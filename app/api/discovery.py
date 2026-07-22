"""Credential-backed public-provider discovery for the Vercel edge tier.

Provider credentials live only in Render. This endpoint returns normalized,
public metadata and canonical source links; it never returns credentials or
subscription-only content.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import re
from typing import Any
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
import requests

router = APIRouter(prefix="/api/discovery", tags=["discovery"])

_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
_HANDLE = re.compile(r"[^a-zA-Z0-9_]")
_PROFILE_HOSTS = {
    "x.com": "X",
    "twitter.com": "X",
    "tumblr.com": "Tumblr",
    "instagram.com": "Instagram",
    "youtube.com": "YouTube",
    "www.youtube.com": "YouTube",
    "redgifs.com": "Redgifs",
    "www.redgifs.com": "Redgifs",
}


class DiscoveryRequest(BaseModel):
    watchlist: list[str] = Field(default_factory=list, max_length=8)
    query: str = Field(default="", max_length=80)

    @field_validator("watchlist")
    @classmethod
    def clean_watchlist(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for value in values:
            display = _clean(value).lstrip("@").strip()[:50]
            key = _canonical(display)
            if len(key) < 2 or key in seen:
                continue
            seen.add(key)
            cleaned.append(display)
        return cleaned[:8]


def _clean(value: Any) -> str:
    return _EMAIL.sub("", str(value or "")).replace("\x00", " ").strip()


def _canonical(value: str) -> str:
    return _HANDLE.sub("", value.lstrip("@")).lower()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_https(value: Any, host_suffix: str) -> str:
    candidate = _clean(value)
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return ""
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return ""
    if host != host_suffix and not host.endswith(f".{host_suffix}"):
        return ""
    return candidate


def _source_status(
    source_id: str,
    name: str,
    mode: str,
    state: str,
    detail: str,
    *,
    media: int = 0,
    creators: int = 0,
    search_url: str = "",
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": source_id,
        "name": name,
        "mode": mode,
        "state": state,
        "mediaFound": media,
        "creatorsFound": creators,
        "detail": detail,
    }
    if search_url:
        result["searchUrl"] = search_url
    return result


def _media_item(
    *,
    item_id: str,
    title: str,
    thumbnail: str,
    source: str,
    creator: str,
    page_url: str,
    profile_url: str,
    created_at: str,
    tags: list[str],
    description: str,
    media_url: str = "",
    is_video: bool = False,
    views: int = 0,
    likes: int = 0,
    comments: int = 0,
    watched: bool = False,
) -> dict[str, Any]:
    candidates = [media_url] if media_url else []
    return {
        "id": item_id,
        "title": _clean(title)[:96] or f"Public post by {creator}",
        "thumbnail": thumbnail or None,
        "source": source,
        "duration": "",
        "isVideo": is_video,
        "category": f"{source} public posts",
        "creator": _clean(creator) or "Public creator",
        "tags": [_clean(tag)[:40] for tag in tags if _clean(tag)][:12],
        "rating": 0,
        "createdAt": created_at or _now(),
        "views": max(0, views),
        "mediaUrl": media_url or None,
        "streamCandidates": candidates,
        "pageUrl": page_url,
        "profileUrl": profile_url,
        "description": _clean(description)[:1000],
        "likes": max(0, likes),
        "comments": max(0, comments),
        "isLiked": False,
        "isNew": True,
        "isTrending": False,
        "curationScore": 0,
        "curationReasons": ["creator is on your watchlist"] if watched else [],
        "isWatchedCreator": watched,
    }


def _collect_x(settings: Any, targets: list[str]) -> dict[str, Any]:
    base_url = "https://x.com/search?q=gay%20creator&src=typed_query&f=live"
    if not settings.x_bearer_token:
        return {"media": [], "leads": [], "status": _source_status("x", "X", "stream", "not-configured", "Official X API is not configured on Render.", search_url=base_url), "attempted": 0, "succeeded": 0}
    if not targets:
        return {"media": [], "leads": [], "status": _source_status("x", "X", "stream", "limited", "Official X API is connected on Render and activates for a search or watchlist.", search_url=base_url), "attempted": 0, "succeeded": 0}

    media: list[dict[str, Any]] = []
    leads: dict[str, dict[str, Any]] = {}
    attempted = succeeded = 0
    session = requests.Session()
    for display in targets[:4]:
        handle = _canonical(display)
        if not handle:
            continue
        attempted += 1
        try:
            response = session.get(
                "https://api.x.com/2/tweets/search/recent",
                params={
                    "query": f"from:{handle} has:media -is:retweet",
                    "max_results": 10,
                    "expansions": "author_id,attachments.media_keys",
                    "tweet.fields": "created_at,text,public_metrics",
                    "user.fields": "username,name,profile_image_url",
                    "media.fields": "url,preview_image_url,type,variants",
                },
                headers={"Authorization": f"Bearer {settings.x_bearer_token}", "User-Agent": settings.user_agent},
                timeout=min(settings.request_timeout_seconds, 6),
            )
            response.raise_for_status()
            body = response.json()
            succeeded += 1
        except (requests.RequestException, ValueError):
            continue

        users = {user.get("id"): user for user in body.get("includes", {}).get("users", [])}
        assets = {asset.get("media_key"): asset for asset in body.get("includes", {}).get("media", [])}
        for tweet in body.get("data", []):
            user = users.get(tweet.get("author_id"), {})
            username = _clean(user.get("username") or handle)
            profile_url = f"https://x.com/{quote(username)}"
            key = _canonical(username)
            leads[f"x-{key}"] = {
                "id": f"x-{key}", "name": _clean(user.get("name") or username), "username": username,
                "platform": "X", "profileUrl": profile_url, "avatar": _safe_https(user.get("profile_image_url"), "twimg.com") or None,
                "tags": ["official api", "public post"], "observedAt": tweet.get("created_at") or _now(),
                "sourceAttribution": "Official X API public post metadata; media remains on X",
                "confidence": 88, "exactWatchMatch": True,
            }
            metrics = tweet.get("public_metrics") or {}
            for media_key in tweet.get("attachments", {}).get("media_keys", []):
                asset = assets.get(media_key, {})
                variants = sorted(
                    [item for item in asset.get("variants", []) if item.get("content_type") == "video/mp4" and item.get("url")],
                    key=lambda item: item.get("bit_rate", 0), reverse=True,
                )
                direct = _safe_https(variants[0].get("url", "") if variants else asset.get("url", ""), "twimg.com")
                thumb = _safe_https(asset.get("preview_image_url") or asset.get("url", ""), "twimg.com")
                if not direct and not thumb:
                    continue
                media.append(_media_item(
                    item_id=f"x-{tweet.get('id')}-{media_key}", title=tweet.get("text", ""), thumbnail=thumb,
                    source="X", creator=username, page_url=f"{profile_url}/status/{tweet.get('id')}",
                    profile_url=profile_url, created_at=tweet.get("created_at", ""), tags=["x", "public post"],
                    description=tweet.get("text", ""), media_url=direct,
                    is_video=asset.get("type") in {"video", "animated_gif"},
                    views=int(metrics.get("impression_count", 0) or 0), likes=int(metrics.get("like_count", 0) or 0),
                    comments=int(metrics.get("reply_count", 0) or 0), watched=True,
                ))

    state = "connected" if succeeded else "error"
    detail = "Official X API public-post discovery from Render." if succeeded else "X is configured on Render, but its API request failed."
    return {"media": media, "leads": list(leads.values()), "status": _source_status("x", "X", "stream", state, detail, media=len(media), creators=len(leads), search_url=base_url), "attempted": attempted, "succeeded": succeeded}


def _collect_tumblr(settings: Any, targets: list[str]) -> dict[str, Any]:
    search_url = "https://www.tumblr.com/search/gay%20creator"
    if not settings.tumblr_api_key:
        return {"media": [], "leads": [], "status": _source_status("tumblr", "Tumblr", "stream", "not-configured", "Official Tumblr API is not configured on Render.", search_url=search_url), "attempted": 0, "succeeded": 0}
    if not targets:
        return {"media": [], "leads": [], "status": _source_status("tumblr", "Tumblr", "stream", "limited", "Official Tumblr API is connected on Render and activates for a search or watchlist.", search_url=search_url), "attempted": 0, "succeeded": 0}
    media: list[dict[str, Any]] = []
    leads: dict[str, dict[str, Any]] = {}
    attempted = succeeded = 0
    for display in targets[:4]:
        attempted += 1
        try:
            response = requests.get(
                "https://api.tumblr.com/v2/tagged",
                params={"tag": display, "limit": 12, "api_key": settings.tumblr_api_key},
                headers={"User-Agent": settings.user_agent}, timeout=min(settings.request_timeout_seconds, 6),
            )
            response.raise_for_status()
            posts = response.json().get("response", [])
            succeeded += 1
        except (requests.RequestException, ValueError):
            continue
        for post in posts:
            username = _clean(post.get("blog_name") or display)
            key = _canonical(username)
            profile_url = f"https://{quote(username)}.tumblr.com/"
            timestamp = post.get("timestamp")
            observed = datetime.fromtimestamp(timestamp, timezone.utc).isoformat() if isinstance(timestamp, (int, float)) else _now()
            leads[f"tumblr-{key}"] = {
                "id": f"tumblr-{key}", "name": username, "username": username, "platform": "Tumblr",
                "profileUrl": profile_url, "tags": ["official api", "public post"], "observedAt": observed,
                "sourceAttribution": "Official Tumblr API public post metadata; media remains on Tumblr",
                "confidence": 86, "exactWatchMatch": True,
            }
            for index, photo in enumerate(post.get("photos") or []):
                original = _safe_https((photo.get("original_size") or {}).get("url", ""), "media.tumblr.com")
                alternatives = photo.get("alt_sizes") or []
                thumbnail = _safe_https((alternatives[1] if len(alternatives) > 1 else alternatives[0] if alternatives else {}).get("url", ""), "media.tumblr.com")
                if not original and not thumbnail:
                    continue
                media.append(_media_item(
                    item_id=f"tumblr-{post.get('id_string') or post.get('id')}-{index}", title=post.get("summary", ""),
                    thumbnail=thumbnail or original, source="Tumblr", creator=username,
                    page_url=post.get("post_url") or profile_url, profile_url=profile_url, created_at=observed,
                    tags=post.get("tags") or [], description=post.get("summary") or post.get("caption", ""),
                    media_url=original, likes=int(post.get("note_count", 0) or 0), watched=True,
                ))
    state = "connected" if succeeded else "error"
    detail = "Official Tumblr API public-post discovery from Render." if succeeded else "Tumblr is configured on Render, but its API request failed."
    return {"media": media, "leads": list(leads.values()), "status": _source_status("tumblr", "Tumblr", "stream", state, detail, media=len(media), creators=len(leads), search_url=search_url), "attempted": attempted, "succeeded": succeeded}


def _profile_from_url(value: str) -> tuple[str, str, str] | None:
    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    host = parsed.hostname or ""
    platform = _PROFILE_HOSTS.get(host.removeprefix("www.")) or _PROFILE_HOSTS.get(host)
    parts = [part for part in parsed.path.split("/") if part]
    if not platform or not parts:
        return None
    username = _clean(parts[0].lstrip("@"))
    if len(_canonical(username)) < 2:
        return None
    return platform, username, f"https://{host}/{quote(parts[0])}"


def _collect_google(settings: Any, targets: list[str]) -> dict[str, Any]:
    search_url = "https://www.google.com/search?q=gay+male+creator+public+profile"
    if not settings.google_cse_api_key or not settings.google_cse_id:
        return {"media": [], "leads": [], "status": _source_status("google", "Google profile leads", "discovery", "not-configured", "Google Programmable Search is not configured on Render.", search_url=search_url), "attempted": 0, "succeeded": 0}
    if not targets:
        return {"media": [], "leads": [], "status": _source_status("google", "Google profile leads", "discovery", "limited", "Google Programmable Search is connected on Render and activates for a search or watchlist.", search_url=search_url), "attempted": 0, "succeeded": 0}
    leads: dict[str, dict[str, Any]] = {}
    attempted = succeeded = 0
    for display in targets[:4]:
        attempted += 1
        try:
            response = requests.get(
                "https://www.googleapis.com/customsearch/v1",
                params={"key": settings.google_cse_api_key, "cx": settings.google_cse_id, "searchType": "image", "safe": "off", "num": 6, "q": f"{display} creator public profile"},
                headers={"User-Agent": settings.user_agent}, timeout=min(settings.request_timeout_seconds, 6),
            )
            response.raise_for_status()
            items = response.json().get("items", [])
            succeeded += 1
        except (requests.RequestException, ValueError):
            continue
        for item in items:
            profile = _profile_from_url((item.get("image") or {}).get("contextLink") or item.get("link", ""))
            if not profile:
                continue
            platform, username, profile_url = profile
            key = _canonical(username)
            leads[f"google-{platform.lower()}-{key}"] = {
                "id": f"google-{platform.lower()}-{key}", "name": username, "username": username,
                "platform": platform, "profileUrl": profile_url, "tags": ["licensed image search"],
                "observedAt": _now(), "sourceAttribution": "Google Programmable Search profile result; media remains at its original source",
                "confidence": 82 if key in {_canonical(value) for value in targets} else 58, "exactWatchMatch": key in {_canonical(value) for value in targets},
            }
    state = "connected" if succeeded else "error"
    detail = "Google profile discovery from Render." if succeeded else "Google search is configured on Render, but its API request failed."
    return {"media": [], "leads": list(leads.values()), "status": _source_status("google", "Google profile leads", "discovery", state, detail, creators=len(leads), search_url=search_url), "attempted": attempted, "succeeded": succeeded}


@router.post("/providers")
def discover_providers(payload: DiscoveryRequest, request: Request) -> JSONResponse:
    settings = request.app.state.settings
    query = _clean(payload.query)[:80]
    targets = payload.watchlist or ([query] if len(_canonical(query)) >= 2 else [])

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(_collect_x, settings, targets),
            executor.submit(_collect_tumblr, settings, targets),
            executor.submit(_collect_google, settings, targets),
        ]
        results = [future.result() for future in futures]

    response = {
        "media": [item for result in results for item in result["media"]],
        "leads": [item for result in results for item in result["leads"]],
        "statuses": [result["status"] for result in results],
        "requestsAttempted": sum(result["attempted"] for result in results),
        "requestsSucceeded": sum(result["succeeded"] for result in results),
        "updatedAt": _now(),
    }
    return JSONResponse(response, headers={"Cache-Control": "private, no-store", "X-Media-Codex-Tier": "render"})
