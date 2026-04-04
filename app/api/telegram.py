from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/telegram", tags=["telegram"])


def _require_client(request: Request):
    client = getattr(request.app.state, "telegram_client", None)
    if client is None:
        raise HTTPException(503, detail="Telegram not configured — set TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION in .env")
    return client


# ── Channels ──────────────────────────────────────────────────────────────

@router.get("/channels")
def list_channels(request: Request):
    db = request.app.state.db
    return db.list_telegram_channels()


class AddChannelBody(BaseModel):
    username: str


@router.post("/channels")
async def add_channel(body: AddChannelBody, request: Request):
    client = _require_client(request)
    db = request.app.state.db
    username = body.username.strip().lstrip("@")
    try:
        chat = await client.get_chat(username)
        db.upsert_telegram_channel(
            username=username,
            display_name=chat.title or username,
            member_count=getattr(chat, "members_count", None),
            description=getattr(chat, "description", None) or "",
        )
        return {"username": username, "display_name": chat.title or username}
    except Exception as e:
        raise HTTPException(400, detail=f"Could not resolve channel @{username}: {e}")


@router.delete("/channels/{username}")
def remove_channel(username: str, request: Request):
    db = request.app.state.db
    db.delete_telegram_channel(username)
    return {"ok": True}


class ToggleBody(BaseModel):
    enabled: bool


@router.patch("/channels/{username}")
def toggle_channel(username: str, body: ToggleBody, request: Request):
    db = request.app.state.db
    db.set_telegram_channel_enabled(username, body.enabled)
    return {"ok": True}


class DiscoverBody(BaseModel):
    query: str


@router.post("/channels/discover")
async def discover_channels(body: DiscoverBody, request: Request):
    _require_client(request)
    settings = request.app.state.settings
    from app.sources.telegram import discover_channels as _discover
    results = await _discover(body.query, settings)
    return {"candidates": results}


# ── Scan ──────────────────────────────────────────────────────────────────

async def _run_scan_async(app_state) -> dict:
    from app.sources.telegram import scan_channel
    from copy import copy as _copy

    db = app_state.db
    settings = app_state.settings

    # Apply DB-configured vision settings so scan_channel uses the right key
    user_settings = db.get_all_settings()
    if user_settings.get("vision_api_key"):
        settings = _copy(settings)
        settings.openai_api_key = user_settings["vision_api_key"]
        if user_settings.get("vision_base_url"):
            settings.openai_base_url = user_settings["vision_base_url"]
        if user_settings.get("vision_model"):
            settings.openai_model = user_settings["vision_model"]

    channels = [c for c in db.list_telegram_channels() if c["enabled"]]

    total_photos = 0
    total_videos = 0
    total_errors = 0

    for ch in channels:
        username = ch["username"]
        # Find the highest message_id we already have for this channel
        since_id = _get_last_message_id(db, username)
        result = await scan_channel(username, since_id, db, settings)
        db.update_telegram_channel_scanned(username)
        total_photos += result["photos_added"]
        total_videos += result["videos_added"]
        total_errors += result["errors"]
        print(
            f"[telegram] scanned @{username}: "
            f"{result['photos_added']} photos, {result['videos_added']} videos, "
            f"{result['errors']} errors"
        )

    return {"photos": total_photos, "videos": total_videos, "errors": total_errors}


def _get_last_message_id(db, channel_username: str) -> int:
    """Return the highest message_id we already have for this channel (0 if none)."""
    with db.connect() as conn:
        row = conn.execute(
            "SELECT MAX(message_id) FROM telegram_media WHERE channel_username = ?",
            (channel_username,),
        ).fetchone()
    return row[0] or 0


@router.post("/scan")
async def trigger_scan(request: Request, background_tasks: BackgroundTasks):
    _require_client(request)
    if getattr(request.app.state, "telegram_scan_running", False):
        return JSONResponse({"status": "already_running"}, status_code=409)

    request.app.state.telegram_scan_running = True

    async def run():
        try:
            result = await _run_scan_async(request.app.state)
            request.app.state.telegram_scan_result = result
        finally:
            request.app.state.telegram_scan_running = False

    background_tasks.add_task(run)
    return {"status": "started"}


@router.get("/scan/status")
def scan_status(request: Request):
    return {
        "running": getattr(request.app.state, "telegram_scan_running", False),
        "last_result": getattr(request.app.state, "telegram_scan_result", None),
    }


# ── Media browse ──────────────────────────────────────────────────────────

@router.get("/media")
def browse_media(
    request: Request,
    media_type: str | None = None,
    channel: str | None = None,
    limit: int = Query(default=40, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    db = request.app.state.db
    return db.browse_telegram_media(
        media_type=media_type,
        channel=channel,
        limit=limit,
        offset=offset,
    )


# ── Video streaming ───────────────────────────────────────────────────────

@router.get("/media/{media_id}/stream")
async def stream_video(media_id: int, request: Request):
    client = _require_client(request)
    db = request.app.state.db

    with db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM telegram_media WHERE id = ?", (media_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Media not found")

    row = dict(row)
    if row["media_type"] not in ("video", "gif"):
        raise HTTPException(400, "Not a video")

    # Re-fetch the message to get a fresh file reference
    try:
        message = await client.get_messages(row["channel_username"], row["message_id"])
    except Exception as e:
        raise HTTPException(404, f"Could not fetch message: {e}")

    if not message or (not message.video and not message.animation):
        raise HTTPException(404, "Video no longer available")

    media_obj = message.video or message.animation
    file_size = getattr(media_obj, "file_size", None) or 0
    mime_type = getattr(media_obj, "mime_type", None) or "video/mp4"

    range_header = request.headers.get("Range")

    if range_header and file_size:
        # Parse "bytes=start-end"
        try:
            byte_range = range_header.replace("bytes=", "")
            start_str, end_str = byte_range.split("-")
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1
        except Exception:
            start, end, length = 0, file_size - 1, file_size

        async def streamer():
            async for chunk in client.stream_media(message, offset=start, limit=length):
                yield chunk

        return StreamingResponse(
            streamer(),
            status_code=206,
            media_type=mime_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
            },
        )
    else:
        async def streamer():
            async for chunk in client.stream_media(message):
                yield chunk

        headers = {"Accept-Ranges": "bytes"}
        if file_size:
            headers["Content-Length"] = str(file_size)

        return StreamingResponse(streamer(), media_type=mime_type, headers=headers)
