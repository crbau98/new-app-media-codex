"""Persistence layer — the only place SQL lives.

Protocols define what services need; SQLite implementations satisfy them
today; PostgreSQL implementations slot in behind the same protocols at the
ADR-0002 cutover. Services never import sqlite3.

See docs/architecture/backend-redesign.md, sections 3 and 7.
"""

from app.repositories.base import SqliteUnitOfWork, UnitOfWork
from app.repositories.idempotency import SqliteIdempotencyStore
from app.repositories.media import MediaRepository, SqliteMediaRepository
from app.repositories.outbox import SqliteOutboxStore

__all__ = [
    "MediaRepository",
    "SqliteIdempotencyStore",
    "SqliteMediaRepository",
    "SqliteOutboxStore",
    "SqliteUnitOfWork",
    "UnitOfWork",
]
