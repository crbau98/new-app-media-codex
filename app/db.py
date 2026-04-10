from __future__ import annotations

import json
import re
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
import time
from typing import Any, Iterator

from app.performer_identity import (
    find_best_identity_match,
    performer_identity_signatures,
    score_candidate_identity,
)

COMPOUND_EXCLUDE = {
    "AND",
    "ARE",
    "BUT",
    "CI",
    "CSFQ",
    "DOI",
    "ED",
    "FAQ",
    "FDA",
    "FOR",
    "FSFI",
    "GRADE",
    "HT",
    "IELT",
    "II",
    "IIEF",
    "LILACS",
    "MED",
    "MORE",
    "NO",
    "NOT",
    "NOS",
    "OR",
    "PE",
    "PEDT",
    "PPR",
    "PSSD",
    "RCT",
    "RR",
    "SD",
    "SNRI",
    "SRI",
    "SSRI",
    "TCM",
    "THE",
    "TRT",
    "VED",
    "VERY",
    "WAY",
    "WITH",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    theme TEXT NOT NULL,
    query TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    author TEXT NOT NULL,
    published_at TEXT,
    domain TEXT NOT NULL,
    image_url TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    compounds_json TEXT NOT NULL DEFAULT '[]',
    mechanisms_json TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    review_status TEXT NOT NULL DEFAULT 'new',
    is_saved INTEGER NOT NULL DEFAULT 0,
    user_note TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_run_id INTEGER,
    FOREIGN KEY(last_run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_items_theme ON items(theme);
CREATE INDEX IF NOT EXISTS idx_items_last_seen ON items(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    source_type TEXT NOT NULL,
    theme TEXT NOT NULL,
    title TEXT NOT NULL,
    image_url TEXT NOT NULL,
    page_url TEXT NOT NULL,
    thumb_url TEXT NOT NULL,
    local_path TEXT NOT NULL,
    original_path TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(image_url, page_url),
    FOREIGN KEY(item_id) REFERENCES items(id)
);

CREATE INDEX IF NOT EXISTS idx_images_theme ON images(theme);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);

CREATE TABLE IF NOT EXISTS hypotheses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    evidence TEXT NOT NULL,
    novelty_score REAL NOT NULL,
    safety_flags TEXT NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'new',
    is_saved INTEGER NOT NULL DEFAULT 0,
    user_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_hypotheses_run ON hypotheses(run_id DESC);

CREATE TABLE IF NOT EXISTS compound_cache (
    name TEXT PRIMARY KEY,
    cid TEXT,
    iupac TEXT,
    molecular_weight REAL,
    pharmacology TEXT,
    pubmed_cids TEXT,
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    source TEXT NOT NULL,
    page_url TEXT NOT NULL UNIQUE,
    local_path TEXT NOT NULL,
    captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS themes (
    slug TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS telegram_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    member_count INTEGER,
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_discovered INTEGER NOT NULL DEFAULT 0,
    last_scanned_at TEXT,
    added_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_username TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    file_size INTEGER,
    caption TEXT,
    local_path TEXT,
    passes_filter INTEGER NOT NULL DEFAULT 1,
    posted_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(channel_username, message_id)
);

CREATE TABLE IF NOT EXISTS user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6b7280'
);

CREATE TABLE IF NOT EXISTS item_tags (
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    icon TEXT DEFAULT '📁',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    added_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, item_id)
);

CREATE TABLE IF NOT EXISTS performers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    platform TEXT NOT NULL DEFAULT 'onlyfans',
    profile_url TEXT,
    avatar_url TEXT,
    avatar_local TEXT,
    bio TEXT,
    tags TEXT,
    follower_count INTEGER,
    media_count INTEGER,
    is_verified INTEGER DEFAULT 0,
    is_favorite INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    discovered_via TEXT,
    first_seen_at TEXT DEFAULT (datetime('now')),
    last_checked_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_performers_platform ON performers(platform);
CREATE INDEX IF NOT EXISTS idx_performers_status ON performers(status);
CREATE INDEX IF NOT EXISTS idx_performers_favorite ON performers(is_favorite);

CREATE TABLE IF NOT EXISTS performer_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    performer_id INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL,
    source_url TEXT,
    local_path TEXT,
    thumbnail_path TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    file_size INTEGER,
    caption TEXT,
    ai_summary TEXT,
    ai_tags TEXT,
    is_favorite INTEGER DEFAULT 0,
    captured_at TEXT DEFAULT (datetime('now')),
    UNIQUE(performer_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_performer_media_performer ON performer_media(performer_id);

CREATE TABLE IF NOT EXISTS performer_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    performer_id INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    username TEXT,
    UNIQUE(performer_id, platform)
);

CREATE TABLE IF NOT EXISTS capture_queue (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    performer_id   INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
    status         TEXT NOT NULL DEFAULT 'queued',
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    started_at     TEXT,
    finished_at    TEXT,
    captured_count INTEGER NOT NULL DEFAULT 0,
    error_msg      TEXT
);
CREATE INDEX IF NOT EXISTS idx_capture_queue_status    ON capture_queue(status);
CREATE INDEX IF NOT EXISTS idx_capture_queue_performer ON capture_queue(performer_id);

CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    is_smart INTEGER DEFAULT 0,
    smart_rules TEXT,
    item_count INTEGER DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    UNIQUE(playlist_id, screenshot_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def check_disk_space(path: Path, min_free_mb: int = 500) -> dict:
    """Check available disk space. Returns dict with total, used, free in MB."""
    usage = shutil.disk_usage(path)
    return {
        "total_mb": usage.total // (1024 * 1024),
        "used_mb": usage.used // (1024 * 1024),
        "free_mb": usage.free // (1024 * 1024),
        "percent_used": round(usage.used / usage.total * 100, 1),
        "low_space": usage.free < min_free_mb * 1024 * 1024,
    }


class Database:
    def __init__(self, path: Path, timeout_seconds: float = 10.0, busy_timeout_ms: int = 10000) -> None:
        self.path = path
        self.timeout_seconds = timeout_seconds
        self.busy_timeout_ms = busy_timeout_ms
        self._snapshot_cache: dict[str, dict[str, Any]] = {}
        self._snapshot_cache_lock = Lock()
        self._snapshot_generation = 0

    def snapshot_generation(self) -> int:
        with self._snapshot_cache_lock:
            return self._snapshot_generation

    def _invalidate_snapshot_cache(self) -> None:
        with self._snapshot_cache_lock:
            self._snapshot_generation += 1
            self._snapshot_cache.clear()

    def _cached_snapshot(self, key: str, ttl_seconds: float, builder):
        now = time.monotonic()
        with self._snapshot_cache_lock:
            generation = self._snapshot_generation
            entry = self._snapshot_cache.get(key)
            if entry and now < entry["expires_at"] and entry.get("generation") == generation:
                return entry["payload"]

        payload = builder()
        expires_at = time.monotonic() + ttl_seconds
        with self._snapshot_cache_lock:
            if len(self._snapshot_cache) > 512:
                expired = [
                    cache_key
                    for cache_key, cache_entry in self._snapshot_cache.items()
                    if now >= cache_entry["expires_at"]
                ]
                for cache_key in expired:
                    self._snapshot_cache.pop(cache_key, None)
                if len(self._snapshot_cache) > 512:
                    self._snapshot_cache.clear()
            if self._snapshot_generation == generation:
                self._snapshot_cache[key] = {
                    "expires_at": expires_at,
                    "payload": payload,
                    "generation": generation,
                }
        return payload

    def _invalidate_after_write(self) -> None:
        self._invalidate_snapshot_cache()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        for attempt in range(3):
            try:
                conn = sqlite3.connect(self.path, timeout=self.timeout_seconds)
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA foreign_keys = ON")
                conn.execute(f"PRAGMA busy_timeout = {self.busy_timeout_ms}")
                conn.execute("SELECT 1")  # verify connection actually works
                break
            except sqlite3.OperationalError:
                if attempt == 2:
                    raise
                import time as _time
                _time.sleep(0.5 * (attempt + 1))
        try:
            yield conn
        finally:
            conn.close()

    def ping(self) -> bool:
        try:
            conn = sqlite3.connect(self.path, timeout=2)
            conn.execute("SELECT 1").fetchone()
            conn.close()
            return True
        except Exception:
            return False

    def init(self) -> None:
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA cache_size = -65536")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.execute("PRAGMA temp_store = MEMORY")
            conn.execute("PRAGMA journal_size_limit = 67108864")
            conn.executescript(SCHEMA)
            self._migrate(conn)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_items_review_status ON items(review_status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_items_saved ON items(is_saved)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_items_first_seen ON items(first_seen_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_items_source_type ON items(source_type)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_items_queued ON items(queued_at) WHERE queued_at IS NOT NULL")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_images_source_type ON images(source_type)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_hypotheses_review_status ON hypotheses(review_status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_hypotheses_saved ON hypotheses(is_saved)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_hypotheses_theme ON hypotheses(theme)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_term ON screenshots(term)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_source ON screenshots(source)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tags_name_lower ON tags(LOWER(name))")
            conn.commit()

    def repair_moved_repo_paths(self, current_base_dir: Path, project_name: str = "App research codex") -> int:
        """Rebase stored absolute paths when the repo directory has moved."""
        targets = [
            ("screenshots", "id", "local_path"),
            ("images", "id", "local_path"),
            ("images", "id", "original_path"),
            ("telegram_media", "id", "local_path"),
            ("performers", "id", "avatar_local"),
            ("performer_media", "id", "local_path"),
            ("performer_media", "id", "thumbnail_path"),
        ]

        def rebased(value: str | None) -> str | None:
            if not value:
                return None
            raw = str(value).strip()
            if not raw.startswith("/"):
                return None
            if raw.startswith(str(current_base_dir)):
                return None
            path = Path(raw)
            try:
                marker_index = path.parts.index(project_name)
            except ValueError:
                return None
            relative_tail = Path(*path.parts[marker_index + 1 :])
            candidate = current_base_dir / relative_tail
            if not candidate.exists():
                return None
            return str(candidate)

        updated = 0
        with self.connect() as conn:
            for table, id_column, path_column in targets:
                try:
                    rows = conn.execute(
                        f"SELECT {id_column} AS row_id, {path_column} AS path_value "
                        f"FROM {table} WHERE {path_column} IS NOT NULL AND {path_column} != ''"
                    ).fetchall()
                except sqlite3.OperationalError:
                    continue
                for row in rows:
                    new_value = rebased(row["path_value"])
                    if not new_value:
                        continue
                    conn.execute(
                        f"UPDATE {table} SET {path_column} = ? WHERE {id_column} = ?",
                        (new_value, row["row_id"]),
                    )
                    updated += 1
            if updated:
                conn.commit()
                self._invalidate_after_write()
        return updated

    def _migrate(self, conn: sqlite3.Connection) -> None:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(items)").fetchall()}
        if "review_status" not in columns:
            conn.execute("ALTER TABLE items ADD COLUMN review_status TEXT NOT NULL DEFAULT 'new'")
        if "is_saved" not in columns:
            conn.execute("ALTER TABLE items ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 0")
        if "user_note" not in columns:
            conn.execute("ALTER TABLE items ADD COLUMN user_note TEXT NOT NULL DEFAULT ''")
        hypothesis_columns = {row["name"] for row in conn.execute("PRAGMA table_info(hypotheses)").fetchall()}
        if "review_status" not in hypothesis_columns:
            conn.execute("ALTER TABLE hypotheses ADD COLUMN review_status TEXT NOT NULL DEFAULT 'new'")
        if "is_saved" not in hypothesis_columns:
            conn.execute("ALTER TABLE hypotheses ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 0")
        if "user_note" not in hypothesis_columns:
            conn.execute("ALTER TABLE hypotheses ADD COLUMN user_note TEXT NOT NULL DEFAULT ''")
        if "theme" not in hypothesis_columns:
            conn.execute("ALTER TABLE hypotheses ADD COLUMN theme TEXT NOT NULL DEFAULT ''")
        if "body" not in hypothesis_columns:
            conn.execute("ALTER TABLE hypotheses ADD COLUMN body TEXT NOT NULL DEFAULT ''")
        image_columns = {row["name"] for row in conn.execute("PRAGMA table_info(images)").fetchall()}
        if "original_path" not in image_columns:
            conn.execute("ALTER TABLE images ADD COLUMN original_path TEXT DEFAULT ''")
        # screenshots table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS screenshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                term TEXT NOT NULL,
                source TEXT NOT NULL,
                page_url TEXT NOT NULL UNIQUE,
                local_path TEXT NOT NULL,
                captured_at TEXT NOT NULL
            )
        """)
        # Add ai_summary / ai_tags / performer_id columns if they don't exist yet
        screenshot_columns = {row["name"] for row in conn.execute("PRAGMA table_info(screenshots)").fetchall()}
        if "performer_id" not in screenshot_columns:
            conn.execute("ALTER TABLE screenshots ADD COLUMN performer_id INTEGER REFERENCES performers(id) ON DELETE SET NULL")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_performer ON screenshots(performer_id)")
        if "ai_summary" not in screenshot_columns:
            conn.execute("ALTER TABLE screenshots ADD COLUMN ai_summary TEXT DEFAULT NULL")
        if "ai_tags" not in screenshot_columns:
            conn.execute("ALTER TABLE screenshots ADD COLUMN ai_tags TEXT DEFAULT NULL")
        if "rating" not in screenshot_columns:
            conn.execute("ALTER TABLE screenshots ADD COLUMN rating INTEGER DEFAULT 0")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_rating ON screenshots(rating)")
        if "user_tags" not in screenshot_columns:
            conn.execute("ALTER TABLE screenshots ADD COLUMN user_tags TEXT DEFAULT NULL")
        if "source_url" not in screenshot_columns:
            conn.execute("ALTER TABLE screenshots ADD COLUMN source_url TEXT")
        if "thumbnail_url" not in screenshot_columns:
            conn.execute("ALTER TABLE screenshots ADD COLUMN thumbnail_url TEXT")
        # Performer subscription tracking columns
        performer_columns = {row["name"] for row in conn.execute("PRAGMA table_info(performers)").fetchall()}
        if "subscription_price" not in performer_columns:
            conn.execute("ALTER TABLE performers ADD COLUMN subscription_price REAL DEFAULT NULL")
        if "is_subscribed" not in performer_columns:
            conn.execute("ALTER TABLE performers ADD COLUMN is_subscribed INTEGER DEFAULT 0")
        if "subscription_renewed_at" not in performer_columns:
            conn.execute("ALTER TABLE performers ADD COLUMN subscription_renewed_at TEXT DEFAULT NULL")
        if "reddit_username" not in performer_columns:
            conn.execute("ALTER TABLE performers ADD COLUMN reddit_username TEXT DEFAULT NULL")
        if "twitter_username" not in performer_columns:
            conn.execute("ALTER TABLE performers ADD COLUMN twitter_username TEXT DEFAULT NULL")
        # Create FTS index for AI summaries
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS screenshots_fts
            USING fts5(ai_summary, ai_tags, content=screenshots, content_rowid=id)
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS screenshots_fts_ai AFTER INSERT ON screenshots BEGIN
              INSERT INTO screenshots_fts(rowid, ai_summary, ai_tags)
              VALUES (new.id, new.ai_summary, new.ai_tags);
            END
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS screenshots_fts_au AFTER UPDATE OF ai_summary, ai_tags ON screenshots BEGIN
              INSERT INTO screenshots_fts(screenshots_fts, rowid, ai_summary, ai_tags)
              VALUES('delete', old.id, old.ai_summary, old.ai_tags);
              INSERT INTO screenshots_fts(rowid, ai_summary, ai_tags)
              VALUES (new.id, new.ai_summary, new.ai_tags);
            END
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS screenshots_fts_ad AFTER DELETE ON screenshots BEGIN
              INSERT INTO screenshots_fts(screenshots_fts, rowid, ai_summary, ai_tags)
              VALUES('delete', old.id, old.ai_summary, old.ai_tags);
            END
        """)
        # Only rebuild FTS if the index is empty (first-time population)
        try:
            fts_count = conn.execute("SELECT COUNT(*) FROM screenshots_fts").fetchone()[0]
            if fts_count == 0:
                conn.execute("INSERT INTO screenshots_fts(screenshots_fts) VALUES('rebuild')")
        except Exception:
            pass
        # user_settings table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        # telegram tables
        conn.execute("""
            CREATE TABLE IF NOT EXISTS telegram_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                member_count INTEGER,
                description TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                auto_discovered INTEGER NOT NULL DEFAULT 0,
                last_scanned_at TEXT,
                added_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS telegram_media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_username TEXT NOT NULL,
                message_id INTEGER NOT NULL,
                media_type TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                duration INTEGER,
                file_size INTEGER,
                caption TEXT,
                local_path TEXT,
                passes_filter INTEGER NOT NULL DEFAULT 1,
                posted_at TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(channel_username, message_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_telegram_media_channel ON telegram_media(channel_username)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_telegram_media_passes_filter ON telegram_media(passes_filter)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_telegram_media_posted_at ON telegram_media(posted_at DESC)")
        # tags tables
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT DEFAULT '#6b7280'
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS item_tags (
                item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
                tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (item_id, tag_id)
            )
        """)
        # collections tables
        conn.execute("""
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                color TEXT DEFAULT '#3b82f6',
                icon TEXT DEFAULT '📁',
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS collection_items (
                collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
                item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
                added_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (collection_id, item_id)
            )
        """)
        # queued_at column for reading queue
        if "queued_at" not in columns:
            conn.execute("ALTER TABLE items ADD COLUMN queued_at TEXT DEFAULT NULL")
        # performer tables
        conn.execute("""
            CREATE TABLE IF NOT EXISTS performers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT,
                platform TEXT NOT NULL DEFAULT 'onlyfans',
                profile_url TEXT,
                avatar_url TEXT,
                avatar_local TEXT,
                bio TEXT,
                tags TEXT,
                follower_count INTEGER,
                media_count INTEGER,
                is_verified INTEGER DEFAULT 0,
                is_favorite INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                notes TEXT,
                discovered_via TEXT,
                first_seen_at TEXT DEFAULT (datetime('now')),
                last_checked_at TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_platform ON performers(platform)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_status ON performers(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_favorite ON performers(is_favorite)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS performer_media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                performer_id INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
                media_type TEXT NOT NULL,
                source_url TEXT,
                local_path TEXT,
                thumbnail_path TEXT,
                width INTEGER,
                height INTEGER,
                duration INTEGER,
                file_size INTEGER,
                caption TEXT,
                ai_summary TEXT,
                ai_tags TEXT,
                is_favorite INTEGER DEFAULT 0,
                captured_at TEXT DEFAULT (datetime('now')),
                UNIQUE(performer_id, source_url)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performer_media_performer ON performer_media(performer_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS performer_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                performer_id INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
                platform TEXT NOT NULL,
                url TEXT NOT NULL,
                username TEXT,
                UNIQUE(performer_id, platform)
            )
        """)
        # Playlists tables
        conn.execute("""
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                cover_url TEXT,
                is_smart INTEGER DEFAULT 0,
                smart_rules TEXT,
                item_count INTEGER DEFAULT 0,
                total_duration INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS playlist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                screenshot_id INTEGER NOT NULL REFERENCES screenshots(id) ON DELETE CASCADE,
                position INTEGER DEFAULT 0,
                added_at TEXT DEFAULT (datetime('now')),
                UNIQUE(playlist_id, screenshot_id)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist ON playlist_items(playlist_id)")
        # capture_queue table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS capture_queue (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                performer_id   INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
                status         TEXT NOT NULL DEFAULT 'queued',
                created_at     TEXT NOT NULL DEFAULT (datetime('now')),
                started_at     TEXT,
                finished_at    TEXT,
                captured_count INTEGER NOT NULL DEFAULT 0,
                error_msg      TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_capture_queue_status ON capture_queue(status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_capture_queue_performer ON capture_queue(performer_id)")
        # Composite indices for common screenshot browse patterns
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_performer_captured ON screenshots(performer_id, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_rating_captured ON screenshots(rating DESC, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_term_captured ON screenshots(term, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_source_captured ON screenshots(source, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_browse ON screenshots(source, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_term_date ON screenshots(term, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_performer_rating_captured ON screenshots(performer_id, rating DESC, captured_at DESC)")
        # Partial index: fast scan when filtering to performer-linked shots only
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_has_performer ON screenshots(captured_at DESC) WHERE performer_id IS NOT NULL")
        # Compound index: term + performer browsing (Creators Only filter within a term)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_term_performer_captured ON screenshots(term, performer_id, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performer_media_performer_captured ON performer_media(performer_id, captured_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_platform_created ON performers(platform, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_status_created ON performers(status, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_favorite_created ON performers(is_favorite, created_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_username ON performers(username)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_source_url ON screenshots(source_url)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_performers_display_name ON performers(display_name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_images_source_created ON images(source_type, created_at DESC)")
        conn.execute("PRAGMA optimize")

    def start_run(self) -> int:
        with self.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO runs (started_at, status, notes) VALUES (?, ?, ?)",
                (utcnow(), "running", ""),
            )
            conn.commit()
        self._invalidate_after_write()
        return int(cursor.lastrowid)

    def finish_run(self, run_id: int, status: str, notes: dict[str, Any] | None = None) -> None:
        payload = json.dumps(notes or {}, ensure_ascii=True, indent=2)
        with self.connect() as conn:
            conn.execute(
                "UPDATE runs SET finished_at = ?, status = ?, notes = ? WHERE id = ?",
                (utcnow(), status, payload, run_id),
            )
            conn.commit()
        self._invalidate_after_write()

    def _parse_notes(self, value: str | None) -> dict[str, Any]:
        if not value:
            return {}
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {"raw": value}

    def upsert_item(self, item: dict[str, Any], run_id: int) -> tuple[int, bool]:
        now = utcnow()
        with self.connect() as conn:
            current = conn.execute("SELECT id FROM items WHERE url = ?", (item["url"],)).fetchone()
            if current:
                conn.execute(
                    """
                    UPDATE items
                    SET source_type = ?, theme = ?, query = ?, title = ?, summary = ?, content = ?, author = ?,
                        published_at = ?, domain = ?, image_url = ?, score = ?, compounds_json = ?, mechanisms_json = ?,
                        metadata_json = ?, last_seen_at = ?, last_run_id = ?
                    WHERE url = ?
                    """,
                    (
                        item["source_type"],
                        item["theme"],
                        item["query"],
                        item["title"],
                        item["summary"],
                        item["content"],
                        item["author"],
                        item["published_at"],
                        item["domain"],
                        item["image_url"],
                        item["score"],
                        json.dumps(item["compounds"], ensure_ascii=True),
                        json.dumps(item["mechanisms"], ensure_ascii=True),
                        json.dumps(item["metadata_json"], ensure_ascii=True),
                        now,
                        run_id,
                        item["url"],
                    ),
                )
                conn.commit()
                self._invalidate_after_write()
                return int(current["id"]), False

            cursor = conn.execute(
                """
                INSERT INTO items (
                    source_type, theme, query, title, url, summary, content, author,
                    published_at, domain, image_url, score, compounds_json, mechanisms_json,
                    metadata_json, first_seen_at, last_seen_at, last_run_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["source_type"],
                    item["theme"],
                    item["query"],
                    item["title"],
                    item["url"],
                    item["summary"],
                    item["content"],
                    item["author"],
                    item["published_at"],
                    item["domain"],
                    item["image_url"],
                    item["score"],
                    json.dumps(item["compounds"], ensure_ascii=True),
                    json.dumps(item["mechanisms"], ensure_ascii=True),
                    json.dumps(item["metadata_json"], ensure_ascii=True),
                    now,
                    now,
                    run_id,
                ),
            )
            conn.commit()
            self._invalidate_after_write()
            return int(cursor.lastrowid), True

    def insert_image(self, image: dict[str, Any], item_id: int | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO images (
                    item_id, source_type, theme, title, image_url, page_url,
                    thumb_url, local_path, original_path, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    image["source_type"],
                    image["theme"],
                    image["title"],
                    image["image_url"],
                    image["page_url"],
                    image["thumb_url"],
                    image["local_path"],
                    image.get("original_path", ""),
                    utcnow(),
                ),
            )
            conn.commit()
        self._invalidate_after_write()

    def replace_hypotheses(self, run_id: int, hypotheses: list[dict[str, Any]]) -> None:
        with self.connect() as conn:
            for hypothesis in hypotheses:
                conn.execute(
                    """
                    INSERT INTO hypotheses (
                        run_id, title, rationale, evidence, novelty_score, safety_flags, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        hypothesis["title"],
                        hypothesis["rationale"],
                        hypothesis["evidence"],
                        hypothesis["novelty_score"],
                        hypothesis["safety_flags"],
                        utcnow(),
                    ),
                )
            conn.commit()
        self._invalidate_after_write()

    def _row_to_item(self, row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["compounds"] = json.loads(item.pop("compounds_json") or "[]")
        item["mechanisms"] = json.loads(item.pop("mechanisms_json") or "[]")
        item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
        item["is_saved"] = bool(item.get("is_saved"))
        item.setdefault("queued_at", None)
        return item

    def _row_to_hypothesis(self, row: sqlite3.Row) -> dict[str, Any]:
        hypothesis = dict(row)
        hypothesis["is_saved"] = bool(hypothesis.get("is_saved"))
        return hypothesis

    @staticmethod
    def _apply_content_filters(query: str, params: list[Any]) -> tuple[str, list[Any]]:
        query += " AND theme != ? AND source_type NOT LIKE ?"
        params.extend(["community_visuals", "%_visual%"])
        return query, params

    @staticmethod
    def _fetch_page(
        conn: sqlite3.Connection,
        select_clause: str,
        base_query: str,
        params: list[Any],
        order_by: str,
        limit: int,
        offset: int,
    ) -> tuple[list[sqlite3.Row], int, bool]:
        rows = conn.execute(
            f"{select_clause} {base_query} ORDER BY {order_by} LIMIT ? OFFSET ?",
            [*params, limit + 1, offset],
        ).fetchall()
        if offset == 0:
            total = conn.execute(f"SELECT COUNT(*) {base_query}", params).fetchone()[0]
        else:
            total = offset + len(rows)
        return rows, int(total), len(rows) > limit

    def _build_item_query(
        self,
        *,
        theme: str | None = None,
        source_type: str | None = None,
        review_status: str | None = None,
        saved_only: bool = False,
        queued_only: bool = False,
        search: str = "",
        compound: str | None = None,
        mechanism: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        tag: str | None = None,
        min_score: float | None = None,
    ) -> tuple[str, list[Any]]:
        query = "FROM items WHERE 1=1"
        params: list[Any] = []
        if theme:
            query += " AND theme = ?"
            params.append(theme)
        if source_type:
            query += " AND source_type = ?"
            params.append(source_type)
        if review_status:
            query += " AND review_status = ?"
            params.append(review_status)
        if saved_only:
            query += " AND is_saved = 1"
        if queued_only:
            query += " AND queued_at IS NOT NULL"
        if search.strip():
            needle = f"%{search.strip().lower()}%"
            query += """
             AND lower(
                 COALESCE(title, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content, '') || ' ' ||
                 COALESCE(domain, '') || ' ' || COALESCE(author, '') || ' ' || COALESCE(user_note, '') || ' ' ||
                 COALESCE(compounds_json, '') || ' ' || COALESCE(mechanisms_json, '')
             ) LIKE ?
            """
            params.append(needle)
        if compound:
            query += " AND LOWER(compounds_json) LIKE ?"
            params.append(f'%"{compound.lower()}"%')
        if mechanism:
            query += " AND LOWER(mechanisms_json) LIKE ?"
            params.append(f'%"{mechanism.lower()}"%')
        if date_from:
            query += " AND (published_at >= ? OR first_seen_at >= ?)"
            params.extend([date_from, date_from])
        if date_to:
            query += " AND (published_at <= ? OR first_seen_at <= ?)"
            params.extend([date_to, date_to])
        if tag:
            query += " AND items.id IN (SELECT it.item_id FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE LOWER(t.name) = LOWER(?))"
            params.append(tag)
        if min_score is not None:
            query += " AND score >= ?"
            params.append(min_score)
        query, params = self._apply_content_filters(query, params)
        return query, params

    # ── Tag methods ────────────────────────────────────────────────────────────

    def get_all_tags(self) -> list[dict[str, Any]]:
        def build():
            with self.connect() as conn:
                rows = conn.execute("""
                    SELECT t.id, t.name, t.color, COUNT(it.item_id) AS usage_count
                    FROM tags t
                    LEFT JOIN item_tags it ON it.tag_id = t.id
                    GROUP BY t.id
                    ORDER BY t.name COLLATE NOCASE
                """).fetchall()
            return [dict(r) for r in rows]

        return self._cached_snapshot("all_tags", 10.0, build)

    def create_tag(self, name: str, color: str = "#6b7280") -> dict[str, Any]:
        with self.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO tags (name, color) VALUES (?, ?)",
                (name.strip(), color),
            )
            conn.commit()
            tag_id = int(cursor.lastrowid)
        return {"id": tag_id, "name": name.strip(), "color": color, "usage_count": 0}

    def delete_tag(self, tag_id: int) -> bool:
        with self.connect() as conn:
            conn.execute("DELETE FROM item_tags WHERE tag_id = ?", (tag_id,))
            cursor = conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
            conn.commit()
        self._invalidate_after_write()
        return cursor.rowcount > 0

    def get_item_tags(self, item_id: int) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("""
                SELECT t.id, t.name, t.color
                FROM tags t
                JOIN item_tags it ON it.tag_id = t.id
                WHERE it.item_id = ?
                ORDER BY t.name COLLATE NOCASE
            """, (item_id,)).fetchall()
        return [dict(r) for r in rows]

    def add_item_tag(self, item_id: int, tag_id: int) -> bool:
        with self.connect() as conn:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)",
                    (item_id, tag_id),
                )
                conn.commit()
                self._invalidate_after_write()
                return True
            except Exception:
                return False

    def remove_item_tag(self, item_id: int, tag_id: int) -> bool:
        with self.connect() as conn:
            cursor = conn.execute(
                "DELETE FROM item_tags WHERE item_id = ? AND tag_id = ?",
                (item_id, tag_id),
            )
            conn.commit()
        self._invalidate_after_write()
        return cursor.rowcount > 0

    def get_or_create_tag(self, name: str, color: str = "#6b7280") -> dict[str, Any]:
        with self.connect() as conn:
            row = conn.execute("SELECT id, name, color FROM tags WHERE LOWER(name) = LOWER(?)", (name.strip(),)).fetchone()
            if row:
                return dict(row)
            cursor = conn.execute(
                "INSERT INTO tags (name, color) VALUES (?, ?)",
                (name.strip(), color),
            )
            conn.commit()
            return {"id": int(cursor.lastrowid), "name": name.strip(), "color": color}

    # ── Duplicate detection & merge ────────────────────────────────────────────

    def find_duplicate_groups(self, max_groups: int = 20) -> list[dict[str, Any]]:
        """Find potential duplicate items by exact URL or case-insensitive title match."""
        groups: list[dict[str, Any]] = []

        with self.connect() as conn:
            # 1. Same URL (items table has UNIQUE on url, but data may have been
            #    inserted with minor variations or the constraint was relaxed)
            url_rows = conn.execute("""
                SELECT a.id AS id_a, b.id AS id_b,
                       a.title AS title_a, b.title AS title_b,
                       a.url, a.source_type AS src_a, b.source_type AS src_b
                FROM items a
                JOIN items b ON a.url = b.url AND a.id < b.id
                LIMIT ?
            """, (max_groups,)).fetchall()

            seen_ids: set[frozenset[int]] = set()
            for r in url_rows:
                pair = frozenset({r["id_a"], r["id_b"]})
                if pair in seen_ids:
                    continue
                seen_ids.add(pair)
                groups.append({
                    "reason": "same_url",
                    "items": [
                        self._dup_item_dict(conn, r["id_a"]),
                        self._dup_item_dict(conn, r["id_b"]),
                    ],
                })
                if len(groups) >= max_groups:
                    break

            # 2. Case-insensitive identical titles (different IDs)
            if len(groups) < max_groups:
                title_rows = conn.execute("""
                    SELECT a.id AS id_a, b.id AS id_b
                    FROM items a
                    JOIN items b ON LOWER(TRIM(a.title)) = LOWER(TRIM(b.title))
                                 AND a.id < b.id
                                 AND a.url != b.url
                    LIMIT ?
                """, (max_groups - len(groups),)).fetchall()

                for r in title_rows:
                    pair = frozenset({r["id_a"], r["id_b"]})
                    if pair in seen_ids:
                        continue
                    seen_ids.add(pair)
                    groups.append({
                        "reason": "similar_title",
                        "items": [
                            self._dup_item_dict(conn, r["id_a"]),
                            self._dup_item_dict(conn, r["id_b"]),
                        ],
                    })
                    if len(groups) >= max_groups:
                        break

        return groups

    def _dup_item_dict(self, conn: sqlite3.Connection, item_id: int) -> dict[str, Any]:
        row = conn.execute(
            "SELECT id, title, url, source_type, theme, score, review_status, first_seen_at FROM items WHERE id = ?",
            (item_id,),
        ).fetchone()
        return dict(row) if row else {"id": item_id}

    def merge_items(self, keep_id: int, remove_ids: list[int]) -> int:
        """Merge items: transfer tags/collections from remove_ids to keep_id, then delete remove_ids."""
        merged = 0
        with self.connect() as conn:
            # Verify keep_id exists
            keeper = conn.execute("SELECT id FROM items WHERE id = ?", (keep_id,)).fetchone()
            if not keeper:
                return 0

            for rid in remove_ids:
                if rid == keep_id:
                    continue
                victim = conn.execute("SELECT id FROM items WHERE id = ?", (rid,)).fetchone()
                if not victim:
                    continue

                # Transfer tags (ignore duplicates)
                conn.execute("""
                    INSERT OR IGNORE INTO item_tags (item_id, tag_id)
                    SELECT ?, tag_id FROM item_tags WHERE item_id = ?
                """, (keep_id, rid))

                # Transfer collection memberships (ignore duplicates)
                conn.execute("""
                    INSERT OR IGNORE INTO collection_items (collection_id, item_id, added_at)
                    SELECT collection_id, ?, added_at FROM collection_items WHERE item_id = ?
                """, (keep_id, rid))

                # Delete the duplicate item (cascades remove its tag/collection links)
                conn.execute("DELETE FROM items WHERE id = ?", (rid,))
                merged += 1

            conn.commit()
        self._invalidate_after_write()
        return merged

    def _build_image_query(
        self,
        *,
        theme: str | None = None,
        source_type: str | None = None,
        search: str = "",
    ) -> tuple[str, list[Any]]:
        query = "FROM images WHERE 1=1"
        params: list[Any] = []
        if theme:
            query += " AND theme = ?"
            params.append(theme)
        if source_type:
            query += " AND source_type = ?"
            params.append(source_type)
        if search.strip():
            query += " AND lower(COALESCE(title, '') || ' ' || COALESCE(page_url, '') || ' ' || COALESCE(source_type, '')) LIKE ?"
            params.append(f"%{search.strip().lower()}%")
        query, params = self._apply_content_filters(query, params)
        return query, params

    def get_recent_items(
        self,
        limit: int = 40,
        theme: str | None = None,
        source_type: str | None = None,
        offset: int = 0,
        review_status: str | None = None,
        saved_only: bool = False,
    ) -> list[dict[str, Any]]:
        base_query, params = self._build_item_query(
            theme=theme,
            source_type=source_type,
            review_status=review_status,
            saved_only=saved_only,
        )
        query = f"SELECT * {base_query} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_item(row) for row in rows]

    def get_recent_images(self, limit: int = 30, theme: str | None = None, offset: int = 0) -> list[dict[str, Any]]:
        base_query, params = self._build_image_query(theme=theme)
        query = f"SELECT * {base_query} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def browse_items(
        self,
        *,
        limit: int = 40,
        offset: int = 0,
        theme: str | None = None,
        source_type: str | None = None,
        review_status: str | None = None,
        saved_only: bool = False,
        queued_only: bool = False,
        search: str = "",
        sort: str = "newest",
        compound: str | None = None,
        mechanism: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        tag: str | None = None,
        min_score: float | None = None,
    ) -> dict[str, Any]:
        base_query, params = self._build_item_query(
            theme=theme,
            source_type=source_type,
            review_status=review_status,
            saved_only=saved_only,
            queued_only=queued_only,
            search=search,
            compound=compound,
            mechanism=mechanism,
            date_from=date_from,
            date_to=date_to,
            tag=tag,
            min_score=min_score,
        )
        order_by = {
            "score": "is_saved DESC, score DESC, last_seen_at DESC",
            "saved": "is_saved DESC, last_seen_at DESC",
            "title": "title COLLATE NOCASE ASC",
            "source": "source_type COLLATE NOCASE ASC, last_seen_at DESC",
            "newest": "last_seen_at DESC",
            "oldest": "last_seen_at ASC",
            "queue": "queued_at ASC NULLS LAST",
        }.get(sort, "last_seen_at DESC")
        cache_key = (
            "browse_items:"
            f"{limit}:{offset}:{theme}:{source_type}:{review_status}:{saved_only}:{queued_only}:"
            f"{search.strip().lower()}:{sort}:{compound}:{mechanism}:{date_from}:{date_to}:{tag}:{min_score}"
        )

        def build():
            with self.connect() as conn:
                rows, total, has_more = self._fetch_page(
                    conn,
                    "SELECT *",
                    base_query,
                    params,
                    order_by,
                    limit,
                    offset,
                )
            return {
                "items": [self._row_to_item(row) for row in rows],
                "total": int(total),
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
            }

        return self._cached_snapshot(cache_key, 8.0, build)

    def browse_images(
        self,
        *,
        limit: int = 30,
        offset: int = 0,
        theme: str | None = None,
        source_type: str | None = None,
        search: str = "",
    ) -> dict[str, Any]:
        base_query, params = self._build_image_query(theme=theme, source_type=source_type, search=search)
        cache_key = f"browse_images:{limit}:{offset}:{theme}:{source_type}:{search.strip().lower()}"

        def build():
            with self.connect() as conn:
                rows, total, has_more = self._fetch_page(
                    conn,
                    "SELECT *",
                    base_query,
                    params,
                    "created_at DESC",
                    limit,
                    offset,
                )
            return {
                "images": [dict(row) for row in rows],
                "total": int(total),
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
            }

        return self._cached_snapshot(cache_key, 30.0, build)

    def get_recent_hypotheses(self, limit: int = 10) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM hypotheses ORDER BY is_saved DESC, created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [self._row_to_hypothesis(row) for row in rows]

    def get_last_run(self) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return None
        payload = dict(row)
        payload["notes"] = self._parse_notes(payload.get("notes"))
        return payload

    def get_recent_runs(self, limit: int = 8) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM runs ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            payload = dict(row)
            payload["notes"] = self._parse_notes(payload.get("notes"))
            results.append(payload)
        return results

    def get_run(self, run_id: int) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        if not row:
            return None
        payload = dict(row)
        payload["notes"] = self._parse_notes(payload.get("notes"))
        return payload

    def get_last_completed_run(self) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM runs WHERE status = 'completed' ORDER BY id DESC LIMIT 1"
            ).fetchone()
        if not row:
            return None
        payload = dict(row)
        payload["notes"] = self._parse_notes(payload.get("notes"))
        return payload

    def get_review_queue(self, limit: int = 8) -> list[dict[str, Any]]:
        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT *
                    FROM items
                    WHERE is_saved = 1 AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    ORDER BY last_seen_at DESC
                    LIMIT ?
                    """,
                    (limit,),
                ).fetchall()
            return [self._row_to_item(row) for row in rows]

        return self._cached_snapshot(f"review_queue:{limit}", 5.0, build)

    def update_item_state(
        self,
        item_id: int,
        *,
        review_status: str | None = None,
        is_saved: bool | None = None,
        user_note: str | None = None,
        queued_at: str | None = "__unset__",
    ) -> dict[str, Any] | None:
        updates: list[str] = []
        params: list[Any] = []
        if review_status is not None:
            updates.append("review_status = ?")
            params.append(review_status)
        if is_saved is not None:
            updates.append("is_saved = ?")
            params.append(1 if is_saved else 0)
        if user_note is not None:
            updates.append("user_note = ?")
            params.append(user_note)
        if queued_at != "__unset__":
            updates.append("queued_at = ?")
            params.append(queued_at)
        if not updates:
            return self.get_item(item_id)
        params.append(item_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE items SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
            row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        self._invalidate_snapshot_cache()
        return self._row_to_item(row) if row else None

    def update_items_bulk(
        self,
        item_ids: list[int],
        *,
        review_status: str | None = None,
        is_saved: bool | None = None,
        queued_at: str | None | type = ...,
    ) -> int:
        if not item_ids:
            return 0
        updates: list[str] = []
        params: list[Any] = []
        if review_status is not None:
            updates.append("review_status = ?")
            params.append(review_status)
        if is_saved is not None:
            updates.append("is_saved = ?")
            params.append(1 if is_saved else 0)
        if queued_at is not ...:
            updates.append("queued_at = ?")
            params.append(queued_at)
        if not updates:
            return 0
        placeholders = ", ".join("?" for _ in item_ids)
        params.extend(item_ids)
        with self.connect() as conn:
            cursor = conn.execute(
                f"UPDATE items SET {', '.join(updates)} WHERE id IN ({placeholders})",
                params,
            )
            conn.commit()
        self._invalidate_snapshot_cache()
        return int(cursor.rowcount or 0)

    def get_item(self, item_id: int) -> dict[str, Any] | None:
        def build():
            with self.connect() as conn:
                row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
            return self._row_to_item(row) if row else None

        return self._cached_snapshot(f"item:{item_id}", 10.0, build)

    def get_queue(self) -> dict[str, Any]:
        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    "SELECT * FROM items WHERE queued_at IS NOT NULL ORDER BY queued_at ASC"
                ).fetchall()
            return {
                "items": [self._row_to_item(row) for row in rows],
                "total": len(rows),
            }

        return self._cached_snapshot("queue", 5.0, build)

    def get_queue_count(self) -> int:
        def build():
            with self.connect() as conn:
                row = conn.execute("SELECT COUNT(*) AS count FROM items WHERE queued_at IS NOT NULL").fetchone()
            return int(row["count"]) if row else 0

        return self._cached_snapshot("queue_count", 5.0, build)

    def get_hypothesis(self, hypothesis_id: int) -> dict[str, Any] | None:
        def build():
            with self.connect() as conn:
                row = conn.execute("SELECT * FROM hypotheses WHERE id = ?", (hypothesis_id,)).fetchone()
            return self._row_to_hypothesis(row) if row else None

        return self._cached_snapshot(f"hypothesis:{hypothesis_id}", 10.0, build)

    def update_hypothesis_state(
        self,
        hypothesis_id: int,
        *,
        review_status: str | None = None,
        is_saved: bool | None = None,
        user_note: str | None = None,
    ) -> dict[str, Any] | None:
        updates: list[str] = []
        params: list[Any] = []
        if review_status is not None:
            updates.append("review_status = ?")
            params.append(review_status)
        if is_saved is not None:
            updates.append("is_saved = ?")
            params.append(1 if is_saved else 0)
        if user_note is not None:
            updates.append("user_note = ?")
            params.append(user_note)
        if not updates:
            return self.get_hypothesis(hypothesis_id)
        params.append(hypothesis_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE hypotheses SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
            row = conn.execute("SELECT * FROM hypotheses WHERE id = ?", (hypothesis_id,)).fetchone()
        self._invalidate_after_write()
        return self._row_to_hypothesis(row) if row else None

    def get_stats(self) -> dict[str, Any]:
        def build():
            with self.connect() as conn:
                totals = conn.execute(
                    """
                    SELECT
                        (SELECT COUNT(*) FROM items WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%') AS item_count,
                        (SELECT COUNT(*) FROM images WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%') AS image_count,
                        (SELECT COUNT(*) FROM hypotheses) AS hypothesis_count,
                        (SELECT COUNT(*) FROM runs) AS run_count,
                        (SELECT COUNT(*) FROM items WHERE is_saved = 1 AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%') AS saved_item_count,
                        (SELECT COUNT(*) FROM hypotheses WHERE is_saved = 1) AS saved_hypothesis_count
                    """
                ).fetchone()
                themes = conn.execute(
                    """
                    SELECT theme, COUNT(*) AS count
                    FROM items
                    WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    GROUP BY theme
                    ORDER BY count DESC
                    """
                ).fetchall()
                compounds = conn.execute(
                    """
                    SELECT compounds_json
                    FROM items
                    WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    ORDER BY last_seen_at DESC
                    LIMIT 100
                    """
                ).fetchall()
                mechanisms = conn.execute(
                    """
                    SELECT mechanisms_json
                    FROM items
                    WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    ORDER BY last_seen_at DESC
                    LIMIT 100
                    """
                ).fetchall()
                sources = conn.execute(
                    """
                    SELECT source_type, COUNT(*) AS count
                    FROM items
                    WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    GROUP BY source_type
                    ORDER BY count DESC
                    """
                ).fetchall()
                review_statuses = conn.execute(
                    """
                    SELECT review_status, COUNT(*) AS count
                    FROM items
                    WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    GROUP BY review_status
                    ORDER BY count DESC
                    """
                ).fetchall()
                theme_summaries = conn.execute(
                    """
                    SELECT
                        theme,
                        COUNT(*) AS count,
                        ROUND(AVG(score), 2) AS avg_score,
                        MAX(last_seen_at) AS last_seen_at
                    FROM items
                    WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    GROUP BY theme
                    ORDER BY count DESC
                    """
                ).fetchall()
                hypothesis_review_statuses = conn.execute(
                    """
                    SELECT review_status, COUNT(*) AS count
                    FROM hypotheses
                    GROUP BY review_status
                    ORDER BY count DESC
                    """
                ).fetchall()
            compound_counts: dict[str, int] = {}
            for row in compounds:
                for compound in json.loads(row["compounds_json"] or "[]"):
                    if compound in COMPOUND_EXCLUDE:
                        continue
                    if len(compound) <= 2 and "-" not in compound:
                        continue
                    compound_counts[compound] = compound_counts.get(compound, 0) + 1
            mechanism_counts: dict[str, int] = {}
            for row in mechanisms:
                for mechanism in json.loads(row["mechanisms_json"] or "[]"):
                    mechanism_counts[mechanism] = mechanism_counts.get(mechanism, 0) + 1
            top_compounds = [
                {"name": name, "count": count}
                for name, count in sorted(compound_counts.items(), key=lambda item: item[1], reverse=True)[:12]
            ]
            top_mechanisms = [
                {"name": name, "count": count}
                for name, count in sorted(mechanism_counts.items(), key=lambda item: item[1], reverse=True)[:12]
            ]
            return {
                "totals": dict(totals),
                "themes": [dict(row) for row in themes],
                "top_compounds": top_compounds,
                "top_mechanisms": top_mechanisms,
                "source_mix": [dict(row) for row in sources],
                "review_statuses": [dict(row) for row in review_statuses],
                "hypothesis_review_statuses": [dict(row) for row in hypothesis_review_statuses],
                "theme_summaries": [dict(row) for row in theme_summaries],
            }

        return self._cached_snapshot("stats", 15.0, build)

    def get_compound_cache(self, name: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM compound_cache WHERE name=?", (name.lower(),)).fetchone()
            return dict(row) if row else None

    def set_compound_cache(self, name: str, data: dict) -> None:
        with self.connect() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO compound_cache
                (name, cid, iupac, molecular_weight, pharmacology, pubmed_cids, fetched_at)
                VALUES (?,?,?,?,?,?,?)
            """, (name.lower(), data.get("cid",""), data.get("iupac",""),
                  data.get("molecular_weight"), data.get("pharmacology",""), "", utcnow()))
            conn.commit()

    def insert_screenshot(self, term: str, source: str, page_url: str, local_path: str | None = None, performer_id: int | None = None, source_url: str | None = None, thumbnail_url: str | None = None) -> bool:
        """Insert screenshot record. Returns True if inserted, False if duplicate."""
        with self.connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO screenshots (term, source, page_url, local_path, captured_at, performer_id, source_url, thumbnail_url) VALUES (?,?,?,?,?,?,?,?)",
                    (term, source, page_url, local_path or "", utcnow(), performer_id, source_url, thumbnail_url)
                )
                conn.commit()
                self._invalidate_after_write()
                return True
            except sqlite3.IntegrityError:
                existing = conn.execute(
                    "SELECT id, term, local_path, performer_id, source_url, thumbnail_url "
                    "FROM screenshots WHERE page_url = ?",
                    (page_url,),
                ).fetchone()
                if existing is None:
                    return False
                updates: list[str] = []
                params: list[Any] = []
                if performer_id and existing["performer_id"] is None:
                    updates.append("performer_id = ?")
                    params.append(performer_id)
                if source_url and not str(existing["source_url"] or "").strip():
                    updates.append("source_url = ?")
                    params.append(source_url)
                if thumbnail_url and not str(existing["thumbnail_url"] or "").strip():
                    updates.append("thumbnail_url = ?")
                    params.append(thumbnail_url)
                if local_path and not str(existing["local_path"] or "").strip():
                    updates.append("local_path = ?")
                    params.append(local_path)
                if term and not str(existing["term"] or "").strip():
                    updates.append("term = ?")
                    params.append(term)
                if updates:
                    conn.execute(
                        f"UPDATE screenshots SET {', '.join(updates)} WHERE id = ?",
                        params + [existing["id"]],
                    )
                    conn.commit()
                    self._invalidate_after_write()
                return False

    def delete_screenshot(self, screenshot_id: int) -> bool:
        """Delete a screenshot record by id. Returns True if a row was deleted."""
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM screenshots WHERE id = ?", (screenshot_id,))
            conn.commit()
        self._invalidate_after_write()
        return cur.rowcount > 0

    def list_all_screenshots(self) -> list[dict]:
        """Return all screenshot records (id + local_path) for cleanup scanning."""
        with self.connect() as conn:
            rows = conn.execute("SELECT id, local_path, page_url FROM screenshots").fetchall()
        return [dict(r) for r in rows]

    def set_screenshot_summary(self, screenshot_id: int, summary: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE screenshots SET ai_summary = ? WHERE id = ?",
                (summary, screenshot_id),
            )
            conn.commit()
        self._invalidate_after_write()

    def set_screenshot_tags(self, screenshot_id: int, tags: str) -> None:
        with self.connect() as conn:
            conn.execute("UPDATE screenshots SET ai_tags = ? WHERE id = ?", (tags, screenshot_id))
            conn.commit()
        self._invalidate_after_write()

    def search_screenshots(self, query: str, limit: int = 50) -> list[dict]:
        cache_key = f"search_screenshots:{query.strip().lower()}:{limit}"

        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    """SELECT s.id, s.term, s.source, s.page_url, s.local_path, s.source_url, s.thumbnail_url, s.captured_at,
                              s.ai_summary, s.ai_tags, s.rating, s.performer_id,
                              p.username AS performer_username
                       FROM screenshots_fts f
                       JOIN screenshots s ON f.rowid = s.id
                       LEFT JOIN performers p ON s.performer_id = p.id
                       WHERE screenshots_fts MATCH ?
                       LIMIT ?""",
                    (query, limit),
                ).fetchall()
            return [dict(r) for r in rows]

        return self._cached_snapshot(cache_key, 5.0, build)

    # ── Settings CRUD ──────────────────────────────────────────────────
    def get_setting(self, key: str) -> str | None:
        def build():
            with self.connect() as conn:
                row = conn.execute("SELECT value FROM user_settings WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else None

        return self._cached_snapshot(f"setting:{key}", 30.0, build)

    def set_setting(self, key: str, value: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
                (key, value),
            )
            conn.commit()
        self._invalidate_after_write()

    def get_all_settings(self) -> dict:
        def build():
            with self.connect() as conn:
                rows = conn.execute("SELECT key, value FROM user_settings").fetchall()
            result = {}
            for r in rows:
                try:
                    result[r["key"]] = json.loads(r["value"])
                except (json.JSONDecodeError, TypeError):
                    result[r["key"]] = r["value"]
            return result

        return self._cached_snapshot("all_settings", 30.0, build)

    def screenshot_page_url_exists(self, page_url: str) -> bool:
        """Return True if a screenshot with this page_url is already stored."""
        def build():
            with self.connect() as conn:
                row = conn.execute(
                    "SELECT 1 FROM screenshots WHERE page_url = ? LIMIT 1", (page_url,)
                ).fetchone()
            return row is not None

        return self._cached_snapshot(f"screenshot_exists:{page_url}", 10.0, build)

    def upsert_visual_capture_item(self, item: dict[str, Any]) -> None:
        """Insert or replace a visual_capture summary item (no run_id required)."""
        now = utcnow()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO items (
                    source_type, theme, query, title, url, summary, content, author,
                    published_at, domain, image_url, score, compounds_json, mechanisms_json,
                    metadata_json, first_seen_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    summary = excluded.summary,
                    score = excluded.score,
                    last_seen_at = excluded.last_seen_at
                """,
                (
                    item["source_type"],
                    item["theme"],
                    item["query"],
                    item["title"],
                    item["url"],
                    item["summary"],
                    item.get("content", ""),
                    item.get("author", ""),
                    item.get("published_at", ""),
                    item["domain"],
                    item.get("image_url", ""),
                    item["score"],
                    "[]",
                    "[]",
                    "{}",
                    now,
                    now,
                ),
            )
            conn.commit()
        self._invalidate_after_write()

    def browse_hypotheses(
        self,
        limit: int = 24,
        offset: int = 0,
        theme: str | None = None,
        review_status: str | None = None,
        search: str = "",
        saved_only: bool = False,
        sort: str = "newest",
    ) -> dict:
        conditions: list[str] = []
        params: list[Any] = []
        if theme:
            conditions.append("theme = ?")
            params.append(theme)
        if review_status:
            conditions.append("review_status = ?")
            params.append(review_status)
        if search:
            conditions.append(
                "(lower(COALESCE(title,'')) LIKE ? OR lower(COALESCE(rationale,'')) LIKE ? "
                "OR lower(COALESCE(evidence,'')) LIKE ? OR lower(COALESCE(body,'')) LIKE ?)"
            )
            like = f"%{search.strip().lower()}%"
            params.extend([like, like, like, like])
        if saved_only:
            conditions.append("is_saved = 1")
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        order_map = {
            "newest": "created_at DESC",
            "oldest": "created_at ASC",
            "theme": "theme ASC, created_at DESC",
            "status": "review_status ASC, created_at DESC",
        }
        order = order_map.get(sort, "created_at DESC")
        cache_key = f"browse_hypotheses:{limit}:{offset}:{theme}:{review_status}:{search.strip().lower()}:{saved_only}:{sort}"

        def build():
            with self.connect() as conn:
                rows, total, has_more = self._fetch_page(
                    conn,
                    "SELECT *",
                    f"FROM hypotheses {where}",
                    params,
                    order,
                    limit,
                    offset,
                )
                hypotheses = [self._row_to_hypothesis(row) for row in rows]
            return {"hypotheses": hypotheses, "total": total, "offset": offset, "limit": limit, "has_more": has_more}

        return self._cached_snapshot(cache_key, 8.0, build)

    def get_themes(self) -> list[dict]:
        def build():
            with self.connect() as conn:
                rows = conn.execute("SELECT slug, label FROM themes ORDER BY label").fetchall()
            return [{"slug": r[0], "label": r[1]} for r in rows]

        return self._cached_snapshot("themes", 30.0, build)

    def create_theme(self, slug: str, label: str) -> dict:
        with self.connect() as conn:
            conn.execute("INSERT OR REPLACE INTO themes (slug, label) VALUES (?, ?)", (slug, label))
            conn.commit()
        self._invalidate_after_write()
        return {"slug": slug, "label": label}

    def delete_theme(self, slug: str) -> bool:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM themes WHERE slug = ?", (slug,))
            conn.commit()
        self._invalidate_after_write()
        return cur.rowcount > 0

    def browse_screenshots(
        self,
        term: str | None = None,
        source: str | None = None,
        min_rating: int | None = None,
        sort: str | None = None,
        limit: int = 40,
        offset: int = 0,
        tag: str | None = None,
        has_description: bool | None = None,
        has_performer: bool | None = None,
        performer_id: int | None = None,
        media_type: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        exclude_keywords: set[str] | None = None,
        require_media_url: bool = False,
    ) -> dict:
        where, params = [], []
        if term:
            where.append("term = ?")
            params.append(term)
        if source:
            where.append("source = ?")
            params.append(source)
        if min_rating is not None and min_rating > 0:
            where.append("rating >= ?")
            params.append(min_rating)
        if tag:
            where.append("user_tags LIKE ?")
            params.append(f'%"{tag}"%')
        if has_description is True:
            where.append("ai_summary IS NOT NULL AND ai_summary != ''")
        elif has_description is False:
            where.append("(ai_summary IS NULL OR ai_summary = '')")
        if performer_id is not None:
            where.append("performer_id = ?")
            params.append(performer_id)
        elif has_performer is True:
            where.append("performer_id IS NOT NULL")
        elif has_performer is False:
            where.append("performer_id IS NULL")
        if media_type == "video":
            where.append(
                "("
                "LOWER(COALESCE(NULLIF(local_path, ''), source_url, page_url, '')) LIKE '%.mp4' "
                "OR LOWER(COALESCE(NULLIF(local_path, ''), source_url, page_url, '')) LIKE '%.webm' "
                "OR LOWER(COALESCE(NULLIF(local_path, ''), source_url, page_url, '')) LIKE '%.mov' "
                "OR LOWER(COALESCE(source, '')) IN ('redgifs', 'ytdlp')"
                ")"
            )
        elif media_type == "image":
            where.append(
                "("
                "LOWER(COALESCE(NULLIF(local_path, ''), source_url, page_url, '')) NOT LIKE '%.mp4' "
                "AND LOWER(COALESCE(NULLIF(local_path, ''), source_url, page_url, '')) NOT LIKE '%.webm' "
                "AND LOWER(COALESCE(NULLIF(local_path, ''), source_url, page_url, '')) NOT LIKE '%.mov' "
                "AND LOWER(COALESCE(source, '')) NOT IN ('redgifs', 'ytdlp')"
                ")"
            )
        if date_from:
            where.append("captured_at >= ?")
            params.append(date_from)
        if date_to:
            where.append("captured_at <= ?")
            params.append(date_to)
        # Push keyword exclusion filter into SQL for efficiency
        if exclude_keywords:
            # Concatenate all searchable text into one LOWER() expression, then check each keyword
            concat_expr = (
                "LOWER("
                "COALESCE(screenshots.term,'') || ' ' || "
                "COALESCE(screenshots.source,'') || ' ' || "
                "COALESCE(screenshots.page_url,'') || ' ' || "
                "COALESCE(screenshots.ai_summary,'') || ' ' || "
                "COALESCE(screenshots.user_tags,'') || ' ' || "
                "COALESCE(p.username,'')"
                ")"
            )
            kw_conditions = []
            for kw in exclude_keywords:
                kw_conditions.append(f"{concat_expr} LIKE ?")
                params.append(f"%{kw}%")
            where.append(f"NOT ({' OR '.join(kw_conditions)})")

        # Only return items with a usable media URL (source_url or local_path)
        if require_media_url:
            where.append(
                "("
                "(source_url IS NOT NULL AND source_url != '' AND (source_url LIKE 'http://%' OR source_url LIKE 'https://%'))"
                " OR (local_path IS NOT NULL AND local_path != '')"
                ")"
            )
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        order = "rating DESC, captured_at DESC" if sort == "rating" else "captured_at DESC"
        cache_key = (
            "browse_screenshots:"
            f"{limit}:{offset}:{term}:{source}:{min_rating}:{sort}:{tag}:{has_description}:{has_performer}:{performer_id}:{media_type}:{date_from}:{date_to}:{bool(exclude_keywords)}:{require_media_url}"
        )

        _from_clause = "screenshots LEFT JOIN performers p ON screenshots.performer_id = p.id"

        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    f"SELECT screenshots.*, p.username AS performer_username "
                    f"FROM {_from_clause} "
                    f"{clause} ORDER BY {order} LIMIT ? OFFSET ?",
                    params + [limit + 1, offset]
                ).fetchall()
                if offset == 0:
                    total = conn.execute(
                        f"SELECT COUNT(*) FROM {_from_clause} {clause}", params
                    ).fetchone()[0]
                else:
                    total = offset + len(rows)
            has_more = len(rows) > limit
            screenshots = [dict(r) for r in rows[:limit]]
            return {"screenshots": screenshots, "total": total, "offset": offset, "limit": limit, "has_more": has_more}

        return self._cached_snapshot(cache_key, 30.0, build)

    def backfill_screenshot_performers(self) -> int:
        """Link or repair screenshot performer assignments when the identity evidence is decisive."""
        with self.connect() as conn:
            performers = conn.execute(
                "SELECT id, username, display_name, platform, twitter_username, reddit_username, profile_url FROM performers"
            ).fetchall()
        performer_rows = [dict(row) for row in performers]
        signatures = performer_identity_signatures(performer_rows)
        signature_by_id = {
            int(signature["id"]): signature
            for signature in signatures
            if signature.get("id") is not None
        }
        if not signatures:
            return 0
        updated = 0
        with self.connect() as conn:
            screenshots = conn.execute(
                "SELECT id, term, source, page_url, source_url, thumbnail_url, ai_summary, performer_id "
                "FROM screenshots"
            ).fetchall()
            for row in screenshots:
                candidate = {
                    "term": row["term"],
                    "source": row["source"],
                    "page_url": row["page_url"],
                    "url": row["source_url"],
                    "image": row["thumbnail_url"],
                    "summary": row["ai_summary"],
                }
                best_match = find_best_identity_match(candidate, signatures)
                current_performer_id = row["performer_id"]

                if current_performer_id is None:
                    if best_match is None or best_match.get("performer_id") is None:
                        continue
                    cur = conn.execute(
                        "UPDATE screenshots SET performer_id = ? WHERE id = ? AND performer_id IS NULL",
                        (best_match["performer_id"], row["id"]),
                    )
                    updated += cur.rowcount
                    continue

                if best_match is None or best_match.get("performer_id") is None:
                    continue
                if int(best_match["performer_id"]) == int(current_performer_id):
                    continue

                current_signature = signature_by_id.get(int(current_performer_id))
                if current_signature is None:
                    continue
                current_score = float(score_candidate_identity(candidate, current_signature)["score"])
                best_score = float(best_match["score"])
                if current_score >= 5.0 or best_score < current_score + 3.0:
                    continue
                cur = conn.execute(
                    "UPDATE screenshots SET performer_id = ? WHERE id = ? AND performer_id = ?",
                    (best_match["performer_id"], row["id"], current_performer_id),
                )
                updated += cur.rowcount
            conn.commit()
        if updated:
            self._invalidate_after_write()
        return updated

    def rate_screenshot(self, screenshot_id: int, rating: int) -> dict | None:
        """Set rating (0-5) on a screenshot. Returns updated row or None."""
        with self.connect() as conn:
            conn.execute("UPDATE screenshots SET rating = ? WHERE id = ?", (rating, screenshot_id))
            conn.commit()
            row = conn.execute("SELECT * FROM screenshots WHERE id = ?", (screenshot_id,)).fetchone()
        self._invalidate_after_write()
        return dict(row) if row else None

    def top_rated_screenshots(self, limit: int = 20) -> list[dict]:
        """Return top-rated screenshots (rating >= 3)."""
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM screenshots WHERE rating >= 3 ORDER BY rating DESC, captured_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def set_screenshot_user_tags(self, screenshot_id: int, tags_json: str) -> dict | None:
        """Set user_tags JSON on a screenshot. Returns updated row or None."""
        with self.connect() as conn:
            conn.execute("UPDATE screenshots SET user_tags = ? WHERE id = ?", (tags_json, screenshot_id))
            conn.commit()
            row = conn.execute("SELECT * FROM screenshots WHERE id = ?", (screenshot_id,)).fetchone()
        self._invalidate_after_write()
        return dict(row) if row else None

    def get_all_user_tags(self) -> list[dict]:
        """Return all unique user tags with counts."""
        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    "SELECT user_tags FROM screenshots WHERE user_tags IS NOT NULL AND user_tags != ''"
                ).fetchall()
            tag_counts: dict[str, int] = {}
            for row in rows:
                try:
                    tags = json.loads(row["user_tags"])
                    if isinstance(tags, list):
                        for t in tags:
                            if isinstance(t, str) and t.strip():
                                key = t.strip().lower()
                                tag_counts[key] = tag_counts.get(key, 0) + 1
                except (json.JSONDecodeError, TypeError):
                    pass
            return sorted(
                [{"tag": t, "count": c} for t, c in tag_counts.items()],
                key=lambda x: -x["count"],
            )

        return self._cached_snapshot("screenshot_user_tags", 15.0, build)

    # ── Telegram channels ──────────────────────────────────────────────────────

    def upsert_telegram_channel(
        self,
        username: str,
        display_name: str,
        member_count: int | None = None,
        description: str | None = None,
        auto_discovered: bool = False,
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO telegram_channels
                    (username, display_name, member_count, description, auto_discovered, enabled, added_at)
                VALUES (?,?,?,?,?,1,?)
                ON CONFLICT(username) DO UPDATE SET
                    display_name=excluded.display_name,
                    member_count=excluded.member_count,
                    description=excluded.description
                """,
                (username, display_name, member_count, description, int(auto_discovered), utcnow()),
            )
            conn.commit()
        self._invalidate_after_write()

    def list_telegram_channels(self) -> list[dict]:
        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    "SELECT * FROM telegram_channels ORDER BY added_at DESC"
                ).fetchall()
            return [dict(r) for r in rows]

        return self._cached_snapshot("telegram_channels", 10.0, build)

    def delete_telegram_channel(self, username: str) -> bool:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM telegram_channels WHERE username = ?", (username,))
            conn.commit()
        self._invalidate_after_write()
        return cur.rowcount > 0

    def set_telegram_channel_enabled(self, username: str, enabled: bool) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE telegram_channels SET enabled = ? WHERE username = ?",
                (int(enabled), username),
            )
            conn.commit()
        self._invalidate_after_write()

    def update_telegram_channel_scanned(self, username: str) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE telegram_channels SET last_scanned_at = ? WHERE username = ?",
                (utcnow(), username),
            )
            conn.commit()
        self._invalidate_after_write()

    def insert_telegram_media(
        self,
        channel_username: str,
        message_id: int,
        media_type: str,
        width: int | None,
        height: int | None,
        duration: int | None,
        file_size: int | None,
        caption: str | None,
        local_path: str | None,
        passes_filter: bool,
        posted_at: str | None,
    ) -> bool:
        """Returns True if inserted (not a duplicate)."""
        with self.connect() as conn:
            try:
                conn.execute(
                    """
                    INSERT INTO telegram_media
                        (channel_username, message_id, media_type, width, height,
                         duration, file_size, caption, local_path, passes_filter,
                         posted_at, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        channel_username, message_id, media_type, width, height,
                        duration, file_size, caption, local_path, int(passes_filter),
                        posted_at, utcnow(),
                    ),
                )
                conn.commit()
                self._invalidate_after_write()
                return True
            except sqlite3.IntegrityError:
                return False

    def browse_telegram_media(
        self,
        media_type: str | None = None,
        channel: str | None = None,
        limit: int = 40,
        offset: int = 0,
    ) -> dict:
        where, params = [], []
        if media_type:
            where.append("media_type = ?")
            params.append(media_type)
        if channel:
            where.append("channel_username = ?")
            params.append(channel)
        where.append("passes_filter = 1")
        clause = "WHERE " + " AND ".join(where)
        cache_key = f"browse_telegram_media:{limit}:{offset}:{media_type}:{channel}"

        def build():
            with self.connect() as conn:
                rows, total, has_more = self._fetch_page(
                    conn,
                    "SELECT *",
                    f"FROM telegram_media {clause}",
                    params,
                    "posted_at DESC, created_at DESC",
                    limit,
                    offset,
                )
            items = [dict(r) for r in rows]
            return {"items": items, "total": total, "offset": offset, "limit": limit, "has_more": has_more}

        return self._cached_snapshot(cache_key, 5.0, build)

    # ── Performers ─────────────────────────────────────────────────────────

    def add_performer(
        self,
        username: str,
        platform: str = "onlyfans",
        display_name: str | None = None,
        profile_url: str | None = None,
        bio: str | None = None,
        tags: list[str] | None = None,
        avatar_url: str | None = None,
        discovered_via: str | None = None,
    ) -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO performers
                    (username, platform, display_name, profile_url, bio, tags,
                     avatar_url, discovered_via, first_seen_at, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    username, platform, display_name, profile_url, bio,
                    json.dumps(tags or []),
                    avatar_url, discovered_via, utcnow(), utcnow(),
                ),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM performers WHERE id = ?", (cursor.lastrowid,)).fetchone()
        self._invalidate_after_write()
        return dict(row)

    def get_performer(self, performer_id: int) -> dict | None:
        def build():
            with self.connect() as conn:
                row = conn.execute("SELECT * FROM performers WHERE id = ?", (performer_id,)).fetchone()
            return dict(row) if row else None

        return self._cached_snapshot(f"performer:{performer_id}", 10.0, build)

    def get_performer_by_username(self, username: str) -> dict | None:
        def build():
            with self.connect() as conn:
                row = conn.execute("SELECT * FROM performers WHERE username = ?", (username,)).fetchone()
            return dict(row) if row else None

        return self._cached_snapshot(f"performer_username:{username.lower()}", 10.0, build)

    def browse_performers(
        self,
        search: str | None = None,
        platform: str | None = None,
        status: str | None = None,
        is_favorite: bool | None = None,
        stale_days: int | None = None,
        renewing_only: bool | None = None,
        is_subscribed: bool | None = None,
        tags: str | None = None,
        sort: str = "created_at",
        compact: bool = False,
        limit: int = 40,
        offset: int = 0,
    ) -> dict:
        where: list[str] = []
        params: list[Any] = []
        if search:
            where.append("(username LIKE ? OR display_name LIKE ? OR bio LIKE ? OR tags LIKE ?)")
            pat = f"%{search}%"
            params.extend([pat, pat, pat, pat])
        if platform:
            where.append("platform = ?")
            params.append(platform)
        if status:
            where.append("status = ?")
            params.append(status)
        if is_favorite is not None:
            where.append("is_favorite = ?")
            params.append(int(is_favorite))
        if stale_days is not None:
            where.append("(last_checked_at IS NULL OR last_checked_at < datetime('now', ?))")
            params.append(f"-{stale_days} days")
        if is_subscribed is not None:
            if is_subscribed:
                where.append("is_subscribed = 1")
            else:
                where.append("(is_subscribed IS NULL OR is_subscribed = 0)")
        if tags:
            where.append("tags LIKE ?")
            params.append(f"%{tags}%")
        if renewing_only:
            where.append(
                "is_subscribed = 1 AND subscription_renewed_at IS NOT NULL "
                "AND subscription_renewed_at < datetime('now', '-23 days')"
            )
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        sort_map = {
            "created_at": "created_at DESC",
            "newest": "created_at DESC",
            "az": "username ASC",
            "most_media": "media_count DESC",
            "username": "username ASC",
            "display_name": "display_name ASC",
            "follower_count": "follower_count DESC",
            "first_seen_at": "first_seen_at DESC",
            "last_checked_at": "last_checked_at DESC",
            "screenshots_count": "screenshots_count DESC",
            "subscription_price": "COALESCE(subscription_price, 0) DESC",
            "subscription_renewed_at": "COALESCE(subscription_renewed_at, '1970-01-01') ASC",
        }
        order_by = sort_map.get(sort, "created_at DESC")
        base_select = (
            "performers.id, performers.username, performers.display_name, "
            "performers.platform, performers.avatar_url, performers.avatar_local, "
            "performers.is_favorite, performers.media_count"
            if compact
            else "performers.*"
        )
        search_norm = search.strip().lower() if search else ""
        cache_key = (
            "browse_performers:"
            f"{limit}:{offset}:{search_norm}:{platform}:{status}:{sort}:{is_favorite}:{stale_days}:{renewing_only}:{is_subscribed}:{tags}:{compact}"
        )

        def build():
            with self.connect() as conn:
                if sort == "screenshots_count":
                    rows = conn.execute(
                        f"SELECT {base_select}, COALESCE(sc.cnt, 0) AS screenshots_count "
                        f"FROM performers "
                        f"LEFT JOIN (SELECT performer_id, COUNT(*) AS cnt FROM screenshots GROUP BY performer_id) sc "
                        f"ON sc.performer_id = performers.id "
                        f"{clause} ORDER BY {order_by} LIMIT ? OFFSET ?",
                        params + [limit + 1, offset],
                    ).fetchall()
                    performers = [dict(r) for r in rows[:limit]]
                else:
                    rows = conn.execute(
                        f"SELECT {base_select} "
                        f"FROM performers "
                        f"{clause} ORDER BY {order_by} LIMIT ? OFFSET ?",
                        params + [limit + 1, offset],
                    ).fetchall()
                    performers = [dict(r) for r in rows[:limit]]
                    counts_by_id: dict[int, int] = {}
                    performer_ids = [int(p["id"]) for p in performers]
                    if performer_ids:
                        placeholders = ",".join("?" for _ in performer_ids)
                        count_rows = conn.execute(
                            f"SELECT performer_id, COUNT(*) AS cnt FROM screenshots "
                            f"WHERE performer_id IN ({placeholders}) "
                            f"GROUP BY performer_id",
                            performer_ids,
                        ).fetchall()
                        counts_by_id = {int(r["performer_id"]): int(r["cnt"]) for r in count_rows}
                    for performer in performers:
                        performer["screenshots_count"] = counts_by_id.get(int(performer["id"]), 0)
                if offset == 0:
                    total = conn.execute(f"SELECT COUNT(*) FROM performers {clause}", params).fetchone()[0]
                else:
                    total = offset + len(rows)
            return {"performers": performers, "total": total, "offset": offset, "limit": limit, "has_more": len(rows) > limit}

        return self._cached_snapshot(cache_key, 45.0, build)

    def update_performer(self, performer_id: int, **fields: Any) -> dict | None:
        allowed = {
            "username", "display_name", "platform", "profile_url", "avatar_url",
            "avatar_local", "bio", "tags", "follower_count", "media_count",
            "is_verified", "is_favorite", "status", "notes", "discovered_via",
            "last_checked_at", "subscription_price", "is_subscribed",
            "subscription_renewed_at", "reddit_username", "twitter_username",
        }
        updates = {k: v for k, v in fields.items() if k in allowed}
        if not updates:
            return self.get_performer(performer_id)
        if "tags" in updates and isinstance(updates["tags"], list):
            updates["tags"] = json.dumps(updates["tags"])
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        params = list(updates.values()) + [performer_id]
        with self.connect() as conn:
            conn.execute(f"UPDATE performers SET {set_clause} WHERE id = ?", params)
            conn.commit()
        self._invalidate_after_write()
        return self.get_performer(performer_id)

    def delete_performer(self, performer_id: int) -> bool:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM performers WHERE id = ?", (performer_id,))
            conn.commit()
        self._invalidate_after_write()
        return cur.rowcount > 0

    def add_performer_media(
        self,
        performer_id: int,
        media_type: str,
        source_url: str | None = None,
        local_path: str | None = None,
        thumbnail_path: str | None = None,
        width: int | None = None,
        height: int | None = None,
        duration: int | None = None,
        file_size: int | None = None,
        caption: str | None = None,
    ) -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO performer_media
                    (performer_id, media_type, source_url, local_path, thumbnail_path,
                     width, height, duration, file_size, caption, captured_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    performer_id, media_type, source_url, local_path, thumbnail_path,
                    width, height, duration, file_size, caption, utcnow(),
                ),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM performer_media WHERE id = ?", (cursor.lastrowid,)).fetchone()
        self._invalidate_after_write()
        return dict(row)

    def browse_performer_media(
        self,
        performer_id: int | None = None,
        media_type: str | None = None,
        limit: int = 40,
        offset: int = 0,
    ) -> dict:
        where: list[str] = []
        params: list[Any] = []
        if performer_id is not None:
            where.append("performer_id = ?")
            params.append(performer_id)
        if media_type:
            where.append("media_type = ?")
            params.append(media_type)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        cache_key = f"browse_performer_media:{limit}:{offset}:{performer_id}:{media_type}"

        def build():
            with self.connect() as conn:
                rows, total, has_more = self._fetch_page(
                    conn,
                    "SELECT *",
                    f"FROM performer_media {clause}",
                    params,
                    "captured_at DESC",
                    limit,
                    offset,
                )
            items = [dict(r) for r in rows]
            return {"items": items, "total": total, "offset": offset, "limit": limit, "has_more": has_more}

        return self._cached_snapshot(cache_key, 8.0, build)

    def get_performer_stats(self) -> dict:
        def build():
            with self.connect() as conn:
                total = conn.execute("SELECT COUNT(*) FROM performers").fetchone()[0]
                favorites = conn.execute("SELECT COUNT(*) FROM performers WHERE is_favorite = 1").fetchone()[0]
                by_platform_rows = conn.execute(
                    "SELECT platform, COUNT(*) as count FROM performers GROUP BY platform ORDER BY count DESC"
                ).fetchall()
                with_media = conn.execute(
                    "SELECT COUNT(DISTINCT performer_id) FROM screenshots WHERE performer_id IS NOT NULL"
                ).fetchone()[0]
                sub_row = conn.execute(
                    "SELECT COUNT(*) as cnt, COALESCE(SUM(subscription_price), 0.0) as total_spend "
                    "FROM performers WHERE is_subscribed = 1"
                ).fetchone()
                subscribed_count = sub_row["cnt"] if sub_row else 0
                monthly_spend = round(float(sub_row["total_spend"]) if sub_row else 0.0, 2)
                stale_count = conn.execute(
                    "SELECT COUNT(*) FROM performers WHERE last_checked_at IS NULL "
                    "OR last_checked_at < datetime('now', '-7 days')"
                ).fetchone()[0]
                renewing_soon_count = conn.execute(
                    "SELECT COUNT(*) FROM performers WHERE is_subscribed = 1 "
                    "AND subscription_renewed_at IS NOT NULL "
                    "AND subscription_renewed_at < datetime('now', '-23 days')"
                ).fetchone()[0]
            by_platform = {row["platform"]: row["count"] for row in by_platform_rows}
            return {
                "total": total,
                "by_platform": by_platform,
                "favorites": favorites,
                "with_media": with_media,
                "subscribed_count": subscribed_count,
                "monthly_spend": monthly_spend,
                "stale_count": stale_count,
                "renewing_soon_count": renewing_soon_count,
            }

        return self._cached_snapshot("performer_stats", 60.0, build)

    def get_performer_analytics(self) -> dict:
        def build():
            with self.connect() as conn:
                # Platform distribution
                platform_rows = conn.execute(
                    "SELECT platform, COUNT(*) as count FROM performers GROUP BY platform ORDER BY count DESC"
                ).fetchall()
                platform_distribution = [{"platform": r["platform"], "count": r["count"]} for r in platform_rows]

                # Top by media — combine screenshots + performer_media via LEFT JOINs
                top_media_rows = conn.execute(
                    """SELECT p.id, p.username, p.platform,
                              COALESCE(sc.cnt, 0) + COALESCE(pm.cnt, 0) AS media_count
                       FROM performers p
                       LEFT JOIN (SELECT performer_id, COUNT(*) AS cnt FROM screenshots GROUP BY performer_id) sc
                           ON sc.performer_id = p.id
                       LEFT JOIN (SELECT performer_id, COUNT(*) AS cnt FROM performer_media GROUP BY performer_id) pm
                           ON pm.performer_id = p.id
                       WHERE COALESCE(sc.cnt, 0) + COALESCE(pm.cnt, 0) > 0
                       ORDER BY media_count DESC
                       LIMIT 8"""
                ).fetchall()
                top_by_media = [
                    {"id": r["id"], "username": r["username"], "platform": r["platform"], "media_count": r["media_count"]}
                    for r in top_media_rows
                ]

                # Recent additions
                recent_rows = conn.execute(
                    "SELECT id, username, platform, created_at FROM performers ORDER BY created_at DESC LIMIT 5"
                ).fetchall()
                recent_additions = [
                    {"id": r["id"], "username": r["username"], "platform": r["platform"], "created_at": r["created_at"]}
                    for r in recent_rows
                ]

                # Tag cloud - parse JSON tags from all performers
                all_performers = conn.execute("SELECT tags FROM performers WHERE tags IS NOT NULL AND tags != ''").fetchall()
                import json as _json
                tag_counts: dict[str, int] = {}
                for row in all_performers:
                    raw = row["tags"]
                    if not raw:
                        continue
                    try:
                        parsed = _json.loads(raw)
                        tags_list = parsed if isinstance(parsed, list) else []
                    except Exception:
                        tags_list = [t.strip() for t in raw.split(",") if t.strip()]
                    for tag in tags_list:
                        tag_lower = str(tag).lower().strip()
                        if tag_lower:
                            tag_counts[tag_lower] = tag_counts.get(tag_lower, 0) + 1
                tag_cloud = sorted(
                    [{"tag": t, "count": c} for t, c in tag_counts.items()],
                    key=lambda x: x["count"],
                    reverse=True,
                )[:30]

                # Growth stats
                total = conn.execute("SELECT COUNT(*) FROM performers").fetchone()[0]
                this_week = conn.execute(
                    "SELECT COUNT(*) FROM performers WHERE created_at >= datetime('now', '-7 days')"
                ).fetchone()[0]
                this_month = conn.execute(
                    "SELECT COUNT(*) FROM performers WHERE created_at >= datetime('now', '-30 days')"
                ).fetchone()[0]

                # Media stats
                total_photos = conn.execute(
                    "SELECT COUNT(*) FROM performer_media WHERE media_type = 'photo'"
                ).fetchone()[0]
                total_videos = conn.execute(
                    "SELECT COUNT(*) FROM performer_media WHERE media_type = 'video'"
                ).fetchone()[0]
                performer_count_with_media = conn.execute(
                    "SELECT COUNT(DISTINCT performer_id) FROM performer_media"
                ).fetchone()[0]
                avg_per_performer = round((total_photos + total_videos) / max(performer_count_with_media, 1), 1)

            return {
                "platform_distribution": platform_distribution,
                "top_by_media": top_by_media,
                "recent_additions": recent_additions,
                "tag_cloud": tag_cloud,
                "growth": {"total": total, "this_week": this_week, "this_month": this_month},
                "media_stats": {
                    "total_photos": total_photos,
                    "total_videos": total_videos,
                    "avg_per_performer": avg_per_performer,
                },
            }

        return self._cached_snapshot("performer_analytics", 30.0, build)

    def add_performer_link(
        self,
        performer_id: int,
        platform: str,
        url: str,
        username: str | None = None,
    ) -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO performer_links (performer_id, platform, url, username)
                VALUES (?,?,?,?)
                ON CONFLICT(performer_id, platform) DO UPDATE SET
                    url=excluded.url, username=excluded.username
                """,
                (performer_id, platform, url, username),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM performer_links WHERE id = ?", (cursor.lastrowid,)).fetchone()
        self._invalidate_after_write()
        return dict(row)

    def get_performer_links(self, performer_id: int) -> list[dict]:
        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    "SELECT * FROM performer_links WHERE performer_id = ? ORDER BY platform",
                    (performer_id,),
                ).fetchall()
            return [dict(r) for r in rows]

        return self._cached_snapshot(f"performer_links:{performer_id}", 10.0, build)

    def delete_performer_link(self, link_id: int) -> bool:
        with self.connect() as conn:
            cur = conn.execute("DELETE FROM performer_links WHERE id = ?", (link_id,))
            conn.commit()
        self._invalidate_after_write()
        return cur.rowcount > 0

    def enqueue_capture(self, performer_id: int) -> dict | None:
        """Add to capture queue. Returns None if already queued/running."""
        with self.connect() as conn:
            existing = conn.execute(
                "SELECT id FROM capture_queue WHERE performer_id = ? AND status IN ('queued', 'running')",
                (performer_id,),
            ).fetchone()
            if existing:
                return None
            cursor = conn.execute(
                "INSERT INTO capture_queue (performer_id, status) VALUES (?, 'queued')",
                (performer_id,),
            )
            conn.commit()
            row = conn.execute(
                """SELECT cq.*, p.username, p.display_name, p.platform, p.avatar_local, p.avatar_url
                   FROM capture_queue cq JOIN performers p ON cq.performer_id = p.id
                   WHERE cq.id = ?""",
                (cursor.lastrowid,),
            ).fetchone()
        self._invalidate_after_write()
        return dict(row) if row else None

    def get_capture_queue(self) -> list[dict]:
        """Active entries plus anything finished in the last 5 minutes."""
        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    """SELECT cq.*, p.username, p.display_name, p.platform, p.avatar_local, p.avatar_url
                       FROM capture_queue cq JOIN performers p ON cq.performer_id = p.id
                       WHERE cq.status IN ('queued', 'running')
                          OR cq.finished_at > datetime('now', '-5 minutes')
                       ORDER BY cq.created_at ASC"""
                ).fetchall()
            return [dict(r) for r in rows]

        return self._cached_snapshot("capture_queue", 3.0, build)

    def requeue_stale_running_entries(self, stale_after_minutes: int = 20) -> int:
        with self.connect() as conn:
            result = conn.execute(
                """
                UPDATE capture_queue
                   SET status = 'queued',
                       started_at = NULL,
                       error_msg = COALESCE(error_msg, 'Automatically re-queued after stale running state')
                 WHERE status = 'running'
                   AND (
                        started_at IS NULL
                        OR started_at <= datetime('now', ?)
                   )
                """,
                (f"-{stale_after_minutes} minutes",),
            )
            conn.commit()
        if result.rowcount:
            self._invalidate_after_write()
        return result.rowcount

    _ALLOWED_QUEUE_FIELDS = frozenset({"status", "started_at", "finished_at", "captured_count", "error_msg"})

    def update_queue_entry(self, entry_id: int, **fields: Any) -> None:
        unknown = set(fields) - self._ALLOWED_QUEUE_FIELDS
        if unknown:
            raise ValueError(f"update_queue_entry: unknown fields {unknown}")
        sets = ", ".join(f"{k} = ?" for k in fields)
        vals = list(fields.values()) + [entry_id]
        with self.connect() as conn:
            conn.execute(f"UPDATE capture_queue SET {sets} WHERE id = ?", vals)
            conn.commit()
        self._invalidate_after_write()

    def cancel_queue_entry(self, entry_id: int) -> bool:
        with self.connect() as conn:
            result = conn.execute(
                "DELETE FROM capture_queue WHERE id = ? AND status = 'queued'",
                (entry_id,),
            )
            conn.commit()
        self._invalidate_after_write()
        return result.rowcount > 0

    def get_stale_performer_ids(self, stale_days: int = 7) -> list[int]:
        def build():
            with self.connect() as conn:
                rows = conn.execute(
                    "SELECT id FROM performers WHERE status != 'inactive' "
                    "AND (last_checked_at IS NULL OR last_checked_at < datetime('now', ?))",
                    (f"-{stale_days} days",),
                ).fetchall()
            return [r["id"] for r in rows]

        return self._cached_snapshot(f"stale_performer_ids:{stale_days}", 10.0, build)

    def search_performers(
        self,
        query: str,
        platform: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        search_norm = query.strip().lower()
        cache_key = f"search_performers:{search_norm}:{platform}:{limit}"

        def build():
            where = ["(lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(bio) LIKE ? OR lower(tags) LIKE ?)"]
            pat = f"%{search_norm}%"
            params: list[Any] = [pat, pat, pat, pat]
            if platform:
                where.append("platform = ?")
                params.append(platform)
            clause = "WHERE " + " AND ".join(where)
            with self.connect() as conn:
                rows = conn.execute(
                    f"SELECT * FROM performers {clause} ORDER BY is_favorite DESC, created_at DESC LIMIT ?",
                    params + [limit],
                ).fetchall()
            return [dict(r) for r in rows]

        return self._cached_snapshot(cache_key, 5.0, build)
