"""Credential-backed public-provider discovery for the Vercel edge tier.

Provider credentials live only in Render. This endpoint returns normalized,
public metadata and canonical source links; it never returns credentials or
subscription-only content. X and Reddit are collected through their official
APIs (see ``app/discovery``); Tumblr and Google keep their existing lanes.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timezone
import time
from typing import Any
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
import requests

from app.discovery.common import (
    canonical as _canonical,
    clean_text as _clean,
    media_item as _media_item,
    now_iso as _now,
    safe_https as _safe_https,
    source_status as _source_status,
)
from app.discovery.reddit_api import collect_reddit
from app.discovery.x_api import collect_x

router = APIRouter(prefix="/api/discovery", tags=["discovery"])

# Wall-clock budget for the whole gateway call. The Vercel edge waits 15s, so every
# source gets a shared deadline well inside it; a slow source is abandoned, not awaited.
GATEWAY_DEADLINE_SECONDS = 10.0
WATCHLIST_CAP = 8

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
    watchlist: list[str] = Field(default_factory=list, max_length=WATCHLIST_CAP)
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
        return cleaned[:WATCHLIST_CAP]


def _collect_x(settings: Any, watchlist: list[str], query: str = "", deadline: float | None = None) -> dict[str, Any]:
    """Official X API v2: exact-handle timelines, typed search, or the rotating default feed."""
    return collect_x(settings, watchlist, query, deadline=deadline)


def _collect_reddit(settings: Any, watchlist: list[str], query: str = "", deadline: float | None = None) -> dict[str, Any]:
    """Official Reddit OAuth2 API: subreddit listings, name search and exact-user submissions."""
    return collect_reddit(settings, watchlist, query, deadline=deadline)


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


def _deferred(source_id: str, name: str, mode: str, reason: str) -> dict[str, Any]:
    return {
        "media": [], "leads": [], "attempted": 0, "succeeded": 0,
        "status": _source_status(source_id, name, mode, "limited", reason),
    }


@router.post("/providers")
def discover_providers(payload: DiscoveryRequest, request: Request) -> JSONResponse:
    settings = request.app.state.settings
    query = _clean(payload.query)[:80]
    typed = query if len(_canonical(query)) >= 2 else ""
    watchlist = payload.watchlist[:WATCHLIST_CAP]
    targets = watchlist or ([typed] if typed else [])
    deadline = time.monotonic() + GATEWAY_DEADLINE_SECONDS

    lanes: list[tuple[str, str, str, Any]] = [
        ("x", "X", "stream", lambda: _collect_x(settings, watchlist, typed, deadline)),
        ("reddit", "Reddit", "stream", lambda: _collect_reddit(settings, watchlist, typed, deadline)),
        ("tumblr", "Tumblr", "stream", lambda: _collect_tumblr(settings, targets)),
        ("google", "Google profile leads", "discovery", lambda: _collect_google(settings, targets)),
    ]
    executor = ThreadPoolExecutor(max_workers=len(lanes), thread_name_prefix="provider-gateway")
    futures = [(lane, executor.submit(lane[3])) for lane in lanes]
    results: list[dict[str, Any]] = []
    for (source_id, name, mode, _), future in futures:
        try:
            results.append(future.result(timeout=max(0.05, deadline - time.monotonic())))
        except FutureTimeout:
            results.append(_deferred(source_id, name, mode, f"{name} discovery was deferred by the gateway time budget; try again shortly."))
        except Exception:  # noqa: BLE001 - one provider must never fail the whole gateway
            results.append(_deferred(source_id, name, mode, f"{name} discovery hit an unexpected error and was skipped."))
    # Slow provider threads are abandoned rather than awaited so the response stays inside the edge budget.
    executor.shutdown(wait=False, cancel_futures=True)

    response = {
        "media": [item for result in results for item in result["media"]],
        "leads": [item for result in results for item in result["leads"]],
        "statuses": [result["status"] for result in results],
        "requestsAttempted": sum(result["attempted"] for result in results),
        "requestsSucceeded": sum(result["succeeded"] for result in results),
        "updatedAt": _now(),
    }
    return JSONResponse(response, headers={"Cache-Control": "private, no-store", "X-Media-Codex-Tier": "render"})
