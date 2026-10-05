"""Validation + sanitising for the admin bulk-upsert (`POST .../observe`).

The edge may report creators it saw in live lanes. Everything is re-validated
server-side with the same hygiene rules as the crawler: exclusion markers on
structured fields, contact-info redaction, allow-listed media hosts only (the
edge's `/api/archiver-proxy?url=` wrapper is unwrapped to the provider URL).
"""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import parse_qs, urlsplit

from pydantic import BaseModel, ConfigDict, Field

from app.creator_index.hygiene import (
    MAX_SAMPLE_MEDIA, canonical, clean_handle, clean_tag, has_contact_info, has_excluded_marker, redact,
    safe_media_url, safe_profile_url, to_int,
)
from app.creator_index.repository import MAX_OBSERVE_BATCH, PLATFORM_LABELS, CreatorObservation, platform_key

Platform = Literal["redgifs", "bluesky", "mastodon", "lemmy", "peertube"]


class ObservedCreator(BaseModel):
    model_config = ConfigDict(extra="ignore")

    platform: str = Field(min_length=2, max_length=20)
    handle: str = Field(min_length=1, max_length=80)
    displayName: str = Field(default="", max_length=120)
    avatar: str = Field(default="", max_length=600)
    profileUrl: str = Field(default="", max_length=500)
    followers: int | None = Field(default=None, ge=0)
    mediaCount: int = Field(default=0, ge=0)
    viewCount: int = Field(default=0, ge=0)
    likeCount: int = Field(default=0, ge=0)
    tags: list[str] = Field(default_factory=list, max_length=60)
    lastSeenAt: str = Field(default="", max_length=40)
    media: list[dict[str, Any]] = Field(default_factory=list, max_length=24)


class ObserveBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    creators: list[ObservedCreator] = Field(min_length=1, max_length=MAX_OBSERVE_BATCH)


def unproxy(value: Any) -> str | None:
    """Return the allow-listed provider URL behind a value that may be edge-proxied."""
    if not isinstance(value, str) or not value:
        return None
    if value.startswith("/api/archiver-proxy"):
        inner = parse_qs(urlsplit(value).query).get("url", [""])[0]
        return safe_media_url(inner)
    return safe_media_url(value)


def sanitize_media(item: Any, creator_name: str) -> dict[str, Any] | None:
    if not isinstance(item, dict) or not item.get("id"):
        return None
    thumb = unproxy(item.get("thumbnail")) or unproxy(item.get("posterUrl"))
    candidates = [u for u in (unproxy(c) for c in (item.get("streamCandidates") or [])) if u]
    media_url = unproxy(item.get("mediaUrl")) or (candidates[0] if candidates else None)
    if not thumb or not media_url:
        return None
    tags = [t for t in (clean_tag(t) for t in (item.get("tags") or [])) if t][:12]
    if has_excluded_marker(tags):
        return None
    out: dict[str, Any] = {
        "id": str(item["id"])[:80],
        "title": redact(item.get("title"))[:300] or f"Video by {creator_name}",
        "thumbnail": thumb,
        "source": str(item.get("source") or "")[:40],
        "duration": str(item.get("duration") or "0:00")[:12],
        "isVideo": bool(item.get("isVideo", True)),
        "category": clean_tag(item.get("category")) or (tags[0] if tags else "gay male"),
        "creator": creator_name,
        "tags": tags,
        "rating": 0,
        "createdAt": str(item.get("createdAt") or "")[:40],
        "views": to_int(item.get("views")),
        "mediaUrl": media_url,
        "streamCandidates": candidates or [media_url],
        "likes": to_int(item.get("likes")),
    }
    page = safe_profile_url(item.get("pageUrl"))
    if page:
        out["pageUrl"] = page
    poster = unproxy(item.get("posterUrl"))
    if poster:
        out["posterUrl"] = poster
    for key in ("width", "height", "durationSeconds"):
        if to_int(item.get(key)):
            out[key] = to_int(item[key])
    if out.get("width") and out.get("height"):
        out["aspect"] = round(out["width"] / out["height"], 4)
    return out


def to_observation(body: ObservedCreator) -> CreatorObservation | None:
    platform = platform_key(body.platform)
    if platform not in PLATFORM_LABELS:
        return None
    handle = clean_handle(body.handle)
    name = redact(body.displayName)
    tags = [t for t in (clean_tag(t) for t in body.tags) if t]
    if not canonical(handle) or has_contact_info(body.handle) or has_excluded_marker([handle, name, *tags]):
        return None
    samples = [m for m in (sanitize_media(m, name or handle) for m in body.media) if m][:MAX_SAMPLE_MEDIA]
    return CreatorObservation(
        platform=platform,
        handle=handle,
        display_name=name,
        avatar_url=unproxy(body.avatar) or "",
        profile_url=safe_profile_url(body.profileUrl),
        followers=body.followers,
        media_count=body.mediaCount,
        view_count=body.viewCount,
        like_count=body.likeCount,
        tags={t: 1 for t in tags},
        last_seen_at=body.lastSeenAt if len(body.lastSeenAt) >= 19 else "",
        source="observed",
        sample_media=samples,
    )
