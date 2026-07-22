"""Dependency-injection wiring for the v2 API surface.

Routers declare what they need; this module decides how it's built. Adapter
swaps (memory -> Valkey, SQLite -> Postgres) happen here and only here.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator

from fastapi import Depends, Request

from app.core.idempotency import IdempotencyStore, InMemoryIdempotencyStore
from app.core.rate_limit import RateLimiter, build_limiter
from app.core.settings import CoreSettings, get_core_settings
from app.repositories.media import SqliteMediaRepository
from app.repositories.outbox import SqliteOutboxStore


def get_settings() -> CoreSettings:
    return get_core_settings()


def get_connection(
    settings: CoreSettings = Depends(get_settings),
) -> Iterator[sqlite3.Connection]:
    """Per-request read connection (sync dependency -> runs in the threadpool,
    so the event loop is never blocked). Write paths use SqliteUnitOfWork."""
    conn = sqlite3.connect(str(settings.database_path), timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    try:
        yield conn
    finally:
        conn.close()


def get_media_repository(
    conn: sqlite3.Connection = Depends(get_connection),
) -> SqliteMediaRepository:
    return SqliteMediaRepository(conn)


def get_outbox_store(
    conn: sqlite3.Connection = Depends(get_connection),
) -> SqliteOutboxStore:
    return SqliteOutboxStore(conn)


def get_rate_limiter(request: Request) -> RateLimiter:
    """Single process-wide limiter, built lazily from settings."""
    limiter = getattr(request.app.state, "v2_rate_limiter", None)
    if limiter is None:
        settings = get_core_settings()
        limiter = build_limiter(
            settings.redis_url,
            settings.rate_limit_capacity,
            settings.rate_limit_refill_per_second,
        )
        request.app.state.v2_rate_limiter = limiter
    return limiter


def get_idempotency_store(request: Request) -> IdempotencyStore:
    """In-memory until Phase 1 wires the SQLite store through the UoW."""
    store = getattr(request.app.state, "v2_idempotency_store", None)
    if store is None:
        store = InMemoryIdempotencyStore()
        request.app.state.v2_idempotency_store = store
    return store
