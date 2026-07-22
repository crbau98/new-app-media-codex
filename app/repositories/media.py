"""Media repository: protocol + SQLite implementation.

Keyset pagination on the (captured_at DESC, id DESC) composite index — the
cursor translates to a row-value comparison, so page depth costs nothing
(blueprint sections 5, 7, 11). Sort/filter fields are allow-listed in the
router; this layer only ever binds parameters.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Protocol

from app.core.pagination import decode_cursor
from app.domain.media import MediaItem, MediaKind, PreviewRef, SourceProvider, SourceRef


class MediaRepository(Protocol):
    def list(
        self,
        *,
        kind: MediaKind | None = None,
        provider: SourceProvider | None = None,
        tag: str | None = None,
        query: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> list[MediaItem]: ...

    def get(self, media_id: str) -> MediaItem | None: ...

    def add(self, conn: sqlite3.Connection, item: MediaItem) -> None: ...


def _row_to_item(row: sqlite3.Row) -> MediaItem:
    return MediaItem(
        id=row["id"],
        kind=MediaKind(row["kind"]),
        source=SourceRef(
            provider=SourceProvider(row["provider"]),
            external_id=row["external_id"],
            canonical_url=row["canonical_url"],
        ),
        title=row["title"] or "",
        tags=json.loads(row["tags_json"] or "[]"),
        preview=PreviewRef(thumbnail_url=row["preview_url"]),
        checksum=row["checksum"],
        captured_at=row["captured_at"],
    )


class SqliteMediaRepository:
    """Reads/writes the v2 ``media_items`` table (blueprint section 7).

    Constructed with an open connection by the dependency layer; all methods
    are synchronous — routers call them via ``asyncio.to_thread`` so the
    event loop never blocks on I/O.
    """

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def list(
        self,
        *,
        kind: MediaKind | None = None,
        provider: SourceProvider | None = None,
        tag: str | None = None,
        query: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> list[MediaItem]:
        clauses: list[str] = []
        params: list[object] = []

        if kind is not None:
            clauses.append("kind = ?")
            params.append(str(kind))
        if provider is not None:
            clauses.append("provider = ?")
            params.append(str(provider))
        if tag:
            clauses.append(
                "EXISTS (SELECT 1 FROM json_each(media_items.tags_json) je WHERE je.value = ?)"
            )
            params.append(tag.strip().lower())
        if query:
            # LIKE fallback until the FTS5 shadow table lands (Phase 2).
            clauses.append("title LIKE ? ESCAPE '\\'")
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            params.append(f"%{escaped}%")
        if cursor:
            sort_value, item_id = decode_cursor(cursor)
            clauses.append("(captured_at < ? OR (captured_at = ? AND id < ?))")
            params.extend([sort_value, sort_value, item_id])

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        # limit + 1: the extra row tells us whether a next page exists.
        rows = self._conn.execute(
            f"SELECT id, kind, provider, external_id, canonical_url, title, tags_json,"
            f" preview_url, checksum, captured_at FROM media_items {where}"
            f" ORDER BY captured_at DESC, id DESC LIMIT ?",
            (*params, limit + 1),
        ).fetchall()
        return [_row_to_item(r) for r in rows]

    def get(self, media_id: str) -> MediaItem | None:
        row = self._conn.execute(
            "SELECT id, kind, provider, external_id, canonical_url, title, tags_json,"
            " preview_url, checksum, captured_at FROM media_items WHERE id = ?",
            (media_id,),
        ).fetchone()
        return _row_to_item(row) if row else None

    def add(self, conn: sqlite3.Connection, item: MediaItem) -> None:
        """Insert inside the caller's unit-of-work transaction. Upsert on the
        (provider, external_id) natural key keeps captures idempotent."""
        conn.execute(
            """
            INSERT INTO media_items
                (id, kind, provider, external_id, canonical_url, title, tags_json,
                 preview_url, checksum, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, external_id) DO UPDATE SET
                title = excluded.title,
                tags_json = excluded.tags_json,
                preview_url = excluded.preview_url,
                checksum = excluded.checksum
            """,
            (
                item.id,
                str(item.kind),
                str(item.source.provider),
                item.source.external_id,
                item.source.canonical_url,
                item.title,
                json.dumps(item.tags, separators=(",", ":")),
                item.preview.thumbnail_url,
                item.checksum,
                item.captured_at,
            ),
        )
