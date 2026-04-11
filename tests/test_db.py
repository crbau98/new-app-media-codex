"""Unit tests for Database migration and FTS5 search functionality."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path

import pytest

from app.db import Database


# ── Helpers ────────────────────────────────────────────────────────────────────

@pytest.fixture()
def db(tmp_path: Path) -> Database:
    """Return an initialized in-memory-backed Database on a temp file."""
    database = Database(tmp_path / "test.db", timeout_seconds=5, busy_timeout_ms=5000)
    database.init()
    return database


# ── Migration tests ────────────────────────────────────────────────────────────

class TestMigration:
    def test_tables_created(self, db: Database) -> None:
        with db.connect() as conn:
            tables = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()}
        assert "items" in tables
        assert "hypotheses" in tables
        assert "screenshots" in tables
        assert "performers" in tables
        assert "images" in tables

    def test_items_fts_created(self, db: Database) -> None:
        with db.connect() as conn:
            tables = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()}
        assert "items_fts" in tables

    def test_hypotheses_fts_created(self, db: Database) -> None:
        with db.connect() as conn:
            tables = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()}
        assert "hypotheses_fts" in tables

    def test_compound_indexes_created(self, db: Database) -> None:
        with db.connect() as conn:
            indexes = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()}
        assert "idx_items_theme_status" in indexes
        assert "idx_items_theme_source" in indexes
        assert "idx_items_saved_seen" in indexes

    def test_migrate_idempotent(self, tmp_path: Path) -> None:
        """Running init() twice must not raise."""
        database = Database(tmp_path / "test2.db", timeout_seconds=5, busy_timeout_ms=5000)
        database.init()
        database.init()  # second call should be a no-op

    def test_review_status_column_exists(self, db: Database) -> None:
        with db.connect() as conn:
            cols = {row["name"] for row in conn.execute("PRAGMA table_info(items)").fetchall()}
        assert "review_status" in cols

    def test_hypotheses_theme_column_exists(self, db: Database) -> None:
        with db.connect() as conn:
            cols = {row["name"] for row in conn.execute("PRAGMA table_info(hypotheses)").fetchall()}
        assert "theme" in cols


# ── FTS5 search tests ──────────────────────────────────────────────────────────

def _insert_item(db: Database, title: str, summary: str = "", content: str = "") -> int:
    """Insert a minimal item row and return its id."""
    with db.connect() as conn:
        # Ensure a parent run row exists for the FK constraint
        run_cur = conn.execute(
            "INSERT OR IGNORE INTO runs (started_at, status, notes) VALUES (datetime('now'), 'running', '')"
        )
        run_id = run_cur.lastrowid or 1
        conn.commit()
        cur = conn.execute(
            """
            INSERT INTO items (
                source_type, theme, query, title, url, summary, content, author,
                published_at, domain, image_url, score, compounds_json, mechanisms_json,
                metadata_json, first_seen_at, last_seen_at, last_run_id
            ) VALUES (
                'test', 'test_theme', 'q', ?, ?, ?, ?, '',
                '', 'example.com', '', 5.0, '[]', '[]',
                '{}', datetime('now'), datetime('now'), ?
            )
            """,
            (title, f"https://example.com/{hash(title)}", summary, content, run_id),
        )
        conn.commit()
        return int(cur.lastrowid)


class TestFTS5:
    def test_item_indexed_on_insert(self, db: Database) -> None:
        _insert_item(db, "Nitric oxide and erectile function", "Study on NO pathways")
        with db.connect() as conn:
            rows = conn.execute(
                'SELECT rowid FROM items_fts WHERE items_fts MATCH \'"nitric oxide"\'',
            ).fetchall()
        assert len(rows) == 1

    def test_item_not_found_for_unrelated_query(self, db: Database) -> None:
        _insert_item(db, "Unrelated headline", "Nothing here")
        with db.connect() as conn:
            rows = conn.execute(
                "SELECT rowid FROM items_fts WHERE items_fts MATCH '\"quantum computing\"'",
            ).fetchall()
        assert len(rows) == 0

    def test_fts_update_trigger(self, db: Database) -> None:
        item_id = _insert_item(db, "Original title", "summary text")
        with db.connect() as conn:
            conn.execute("UPDATE items SET title = 'Updated title' WHERE id = ?", (item_id,))
            conn.commit()
            rows = conn.execute(
                "SELECT rowid FROM items_fts WHERE items_fts MATCH '\"Updated title\"'",
            ).fetchall()
        assert len(rows) == 1

    def test_fts_delete_trigger(self, db: Database) -> None:
        item_id = _insert_item(db, "Deletable record", "unique phrase zxqwerty")
        with db.connect() as conn:
            conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
            conn.commit()
            rows = conn.execute(
                "SELECT rowid FROM items_fts WHERE items_fts MATCH '\"zxqwerty\"'",
            ).fetchall()
        assert len(rows) == 0


# ── WAL checkpoint tests ───────────────────────────────────────────────────────

class TestWALCheckpoint:
    def test_wal_checkpoint_does_not_raise(self, db: Database) -> None:
        db.wal_checkpoint()  # should succeed silently


# ── Cache utility tests ────────────────────────────────────────────────────────

class TestTimedCache:
    def test_set_and_get(self) -> None:
        from app.cache import TimedCache

        cache: TimedCache[str, int] = TimedCache(ttl=60.0)
        cache.set("key", 42)
        assert cache.get("key") == 42

    def test_miss_returns_none(self) -> None:
        from app.cache import TimedCache

        cache: TimedCache[str, int] = TimedCache(ttl=60.0)
        assert cache.get("missing") is None

    def test_expired_entry_returns_none(self) -> None:
        from app.cache import TimedCache
        import time

        cache: TimedCache[str, str] = TimedCache(ttl=0.001)  # 1 ms TTL
        cache.set("k", "v")
        time.sleep(0.01)
        assert cache.get("k") is None

    def test_max_size_eviction(self) -> None:
        from app.cache import TimedCache

        cache: TimedCache[int, int] = TimedCache(ttl=60.0, max_size=3)
        for i in range(5):
            cache.set(i, i * 10)
        # Only max_size=3 entries should survive
        assert len(cache) <= 3

    def test_get_or_set_calls_builder_on_miss(self) -> None:
        from app.cache import TimedCache

        cache: TimedCache[str, str] = TimedCache(ttl=60.0)
        called = []

        def builder():
            called.append(1)
            return "built"

        result = cache.get_or_set("k", builder)
        assert result == "built"
        assert len(called) == 1

    def test_get_or_set_does_not_call_builder_on_hit(self) -> None:
        from app.cache import TimedCache

        cache: TimedCache[str, str] = TimedCache(ttl=60.0)
        cache.set("k", "cached")
        called = []

        result = cache.get_or_set("k", lambda: called.append(1) or "new")  # type: ignore[return-value]
        assert result == "cached"
        assert len(called) == 0

    def test_invalidate_removes_entry(self) -> None:
        from app.cache import TimedCache

        cache: TimedCache[str, int] = TimedCache(ttl=60.0)
        cache.set("k", 99)
        cache.invalidate("k")
        assert cache.get("k") is None

    def test_clear_removes_all(self) -> None:
        from app.cache import TimedCache

        cache: TimedCache[int, int] = TimedCache(ttl=60.0)
        for i in range(10):
            cache.set(i, i)
        cache.clear()
        assert len(cache) == 0
