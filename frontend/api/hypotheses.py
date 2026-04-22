from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/api/hypotheses", tags=["hypotheses"])
browse_router = APIRouter(prefix="/api/browse", tags=["hypotheses"])


class HypothesisUpdateRequest(BaseModel):
    review_status: str | None = None
    is_saved: bool | None = None
    user_note: str | None = None


@router.get("")
def hypotheses(limit: int = Query(default=12, ge=1, le=100)) -> JSONResponse:
    from app.main import db
    return JSONResponse(db.get_recent_hypotheses(limit=limit))


@router.patch("/{hypothesis_id}")
def update_hypothesis(
    hypothesis_id: int,
    payload: HypothesisUpdateRequest,
    x_admin_token: str | None = Header(default=None),
) -> JSONResponse:
    from app.main import db
    if settings.admin_token and x_admin_token != settings.admin_token:
        raise HTTPException(status_code=401, detail="Missing or invalid admin token")
    allowed_statuses = {"new", "reviewing", "promoted", "dismissed"}
    if payload.review_status is not None and payload.review_status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Invalid hypothesis review status")
    hypothesis = db.update_hypothesis_state(
        hypothesis_id,
        review_status=payload.review_status,
        is_saved=payload.is_saved,
        user_note=payload.user_note,
    )
    if not hypothesis:
        raise HTTPException(status_code=404, detail="Hypothesis not found")
    return JSONResponse(hypothesis)


@router.get("/export", response_model=None)
def export_hypotheses(
    status: str | None = Query(default=None),
    format: str = Query(default="md", pattern="^(md|json)$"),
) -> JSONResponse | PlainTextResponse:
    from app.main import db

    data = db.browse_hypotheses(limit=10000, offset=0, review_status=status)
    hypotheses = data["hypotheses"]

    if format == "json":
        return JSONResponse(hypotheses)

    # Build Markdown document grouped by review_status
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = [f"# Research Hypotheses Report", f"Generated: {now}", ""]

    groups: dict[str, list[dict]] = {}
    status_order = ["promoted", "reviewing", "new", "dismissed"]
    for h in hypotheses:
        rs = h.get("review_status", "new")
        groups.setdefault(rs, []).append(h)

    counter = 1
    for rs in status_order:
        group = groups.get(rs)
        if not group:
            continue
        heading = {
            "promoted": "Promoted Hypotheses",
            "reviewing": "Under Review",
            "new": "New Hypotheses",
            "dismissed": "Dismissed",
        }.get(rs, rs.title())
        lines.append(f"## {heading}")
        lines.append("")
        for h in group:
            title = h.get("title", "Untitled")
            novelty = h.get("novelty_score", "N/A")
            rationale = h.get("rationale", "")
            evidence = h.get("evidence", "")
            safety = h.get("safety_flags", "")
            theme = h.get("theme", "")

            lines.append(f"### {counter}. {title}")
            if novelty != "N/A":
                lines.append(f"**Confidence:** {novelty}/10")
            lines.append(f"**Status:** {rs.title()}")
            if theme:
                lines.append(f"**Theme:** {theme}")
            lines.append("")
            if rationale:
                lines.append(f"**Rationale:** {rationale}")
                lines.append("")
            if evidence:
                lines.append(f"**Evidence:** {evidence}")
                lines.append("")
            if safety:
                lines.append(f"**Safety Notes:** {safety}")
                lines.append("")
            lines.append("---")
            lines.append("")
            counter += 1

    md_text = "\n".join(lines)
    return PlainTextResponse(
        content=md_text,
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="hypotheses_report.md"'},
    )


@browse_router.get("/hypotheses")
def browse_hypotheses(
    theme: str | None = Query(default=None),
    review_status: str | None = Query(default=None),
    search: str = Query(default=""),
    saved_only: bool = Query(default=False),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=24, ge=1, le=100),
    sort: str = Query(default="newest", pattern="^(newest|oldest|theme|status)$"),
) -> JSONResponse:
    from app.main import db
    return JSONResponse(db.browse_hypotheses(
        limit=limit, offset=offset, theme=theme,
        review_status=review_status, search=search, saved_only=saved_only, sort=sort,
    ))
