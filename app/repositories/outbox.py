"""Transactional outbox store + schema DDL (blueprint sections 7 and 9).

``enqueue`` runs on the caller's connection inside the same transaction as
the domain write — either both commit or neither does. The relay polls
``fetch_pending`` and finalizes with ``mark_published``/``mark_failed``.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from app.domain.events import DomainEvent

OUTBOX_DDL = """
CREATE TABLE IF NOT EXISTS outbox (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  published_at  TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox(occurred_at) WHERE published_at IS NULL;
"""


@dataclass(frozen=True)
class OutboxMessage:
    id: str
    type: str
    payload_json: str
    occurred_at: str
    attempts: int


def _row_to_message(row: sqlite3.Row) -> OutboxMessage:
    return OutboxMessage(
        id=row["id"],
        type=row["type"],
        payload_json=row["payload_json"],
        occurred_at=row["occurred_at"],
        attempts=row["attempts"],
    )


class SqliteOutboxStore:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    @staticmethod
    def enqueue(conn: sqlite3.Connection, event: DomainEvent) -> None:
        """Append the event on the caller's transaction. Static on purpose:
        it must be impossible to enqueue outside the domain transaction."""
        conn.execute(
            "INSERT INTO outbox (id, type, payload_json, occurred_at) VALUES (?, ?, ?, ?)",
            event.to_outbox_params(),
        )

    def fetch_pending(self, limit: int = 100) -> list[OutboxMessage]:
        rows = self._conn.execute(
            "SELECT id, type, payload_json, occurred_at, attempts FROM outbox"
            " WHERE published_at IS NULL ORDER BY occurred_at LIMIT ?",
            (limit,),
        ).fetchall()
        return [_row_to_message(r) for r in rows]

    def mark_published(self, message_id: str, published_at: str) -> None:
        self._conn.execute(
            "UPDATE outbox SET published_at = ? WHERE id = ?",
            (published_at, message_id),
        )
        self._conn.commit()

    def mark_failed(self, message_id: str) -> None:
        self._conn.execute(
            "UPDATE outbox SET attempts = attempts + 1 WHERE id = ?",
            (message_id,),
        )
        self._conn.commit()

    def pending_count(self) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM outbox WHERE published_at IS NULL"
        ).fetchone()
        return int(row["n"])

    def dead_letters(self, max_attempts: int) -> list[OutboxMessage]:
        rows = self._conn.execute(
            "SELECT id, type, payload_json, occurred_at, attempts FROM outbox"
            " WHERE published_at IS NULL AND attempts >= ? ORDER BY occurred_at",
            (max_attempts,),
        ).fetchall()
        return [_row_to_message(r) for r in rows]
