"""Analytics dashboard endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Query, Request

router = APIRouter(prefix="/api", tags=["analytics"])


@router.get("/analytics/overview")
def get_analytics_overview(request: Request) -> dict[str, Any]:
    """High-level analytics overview for the admin dashboard."""
    db = request.app.state.db
    with db.connect() as conn:
        # Total counts
        total_media = conn.execute("SELECT COUNT(*) as c FROM screenshots").fetchone()["c"]
        total_creators = conn.execute("SELECT COUNT(*) as c FROM performers").fetchone()["c"]
        total_views = conn.execute(
            "SELECT COALESCE(SUM(views_count), 0) as c FROM screenshots"
        ).fetchone()["c"]
        total_likes = conn.execute(
            "SELECT COALESCE(SUM(likes_count), 0) as c FROM screenshots"
        ).fetchone()["c"]

        # Media by source (last 30 days)
        source_rows = conn.execute(
            """
            SELECT source, COUNT(*) as count
            FROM screenshots
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY source
            ORDER BY count DESC
            """
        ).fetchall()

        # Top creators by followers
        top_creators = conn.execute(
            """
            SELECT username, display_name, followers_count, views_count
            FROM performers
            ORDER BY followers_count DESC
            LIMIT 10
            """
        ).fetchall()

        # Popular tags (from ai_tags)
        tag_rows = conn.execute(
            """
            SELECT ai_tags FROM screenshots
            WHERE ai_tags IS NOT NULL AND ai_tags != ''
            ORDER BY created_at DESC
            LIMIT 1000
            """
        ).fetchall()

    # Count tags
    tag_counts: dict[str, int] = {}
    for row in tag_rows:
        for tag in str(row["ai_tags"]).split(","):
            tag = tag.strip().lower()
            if tag and len(tag) < 30:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1

    popular_tags = sorted(
        [{"tag": k, "count": v} for k, v in tag_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:20]

    # Hourly activity (last 24h)
    now = datetime.now(timezone.utc)
    hourly = []
    for i in range(24):
        hour_start = now - timedelta(hours=i + 1)
        hour_end = now - timedelta(hours=i)
        with db.connect() as conn:
            count = conn.execute(
                """
                SELECT COUNT(*) as c FROM screenshots
                WHERE created_at >= ? AND created_at < ?
                """,
                (hour_start.isoformat(), hour_end.isoformat()),
            ).fetchone()["c"]
        hourly.append({
            "hour": hour_end.strftime("%H:00"),
            "count": count,
        })
    hourly.reverse()

    return {
        "totals": {
            "media": total_media,
            "creators": total_creators,
            "views": total_views,
            "likes": total_likes,
        },
        "sources": [{"source": r["source"], "count": r["count"]} for r in source_rows],
        "top_creators": [dict(r) for r in top_creators],
        "popular_tags": popular_tags,
        "hourly_activity": hourly,
    }


@router.get("/analytics/creators/{performer_id}")
def get_creator_analytics(performer_id: int, request: Request) -> dict[str, Any]:
    """Analytics for a specific creator."""
    db = request.app.state.db
    with db.connect() as conn:
        performer = conn.execute(
            "SELECT * FROM performers WHERE id = ?", (performer_id,)
        ).fetchone()
        if not performer:
            raise HTTPException(404, "Creator not found")

        media_count = conn.execute(
            "SELECT COUNT(*) as c FROM screenshots WHERE performer_id = ?",
            (performer_id,),
        ).fetchone()["c"]

        total_views = conn.execute(
            "SELECT COALESCE(SUM(views_count), 0) as c FROM screenshots WHERE performer_id = ?",
            (performer_id,),
        ).fetchone()["c"]

        total_likes = conn.execute(
            "SELECT COALESCE(SUM(likes_count), 0) as c FROM screenshots WHERE performer_id = ?",
            (performer_id,),
        ).fetchone()["c"]

        # Weekly media count (last 12 weeks)
        weekly = []
        for i in range(12):
            week_start = datetime.now(timezone.utc) - timedelta(weeks=i + 1)
            week_end = datetime.now(timezone.utc) - timedelta(weeks=i)
            count = conn.execute(
                """
                SELECT COUNT(*) as c FROM screenshots
                WHERE performer_id = ? AND created_at >= ? AND created_at < ?
                """,
                (performer_id, week_start.isoformat(), week_end.isoformat()),
            ).fetchone()["c"]
            weekly.append({"week": week_end.strftime("%Y-%m-%d"), "count": count})
        weekly.reverse()

        # Top media
        top_media = conn.execute(
            """
            SELECT id, term, source, thumbnail_url, preview_url, likes_count, views_count
            FROM screenshots
            WHERE performer_id = ?
            ORDER BY views_count DESC
            LIMIT 5
            """,
            (performer_id,),
        ).fetchall()

    return {
        "performer": dict(performer),
        "media_count": media_count,
        "total_views": total_views,
        "total_likes": total_likes,
        "weekly_activity": weekly,
        "top_media": [dict(r) for r in top_media],
    }


@router.get("/analytics/engagement")
def get_engagement_analytics(
    request: Request,
    period: str = Query("week", regex=r"^(day|week|month|all)$"),
) -> dict[str, Any]:
    """Engagement analytics over time."""
    db = request.app.state.db
    if period == "day":
        start = datetime.now(timezone.utc) - timedelta(days=1)
    elif period == "week":
        start = datetime.now(timezone.utc) - timedelta(weeks=1)
    elif period == "month":
        start = datetime.now(timezone.utc) - timedelta(days=30)
    else:
        start = datetime(2020, 1, 1, tzinfo=timezone.utc)

    with db.connect() as conn:
        likes = conn.execute(
            "SELECT COUNT(*) as c FROM likes WHERE created_at >= ?",
            (start.isoformat(),),
        ).fetchone()["c"]

        views = conn.execute(
            "SELECT COUNT(*) as c FROM views WHERE created_at >= ?",
            (start.isoformat(),),
        ).fetchone()["c"]

        comments = conn.execute(
            "SELECT COUNT(*) as c FROM comments WHERE created_at >= ?",
            (start.isoformat(),),
        ).fetchone()["c"]

        follows = conn.execute(
            "SELECT COUNT(*) as c FROM follows WHERE created_at >= ?",
            (start.isoformat(),),
        ).fetchone()["c"]

    return {
        "period": period,
        "likes": likes,
        "views": views,
        "comments": comments,
        "follows": follows,
    }
