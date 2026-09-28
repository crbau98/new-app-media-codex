"""Lazily-built ingestion runtime (store + service + worker) bound to a FastAPI
app. Building is idempotent and thread-safe; the background worker only runs
after ``start_runtime`` (called from the app lifespan), so tests and minimal
apps can drive jobs synchronously with ``runtime.worker.drain()``."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any

from app.media_pipeline.ingest import IngestConfig, IngestService
from app.repositories.ingest import IngestStore, ensure_ingest_schema
from app.workers.ingest import IngestWorker

logger = logging.getLogger(__name__)
_LOCK = threading.Lock()


@dataclass
class IngestRuntime:
    store: IngestStore
    service: IngestService
    worker: IngestWorker


def _screenshots_hooks(config: IngestConfig) -> None:
    """Bind the shared video-cache helpers (looked up at call time so tests may
    monkeypatch them)."""
    try:
        from app.api import screenshots as shots
    except Exception:  # pragma: no cover - API layer unavailable
        return
    config.video_cache_path = lambda shot_id: shots._video_cache_path(shot_id)
    config.evict_video_cache = lambda: shots._evict_video_cache_if_needed()


def get_runtime(app: Any) -> IngestRuntime:
    runtime = getattr(app.state, "ingest_runtime", None)
    if runtime is not None:
        return runtime
    with _LOCK:
        runtime = getattr(app.state, "ingest_runtime", None)
        if runtime is not None:
            return runtime
        db = app.state.db
        with db.connect() as conn:
            ensure_ingest_schema(conn)
        store = IngestStore(db.connect)
        config = IngestConfig()
        _screenshots_hooks(config)
        config.ensure()
        service = IngestService(db, store, config)
        worker = IngestWorker(store, service.handlers())
        runtime = IngestRuntime(store=store, service=service, worker=worker)
        app.state.ingest_runtime = runtime
        return runtime


def start_runtime(app: Any) -> IngestRuntime:
    runtime = get_runtime(app)
    runtime.worker.start()
    logger.info("ingest worker started (%d threads)", runtime.worker.concurrency)
    return runtime


def stop_runtime(app: Any) -> None:
    runtime = getattr(app.state, "ingest_runtime", None)
    if runtime is not None:
        runtime.worker.stop()
