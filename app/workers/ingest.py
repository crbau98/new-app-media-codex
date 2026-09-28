"""Background ingestion worker.

A small pool of daemon threads polls the durable ``ingest_jobs`` queue. Jobs
are blocking (network + Pillow + ffmpeg) so threads, not asyncio, are the
right tool; the web event loop is never touched. Failure semantics:

* ``PermanentJobError``  -> job fails immediately (no retry)
* ``RetryableJobError``  -> exponential backoff + jitter until max_attempts
* ``JobCancelled``       -> job ends ``cancelled``
* any other exception    -> treated as retryable (transient by default)
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from typing import Any, Callable

from app.repositories.ingest import IngestStore

logger = logging.getLogger("app.workers.ingest")


class JobCancelled(Exception):
    pass


class PermanentJobError(Exception):
    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code


class RetryableJobError(Exception):
    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code


class JobContext:
    """Handed to handlers: progress reporting + cancellation polling."""

    def __init__(self, job: dict[str, Any], payload: dict[str, Any], store: IngestStore):
        self.job = job
        self.id: str = job["id"]
        self.payload = payload
        self.store = store
        self.attempt: int = job["attempts"]

    def progress(self, stage: str, percent: int, message: str | None = None, level: str = "info") -> None:
        self.check_cancelled()
        self.store.progress(self.id, stage, percent, message, level)

    def log(self, stage: str, message: str, level: str = "info") -> None:
        self.store.progress(self.id, stage, 0, message, level)

    def cancelled(self) -> bool:
        return self.store.is_cancel_requested(self.id)

    def check_cancelled(self) -> None:
        if self.cancelled():
            raise JobCancelled()


Handler = Callable[[JobContext], dict[str, Any]]


class IngestWorker:
    def __init__(
        self,
        store: IngestStore,
        handlers: dict[str, Handler],
        *,
        concurrency: int | None = None,
        poll_interval: float = 1.0,
        stale_after: float = 1800.0,
    ):
        self.store = store
        self.handlers = handlers
        self.concurrency = concurrency or int(os.getenv("INGEST_WORKERS", "1"))
        self.poll_interval = poll_interval
        self.stale_after = stale_after
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._threads: list[threading.Thread] = []
        self._id = f"w-{uuid.uuid4().hex[:8]}"

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        if self._threads:
            return
        try:
            recovered = self.store.recover_stale(self.stale_after)
            if recovered:
                logger.info("ingest: recovered %d stale jobs", recovered)
        except Exception:
            logger.warning("ingest: stale recovery failed", exc_info=True)
        self._stop.clear()
        for i in range(max(1, self.concurrency)):
            t = threading.Thread(target=self._loop, name=f"ingest-worker-{i}", daemon=True, args=(f"{self._id}-{i}",))
            t.start()
            self._threads.append(t)

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        for t in self._threads:
            t.join(timeout)
        self._threads.clear()

    def notify(self) -> None:
        """Wake idle workers (called right after enqueue)."""
        self._wake.set()

    def _loop(self, worker_id: str) -> None:
        while not self._stop.is_set():
            try:
                ran = self.run_once(worker_id)
            except Exception:  # never let the loop die
                logger.exception("ingest: worker loop error")
                ran = False
            if not ran:
                self._wake.wait(self.poll_interval)
                self._wake.clear()

    # -- single step (also used by tests) ----------------------------------

    def run_once(self, worker_id: str | None = None) -> bool:
        job = self.store.claim_next(worker_id or self._id)
        if job is None:
            return False
        self._execute(job)
        return True

    def drain(self, max_jobs: int = 100) -> int:
        n = 0
        while n < max_jobs and self.run_once():
            n += 1
        return n

    def _execute(self, job: dict[str, Any]) -> None:
        payload = self.store.get_raw_payload(job["id"]) or {}
        handler = self.handlers.get(job["kind"])
        if handler is None:
            self.store.fail(job["id"], "unknown_job_kind", f"no handler for {job['kind']!r}", retryable=False)
            return
        ctx = JobContext(job, payload, self.store)
        try:
            ctx.check_cancelled()
            result = handler(ctx)
        except JobCancelled:
            self.store.mark_cancelled(job["id"])
            return
        except PermanentJobError as exc:
            self.store.fail(job["id"], exc.code, str(exc), retryable=False)
            return
        except RetryableJobError as exc:
            self.store.fail(job["id"], exc.code, str(exc), retryable=True)
            return
        except Exception as exc:
            logger.exception("ingest: job %s crashed", job["id"])
            self.store.fail(job["id"], "internal_error", f"{type(exc).__name__}: {exc}", retryable=True)
            return
        if self.store.is_cancel_requested(job["id"]):
            self.store.mark_cancelled(job["id"])
            return
        self.store.succeed(job["id"], result or {})
