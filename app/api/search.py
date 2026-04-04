from __future__ import annotations

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def unified_search(
    request: Request,
    q: str = Query(default="", min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> JSONResponse:
    db = request.app.state.db
    results: list[dict] = []

    if not q.strip():
        return JSONResponse([])

    needle = f"%{q.strip()}%"
    per_type = max(1, limit // 2)

    with db.connect() as conn:
        # Search items: title, summary, content
        # Score by position of match in title (lower INSTR = better = lower sort key)
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
                (q.strip(), q.strip(), q.strip(), q.strip(), needle, needle, needle, per_type),
            ).fetchall()
            for row in rows:
                results.append(
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
                )
        except Exception:
            pass

        # Search hypotheses: title, rationale, evidence, body
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
                (q.strip(), q.strip(), q.strip(), q.strip(), q.strip(), q.strip(), needle, needle, needle, needle, per_type),
            ).fetchall()
            for row in rows:
                results.append(
                    {
                        "result_type": "hypothesis",
                        "id": row["id"],
                        "title": row["title"],
                        "body": row["body"] or row["rationale"],
                        "score": row["_score"],
                        "created_at": row["created_at"],
                    }
                )
        except Exception:
            pass

    # Sort combined results by score ascending (lower = better match position)
    results.sort(key=lambda r: r.get("score") or 9999)
    return JSONResponse(results[:limit])
