from __future__ import annotations

import time

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/activity", tags=["activity"])

# ââ In-memory cache for the activity feed (60 s TTL) âââââââââââââââââ
_activity_cache: list[dict] | None = None
_activity_cache_expires = 0.0


@router.get("")
def activity_feed(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
) -> JSONResponse:
    global _activity_cache, _activity_cache_expires

    now = time.monotonic()
    if _activity_cache is not None and now < _activity_cache_expires:
        return JSONResponse({"events": _activity_cache[:limit], "total": len(_activity_cache)})

    db = request.app.state.db
    events: list[dict] = []

    with db.connect() as conn:
        # ââ Single UNION query instead of 3 separate queries âââââââââ
        try:
            rows = conn.execute(
                """
                SELECT * FROM (
                    SELECT id, title, source_type, theme, NULL AS term,
                           first_seen_at AS created_at, 'item' AS event_type
                    FROM items
                    WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                    ORDER BY first_seen_at DESC LIMIT 50
                ) UNION ALL SELECT * FROM (
                    SELECT id, title, NULL, NULL, NULL,
                           created_at, 'hypothesis' AS event_type
                    FROM hypotheses
                    ORDER BY created_at DESC LIMIT 50
                ) UNION ALL SELECT * FROM (
                    SELECT id, NULL, source, NULL, term,
                           captured_at AS created_at, 'screenshot' AS event_type
                    FROM screenshots
                    ORDER BY captured_at DESC LIMIT 50
                )
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            for row in rows:
                event: dict = {
                    "event_type": row["event_type"],
                    "id": row["id"],
                    "created_at": row["created_at"],
                }
                if row["title"]:
                    event["title"] = row["title"]
                if row["source_type"]:
                    event["source_type"] = row["source_type"]
                if row["theme"]:
                    event["theme"] = row["theme"]
                if row["term"]:
                    event["term"] = row["term"]
                events.append(event)
        except Exception:
            pass

    _activity_cache = events
    _activity_cache_expires = now + 60.0
    return JSONResponse({"events": events[:limit], "total": len(events)})
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
