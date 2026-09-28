"""Map stored media assets onto the shared "media-intelligence contract"
fields consumed by the frontend (camelCase)."""

from __future__ import annotations

import json
from typing import Any

PUBLIC_PREFIX = "/ingested-media"


def _loads(value: Any) -> Any:
    if isinstance(value, (list, dict)) or value is None:
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def asset_url(asset_id: str, name: str | None, prefix: str = PUBLIC_PREFIX) -> str | None:
    if not name:
        return None
    return f"{prefix}/{asset_id}/{name}"


def asset_contract(asset: dict[str, Any], prefix: str = PUBLIC_PREFIX) -> dict[str, Any]:
    """Contract fields for one asset row. Unknown values are omitted (None)
    rather than guessed."""
    aid = asset["id"]

    def u(key: str) -> str | None:
        return asset_url(aid, asset.get(key), prefix)

    gallery_items = _loads(asset.get("gallery_json")) or []
    gallery = [
        {k: v for k, v in {
            "url": asset_url(aid, g.get("full"), prefix), "thumbnail": asset_url(aid, g.get("thumb"), prefix),
            "width": g.get("width"), "height": g.get("height"),
        }.items() if v is not None}
        for g in gallery_items if isinstance(g, dict) and g.get("full")
    ]
    hls = asset.get("hls_path")
    has_audio = asset.get("has_audio")
    contract: dict[str, Any] = {
        "width": asset.get("width"),
        "height": asset.get("height"),
        "aspect": asset.get("aspect"),
        "durationSeconds": asset.get("duration_seconds"),
        "dominantColor": asset.get("dominant_color"),
        "lqip": asset.get("lqip"),
        "hlsUrl": asset_url(aid, hls, prefix),
        "posterUrl": u("poster_path") or u("thumb_path"),
        "previewUrl": u("preview_path"),
        "spriteUrl": u("sprite_path"),
        "spriteGrid": _loads(asset.get("sprite_grid_json")),
        "gallery": gallery or None,
        "mimeType": asset.get("mime_type"),
        "codec": asset.get("codec"),
        "hasAudio": None if has_audio is None else bool(has_audio),
    }
    return {k: v for k, v in contract.items() if v is not None}


def asset_public(asset: dict[str, Any], prefix: str = PUBLIC_PREFIX) -> dict[str, Any]:
    """Full public asset description (contract + identity + media URLs)."""
    aid = asset["id"]
    body = asset_contract(asset, prefix)
    body.update(
        {
            "assetId": aid,
            "screenshotId": asset.get("screenshot_id"),
            "kind": asset.get("kind"),
            "title": asset.get("title"),
            "canonicalUrl": asset.get("canonical_url"),
            "sourceUrl": asset.get("source_url"),
            "mediaUrl": asset_url(aid, asset.get("media_path"), prefix) or asset.get("source_url"),
            "thumbnailUrl": asset_url(aid, asset.get("thumb_path"), prefix),
            "sha256": asset.get("sha256"),
            "phash": asset.get("phash"),
            "faststart": None if asset.get("faststart") is None else bool(asset["faststart"]),
            "needsTranscode": None if asset.get("needs_transcode") is None else bool(asset["needs_transcode"]),
            "status": asset.get("status"),
            "dupOf": asset.get("dup_of"),
        }
    )
    return {k: v for k, v in body.items() if v is not None}
