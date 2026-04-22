from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/collections", tags=["collections"])


class CollectionCreate(BaseModel):
    name: str
    color: str = "#3b82f6"
    icon: str = "\U0001f4c1"


class CollectionUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    icon: str | None = None


class CollectionItemsBody(BaseModel):
    item_ids: list[int]


@router.get("")
def list_collections() -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.name, c.color, c.icon, c.created_at,
                   COUNT(ci.item_id) AS item_count
            FROM collections c
            LEFT JOIN collection_items ci ON ci.collection_id = c.id
            GROUP BY c.id
            ORDER BY c.created_at DESC
            """
        ).fetchall()
    return JSONResponse(
        [
            {
                "id": r["id"],
                "name": r["name"],
                "color": r["color"],
                "icon": r["icon"],
                "created_at": r["created_at"],
                "item_count": r["item_count"],
            }
            for r in rows
        ]
    )


@router.post("")
def create_collection(payload: CollectionCreate) -> JSONResponse:
    from app.main import db

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    with db.connect() as conn:
        cursor = conn.execute(
            "INSERT INTO collections (name, color, icon) VALUES (?, ?, ?)",
            (name, payload.color, payload.icon),
        )
        conn.commit()
        cid = cursor.lastrowid
    return JSONResponse(
        {"id": cid, "name": name, "color": payload.color, "icon": payload.icon, "item_count": 0},
        status_code=201,
    )


@router.patch("/{collection_id}")
def update_collection(collection_id: int, payload: CollectionUpdate) -> JSONResponse:
    from app.main import db

    updates: list[str] = []
    values: list[str] = []
    if payload.name is not None:
        updates.append("name = ?")
        values.append(payload.name.strip())
    if payload.color is not None:
        updates.append("color = ?")
        values.append(payload.color)
    if payload.icon is not None:
        updates.append("icon = ?")
        values.append(payload.icon)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    values.append(str(collection_id))
    with db.connect() as conn:
        conn.execute(
            f"UPDATE collections SET {', '.join(updates)} WHERE id = ?",
            values,
        )
        conn.commit()
        row = conn.execute(
            """
            SELECT c.id, c.name, c.color, c.icon, c.created_at,
                   COUNT(ci.item_id) AS item_count
            FROM collections c
            LEFT JOIN collection_items ci ON ci.collection_id = c.id
            WHERE c.id = ?
            GROUP BY c.id
            """,
            (collection_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")
    return JSONResponse(
        {
            "id": row["id"],
            "name": row["name"],
            "color": row["color"],
            "icon": row["icon"],
            "created_at": row["created_at"],
            "item_count": row["item_count"],
        }
    )


@router.delete("/{collection_id}")
def delete_collection(collection_id: int) -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))
        conn.commit()
    return JSONResponse({"ok": True})


@router.post("/{collection_id}/items")
def add_items_to_collection(collection_id: int, payload: CollectionItemsBody) -> JSONResponse:
    from app.main import db

    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="No item ids supplied")
    with db.connect() as conn:
        # Verify collection exists
        exists = conn.execute("SELECT 1 FROM collections WHERE id = ?", (collection_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Collection not found")
        added = 0
        for item_id in payload.item_ids:
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO collection_items (collection_id, item_id) VALUES (?, ?)",
                    (collection_id, item_id),
                )
                added += conn.total_changes  # approximate
            except Exception:
                pass
        conn.commit()
    return JSONResponse({"added": len(payload.item_ids), "collection_id": collection_id})


@router.delete("/{collection_id}/items")
def remove_items_from_collection(collection_id: int, payload: CollectionItemsBody) -> JSONResponse:
    from app.main import db

    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="No item ids supplied")
    placeholders = ", ".join("?" for _ in payload.item_ids)
    with db.connect() as conn:
        conn.execute(
            f"DELETE FROM collection_items WHERE collection_id = ? AND item_id IN ({placeholders})",
            [collection_id, *payload.item_ids],
        )
        conn.commit()
    return JSONResponse({"removed": len(payload.item_ids), "collection_id": collection_id})


@router.get("/{collection_id}/items")
def get_collection_items(
    collection_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> JSONResponse:
    from app.main import db

    with db.connect() as conn:
        # Verify collection exists
        coll = conn.execute("SELECT id, name FROM collections WHERE id = ?", (collection_id,)).fetchone()
        if not coll:
            raise HTTPException(status_code=404, detail="Collection not found")

        total_row = conn.execute(
            "SELECT COUNT(*) as cnt FROM collection_items WHERE collection_id = ?",
            (collection_id,),
        ).fetchone()
        total = total_row["cnt"] if total_row else 0

        rows = conn.execute(
            """
            SELECT i.id, i.title, i.url, i.summary, i.content, i.author,
                   i.published_at, i.domain, i.image_url, i.source_type,
                   i.theme, i.query, i.score, i.review_status, i.is_saved,
                   i.user_note, i.compounds_json, i.mechanisms_json,
                   i.first_seen_at, i.last_seen_at,
                   ci.added_at AS collection_added_at
            FROM collection_items ci
            JOIN items i ON i.id = ci.item_id
            WHERE ci.collection_id = ?
            ORDER BY ci.added_at DESC
            LIMIT ? OFFSET ?
            """,
            (collection_id, limit, offset),
        ).fetchall()

    import json

    items = []
    for r in rows:
        item = dict(r)
        for field in ("compounds_json", "mechanisms_json"):
            raw = item.pop(field, "[]")
            key = field.replace("_json", "s")
            try:
                item[key] = json.loads(raw) if raw else []
            except (json.JSONDecodeError, TypeError):
                item[key] = []
        item["is_saved"] = bool(item.get("is_saved"))
        item["created_at"] = item.get("first_seen_at", "")
        items.append(item)

    return JSONResponse({"items": items, "total": total, "offset": offset, "limit": limit})
