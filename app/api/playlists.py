from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class PlaylistCreate(BaseModel):
    name: str
    description: str | None = None
    is_smart: bool = False
    smart_rules: dict | None = None


class PlaylistUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    cover_url: str | None = None
    is_smart: bool | None = None
    smart_rules: dict | None = None


class PlaylistItemsBody(BaseModel):
    screenshot_ids: list[int]


class ReorderBody(BaseModel):
    ordered_ids: list[int]


def _playlist_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "cover_url": row["cover_url"],
        "is_smart": bool(row["is_smart"]),
        "smart_rules": json.loads(row["smart_rules"]) if row["smart_rules"] else None,
        "item_count": row["item_count"],
        "total_duration": row["total_duration"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("")
def list_playlists() -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT p.*,
                   COUNT(pi.id) AS computed_count
            FROM playlists p
            LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
            GROUP BY p.id
            ORDER BY p.updated_at DESC
            """
        ).fetchall()
    result = []
    for r in rows:
        d = _playlist_row_to_dict(r)
        d["item_count"] = r["computed_count"]
        result.append(d)
    return JSONResponse(result)


@router.post("")
def create_playlist(payload: PlaylistCreate) -> JSONResponse:
    from app.main import db

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    rules_json = json.dumps(payload.smart_rules) if payload.smart_rules else None
    with db.connect() as conn:
        cursor = conn.execute(
            "INSERT INTO playlists (name, description, is_smart, smart_rules) VALUES (?, ?, ?, ?)",
            (name, payload.description, int(payload.is_smart), rules_json),
        )
        conn.commit()
        pid = cursor.lastrowid
        row = conn.execute("SELECT * FROM playlists WHERE id = ?", (pid,)).fetchone()
    return JSONResponse(_playlist_row_to_dict(row), status_code=201)


@router.get("/{playlist_id}")
def get_playlist(
    playlist_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
) -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Playlist not found")

        total = conn.execute(
            "SELECT COUNT(*) as cnt FROM playlist_items WHERE playlist_id = ?",
            (playlist_id,),
        ).fetchone()["cnt"]

        items = conn.execute(
            """
            SELECT s.id, s.term, s.source, s.page_url, s.local_path,
                   s.captured_at, s.ai_summary, s.ai_tags, s.performer_id,
                   pi.position, pi.added_at AS playlist_added_at
            FROM playlist_items pi
            JOIN screenshots s ON s.id = pi.screenshot_id
            WHERE pi.playlist_id = ?
            ORDER BY pi.position ASC, pi.added_at ASC
            LIMIT ? OFFSET ?
            """,
            (playlist_id, limit, offset),
        ).fetchall()

    playlist = _playlist_row_to_dict(row)
    playlist["item_count"] = total

    screenshots = []
    for s in items:
        d = dict(s)
        lp = d.get("local_path") or ""
        d["local_url"] = "/cached-screenshots/" + lp.split("/")[-1] if lp else None
        screenshots.append(d)

    return JSONResponse({
        "playlist": playlist,
        "screenshots": screenshots,
        "total": total,
        "offset": offset,
        "limit": limit,
    })


@router.patch("/{playlist_id}")
def update_playlist(playlist_id: int, payload: PlaylistUpdate) -> JSONResponse:
    from app.main import db

    updates: list[str] = []
    values: list = []
    if payload.name is not None:
        updates.append("name = ?")
        values.append(payload.name.strip())
    if payload.description is not None:
        updates.append("description = ?")
        values.append(payload.description)
    if payload.cover_url is not None:
        updates.append("cover_url = ?")
        values.append(payload.cover_url)
    if payload.is_smart is not None:
        updates.append("is_smart = ?")
        values.append(int(payload.is_smart))
    if payload.smart_rules is not None:
        updates.append("smart_rules = ?")
        values.append(json.dumps(payload.smart_rules))
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates.append("updated_at = datetime('now')")
    values.append(playlist_id)
    with db.connect() as conn:
        conn.execute(
            f"UPDATE playlists SET {', '.join(updates)} WHERE id = ?",
            values,
        )
        conn.commit()
        row = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return JSONResponse(_playlist_row_to_dict(row))


@router.delete("/{playlist_id}")
def delete_playlist(playlist_id: int) -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        conn.commit()
    return JSONResponse({"ok": True})


@router.post("/{playlist_id}/items")
def add_items_to_playlist(playlist_id: int, payload: PlaylistItemsBody) -> JSONResponse:
    from app.main import db

    if not payload.screenshot_ids:
        raise HTTPException(status_code=400, detail="No screenshot ids supplied")
    with db.connect() as conn:
        exists = conn.execute("SELECT 1 FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Playlist not found")
        # Get current max position
        max_pos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) as mp FROM playlist_items WHERE playlist_id = ?",
            (playlist_id,),
        ).fetchone()["mp"]
        added = 0
        for sid in payload.screenshot_ids:
            try:
                max_pos += 1
                conn.execute(
                    "INSERT OR IGNORE INTO playlist_items (playlist_id, screenshot_id, position) VALUES (?, ?, ?)",
                    (playlist_id, sid, max_pos),
                )
                added += 1
            except Exception:
                pass
        # Update item_count
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM playlist_items WHERE playlist_id = ?",
            (playlist_id,),
        ).fetchone()["cnt"]
        conn.execute(
            "UPDATE playlists SET item_count = ?, updated_at = datetime('now') WHERE id = ?",
            (count, playlist_id),
        )
        conn.commit()
    return JSONResponse({"added": len(payload.screenshot_ids), "playlist_id": playlist_id})


@router.delete("/{playlist_id}/items")
def remove_items_from_playlist(playlist_id: int, payload: PlaylistItemsBody) -> JSONResponse:
    from app.main import db

    if not payload.screenshot_ids:
        raise HTTPException(status_code=400, detail="No screenshot ids supplied")
    placeholders = ", ".join("?" for _ in payload.screenshot_ids)
    with db.connect() as conn:
        conn.execute(
            f"DELETE FROM playlist_items WHERE playlist_id = ? AND screenshot_id IN ({placeholders})",
            [playlist_id, *payload.screenshot_ids],
        )
        count = conn.execute(
            "SELECT COUNT(*) as cnt FROM playlist_items WHERE playlist_id = ?",
            (playlist_id,),
        ).fetchone()["cnt"]
        conn.execute(
            "UPDATE playlists SET item_count = ?, updated_at = datetime('now') WHERE id = ?",
            (count, playlist_id),
        )
        conn.commit()
    return JSONResponse({"removed": len(payload.screenshot_ids), "playlist_id": playlist_id})


@router.post("/{playlist_id}/reorder")
def reorder_playlist(playlist_id: int, payload: ReorderBody) -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        for position, sid in enumerate(payload.ordered_ids):
            conn.execute(
                "UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND screenshot_id = ?",
                (position, playlist_id, sid),
            )
        conn.execute(
            "UPDATE playlists SET updated_at = datetime('now') WHERE id = ?",
            (playlist_id,),
        )
        conn.commit()
    return JSONResponse({"ok": True})


@router.post("/{playlist_id}/populate")
def populate_smart_playlist(playlist_id: int) -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        row = conn.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Playlist not found")
        if not row["is_smart"] or not row["smart_rules"]:
            raise HTTPException(status_code=400, detail="Not a smart playlist or no rules defined")

        rules = json.loads(row["smart_rules"])
        conditions: list[str] = []
        params: list = []

        if rules.get("source"):
            conditions.append("s.source = ?")
            params.append(rules["source"])
        if rules.get("term"):
            conditions.append("s.term LIKE ?")
            params.append(f"%{rules['term']}%")
        if rules.get("has_ai_summary"):
            conditions.append("s.ai_summary IS NOT NULL AND s.ai_summary != ''")
        if rules.get("media_type") == "video":
            conditions.append("(s.local_path LIKE '%.mp4' OR s.local_path LIKE '%.webm' OR s.local_path LIKE '%.mov')")
        elif rules.get("media_type") == "image":
            conditions.append("s.local_path NOT LIKE '%.mp4' AND s.local_path NOT LIKE '%.webm' AND s.local_path NOT LIKE '%.mov'")
        if rules.get("min_date"):
            conditions.append("s.captured_at >= ?")
            params.append(rules["min_date"])
        if rules.get("performer_id"):
            conditions.append("s.performer_id = ?")
            params.append(rules["performer_id"])

        where = " AND ".join(conditions) if conditions else "1=1"
        limit = rules.get("limit", 50)

        matching = conn.execute(
            f"SELECT s.id FROM screenshots s WHERE {where} ORDER BY s.captured_at DESC LIMIT ?",
            [*params, limit],
        ).fetchall()

        # Clear existing items and repopulate
        conn.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
        for pos, m in enumerate(matching):
            conn.execute(
                "INSERT OR IGNORE INTO playlist_items (playlist_id, screenshot_id, position) VALUES (?, ?, ?)",
                (playlist_id, m["id"], pos),
            )
        count = len(matching)
        conn.execute(
            "UPDATE playlists SET item_count = ?, updated_at = datetime('now') WHERE id = ?",
            (count, playlist_id),
        )
        conn.commit()

    return JSONResponse({"populated": count, "playlist_id": playlist_id})
