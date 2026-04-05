from __future__ import annotations

import logging
import time
from threading import Lock

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])

# ---------------------------------------------------------------------------
# Optimization #1: Short-lived search result cache (2s TTL) to handle
# rapid re-queries from typeahead/command palette without hitting SQLite
# ---------------------------------------------------------------------------
_SEARCH_CACHE: dict[str, dict] = {}
_SEARCH_CACHE_LOCK = Lock()
_SEARCH_TTL = 2.0
_SEARCH_CACHE_MAX = 64


def _get_cached_search(key: str):
    with _SEARCH_CACHE_LOCK:
        entry = _SEARCH_CACHE.get(key)
        if entry and time.monotonic() < entry["exp"]:
            return entry["data"]
    return None


def _set_cached_search(key: str, data):
    with _SEARCH_CACHE_LOCK:
        # Optimization #2: evict oldest entries when cache is full
        if len(_SEARCH_CACHE) >= _SEARCH_CACHE_MAX:
            oldest_key = min(_SEARCH_CACHE, key=lambda k: _SEARCH_CACHE[k]["exp"])
            del _SEARCH_CACHE[oldest_key]
        _SEARCH_CACHE[key] = {"data": data, "exp": time.monotonic() + _SEARCH_TTL}


# Optimization #3: pre-strip query once, reuse everywhere
def _normalize_query(q: str) -> str:
    return q.strip().lower()


@router.get("")
def unified_search(
    request: Request,
    q: str = Query(default="", min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> JSONResponse:
    db = request.app.state.db

    raw = q.strip()
    if not raw:
        return JSONResponse([])

    # Optimization #4: cache key includes normalized query + limit
    cache_key = f"{raw.lower()}:{limit}"
    cached = _get_cached_search(cache_key)
    if cached is not None:
        return JSONResponse(cached)

    needle = f"%{raw}%"
    per_type = max(1, limit // 2)
    results: list[dict] = []

    with db.connect() as conn:
        # Optimization #5: log search errors instead of silently swallowing
        try:
            rows = conn.execute(
                """
                SELECT
                    id, title, summary, source_type, theme, first_seen_at AS created_at,
                    CASE
                        WHEN INSTR(LOWER(title), LOWER(?)) > 0
                            THEN INSTR(LOWER(title), LOWER(?))
                        WHEN INSTR(LOWER(summary), LOWER(?)) > 0
                            THEN 1000 + INSTR(LOWER(summary), LOWER(?))
                        ELSE 9999
                    END AS _score
                FROM items
                WHERE
                    theme != 'community_visuals'
                    AND source_type NOT LIKE '%_visual%'
                    AND (
                        LOWER(title) LIKE LOWER(?)
                        OR LOWER(summary) LIKE LOWER(?)
                        OR LOWER(content) LIKE LOWER(?)
                    )
                ORDER BY _score ASC
                LIMIT ?
                """,
                (raw, raw, raw, raw, needle, needle, needle, per_type),
            ).fetchall()

            # Optimization #6: use list comprehension instead of append loop
            results.extend(
                {
                    "result_type": "item",
                    "id": row["id"],
                    "title": row["title"],
                    "body": row["summary"],
                    "source_type": row["source_type"],
                    "theme": row["theme"],
                    "score": row["_score"],
                    "created_at": row["created_at"],
                }
                for row in rows
            )
        except Exception:
            logger.exception("search items query failed for q=%r", raw)

        try:
            rows = conn.execute(
                """
                SELECT
                    id, title, rationale, body, created_at,
                    CASE
                        WHEN INSTR(LOWER(title), LOWER(?)) > 0
                            THEN INSTR(LOWER(title), LOWER(?))
                        WHEN INSTR(LOWER(rationale), LOWER(?)) > 0
                            THEN 1000 + INSTR(LOWER(rationale), LOWER(?))
                        WHEN INSTR(LOWER(body), LOWER(?)) > 0
                            THEN 2000 + INSTR(LOWER(body), LOWER(?))
                        ELSE 9999
                    END AS _score
                FROM hypotheses
                WHERE
                    LOWER(title) LIKE LOWER(?)
                    OR LOWER(rationale) LIKE LOWER(?)
                    OR LOWER(evidence) LIKE LOWER(?)
                    OR LOWER(body) LIKE LOWER(?)
                ORDER BY _score ASC
                LIMIT ?
                """,
                (raw, raw, raw, raw, raw, raw, needle, needle, needle, needle, per_type),
            ).fetchall()

            # Optimization #7: generator expression for extend
            results.extend(
                {
                    "result_type": "hypothesis",
                    "id": row["id"],
                    "title": row["title"],
                    "body": row["body"] or row["rationale"],
                    "score": row["_score"],
                    "created_at": row["created_at"],
                }
                for row in rows
            )
        except Exception:
            logger.exception("search hypotheses query failed for q=%r", raw)

    # Optimization #8: use key function with default via operator.itemgetter pattern
    results.sort(key=lambda r: r.get("score", 9999))
    final = results[:limit]

    _set_cached_search(cache_key, final)
    return JSONResponse(final)
