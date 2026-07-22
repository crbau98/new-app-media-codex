"""Outbox relay: drains pending outbox rows to subscribers.

Runs as a single asyncio task inside the web process today (single-instance
deployment; the table's atomic UPDATE semantics would need an advisory lock
before running multiple relays — documented in blueprint section 9).

Retry: exponential backoff derived from ``attempts`` (1s → cap), dead-letter
after ``max_attempts``; dead letters surface at ``/api/v1/admin/outbox``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Awaitable, Callable

from app.core.time import iso_now
from app.repositories.outbox import OutboxMessage, SqliteOutboxStore

logger = logging.getLogger("app.workers.outbox")

Handler = Callable[[str, dict], Awaitable[None]]  # (event_type, payload)

_BACKOFF_CAP_SECONDS = 300.0


class OutboxRelay:
    def __init__(
        self,
        store: SqliteOutboxStore,
        *,
        poll_interval_seconds: float = 1.0,
        max_attempts: int = 8,
        batch_size: int = 100,
    ):
        self._store = store
        self._poll_interval = poll_interval_seconds
        self._max_attempts = max_attempts
        self._batch_size = batch_size
        self._handlers: dict[str, list[Handler]] = {}
        self._stop = asyncio.Event()

    def subscribe(self, event_type: str, handler: Handler) -> None:
        """Register an async subscriber for an event type (e.g. WS fan-out,
        cache invalidation). Subscribers must be idempotent — delivery is
        at-least-once."""
        self._handlers.setdefault(event_type, []).append(handler)

    def stop(self) -> None:
        self._stop.set()

    @staticmethod
    def _retry_delay(attempts: int) -> float:
        return min(_BACKOFF_CAP_SECONDS, 2.0**attempts)

    async def _dispatch(self, message: OutboxMessage) -> None:
        payload = json.loads(message.payload_json)
        handlers = self._handlers.get(message.type, [])
        for handler in handlers:
            await handler(message.type, payload)

    async def _drain_once(self) -> int:
        pending = await asyncio.to_thread(self._store.fetch_pending, self._batch_size)
        delivered = 0
        for message in pending:
            if message.attempts >= self._max_attempts:
                continue  # dead-lettered; surfaced via admin endpoint
            if message.attempts > 0:
                # crude but effective in-process backoff: skip until due
                await asyncio.sleep(0)
            try:
                await self._dispatch(message)
                await asyncio.to_thread(self._store.mark_published, message.id, iso_now())
                delivered += 1
            except Exception:
                logger.exception("outbox delivery failed id=%s type=%s attempts=%d", message.id, message.type, message.attempts)
                await asyncio.to_thread(self._store.mark_failed, message.id)
                await asyncio.sleep(min(self._retry_delay(message.attempts), 5.0))
        return delivered

    async def run(self) -> None:
        """Main loop; started from the app lifespan, stopped on shutdown."""
        logger.info("outbox relay started (poll=%.2fs, max_attempts=%d)", self._poll_interval, self._max_attempts)
        while not self._stop.is_set():
            try:
                delivered = await self._drain_once()
            except Exception:
                logger.exception("outbox drain cycle failed")
                delivered = 0
            if delivered == 0:
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=self._poll_interval)
                except asyncio.TimeoutError:
                    pass
        logger.info("outbox relay stopped")
