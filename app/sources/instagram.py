from __future__ import annotations

import json
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

_INSTAGRAM_CB = CircuitBreaker("instagram", failure_threshold=3, recovery_timeout=60.0)
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


async def collect_instagram(username: str, limit: int = 50) -> list[dict[str, Any]]:
    """Scrape public Instagram profile via embed page.

    Returns a list of dicts shaped like:
        [{"url": "https://...", "thumbnail": "https://...", "title": "...", "type": "image"}, ...]
    """
    username = username.strip().lstrip("@")
    if not username:
        return []

    embed_url = f"https://www.instagram.com/{username}/embed/"
    headers = {
        "User-Agent": _USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://www.instagram.com/",
    }

    rotator = ProxyRotator()

    try:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, timeout=15.0, proxy=rotator._next()
        ) as client:
            resp = await _INSTAGRAM_CB.async_call(client.get, embed_url)
    except Exception as exc:
        logger.warning("instagram: failed to fetch %s: %s", username, exc)
        return []

    if resp.status_code in (404, 403):
        logger.info("instagram: profile %s not accessible (status %s)", username, resp.status_code)
        return []

    if resp.status_code >= 400:
        logger.warning("instagram: HTTP %s for %s", resp.status_code, username)
        return []

    results: list[dict[str, Any]] = []
    try:
        soup = BeautifulSoup(resp.text, "html.parser")

        # Strategy 1: Look for sharedData / additionalDataLoaded in script tags
        for script in soup.find_all("script"):
            text = script.string or ""
            if not text:
                continue
            # Instagram sometimes embeds JSON directly
            for pattern in (r'window\._sharedData\s*=\s*({.+?});', r'window\.__additionalDataLoaded\(.+?,\s*({.+?})\);'):
                m = re.search(pattern, text)
                if m:
                    try:
                        data = json.loads(m.group(1))
                        edges = (
                            data.get("entry_data", {})
                            .get("ProfilePage", [{}])[0]
                            .get("graphql", {})
                            .get("user", {})
                            .get("edge_owner_to_timeline_media", {})
                            .get("edges", [])
                        )
                        for edge in edges:
                            node = edge.get("node", {})
                            if not node:
                                continue
                            typ = "video" if node.get("is_video") else "image"
                            url = node.get("display_url") or node.get("thumbnail_src") or ""
                            if not url:
                                continue
                            caption_edges = node.get("edge_media_to_caption", {}).get("edges", [])
                            caption = caption_edges[0].get("node", {}).get("text", "") if caption_edges else ""
                            results.append({
                                "url": url,
                                "thumbnail": node.get("thumbnail_src") or url,
                                "title": (caption or f"Post by {username}")[:200],
                                "type": typ,
                            })
                            if len(results) >= limit:
                                break
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue

        # Strategy 2: Fallback to visible <img> tags in embed grid
        if not results:
            for img in soup.find_all("img"):
                src = img.get("src")
                if not src or not src.startswith("http"):
                    continue
                alt = img.get("alt", "")
                # Skip avatar / logo images
                if any(marker in src.lower() for marker in ("avatar", "logo", "profile")):
                    continue
                results.append({
                    "url": src,
                    "thumbnail": src,
                    "title": (alt or f"Post by {username}")[:200],
                    "type": "image",
                })
                if len(results) >= limit:
                    break
    except Exception as exc:
        logger.warning("instagram: parsing error for %s: %s", username, exc)

    logger.info("instagram: collected %d items for %s", len(results), username)
    return results


async def collect_instagram_theme(
    settings: Settings, theme: Theme, db: Any | None = None
) -> tuple[list[ResearchItem], list[ImageRecord]]:
    """Themed wrapper that queries the DB for Instagram performers and scrapes them."""
    from app.db import Database

    limit = getattr(settings, "instagram_results", 10)
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()

    usernames: list[str] = []
    if isinstance(db, Database):
        try:
            rows = db.browse_performers(platform="Instagram", limit=10, compact=True)["performers"]
            usernames = [r["username"] for r in rows if r.get("username")]
        except Exception as exc:
            logger.debug("instagram_theme: failed to query performers: %s", exc)

    if not usernames:
        # No Instagram performers seeded — skip gracefully
        return items, images

    for username in usernames:
        if len(items) >= limit:
            break
        try:
            rows = await collect_instagram(username, limit=max(1, limit - len(items)))
        except Exception as exc:
            logger.warning("instagram_theme: error for %s: %s", username, exc)
            continue
        for row in rows:
            url = row.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            title = row.get("title", f"Instagram post by {username}")
            combined = f"{title} {username} {theme.label}"
            compounds, mechanisms = extract_terms(combined)
            item = ResearchItem(
                source_type="instagram",
                theme=theme.slug,
                query=username,
                title=title,
                url=url,
                summary=title,
                content=title,
                author=username,
                published_at="",
                domain="instagram.com",
                image_url=row.get("thumbnail", ""),
                score=score_item(theme, combined, compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata={"type": row.get("type", "image")},
            )
            items.append(item)
            if row.get("thumbnail"):
                images.append(
                    ImageRecord(
                        source_type="instagram_image",
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
