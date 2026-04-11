"""Unit tests for Database migration and FTS5 search functionality."""
from __future__ import annotations

import sqlite3
import tempfile
from contextlib import contextmanager
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

    def test_targeted_hot_query_indexes_created(self, db: Database) -> None:
        with db.connect() as conn:
            indexes = {row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()}
        assert "idx_runs_status_id_desc" in indexes
        assert "idx_capture_queue_status_created" in indexes
        assert "idx_capture_queue_finished_at" in indexes
        assert "idx_performers_status_last_checked" in indexes
        assert "idx_telegram_media_filter_posted_created" in indexes

    def test_targeted_hot_query_indexes_use_expected_columns(self, db: Database) -> None:
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT name, sql
                FROM sqlite_master
                WHERE type = 'index'
                  AND name IN (
                      'idx_runs_status_id_desc',
                      'idx_capture_queue_status_created',
                      'idx_capture_queue_finished_at',
                      'idx_performers_status_last_checked',
                      'idx_telegram_media_filter_posted_created'
                  )
                """
            ).fetchall()

        definitions = {
            row["name"]: " ".join((row["sql"] or "").split())
            for row in rows
        }

        assert "runs(status, id DESC)" in definitions["idx_runs_status_id_desc"]
        assert "capture_queue(status, created_at)" in definitions["idx_capture_queue_status_created"]
        assert "capture_queue(finished_at)" in definitions["idx_capture_queue_finished_at"]
        assert "performers(status, last_checked_at)" in definitions["idx_performers_status_last_checked"]
        assert (
            "telegram_media(passes_filter, posted_at DESC, created_at DESC)"
            in definitions["idx_telegram_media_filter_posted_created"]
        )

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


def _insert_performer(
    db: Database,
    username: str,
    *,
    display_name: str | None = None,
    status: str = "active",
    created_at: str = "2024-01-01T00:00:00+00:00",
    platform: str = "OnlyFans",
) -> int:
    with db.connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO performers (
                username, display_name, platform, status, tags,
                first_seen_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                username,
                display_name,
                platform,
                status,
                "[]",
                created_at,
                created_at,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def _insert_screenshot(db: Database, performer_id: int | None, page_url: str) -> int:
    with db.connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO screenshots (
                term, source, page_url, local_path, captured_at, performer_id
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "term",
                "ddg",
                page_url,
                "",
                "2024-01-10T00:00:00+00:00",
                performer_id,
            ),
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


class TestBrowsePerformers:
    def test_browse_performers_returns_screenshot_counts_without_extra_page_count_query(
        self,
        db: Database,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        alpha_id = _insert_performer(db, "alpha", created_at="2024-01-01T00:00:00+00:00")
        _insert_performer(db, "beta", created_at="2024-01-02T00:00:00+00:00")
        _insert_screenshot(db, alpha_id, "https://example.com/a1")
        _insert_screenshot(db, alpha_id, "https://example.com/a2")

        statements: list[str] = []
        original_connect = db.connect

        @contextmanager
        def traced_connect():
            with original_connect() as conn:
                conn.set_trace_callback(statements.append)
                yield conn

        monkeypatch.setattr(db, "connect", traced_connect)

        result = db.browse_performers(sort="created_at", compact=True, limit=10, offset=0)

        screenshot_count_queries = [
            statement
            for statement in statements
            if "COUNT(*) AS cnt FROM screenshots GROUP BY performer_id" in statement
        ]

        assert len(screenshot_count_queries) == 1
        assert not any("WHERE performer_id IN" in statement for statement in statements)
        assert result["total"] == 2
        assert result["has_more"] is False
        assert [performer["username"] for performer in result["performers"]] == ["beta", "alpha"]
        assert [performer["screenshots_count"] for performer in result["performers"]] == [0, 2]

    def test_browse_performers_sorts_by_screenshot_count_and_preserves_full_rows(self, db: Database) -> None:
        alpha_id = _insert_performer(db, "alpha", display_name="Alpha", created_at="2024-01-01T00:00:00+00:00")
        _insert_performer(db, "beta", display_name="Beta", created_at="2024-01-02T00:00:00+00:00")
        gamma_id = _insert_performer(db, "gamma", display_name="Gamma", status="inactive", created_at="2024-01-03T00:00:00+00:00")

        _insert_screenshot(db, alpha_id, "https://example.com/a1")
        _insert_screenshot(db, alpha_id, "https://example.com/a2")
        _insert_screenshot(db, gamma_id, "https://example.com/g1")

        result = db.browse_performers(sort="screenshots_count", compact=False, limit=10, offset=0)
        filtered = db.browse_performers(status="active", sort="created_at", compact=False, limit=10, offset=0)

        assert list(result.keys()) == ["performers", "total", "offset", "limit", "has_more"]
        assert [performer["username"] for performer in result["performers"]] == ["alpha", "gamma", "beta"]
        assert [performer["screenshots_count"] for performer in result["performers"]] == [2, 1, 0]
        assert result["performers"][0]["display_name"] == "Alpha"

        assert filtered["total"] == 2
        assert [performer["username"] for performer in filtered["performers"]] == ["beta", "alpha"]
        assert [performer["screenshots_count"] for performer in filtered["performers"]] == [0, 2]

    @pytest.mark.parametrize("compact", [True, False])
    def test_browse_performers_returns_screenshot_counts_when_filtered(
        self,
        db: Database,
        compact: bool,
    ) -> None:
        alpha_id = _insert_performer(
            db,
            "alpha",
            display_name="Alpha Prime",
            created_at="2024-01-01T00:00:00+00:00",
            platform="OnlyFans",
        )
        beta_id = _insert_performer(
            db,
            "beta",
            display_name="Beta Prime",
            created_at="2024-01-02T00:00:00+00:00",
            platform="OnlyFans",
        )
        gamma_id = _insert_performer(
            db,
            "gamma",
            display_name="Gamma Elsewhere",
            status="inactive",
            created_at="2024-01-03T00:00:00+00:00",
            platform="Fansly",
        )

        _insert_screenshot(db, alpha_id, "https://example.com/a1")
        _insert_screenshot(db, alpha_id, "https://example.com/a2")
        _insert_screenshot(db, beta_id, "https://example.com/b1")
        _insert_screenshot(db, gamma_id, "https://example.com/g1")
        _insert_screenshot(db, None, "https://example.com/unassigned")

        result = db.browse_performers(
            search="Prime",
            platform="OnlyFans",
            status="active",
            sort="screenshots_count",
            compact=compact,
            limit=10,
            offset=0,
        )

        assert result["total"] == 2
        assert result["has_more"] is False
        assert [performer["username"] for performer in result["performers"]] == ["alpha", "beta"]
        assert [performer["screenshots_count"] for performer in result["performers"]] == [2, 1]
        assert all("screenshots_count" in performer for performer in result["performers"])

        if compact:
            assert "status" not in result["performers"][0]
        else:
            assert result["performers"][0]["status"] == "active"


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
