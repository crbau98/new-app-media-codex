"""Unit-of-work: one transaction per use-case, domain state + outbox rows
committed together (blueprint section 7 — that's what makes the outbox
transactional)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Protocol


class UnitOfWork(Protocol):
    """Context manager: enter = begin, clean exit = commit, exception = rollback."""

    connection: sqlite3.Connection

    def __enter__(self) -> "UnitOfWork": ...
    def __exit__(self, exc_type, exc, tb) -> bool: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...


class SqliteUnitOfWork:
    """SQLite unit of work with WAL + busy timeout (mirrors production pragmas)."""

    def __init__(self, database_path: Path | str, *, busy_timeout_ms: int = 10_000):
        self._path = str(database_path)
        self._busy_timeout_ms = busy_timeout_ms
        self.connection: sqlite3.Connection  # set in __enter__

    def __enter__(self) -> "SqliteUnitOfWork":
        conn = sqlite3.connect(self._path, timeout=self._busy_timeout_ms / 1000)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(f"PRAGMA busy_timeout={self._busy_timeout_ms}")
        conn.execute("PRAGMA foreign_keys=ON")
        self.connection = conn
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        try:
            if exc_type is None:
                self.connection.commit()
            else:
                self.connection.rollback()
        finally:
            self.connection.close()
        return False  # never swallow exceptions

    def commit(self) -> None:
        self.connection.commit()

    def rollback(self) -> None:
        self.connection.rollback()
