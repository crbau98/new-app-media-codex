"""Additive SQLite schema for the creator index (CREATE ... IF NOT EXISTS only)."""

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
    state             TEXT NOT NULL DEFAULT 'running'
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
"""


def ensure_creator_index_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(CREATOR_INDEX_DDL)
    conn.commit()
