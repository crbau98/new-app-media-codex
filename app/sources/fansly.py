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

_FANSLY_CB = CircuitBreaker("fansly", failure_threshold=3, recovery_timeout=60.0)
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


async def collect_fansly(username: str, limit: int = 50) -> list[dict[str, Any]]:
    """Scrape Fansly creator public page for media previews.

    Returns a list of dicts shaped like:
        [{"url": "https://...", "thumbnail": "https://...", "title": "...", "type": "image|video"}, ...]
    """
    username = username.strip().lstrip("@")
    if not username:
        return []

    # Fansly profile URL formats
    urls_to_try = [
        f"https://fansly.com/{username}",
        f"https://fansly.com/a/{username}",
    ]

    headers = {
        "User-Agent": _USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    rotator = ProxyRotator()
    resp: httpx.Response | None = None

    async with httpx.AsyncClient(
        headers=headers, follow_redirects=True, timeout=15.0, proxy=rotator._next()
    ) as client:
        for url in urls_to_try:
            try:
                resp = await _FANSLY_CB.async_call(client.get, url)
                if resp.status_code == 200:
                    break
            except Exception as exc:
                logger.debug("fansly: failed %s: %s", url, exc)
                continue

    if resp is None or resp.status_code >= 400:
        logger.info("fansly: profile %s not accessible", username)
        return []

    results: list[dict[str, Any]] = []
    try:
        soup = BeautifulSoup(resp.text, "html.parser")

        # Strategy 1: JSON-LD or next.js __NEXT_DATA__
        for script in soup.find_all("script"):
            text = script.string or ""
            if "__NEXT_DATA__" in text:
                m = re.search(r'window\.__NEXT_DATA__\s*=\s*({.+?});', text)
                if m:
                    try:
                        data = json.loads(m.group(1))
                        props = data.get("props", {}).get("pageProps", {})
                        posts = props.get("posts", props.get("creator", {}).get("posts", []))
                        for post in posts:
                            attachments = post.get("attachments", [])
                            for att in attachments:
                                media_type = att.get("type", "image")
                                loc = att.get("location", "")
                                thumb = att.get("preview", loc)
                                if loc:
                                    results.append({
                                        "url": loc,
                                        "thumbnail": thumb or loc,
                                        "title": (post.get("title", "") or post.get("content", "") or f"Post by {username}")[:200],
                                        "type": "video" if media_type == "video" else "image",
                                    })
                                    if len(results) >= limit:
                                        break
                            if len(results) >= limit:
                                break
                    except (json.JSONDecodeError, KeyError):
                        pass

        # Strategy 2: Generic image extraction from post grids
        if not results:
            for img in soup.find_all("img"):
                src = img.get("src") or img.get("data-src", "")
                if not src or not src.startswith("http"):
                    continue
                if any(marker in src.lower() for marker in ("avatar", "logo", "icon", "banner")):
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
        logger.warning("fansly: parsing error for %s: %s", username, exc)

    logger.info("fansly: collected %d items for %s", len(results), username)
    return results


async def collect_fansly_theme(
    settings: Settings, theme: Theme, db: Any | None = None
) -> tuple[list[ResearchItem], list[ImageRecord]]:
    """Themed wrapper that queries the DB for Fansly performers and scrapes them."""
    from app.db import Database

    limit = getattr(settings, "fansly_results", 10)
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()

    usernames: list[str] = []
    if isinstance(db, Database):
        try:
            rows = db.browse_performers(platform="Fansly", limit=10, compact=True)["performers"]
            usernames = [r["username"] for r in rows if r.get("username")]
        except Exception as exc:
            logger.debug("fansly_theme: failed to query performers: %s", exc)

    # Fallback to default seed names if DB empty
    if not usernames:
        usernames = ["jakipz", "austinwolf"]

    for username in usernames:
        if len(items) >= limit:
            break
        try:
            rows = await collect_fansly(username, limit=max(1, limit - len(items)))
        except Exception as exc:
            logger.warning("fansly_theme: error for %s: %s", username, exc)
            continue
        for row in rows:
            url = row.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            title = row.get("title", f"Fansly post by {username}")
            combined = f"{title} {username} {theme.label}"
            compounds, mechanisms = extract_terms(combined)
            item = ResearchItem(
                source_type="fansly",
                theme=theme.slug,
                query=username,
                title=title,
                url=url,
                summary=title,
                content=title,
                author=username,
                published_at="",
                domain="fansly.com",
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
                        source_type="fansly_image",
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
