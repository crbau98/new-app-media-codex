from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from bs4 import BeautifulSoup

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import build_image_records, extract_terms, score_item
from app.utils.circuit_breaker import CircuitBreaker
from app.utils.proxy import ProxyRotator

logger = logging.getLogger(__name__)

_JFF_CB = CircuitBreaker("justforfans", failure_threshold=3, recovery_timeout=60.0)
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


async def collect_justforfans(username: str, limit: int = 50) -> list[dict[str, Any]]:
    """Scrape JustForFans creator public page for media previews.

    Returns a list of dicts shaped like:
        [{"url": "https://...", "thumbnail": "https://...", "title": "...", "type": "image|video"}, ...]
    """
    username = username.strip().lstrip("@")
    if not username:
        return []

    profile_url = f"https://justfor.fans/{username}"
    headers = {
        "User-Agent": _USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    rotator = ProxyRotator()

    try:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, timeout=15.0, proxy=rotator._next()
        ) as client:
            resp = await _JFF_CB.async_call(client.get, profile_url)
    except Exception as exc:
        logger.warning("justforfans: failed to fetch %s: %s", username, exc)
        return []

    if resp.status_code in (404, 403):
        logger.info("justforfans: profile %s not accessible (status %s)", username, resp.status_code)
        return []

    if resp.status_code >= 400:
        logger.warning("justforfans: HTTP %s for %s", resp.status_code, username)
        return []

    results: list[dict[str, Any]] = []
    try:
        soup = BeautifulSoup(resp.text, "html.parser")

        # Strategy 1: Look for video poster images and video sources
        for video in soup.find_all("video"):
            poster = video.get("poster", "")
            src = ""
            for source in video.find_all("source"):
                src = source.get("src", "")
                if src:
                    break
            if not src and poster:
                src = poster
            if src:
                results.append({
                    "url": src,
                    "thumbnail": poster or src,
                    "title": f"Video by {username}",
                    "type": "video",
                })
                if len(results) >= limit:
                    break

        # Strategy 2: Image grid / post images
        for img in soup.find_all("img"):
            src = img.get("src") or img.get("data-src", "")
            if not src or not src.startswith("http"):
                continue
            if any(marker in src.lower() for marker in ("avatar", "logo", "icon", "banner", "header")):
                continue
            # Skip small icons
            if "/emoji/" in src or "/icon/" in src:
                continue
            results.append({
                "url": src,
                "thumbnail": src,
                "title": (img.get("alt", "") or f"Post by {username}")[:200],
                "type": "image",
            })
            if len(results) >= limit:
                break
    except Exception as exc:
        logger.warning("justforfans: parsing error for %s: %s", username, exc)

    logger.info("justforfans: collected %d items for %s", len(results), username)
    return results


async def collect_justforfans_theme(
    settings: Settings, theme: Theme, db: Any | None = None
) -> tuple[list[ResearchItem], list[ImageRecord]]:
    """Themed wrapper that queries the DB for JustForFans performers and scrapes them."""
    from app.db import Database

    limit = getattr(settings, "justforfans_results", 10)
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()

    usernames: list[str] = []
    if isinstance(db, Database):
        try:
            rows = db.browse_performers(platform="JustForFans", limit=10, compact=True)["performers"]
            usernames = [r["username"] for r in rows if r.get("username")]
        except Exception as exc:
            logger.debug("justforfans_theme: failed to query performers: %s", exc)

    if not usernames:
        return items, images

    for username in usernames:
        if len(items) >= limit:
            break
        try:
            rows = await collect_justforfans(username, limit=max(1, limit - len(items)))
        except Exception as exc:
            logger.warning("justforfans_theme: error for %s: %s", username, exc)
            continue
        for row in rows:
            url = row.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            title = row.get("title", f"JustForFans post by {username}")
            combined = f"{title} {username} {theme.label}"
            compounds, mechanisms = extract_terms(combined)
            item = ResearchItem(
                source_type="justforfans",
                theme=theme.slug,
                query=username,
                title=title,
                url=url,
                summary=title,
                content=title,
                author=username,
                published_at="",
                domain="justfor.fans",
                image_url=row.get("thumbnail", ""),
                score=score_item(theme, combined, compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata={"type": row.get("type", "image"), "duration": row.get("duration", "")},
            )
            items.append(item)
            if row.get("thumbnail"):
                images.append(
                    ImageRecord(
                        source_type="justforfans_image",
                        theme=theme.slug,
                        title=title,
                        image_url=row["thumbnail"],
                        page_url=url,
                        thumb_url=row["thumbnail"],
                    )
                )
            if len(items) >= limit:
                break
    return items, images
