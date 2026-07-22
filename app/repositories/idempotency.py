"""SQLite store for Idempotency-Key records (core/idempotency.py protocol)
+ table DDL (blueprint section 7)."""

from __future__ import annotations

import sqlite3
import time

from app.core.idempotency import IdempotencyRecord

IDEMPOTENCY_DDL = """
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json TEXT,
  created_at    REAL NOT NULL,
  PRIMARY KEY (key, endpoint)
);
"""


class SqliteIdempotencyStore:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def get(self, key: str, endpoint: str) -> IdempotencyRecord | None:
        row = self._conn.execute(
            "SELECT key, endpoint, request_hash, response_json, created_at"
            " FROM idempotency_keys WHERE key = ? AND endpoint = ?",
            (key, endpoint),
        ).fetchone()
        if row is None:
            return None
        return IdempotencyRecord(
            key=row["key"],
            endpoint=row["endpoint"],
            request_hash=row["request_hash"],
            response_json=row["response_json"],
            created_at=row["created_at"],
        )

    def save(self, record: IdempotencyRecord) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO idempotency_keys"
            " (key, endpoint, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (record.key, record.endpoint, record.request_hash, record.response_json, record.created_at),
        )
        self._conn.commit()

    def purge_expired(self, window_seconds: int) -> int:
        cursor = self._conn.execute(
            "DELETE FROM idempotency_keys WHERE created_at < ?",
            (time.time() - window_seconds,),
        )
        self._conn.commit()
        return cursor.rowcount
