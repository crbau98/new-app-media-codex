"""Additive SQLite schema for the creator index.

Only ``CREATE ... IF NOT EXISTS`` plus guarded ``ALTER TABLE ... ADD COLUMN`` (each column is
added at most once, tolerant of concurrent initialisers). Safe to run on every boot.
"""

from __future__ import annotations

import sqlite3

CREATOR_INDEX_DDL = """
CREATE TABLE IF NOT EXISTS creator_index (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    platform        TEXT NOT NULL,
    handle          TEXT NOT NULL,
    display_name    TEXT NOT NULL DEFAULT '',
    avatar_url      TEXT NOT NULL DEFAULT '',
    profile_url     TEXT NOT NULL DEFAULT '',
    followers       INTEGER,
    media_count     INTEGER NOT NULL DEFAULT 0,
    view_count      INTEGER NOT NULL DEFAULT 0,
    like_count      INTEGER NOT NULL DEFAULT 0,
    curation_score  INTEGER NOT NULL DEFAULT 0,
    tags_json       TEXT NOT NULL DEFAULT '{}',
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL DEFAULT '',
    last_crawled_at TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT '',
    sample_media_json TEXT NOT NULL DEFAULT '[]',
    hidden          INTEGER NOT NULL DEFAULT 0,
    attribution     TEXT NOT NULL DEFAULT '',
    links_json      TEXT NOT NULL DEFAULT '[]',
    UNIQUE (platform, handle)
);
CREATE INDEX IF NOT EXISTS idx_creator_index_platform_seen ON creator_index(platform, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_creator_index_hidden ON creator_index(hidden);
CREATE INDEX IF NOT EXISTS idx_creator_index_score ON creator_index(hidden, curation_score, view_count);

CREATE TABLE IF NOT EXISTS creator_tags (
    handle   TEXT NOT NULL,
    platform TEXT NOT NULL,
    tag      TEXT NOT NULL,
    PRIMARY KEY (platform, handle, tag)
);
CREATE INDEX IF NOT EXISTS idx_creator_tags_tag ON creator_tags(tag, platform);

CREATE TABLE IF NOT EXISTS creator_crawl_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at        TEXT NOT NULL,
    finished_at       TEXT,
    source            TEXT NOT NULL DEFAULT 'all',
    lane              TEXT NOT NULL DEFAULT '',
    pages             INTEGER NOT NULL DEFAULT 0,
    creators_upserted INTEGER NOT NULL DEFAULT 0,
    errors_json       TEXT NOT NULL DEFAULT '[]',
    state             TEXT NOT NULL DEFAULT 'running',
    new_creators      INTEGER NOT NULL DEFAULT 0,
    requests          INTEGER NOT NULL DEFAULT 0,
    yield_json        TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_creator_crawl_runs_started ON creator_crawl_runs(started_at);

-- Resumable lane cursors, keyed e.g. 'cursor:redgifs'.
CREATE TABLE IF NOT EXISTS creator_crawl_state (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL DEFAULT 'null',
    updated_at TEXT NOT NULL
);

-- Snowball queue: creators discovered via tag co-occurrence whose catalogs
-- should be crawled next.
CREATE TABLE IF NOT EXISTS creator_seed_queue (
    platform    TEXT NOT NULL,
    handle      TEXT NOT NULL,
    priority    INTEGER NOT NULL DEFAULT 0,
    reason      TEXT NOT NULL DEFAULT '',
    enqueued_at TEXT NOT NULL,
    crawled_at  TEXT,
    PRIMARY KEY (platform, handle)
);
CREATE INDEX IF NOT EXISTS idx_creator_seed_queue_pending ON creator_seed_queue(crawled_at, priority);

-- Adaptive lane weighting: per-lane yield (new creators per request); zero-yield lanes back off.
CREATE TABLE IF NOT EXISTS creator_lane_stats (
    lane_key      TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    runs          INTEGER NOT NULL DEFAULT 0,
    requests      INTEGER NOT NULL DEFAULT 0,
    new_creators  INTEGER NOT NULL DEFAULT 0,
    zero_runs     INTEGER NOT NULL DEFAULT 0,
    last_run_at   TEXT NOT NULL DEFAULT '',
    last_new_at   TEXT,
    backoff_until TEXT
);
CREATE INDEX IF NOT EXISTS idx_creator_lane_stats_source ON creator_lane_stats(source, backoff_until);

-- Related-tag snowballing: how often a tag appears on items of high-engagement creators.
CREATE TABLE IF NOT EXISTS creator_tag_freq (
    platform      TEXT NOT NULL,
    tag           TEXT NOT NULL,
    items         INTEGER NOT NULL DEFAULT 0,
    sightings     INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    promoted_at   TEXT,
    PRIMARY KEY (platform, tag)
);
CREATE INDEX IF NOT EXISTS idx_creator_tag_freq_rank ON creator_tag_freq(platform, promoted_at, items);

-- Lanes discovered at runtime (promoted tags, Redgifs niches, Lemmy communities, ...).
CREATE TABLE IF NOT EXISTS creator_discovered_lanes (
    source       TEXT NOT NULL,
    lane_key     TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    score        INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (source, lane_key)
);

-- Creator-submitted public feeds (moderated; only approved feeds are crawled).
CREATE TABLE IF NOT EXISTS submitted_feeds (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    kind               TEXT NOT NULL,
    url                TEXT NOT NULL,
    canonical_key      TEXT NOT NULL UNIQUE,
    handle             TEXT NOT NULL DEFAULT '',
    display_name       TEXT NOT NULL DEFAULT '',
    creator_handle     TEXT NOT NULL DEFAULT '',
    site_url           TEXT NOT NULL DEFAULT '',
    contact_email_hash TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'pending',
    reason             TEXT NOT NULL DEFAULT '',
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL DEFAULT '',
    last_fetched_at    TEXT,
    next_fetch_at      TEXT,
    last_status        TEXT NOT NULL DEFAULT '',
    item_count         INTEGER NOT NULL DEFAULT 0,
    error_json         TEXT NOT NULL DEFAULT '[]',
    failures           INTEGER NOT NULL DEFAULT 0,
    submitted_ip_hash  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_submitted_feeds_status ON submitted_feeds(status, next_fetch_at);
CREATE INDEX IF NOT EXISTS idx_submitted_feeds_ip ON submitted_feeds(submitted_ip_hash, created_at);

-- Takedown / hide requests (contact stored only as a salted hash).
CREATE TABLE IF NOT EXISTS takedown_requests (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at         TEXT NOT NULL,
    platform           TEXT NOT NULL DEFAULT '',
    handle             TEXT NOT NULL DEFAULT '',
    target_url         TEXT NOT NULL DEFAULT '',
    reason             TEXT NOT NULL DEFAULT '',
    contact_email_hash TEXT NOT NULL DEFAULT '',
    submitted_ip_hash  TEXT NOT NULL DEFAULT '',
    source             TEXT NOT NULL DEFAULT 'public',
    status             TEXT NOT NULL DEFAULT 'hidden',
    matched_creators   INTEGER NOT NULL DEFAULT 0,
    matched_items      INTEGER NOT NULL DEFAULT 0,
    resolved_at        TEXT,
    admin_note         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_takedown_requests_status ON takedown_requests(status, id);
CREATE INDEX IF NOT EXISTS idx_takedown_requests_email ON takedown_requests(contact_email_hash, created_at);

-- Suppression list consulted by the crawler, observe and feeds (so removed creators/items never return).
CREATE TABLE IF NOT EXISTS creator_suppressions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,                 -- creator | item | profile | feed
    platform   TEXT NOT NULL DEFAULT '',
    handle     TEXT NOT NULL DEFAULT '',
    item_key   TEXT NOT NULL DEFAULT '',
    level      TEXT NOT NULL DEFAULT 'hidden', -- hidden (restorable) | permanent
    source     TEXT NOT NULL DEFAULT 'takedown',
    request_id INTEGER,
    reason     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (kind, platform, handle, item_key)
);
CREATE INDEX IF NOT EXISTS idx_creator_suppressions_request ON creator_suppressions(request_id);
"""

# Columns added after the first release of a table (CREATE TABLE IF NOT EXISTS cannot add them).
_ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("creator_index", "attribution", "TEXT NOT NULL DEFAULT ''"),
    ("creator_index", "links_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("creator_crawl_runs", "new_creators", "INTEGER NOT NULL DEFAULT 0"),
    ("creator_crawl_runs", "requests", "INTEGER NOT NULL DEFAULT 0"),
    ("creator_crawl_runs", "yield_json", "TEXT NOT NULL DEFAULT '{}'"),
)


def _ensure_columns(conn: sqlite3.Connection) -> None:
    for table, column, ddl in _ADDED_COLUMNS:
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column in existing:
            continue
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
        except sqlite3.OperationalError as exc:  # a concurrent initialiser added it first
            if "duplicate column" not in str(exc).lower():
                raise


def ensure_creator_index_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(CREATOR_INDEX_DDL)
    _ensure_columns(conn)
    conn.commit()
