from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("")
def activity_feed(request: Request) -> JSONResponse:
    db = request.app.state.db
    events: list[dict] = []

    with db.connect() as conn:
        # Query items — use first_seen_at as the creation timestamp
        try:
            rows = conn.execute(
                """
                SELECT id, title, source_type, theme, first_seen_at AS created_at
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                ORDER BY first_seen_at DESC
                LIMIT 50
                """
            ).fetchall()
            for row in rows:
                events.append(
                    {
                        "event_type": "item",
                        "id": row["id"],
                        "title": row["title"],
                        "source_type": row["source_type"],
                        "theme": row["theme"],
                        "created_at": row["created_at"],
                    }
                )
        except Exception:
            pass

        # Query hypotheses — have a proper created_at column
        try:
            rows = conn.execute(
                """
                SELECT id, title, created_at
                FROM hypotheses
                ORDER BY created_at DESC
                LIMIT 50
                """
            ).fetchall()
            for row in rows:
                events.append(
                    {
                        "event_type": "hypothesis",
                        "id": row["id"],
                        "title": row["title"],
                        "created_at": row["created_at"],
                    }
                )
        except Exception:
            pass

        # Query screenshots — use captured_at, expose term as the label
        try:
            rows = conn.execute(
                """
                SELECT id, term, source, captured_at AS created_at
                FROM screenshots
                ORDER BY captured_at DESC
                LIMIT 50
                """
            ).fetchall()
            for row in rows:
                events.append(
                    {
                        "event_type": "screenshot",
                        "id": row["id"],
                        "term": row["term"],
                        "source_type": row["source"],
                        "created_at": row["created_at"],
                    }
                )
        except Exception:
            pass

    # Merge and sort by created_at descending, return top 50
    events.sort(key=lambda e: e.get("created_at") or "", reverse=True)
    return JSONResponse(events[:50])
