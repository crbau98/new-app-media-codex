"""Telegram channel scanner using Pyrogram MTProto.

Client lifecycle:
  - `get_client(settings)` returns the singleton Client (creates if needed).
  - Call `await client.start()` once (handled in main.py lifespan).
  - Call `await client.stop()` on shutdown.

Photos are downloaded + vision-filtered → stored in data/screenshots/.
Videos: metadata only → inserted into telegram_media table for on-demand streaming.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from pyrogram import Client
from pyrogram.types import Message

from app.config import Settings

_client: Client | None = None


def get_client(settings: Settings) -> Client:
    """Return (or lazily create) the singleton Pyrogram client."""
    global _client
    if _client is None:
        _client = Client(
            name="codex_radar",
            api_id=settings.telegram_api_id,
            api_hash=settings.telegram_api_hash,
            session_string=settings.telegram_session,
            in_memory=True,
        )
    return _client


async def discover_channels(query: str, settings: Settings) -> list[dict]:
    """Use OpenAI to suggest channel usernames, then resolve each via Pyrogram.

    Returns a list of dicts:
      {username, display_name, member_count, description, valid}
    """
    import re
    import requests as req

    # Step 1: ask OpenAI for 10 candidate channel usernames
    prompt = (
        f"Suggest 10 Telegram public channel usernames (without @) that contain "
        f"explicit gay male adult content related to: {query}. "
        f"Return ONLY a JSON array of strings, e.g. [\"channel1\", \"channel2\", ...]."
    )
    try:
        resp = req.post(
            f"{settings.openai_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openai_model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
            },
            timeout=20,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()
        # Extract JSON array even if wrapped in markdown
        m = re.search(r"\[.*\]", raw, re.S)
        candidates: list[str] = json.loads(m.group(0)) if m else []
    except Exception as e:
        print(f"[telegram] discover: OpenAI call failed: {e}")
        candidates = []

    if not candidates:
        return []

    # Step 2: resolve each with Pyrogram
    client = get_client(settings)
    results = []
    for username in candidates[:10]:
        username = username.strip().lstrip("@")
        try:
            chat = await client.get_chat(username)
            results.append({
                "username": username,
                "display_name": chat.title or username,
                "member_count": getattr(chat, "members_count", None),
                "description": getattr(chat, "description", None) or "",
                "valid": True,
            })
        except Exception:
            results.append({"username": username, "valid": False})

    return results


async def scan_channel(
    channel_username: str,
    since_message_id: int,
    db,
    settings: Settings,
) -> dict:
    """Scan a Telegram channel for photos and videos since `since_message_id`.

    Photos: downloaded, vision-filtered, stored in data/screenshots/.
    Videos/GIFs: metadata only stored in telegram_media.

    Returns: {photos_added, videos_added, skipped, errors}
    """
    from app.vision_filter import passes_strict_content_filter

    client = get_client(settings)
    screenshots_dir = Path(settings.image_dir).parent / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    photos_added = 0
    videos_added = 0
    skipped = 0
    errors = 0

    try:
        async for message in client.get_chat_history(
            channel_username,
            limit=settings.telegram_scan_limit,
        ):
            if message.id <= since_message_id:
                break

            try:
                if message.photo:
                    if settings.stream_only_media:
                        skipped += 1
                        continue
                    await _handle_photo(
                        message, channel_username, screenshots_dir, db, settings
                    )
                    photos_added += 1
                elif message.video or message.animation:
                    await _handle_video(message, channel_username, db)
                    videos_added += 1
                else:
                    skipped += 1
            except Exception as e:
                print(f"[telegram] scan error on msg {message.id}: {e}")
                errors += 1

    except Exception as e:
        print(f"[telegram] scan_channel failed for {channel_username}: {e}")
        errors += 1

    return {
        "photos_added": photos_added,
        "videos_added": videos_added,
        "skipped": skipped,
        "errors": errors,
    }


async def _handle_photo(
    message: Message,
    channel_username: str,
    screenshots_dir: Path,
    db,
    settings: Settings,
) -> None:
    """Download photo, vision-filter it, insert into screenshots + telegram_media."""
    from app.vision_filter import passes_vision_filter

    caption = message.caption or ""
    caption_lower = caption.lower()
    if any(kw in caption_lower for kw in _TELEGRAM_FEMALE_KEYWORDS):
        db.insert_telegram_media(
            channel_username=channel_username,
            message_id=message.id,
            media_type="photo",
            width=message.photo.width if message.photo else None,
            height=message.photo.height if message.photo else None,
            duration=None,
            file_size=message.photo.file_size if message.photo else None,
            caption=caption,
            local_path=None,
            passes_filter=False,
            posted_at=message.date.isoformat() if message.date else None,
        )
        return

    filename = f"tg_{channel_username}_{message.id}_{uuid.uuid4().hex[:8]}.jpg"
    out_path = screenshots_dir / filename

    # Download the photo to disk
    await message.download(file_name=str(out_path))

    if not out_path.exists():
        return

    # Vision filter
    if not passes_strict_content_filter(settings, str(out_path)):
        out_path.unlink(missing_ok=True)
        # Still record in telegram_media with passes_filter=False so we don't retry
        db.insert_telegram_media(
            channel_username=channel_username,
            message_id=message.id,
            media_type="photo",
            width=message.photo.width if message.photo else None,
            height=message.photo.height if message.photo else None,
            duration=None,
            file_size=message.photo.file_size if message.photo else None,
            caption=message.caption or "",
            local_path=None,
            passes_filter=False,
            posted_at=message.date.isoformat() if message.date else None,
        )
        return

    # Insert into screenshots table (shows up in existing media grid)
    page_url = f"https://t.me/{channel_username}/{message.id}"
    db.insert_screenshot(
        term=message.caption or channel_username,
        source="telegram",
        page_url=page_url,
        local_path=str(out_path),
    )

    # Also record in telegram_media for provenance
    db.insert_telegram_media(
        channel_username=channel_username,
        message_id=message.id,
        media_type="photo",
        width=message.photo.width if message.photo else None,
        height=message.photo.height if message.photo else None,
        duration=None,
        file_size=message.photo.file_size if message.photo else None,
        caption=message.caption or "",
        local_path=str(out_path),
        passes_filter=True,
        posted_at=message.date.isoformat() if message.date else None,
    )


_TELEGRAM_FEMALE_KEYWORDS = {
    "female", "woman", "women", "girl", "girls", "lesbian", "straight",
    "pussy", "vagina", "trans", "shemale", "ladyboy", "femboy", "hetero",
    "couple", "bisex", "bisexual", "wife", "girlfriend", "bikini",
}


async def _handle_video(message: Message, channel_username: str, db) -> None:
    """Store video/gif metadata only — no download. Reject if caption has female keywords."""
    video = message.video or message.animation
    if not video:
        return

    caption = message.caption or ""
    caption_lower = caption.lower()
    if any(kw in caption_lower for kw in _TELEGRAM_FEMALE_KEYWORDS):
        return

    media_type = "gif" if message.animation else "video"

    db.insert_telegram_media(
        channel_username=channel_username,
        message_id=message.id,
        media_type=media_type,
        width=getattr(video, "width", None),
        height=getattr(video, "height", None),
        duration=getattr(video, "duration", None),
        file_size=getattr(video, "file_size", None),
        caption=caption,
        local_path=None,
        passes_filter=True,
        posted_at=message.date.isoformat() if message.date else None,
    )
