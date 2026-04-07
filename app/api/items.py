from __future__ import annotations

import json
import time
from threading import Lock

import httpx
from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/api/items", tags=["items"])
_OEMBED_HEADERS = {"User-Agent": "Mozilla/5.0"}
_OEMBED_TIMEOUT = httpx.Timeout(8.0, connect=3.0)

# ── Suggest cache ────────────────────────────────────────────────────
_SUGGEST_CACHE: dict[str, tuple[float, set[str]]] = {}
_SUGGEST_CACHE_LOCK = Lock()
_SUGGEST_TTL = 300.0  # 5 minutes


class ItemUpdateRequest(BaseModel):
    review_status: str | None = None
    is_saved: bool | None = None
    user_note: str | None = None
    queued_at: str | None = "__unset__"


class MergeItemsRequest(BaseModel):
    keep_id: int
    remove_ids: list[int]


class BulkItemUpdateRequest(BaseModel):
    item_ids: list[int]
    review_status: str | None = None
    is_saved: bool | None = None
    queued_at: str | None = "__unset__"


class CreateTagRequest(BaseModel):
    name: str
    color: str = "#6b7280"


class AddItemTagRequest(BaseModel):
    tag_id: int | None = None
    tag_name: str | None = None
    color: str = "#6b7280"


_ALLOWED_STATUSES = frozenset({"new", "reviewing", "shortlisted", "archived"})


@router.get("")
def items(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    saved_only: bool = Query(default=False),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
) -> JSONResponse:
    from app.main import db
    return JSONResponse(
        db.get_recent_items(
            limit=limit,
            theme=theme,
            source_type=source_type,
            review_status=review_status,
            saved_only=saved_only,
            offset=offset,
        )
    )


@router.post("/bulk")
def update_items_bulk(
    payload: BulkItemUpdateRequest,
    x_admin_token: str | None = Header(default=None),
) -> JSONResponse:
    from app.main import db
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Missing or invalid admin token")
    if payload.review_status is not None and payload.review_status not in _ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid review status")
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="No item ids supplied")
    kwargs: dict = dict(review_status=payload.review_status, is_saved=payload.is_saved)
    if payload.queued_at != "__unset__":
        kwargs["queued_at"] = payload.queued_at
    updated = db.update_items_bulk(payload.item_ids, **kwargs)
    return JSONResponse({"updated": updated, "item_ids": payload.item_ids})


@router.get("/queue")
def items_queue() -> JSONResponse:
    from app.main import db
    return JSONResponse(db.get_queue())


@router.get("/queue/count")
def items_queue_count() -> JSONResponse:
    from app.main import db
    return JSONResponse({"count": db.get_queue_count()})


def _get_suggest_values(db, col: str) -> set[str]:
    """Get all distinct values for a JSON array column, with TTL caching."""
    now = time.monotonic()
    with _SUGGEST_CACHE_LOCK:
        entry = _SUGGEST_CACHE.get(col)
        if entry and now - entry[0] < _SUGGEST_TTL:
            return entry[1]

    with db.connect() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT {col} FROM items WHERE {col} IS NOT NULL AND {col} != '[]' LIMIT 5000"
        ).fetchall()

    seen: set[str] = set()
    for row in rows:
        try:
            arr = json.loads(row[0])
            for val in arr:
                if isinstance(val, str):
                    seen.add(val)
        except (json.JSONDecodeError, TypeError):
            pass

    with _SUGGEST_CACHE_LOCK:
        _SUGGEST_CACHE[col] = (time.monotonic(), seen)

    return seen


@router.get("/suggest")
def suggest(
    q: str = Query(default=""),
    field: str = Query(default="compound"),
) -> JSONResponse:
    """Autocomplete suggestions for compounds or mechanisms (cached 5 min)."""
    from app.main import db

    col_map = {"compound": "compounds_json", "mechanism": "mechanisms_json"}
    col = col_map.get(field)
    if not col:
        return JSONResponse({"suggestions": []})

    values = _get_suggest_values(db, col)
    q_lower = q.lower()
    matches = sorted([s for s in values if q_lower in s.lower()])[:20]
    return JSONResponse({"suggestions": matches})


@router.get("/duplicates")
def find_duplicates() -> JSONResponse:
    from app.main import db
    groups = db.find_duplicate_groups(max_groups=20)
    return JSONResponse({"groups": groups, "total_groups": len(groups)})


@router.post("/merge")
def merge_items(
    payload: MergeItemsRequest,
    x_admin_token: str | None = Header(default=None),
) -> JSONResponse:
    from app.main import db
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Missing or invalid admin token")
    if not payload.remove_ids:
        raise HTTPException(status_code=400, detail="No remove_ids supplied")
    if payload.keep_id in payload.remove_ids:
        raise HTTPException(status_code=400, detail="keep_id cannot be in remove_ids")
    merged = db.merge_items(payload.keep_id, payload.remove_ids)
    return JSONResponse({"merged": merged})


@router.get("/{item_id}")
def item_detail(item_id: int) -> JSONResponse:
    from app.main import db
    item = db.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return JSONResponse(item)


@router.patch("/{item_id}")
def update_item(
    item_id: int,
    payload: ItemUpdateRequest,
    x_admin_token: str | None = Header(default=None),
) -> JSONResponse:
    from app.main import db
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Missing or invalid admin token")
    if payload.review_status is not None and payload.review_status not in _ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid review status")
    item = db.update_item_state(
        item_id,
        review_status=payload.review_status,
        is_saved=payload.is_saved,
        user_note=payload.user_note,
        queued_at=payload.queued_at,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return JSONResponse(item)


@router.get("/{item_id}/oembed")
def item_oembed(item_id: int) -> JSONResponse:
    from app.main import db

    item = db.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    source_type = (item.get("source_type") or "").lower()
    url = item.get("url") or ""
    oembed_map: dict[str, str] = {
        "x": f"https://publish.twitter.com/oembed?url={url}&omit_script=false&theme=dark",
        "twitter": f"https://publish.twitter.com/oembed?url={url}&omit_script=false&theme=dark",
        "reddit": f"https://www.reddit.com/oembed?url={url}",
    }
    oembed_url = oembed_map.get(source_type)
    if not oembed_url:
        return JSONResponse({"error": "no_oembed"})
    try:
        resp = httpx.get(
            oembed_url,
            headers=_OEMBED_HEADERS,
            timeout=_OEMBED_TIMEOUT,
            follow_redirects=True,
        )
        resp.raise_for_status()
        data = resp.json()
        return JSONResponse({"html": data.get("html") or ""})
    except Exception:
        return JSONResponse({"error": "fetch_failed"})


# ── Tag endpoints ────────────────────────────────────────────────────

tags_router = APIRouter(prefix="/api/tags", tags=["tags"])


@tags_router.get("")
def list_tags() -> JSONResponse:
    from app.main import db
    return JSONResponse(db.get_all_tags())


@tags_router.post("")
def create_tag(payload: CreateTagRequest) -> JSONResponse:
    from app.main import db
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")
    try:
        tag = db.create_tag(name, payload.color)
    except Exception:
        raise HTTPException(status_code=409, detail="Tag already exists")
    return JSONResponse(tag, status_code=201)


@tags_router.delete("/{tag_id}")
def delete_tag(tag_id: int) -> JSONResponse:
    from app.main import db
    ok = db.delete_tag(tag_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tag not found")
    return JSONResponse({"ok": True})


@router.get("/{item_id}/tags")
def get_item_tags(item_id: int) -> JSONResponse:
    from app.main import db
    return JSONResponse(db.get_item_tags(item_id))


@router.post("/{item_id}/tags")
def add_item_tag(item_id: int, payload: AddItemTagRequest) -> JSONResponse:
    from app.main import db
    if payload.tag_id is None and not payload.tag_name:
        raise HTTPException(status_code=400, detail="Provide tag_id or tag_name")
    if payload.tag_id is not None:
        tag_id = payload.tag_id
    else:
        tag = db.get_or_create_tag(payload.tag_name, payload.color)  # type: ignore[arg-type]
        tag_id = tag["id"]
    db.add_item_tag(item_id, tag_id)
    return JSONResponse(db.get_item_tags(item_id))


@router.delete("/{item_id}/tags/{tag_id}")
def remove_item_tag(item_id: int, tag_id: int) -> JSONResponse:
    from app.main import db
    db.remove_item_tag(item_id, tag_id)
    return JSONResponse(db.get_item_tags(item_id))


browse_router = APIRouter(prefix="/api/browse", tags=["items"])


@browse_router.get("/items")
def browse_items(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    saved_only: bool = Query(default=False),
    queued_only: bool = Query(default=False),
    search: str = Query(default=""),
    sort: str = Query(default="newest"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    compound: str | None = Query(default=None),
    mechanism: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    min_score: float | None = Query(default=None, ge=0),
) -> JSONResponse:
    from app.main import db
    return JSONResponse(
        db.browse_items(
            limit=limit,
            offset=offset,
            theme=theme,
            source_type=source_type,
            review_status=review_status,
            saved_only=saved_only,
            queued_only=queued_only,
            search=search,
            sort=sort,
            compound=compound,
            mechanism=mechanism,
            date_from=date_from,
            date_to=date_to,
            tag=tag,
            min_score=min_score,
        )
    )
