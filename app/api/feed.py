"""Feed algorithm endpoints for personalized content discovery."""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/api", tags=["feed"])


def _compute_trending_score(
    likes: int,
    views: int,
    comments: int,
    rating: float,
    created_at: str,
    half_life_hours: float = 24.0,
) -> float:
    """Compute a time-decayed trending score.

    Score = (likes*3 + views*1 + comments*5 + rating*2) * decay
    where decay = 0.5^(hours_ago / half_life)
    """
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    hours_ago = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    decay = 0.5 ** (hours_ago / half_life_hours)
    raw = likes * 3 + views * 1 + comments * 5 + rating * 2
    return raw * decay


@router.get("/feed/trending")
def get_trending_feed(
    request: Request,
    limit: int = Query(48, ge=1, le=200),
    offset: int = Query(0, ge=0),
    media_type: str = Query("all"),
) -> dict[str, Any]:
    """Return trending media ordered by computed trending score."""
    db = request.app.state.db
    with db.connect() as conn:
        # Build WHERE clause
        where_parts = ["s.performer_id IS NOT NULL"]
        params: list[Any] = []
        if media_type == "video":
            where_parts.append(
                "(LOWER(COALESCE(NULLIF(s.local_path, ''), s.source_url, s.page_url, '')) LIKE '%.mp4' "
                "OR LOWER(COALESCE(NULLIF(s.local_path, ''), s.source_url, s.page_url, '')) LIKE '%.webm' "
                "OR LOWER(COALESCE(NULLIF(s.local_path, ''), s.source_url, s.page_url, '')) LIKE '%.mov' "
                "OR LOWER(COALESCE(s.source, '')) IN ('redgifs', 'ytdlp'))"
            )
        elif media_type == "image":
            where_parts.append(
                "LOWER(COALESCE(NULLIF(s.local_path, ''), s.source_url, s.page_url, '')) NOT LIKE '%.mp4' "
                "AND LOWER(COALESCE(NULLIF(s.local_path, ''), s.source_url, s.page_url, '')) NOT LIKE '%.webm' "
                "AND LOWER(COALESCE(NULLIF(s.local_path, ''), s.source_url, s.page_url, '')) NOT LIKE '%.mov' "
                "AND LOWER(COALESCE(s.source, '')) NOT IN ('redgifs', 'ytdlp')"
            )

        where_clause = " AND ".join(where_parts)

        rows = conn.execute(
            f"""
            SELECT s.id, s.term, s.source, s.source_url, s.local_path, s.thumbnail_url,
                   s.preview_url, s.page_url, s.performer_id, s.rating, s.ai_summary,
                   s.ai_tags, s.created_at, s.likes_count, s.views_count, s.comments_count,
                   p.username as performer_username, p.avatar_url as performer_avatar
            FROM screenshots s
            LEFT JOIN performers p ON s.performer_id = p.id
            WHERE {where_clause}
            ORDER BY s.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit * 3, offset),
        ).fetchall()

    # Compute trending score and sort in Python
    scored = []
    for row in rows:
        score = _compute_trending_score(
            likes=row["likes_count"] or 0,
            views=row["views_count"] or 0,
            comments=row["comments_count"] or 0,
            rating=(row["rating"] or 0) * 1.0,
            created_at=row["created_at"] or datetime.now(timezone.utc).isoformat(),
        )
        scored.append((score, dict(row)))

    scored.sort(key=lambda x: x[0], reverse=True)
    results = [item for _, item in scored[:limit]]

    return {
        "screenshots": results,
        "total": len(results),
        "offset": offset,
        "limit": limit,
        "algorithm": "trending",
    }


@router.get("/feed/popular")
def get_popular_feed(
    request: Request,
    limit: int = Query(48, ge=1, le=200),
    offset: int = Query(0, ge=0),
    period: str = Query("all", regex=r"^(all|day|week|month)$"),
) -> dict[str, Any]:
    """Return most popular media by total engagement (likes + views + comments)."""
    db = request.app.state.db
    date_filter = ""
    params: list[Any] = []

    if period == "day":
        date_filter = "AND s.created_at >= datetime('now', '-1 day')"
    elif period == "week":
        date_filter = "AND s.created_at >= datetime('now', '-7 days')"
    elif period == "month":
        date_filter = "AND s.created_at >= datetime('now', '-30 days')"

    with db.connect() as conn:
        rows = conn.execute(
            f"""
            SELECT s.id, s.term, s.source, s.source_url, s.local_path, s.thumbnail_url,
                   s.preview_url, s.page_url, s.performer_id, s.rating, s.ai_summary,
                   s.ai_tags, s.created_at, s.likes_count, s.views_count, s.comments_count,
                   p.username as performer_username, p.avatar_url as performer_avatar,
                   COALESCE(s.likes_count, 0) + COALESCE(s.views_count, 0) + COALESCE(s.comments_count, 0) as engagement
            FROM screenshots s
            LEFT JOIN performers p ON s.performer_id = p.id
            WHERE s.performer_id IS NOT NULL {date_filter}
            ORDER BY engagement DESC, s.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()

    return {
        "screenshots": [dict(row) for row in rows],
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "algorithm": "popular",
        "period": period,
    }


@router.get("/feed/following")
def get_following_feed(
    request: Request,
    limit: int = Query(48, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Return media from creators the user follows."""
    db = request.app.state.db
    user_id = "default"  # TODO: replace with actual auth

    with db.connect() as conn:
        # Get followed performer IDs
        followed = conn.execute(
            "SELECT performer_id FROM follows WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        performer_ids = [r["performer_id"] for r in followed]

        if not performer_ids:
            return {
                "screenshots": [],
                "total": 0,
                "offset": offset,
                "limit": limit,
                "algorithm": "following",
            }

        placeholders = ",".join("?" * len(performer_ids))
        rows = conn.execute(
            f"""
            SELECT s.id, s.term, s.source, s.source_url, s.local_path, s.thumbnail_url,
                   s.preview_url, s.page_url, s.performer_id, s.rating, s.ai_summary,
                   s.ai_tags, s.created_at, s.likes_count, s.views_count, s.comments_count,
                   p.username as performer_username, p.avatar_url as performer_avatar
            FROM screenshots s
            LEFT JOIN performers p ON s.performer_id = p.id
            WHERE s.performer_id IN ({placeholders})
            ORDER BY s.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*performer_ids, limit, offset),
        ).fetchall()

    return {
        "screenshots": [dict(row) for row in rows],
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "algorithm": "following",
    }


@router.get("/feed/for-you")
def get_for_you_feed(
    request: Request,
    limit: int = Query(48, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Return personalized recommendations based on liked content."""
    db = request.app.state.db
    user_id = "default"

    with db.connect() as conn:
        # Get liked performer IDs and tags
        liked_performers = conn.execute(
            "SELECT performer_id FROM likes WHERE user_id = ? AND performer_id IS NOT NULL",
            (user_id,),
        ).fetchall()
        liked_performer_ids = [r["performer_id"] for r in liked_performers]

        liked_screenshots = conn.execute(
            "SELECT screenshot_id FROM likes WHERE user_id = ? AND screenshot_id IS NOT NULL",
            (user_id,),
        ).fetchall()
        liked_screenshot_ids = [r["screenshot_id"] for r in liked_screenshots]

        # Extract tags from liked screenshots
        tags: set[str] = set()
        if liked_screenshot_ids:
            placeholders = ",".join("?" * len(liked_screenshot_ids))
            tag_rows = conn.execute(
                f"SELECT ai_tags FROM screenshots WHERE id IN ({placeholders})",
                liked_screenshot_ids,
            ).fetchall()
            for row in tag_rows:
                if row["ai_tags"]:
                    tags.update(t.strip() for t in str(row["ai_tags"]).split(",") if t.strip())

        # Build recommendation query
        where_parts = ["s.performer_id IS NOT NULL"]
        params: list[Any] = []

        # Exclude already liked
        if liked_screenshot_ids:
            placeholders = ",".join("?" * len(liked_screenshot_ids))
            where_parts.append(f"s.id NOT IN ({placeholders})")
            params.extend(liked_screenshot_ids)

        # Prefer liked performers
        performer_boost = ""
        if liked_performer_ids:
            placeholders = ",".join("?" * len(liked_performer_ids))
            performer_boost = f"CASE WHEN s.performer_id IN ({placeholders}) THEN 100 ELSE 0 END"
            params.extend(liked_performer_ids)
        else:
            performer_boost = "0"

        # Tag matching
        tag_boost = "0"
        if tags:
            conditions = " OR ".join("s.ai_tags LIKE ?" for _ in tags)
            tag_boost = f"CASE WHEN {conditions} THEN 50 ELSE 0 END"
            params.extend(f"%{t}%" for t in tags)

        where_clause = " AND ".join(where_parts)
        order_by = f"{performer_boost} + {tag_boost} + COALESCE(s.likes_count, 0) * 2 + COALESCE(s.views_count, 0)"

        rows = conn.execute(
            f"""
            SELECT s.id, s.term, s.source, s.source_url, s.local_path, s.thumbnail_url,
                   s.preview_url, s.page_url, s.performer_id, s.rating, s.ai_summary,
                   s.ai_tags, s.created_at, s.likes_count, s.views_count, s.comments_count,
                   p.username as performer_username, p.avatar_url as performer_avatar,
                   {order_by} as rec_score
            FROM screenshots s
            LEFT JOIN performers p ON s.performer_id = p.id
            WHERE {where_clause}
            ORDER BY rec_score DESC, s.created_at DESC
            LIMIT ? OFFSET ?
            """,
            (*params, limit, offset),
        ).fetchall()

    return {
        "screenshots": [dict(row) for row in rows],
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "algorithm": "for-you",
    }


@router.get("/trending")
def get_trending(
    request: Request,
    type: str = Query("media", regex=r"^(media|creators)$"),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Return trending items — either media or creators."""
    db = request.app.state.db

    if type == "creators":
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT id, username, display_name, platform, avatar_url, followers_count,
                       views_count, created_at, bio, tags
                FROM performers
                WHERE status != 'archived'
                ORDER BY followers_count DESC, views_count DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return {
            "type": "creators",
            "items": [dict(row) for row in rows],
        }

    # Trending media
    return get_trending_feed(request, limit=limit, offset=0)
