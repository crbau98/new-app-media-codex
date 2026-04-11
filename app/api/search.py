from __future__ import annotations

import logging
import time
from threading import Lock

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])

# ---------------------------------------------------------------------------
# Short-lived search result cache (2s TTL) to absorb typeahead bursts
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
        if len(_SEARCH_CACHE) >= _SEARCH_CACHE_MAX:
            oldest_key = min(_SEARCH_CACHE, key=lambda k: _SEARCH_CACHE[k]["exp"])
            del _SEARCH_CACHE[oldest_key]
        _SEARCH_CACHE[key] = {"data": data, "exp": time.monotonic() + _SEARCH_TTL}


def _fts_query(raw: str) -> str:
    """Convert a raw user query into a safe FTS5 MATCH expression.

    Wraps the trimmed input in double quotes so that special FTS5 operators
    (AND, OR, NOT, *, ^) in user input don't cause syntax errors.
    """
    safe = raw.strip().replace('"', '""')
    return f'"{safe}"'


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

    cache_key = f"{raw.lower()}:{limit}"
    cached = _get_cached_search(cache_key)
    if cached is not None:
        return JSONResponse(cached)

    fts_term = _fts_query(raw)
    per_type = max(1, limit // 2)
    results: list[dict] = []

    with db.connect() as conn:
        # ── items FTS5 ────────────────────────────────────────────────────
        try:
            rows = conn.execute(
                """
                SELECT
                    i.id, i.title, i.summary, i.source_type, i.theme, i.first_seen_at AS created_at,
                    -bm25(items_fts) AS score
                FROM items_fts
                JOIN items i ON i.id = items_fts.rowid
                WHERE items_fts MATCH ?
                  AND i.theme != 'community_visuals'
                  AND i.source_type NOT LIKE '%_visual%'
                ORDER BY score ASC
                LIMIT ?
                """,
                (fts_term, per_type),
            ).fetchall()
            results.extend(
                {
                    "result_type": "item",
                    "id": row["id"],
                    "title": row["title"],
                    "body": row["summary"],
                    "source_type": row["source_type"],
                    "theme": row["theme"],
                    "score": row["score"],
                    "created_at": row["created_at"],
                }
                for row in rows
            )
        except Exception:
            logger.exception("FTS search failed for items q=%r; falling back to LIKE", raw)
            # Fallback: plain LIKE scan so search never returns nothing due to FTS issues
            needle = f"%{raw}%"
            try:
                rows = conn.execute(
                    """
                    SELECT id, title, summary, source_type, theme, first_seen_at AS created_at,
                           INSTR(LOWER(title), LOWER(?)) AS score
                    FROM items
                    WHERE theme != 'community_visuals'
                      AND source_type NOT LIKE '%_visual%'
                      AND (LOWER(title) LIKE LOWER(?) OR LOWER(summary) LIKE LOWER(?))
                    ORDER BY score ASC
                    LIMIT ?
                    """,
                    (raw, needle, needle, per_type),
                ).fetchall()
                results.extend(
                    {
                        "result_type": "item",
                        "id": row["id"],
                        "title": row["title"],
                        "body": row["summary"],
                        "source_type": row["source_type"],
                        "theme": row["theme"],
                        "score": row["score"],
                        "created_at": row["created_at"],
                    }
                    for row in rows
                )
            except Exception:
                logger.exception("LIKE fallback also failed for items q=%r", raw)

        # ── hypotheses FTS5 ───────────────────────────────────────────────
        try:
            rows = conn.execute(
                """
                SELECT
                    h.id, h.title, h.rationale, h.body, h.created_at,
                    -bm25(hypotheses_fts) AS score
                FROM hypotheses_fts
                JOIN hypotheses h ON h.id = hypotheses_fts.rowid
                WHERE hypotheses_fts MATCH ?
                ORDER BY score ASC
                LIMIT ?
                """,
                (fts_term, per_type),
            ).fetchall()
            results.extend(
                {
                    "result_type": "hypothesis",
                    "id": row["id"],
                    "title": row["title"],
                    "body": row["body"] or row["rationale"],
                    "score": row["score"],
                    "created_at": row["created_at"],
                }
                for row in rows
            )
        except Exception:
            logger.exception("FTS search failed for hypotheses q=%r; falling back to LIKE", raw)
            needle = f"%{raw}%"
            try:
                rows = conn.execute(
                    """
                    SELECT id, title, rationale, body, created_at,
                           INSTR(LOWER(title), LOWER(?)) AS score
                    FROM hypotheses
                    WHERE LOWER(title) LIKE LOWER(?) OR LOWER(rationale) LIKE LOWER(?)
                    ORDER BY score ASC
                    LIMIT ?
                    """,
                    (raw, needle, needle, per_type),
                ).fetchall()
                results.extend(
                    {
                        "result_type": "hypothesis",
                        "id": row["id"],
                        "title": row["title"],
                        "body": row["body"] or row["rationale"],
                        "score": row["score"],
                        "created_at": row["created_at"],
                    }
                    for row in rows
                )
            except Exception:
                logger.exception("LIKE fallback also failed for hypotheses q=%r", raw)

    results.sort(key=lambda r: r.get("score", 9999))
    final = results[:limit]

    _set_cached_search(cache_key, final)
    return JSONResponse(final)

