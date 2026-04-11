from __future__ import annotations
import csv
import io
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api/export", tags=["export"])


def _query_params(theme, source_type, review_status, saved_only, search, sort, compound, mechanism):
    return dict(
        limit=5000, offset=0, theme=theme, source_type=source_type,
        review_status=review_status, saved_only=saved_only,
        search=search, sort=sort, compound=compound, mechanism=mechanism,
    )


@router.get("/items.csv")
def export_items_csv(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    saved_only: bool = Query(default=False),
    search: str = Query(default=""),
    sort: str = Query(default="newest"),
    compound: str | None = Query(default=None),
    mechanism: str | None = Query(default=None),
) -> Response:
    from app.main import db
    result = db.browse_items(**_query_params(theme, source_type, review_status, saved_only, search, sort, compound, mechanism))
    items = result["items"]
    if not items:
        return Response(content="", media_type="text/csv")
    fields = ["id", "title", "url", "author", "published_at", "source_type", "theme", "score", "review_status", "is_saved", "compounds", "mechanisms", "summary"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for item in items:
        row = {k: item.get(k, "") for k in fields}
        row["compounds"] = "; ".join(item.get("compounds") or [])
        row["mechanisms"] = "; ".join(item.get("mechanisms") or [])
        w.writerow(row)
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=items.csv"})


@router.get("/items.json")
def export_items_json(
    theme: str | None = Query(default=None),
    source_type: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    saved_only: bool = Query(default=False),
    search: str = Query(default=""),
    sort: str = Query(default="newest"),
    compound: str | None = Query(default=None),
    mechanism: str | None = Query(default=None),
) -> Response:
    from app.main import db
    result = db.browse_items(**_query_params(theme, source_type, review_status, saved_only, search, sort, compound, mechanism))
    return Response(content=json.dumps(result["items"], default=str), media_type="application/json", headers={"Content-Disposition": "attachment; filename=items.json"})


# ── Performers export ─────────────────────────────────────────────────────────

@router.get("/performers.csv")
def export_performers_csv(request: Request) -> Response:
    """Export all performers as CSV with platform links."""
    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute("""
            SELECT p.id, p.username, p.display_name, p.platform, p.profile_url,
                   p.bio, p.tags, p.follower_count, p.media_count, p.is_verified,
                   p.is_favorite, p.status, p.notes, p.created_at
            FROM performers p
            ORDER BY p.created_at DESC
        """).fetchall()
    if not rows:
        return Response(content="", media_type="text/csv")
    fields = [
        "id", "username", "display_name", "platform", "profile_url",
        "bio", "tags", "follower_count", "media_count", "is_verified",
        "is_favorite", "status", "notes", "created_at",
    ]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for row in rows:
        w.writerow(dict(row))
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=performers.csv"},
    )


@router.get("/performers.json")
def export_performers_json(request: Request) -> Response:
    """Export all performers as JSON including their linked platform URLs."""
    db = request.app.state.db
    with db.connect() as conn:
        performers = [dict(r) for r in conn.execute(
            "SELECT * FROM performers ORDER BY created_at DESC"
        ).fetchall()]
        links = conn.execute(
            "SELECT performer_id, platform, url, username FROM performer_links ORDER BY performer_id"
        ).fetchall()
    links_by_performer: dict[int, list[dict]] = {}
    for lnk in links:
        links_by_performer.setdefault(lnk["performer_id"], []).append(
            {"platform": lnk["platform"], "url": lnk["url"], "username": lnk["username"]}
        )
    for p in performers:
        p["links"] = links_by_performer.get(p["id"], [])
    return Response(
        content=json.dumps(performers, default=str),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=performers.json"},
    )


# ── Media metadata export ─────────────────────────────────────────────────────

@router.get("/media.csv")
def export_media_csv(request: Request) -> Response:
    """Export captured media metadata (screenshots + performer_media) as CSV."""
    db = request.app.state.db
    buf = io.StringIO()
    fields = [
        "id", "type", "performer_username", "caption", "media_type",
        "width", "height", "duration", "file_size", "local_path",
        "source_url", "rating", "ai_summary", "ai_tags", "captured_at",
    ]
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    with db.connect() as conn:
        # Screenshots linked to performers
        for row in conn.execute("""
            SELECT s.id, 'screenshot' AS type, p.username AS performer_username,
                   s.caption, NULL AS media_type, NULL AS width, NULL AS height,
                   NULL AS duration, NULL AS file_size, s.local_path, s.source_url,
                   s.rating, s.ai_summary, s.ai_tags, s.captured_at
            FROM screenshots s
            LEFT JOIN performers p ON p.id = s.performer_id
            ORDER BY s.captured_at DESC
        """).fetchall():
            w.writerow(dict(row))
        # Performer media
        for row in conn.execute("""
            SELECT pm.id, 'performer_media' AS type, p.username AS performer_username,
                   pm.caption, pm.media_type, pm.width, pm.height, pm.duration,
                   pm.file_size, pm.local_path, pm.source_url, NULL AS rating,
                   pm.ai_summary, pm.ai_tags, pm.captured_at
            FROM performer_media pm
            JOIN performers p ON p.id = pm.performer_id
            ORDER BY pm.captured_at DESC
        """).fetchall():
            w.writerow(dict(row))
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=media.csv"},
    )

