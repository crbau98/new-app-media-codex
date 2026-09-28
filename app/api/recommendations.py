from __future__ import annotations

import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api", tags=["recommendations"])


@router.get("/recommendations")
def get_recommendations(request: Request) -> JSONResponse:
    """Return up to 5 recommended items based on compound/mechanism overlap with saved items."""
    db = request.app.state.db

    with db.connect() as conn:
        # 1. Get compounds and mechanisms from saved/promoted items
        saved_rows = conn.execute(
            "SELECT compounds_json, mechanisms_json FROM items WHERE is_saved = 1"
        ).fetchall()

        if not saved_rows:
            return JSONResponse({"items": [], "reason": "no_saved_items"})

        saved_compounds: set[str] = set()
        saved_mechanisms: set[str] = set()
        for row in saved_rows:
            for c in json.loads(row["compounds_json"] or "[]"):
                if c:
                    saved_compounds.add(c)
            for m in json.loads(row["mechanisms_json"] or "[]"):
                if m:
                    saved_mechanisms.add(m)

        if not saved_compounds and not saved_mechanisms:
            return JSONResponse({"items": [], "reason": "no_signals"})

        # 2. Get unreviewed items (not saved, not shortlisted or archived)
        candidates = conn.execute(
            """SELECT id, title, url, summary, source_type, theme, score,
                      compounds_json, mechanisms_json, first_seen_at
               FROM items
               WHERE is_saved = 0
                 AND review_status IN ('new', 'reviewing')
            """
        ).fetchall()

        # 3. Score each candidate by overlap count
        scored: list[tuple[dict, int, list[str], list[str]]] = []
        for row in candidates:
            compounds = json.loads(row["compounds_json"] or "[]")
            mechanisms = json.loads(row["mechanisms_json"] or "[]")

            overlapping_compounds = [c for c in compounds if c in saved_compounds]
            overlapping_mechanisms = [m for m in mechanisms if m in saved_mechanisms]
            overlap_count = len(overlapping_compounds) + len(overlapping_mechanisms)

            if overlap_count > 0:
                scored.append((
                    dict(row),
                    overlap_count,
                    overlapping_compounds,
                    overlapping_mechanisms,
                ))

        # 4. Sort by overlap count DESC, then score DESC
        scored.sort(key=lambda x: (x[1], x[0].get("score", 0)), reverse=True)

        # 5. Return top 5
        results = []
        for row_dict, overlap_count, oc, om in scored[:5]:
            results.append({
                "id": row_dict["id"],
                "title": row_dict["title"],
                "url": row_dict["url"],
                "summary": row_dict["summary"],
                "source_type": row_dict["source_type"],
                "theme": row_dict["theme"],
                "score": row_dict["score"],
                "overlap_count": overlap_count,
                "overlapping_compounds": oc,
                "overlapping_mechanisms": om,
            })

        return JSONResponse({"items": results, "reason": "ok"})


# ─────────────────────────────────────────────────────────────────────────────
# Metadata-enrichment endpoints (public metadata only, cached, fail-soft)
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import HTTPException, Query

from app.ai import (
    TTLCache,
    enrich_item,
    normalize_tags,
    related_items,
    suggest_collections,
    unsafe_reason,
)

_cache = TTLCache(ttl_seconds=120.0)
_ITEM_COLUMNS = "id, title, summary, author, source_type, theme, score, compounds_json, mechanisms_json"


def _safe_json_list(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [str(v) for v in data if v] if isinstance(data, list) else []


def _load_items(conn, limit: int = 400) -> list[dict]:
    rows = conn.execute(f"SELECT {_ITEM_COLUMNS} FROM items ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    tag_rows = conn.execute(
        "SELECT it.item_id AS item_id, t.name AS name FROM item_tags it JOIN tags t ON t.id = it.tag_id"
    ).fetchall()
    tags_by_item: dict[int, list[str]] = {}
    for tr in tag_rows:
        tags_by_item.setdefault(tr["item_id"], []).append(tr["name"])
    items = []
    for row in rows:
        raw_tags = [
            *tags_by_item.get(row["id"], []),
            row["theme"] or "",
            *_safe_json_list(row["compounds_json"]),
            *_safe_json_list(row["mechanisms_json"]),
        ]
        items.append(
            {
                "id": row["id"],
                "title": row["title"],
                "creator": row["author"] or "",
                "summary": row["summary"] or "",
                "source_type": row["source_type"],
                "score": row["score"],
                "tags": normalize_tags(raw_tags),
            }
        )
    return items


@router.get("/recommendations/related")
def related(request: Request, item_id: int = Query(..., ge=1), limit: int = Query(8, ge=1, le=24)) -> JSONResponse:
    """Items related to `item_id` by tags, creator and title words (embedding-lite)."""
    cache_key = f"related:{item_id}:{limit}"
    hit = _cache.get(cache_key)
    if hit is not None:
        return JSONResponse(hit)
    with request.app.state.db.connect() as conn:
        items = _load_items(conn)
    target = next((i for i in items if i["id"] == item_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="item not found")
    payload = {"item_id": item_id, "items": related_items(target, items, limit), "method": "metadata-similarity"}
    _cache.set(cache_key, payload)
    return JSONResponse(payload)


@router.get("/recommendations/collections")
def collection_suggestions(request: Request, limit: int = Query(5, ge=1, le=12)) -> JSONResponse:
    """Smart collection suggestions grouped by normalized tags and creators."""
    cache_key = f"collections:{limit}"
    hit = _cache.get(cache_key)
    if hit is not None:
        return JSONResponse(hit)
    with request.app.state.db.connect() as conn:
        items = _load_items(conn)
    payload = {"suggestions": suggest_collections(items, max_suggestions=limit)}
    _cache.set(cache_key, payload)
    return JSONResponse(payload)


@router.get("/recommendations/enrich")
def enrich(request: Request, item_id: int = Query(..., ge=1)) -> JSONResponse:
    """aiTags / aiSummary / aiMood for one item, derived from public metadata."""
    with request.app.state.db.connect() as conn:
        items = _load_items(conn)
    item = next((i for i in items if i["id"] == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="item not found")
    return JSONResponse({"item_id": item_id, **enrich_item(item)})


@router.get("/recommendations/search-assist")
def search_assist(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    page: int = Query(1, ge=1, le=50),
    per_page: int = Query(10, ge=1, le=50),
) -> JSONResponse:
    """Tag-alias-aware search with pagination. Refuses unsafe queries."""
    reason = unsafe_reason(q)
    if reason:
        return JSONResponse({"items": [], "total": 0, "page": page, "per_page": per_page, "refused": reason})
    terms = set(normalize_tags(q.replace(",", " ").split(), limit=8))
    raw_terms = {w for w in q.lower().split() if len(w) > 1}
    with request.app.state.db.connect() as conn:
        items = _load_items(conn)
    scored = []
    for item in items:
        haystack = f"{item['title']} {item['summary']} {item['creator']}".lower()
        tag_hits = len(terms & set(item["tags"]))
        text_hits = sum(1 for w in raw_terms if w in haystack)
        if tag_hits or text_hits:
            scored.append((tag_hits * 2 + text_hits + min(float(item["score"] or 0), 100) / 1000, item))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    total = len(scored)
    start = (page - 1) * per_page
    window = [{**item, "relevance": round(score, 3)} for score, item in scored[start : start + per_page]]
    return JSONResponse(
        {
            "items": window,
            "total": total,
            "page": page,
            "per_page": per_page,
            "has_more": start + per_page < total,
            "interpreted_tags": sorted(terms),
        }
    )
