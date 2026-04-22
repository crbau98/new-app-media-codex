from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["engagement"])


class LikeBody(BaseModel):
    screenshot_id: int | None = None
    performer_id: int | None = None


class ViewBody(BaseModel):
    screenshot_id: int | None = None
    performer_id: int | None = None
    source_page: str | None = None


class CommentBody(BaseModel):
    screenshot_id: int | None = None
    performer_id: int | None = None
    parent_id: int | None = None
    content: str


class FollowBody(BaseModel):
    performer_id: int


_DEFAULT_USER = "default"


# ── Likes ──────────────────────────────────────────────────────────────

@router.post("/like")
def like_item(body: LikeBody, request: Request):
    db = request.app.state.db
    if body.screenshot_id is not None:
        result = db.like_screenshot(body.screenshot_id, _DEFAULT_USER)
        return result
    if body.performer_id is not None:
        result = db.like_performer(body.performer_id, _DEFAULT_USER)
        return result
    raise HTTPException(400, detail="screenshot_id or performer_id required")


@router.delete("/like")
def unlike_item(
    request: Request,
    screenshot_id: int | None = Query(None),
    performer_id: int | None = Query(None),
):
    db = request.app.state.db
    if screenshot_id is not None:
        return db.unlike_screenshot(screenshot_id, _DEFAULT_USER)
    if performer_id is not None:
        return db.unlike_performer(performer_id, _DEFAULT_USER)
    raise HTTPException(400, detail="screenshot_id or performer_id required")


@router.get("/likes")
def get_likes(
    request: Request,
    screenshot_id: int | None = Query(None),
    performer_id: int | None = Query(None),
):
    db = request.app.state.db
    if screenshot_id is not None:
        return db.get_screenshot_like_status(screenshot_id, _DEFAULT_USER)
    if performer_id is not None:
        return db.get_performer_like_status(performer_id, _DEFAULT_USER)
    raise HTTPException(400, detail="screenshot_id or performer_id required")


# ── Views ──────────────────────────────────────────────────────────────

@router.post("/view")
def record_view(body: ViewBody, request: Request):
    db = request.app.state.db
    db.record_view(
        screenshot_id=body.screenshot_id,
        performer_id=body.performer_id,
        source_page=body.source_page,
    )
    return {"ok": True}


# ── Comments ───────────────────────────────────────────────────────────

@router.get("/comments")
def get_comments(
    request: Request,
    screenshot_id: int | None = Query(None),
    performer_id: int | None = Query(None),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    db = request.app.state.db
    if screenshot_id is None and performer_id is None:
        raise HTTPException(400, detail="screenshot_id or performer_id required")
    return db.get_comments(
        screenshot_id=screenshot_id,
        performer_id=performer_id,
        limit=limit,
        offset=offset,
    )


@router.post("/comments")
def create_comment(body: CommentBody, request: Request):
    db = request.app.state.db
    if not body.content or not body.content.strip():
        raise HTTPException(400, detail="content is required")
    if body.screenshot_id is None and body.performer_id is None:
        raise HTTPException(400, detail="screenshot_id or performer_id required")
    comment = db.add_comment(
        user_id=_DEFAULT_USER,
        content=body.content.strip(),
        screenshot_id=body.screenshot_id,
        performer_id=body.performer_id,
        parent_id=body.parent_id,
    )
    return comment


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, request: Request):
    db = request.app.state.db
    ok = db.delete_comment(comment_id)
    if not ok:
        raise HTTPException(404, detail="Comment not found")
    return {"ok": True}


# ── Follows ────────────────────────────────────────────────────────────

@router.post("/follow")
def follow_performer(body: FollowBody, request: Request):
    db = request.app.state.db
    return db.follow_performer(body.performer_id, _DEFAULT_USER)


@router.delete("/follow")
def unfollow_performer(
    request: Request,
    performer_id: int = Query(...),
):
    db = request.app.state.db
    return db.unfollow_performer(performer_id, _DEFAULT_USER)


@router.get("/follows")
def get_follows(
    request: Request,
    performer_id: int | None = Query(None),
    user_id: str | None = Query(None),
):
    db = request.app.state.db
    target_user = user_id or _DEFAULT_USER
    if performer_id is not None:
        return db.get_follow_status(performer_id=performer_id, user_id=target_user)
    return db.get_follow_status(user_id=target_user)
