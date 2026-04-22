from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import build_image_records, clean_text, extract_terms, score_item
from app.utils.circuit_breaker import CircuitBreaker
from app.utils.proxy import ProxyRotator

logger = logging.getLogger(__name__)

_SPANKBANG_CB = CircuitBreaker("spankbang", failure_threshold=3, recovery_timeout=60.0)
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


async def collect_spankbang(query: str, limit: int = 20) -> list[dict[str, Any]]:
    """Search SpankBang and extract video entries.

    Returns a list of dicts shaped like:
        [{"url": "https://...", "thumbnail": "https://...", "title": "...", "type": "video"}, ...]
    """
    query = query.strip()
    if not query:
        return []

    search_url = f"https://spankbang.com/s/{query.replace(' ', '+')}/"
    headers = {
        "User-Agent": _USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://spankbang.com/",
    }

    rotator = ProxyRotator()

    try:
        async with httpx.AsyncClient(
            headers=headers, follow_redirects=True, timeout=15.0, proxy=rotator._next()
        ) as client:
            resp = await _SPANKBANG_CB.async_call(client.get, search_url)
    except Exception as exc:
        logger.warning("spankbang: search failed for '%s': %s", query, exc)
        return []

    if resp.status_code >= 400:
        logger.warning("spankbang: HTTP %s for query '%s'", resp.status_code, query)
        return []

    results: list[dict[str, Any]] = []
    try:
        soup = BeautifulSoup(resp.text, "html.parser")

        # SpankBang search results use .video-list > .video-item
        for item in soup.select(".video-list .video-item, .main_results .video-item, .video-item"):
            link_tag = item.select_one("a[href]")
            if not link_tag:
                continue
            href = link_tag.get("href", "")
            if not href:
                continue
            page_url = urljoin("https://spankbang.com/", href)

            thumb_tag = item.select_one("img")
            thumbnail = ""
            if thumb_tag:
                thumbnail = thumb_tag.get("data-src") or thumb_tag.get("src", "")

            title_tag = item.select_one(".n, .title, a[title]")
            title = ""
            if title_tag:
                title = title_tag.get("title", "") or title_tag.get_text(strip=True)

            # Duration / quality indicators (optional)
            duration = ""
            dur_tag = item.select_one(".l, .duration")
            if dur_tag:
                duration = dur_tag.get_text(strip=True)

            if title or thumbnail:
                results.append({
                    "url": page_url,
                    "thumbnail": thumbnail,
                    "title": (title or f"SpankBang video")[:200],
                    "type": "video",
                    "duration": duration,
                })
                if len(results) >= limit:
                    break

        # Fallback: broader selector
        if not results:
            for link in soup.find_all("a", href=re.compile(r"/\d+_\w+/video/")):
                href = link.get("href", "")
                page_url = urljoin("https://spankbang.com/", href)
                img = link.find("img")
                thumbnail = ""
                if img:
                    thumbnail = img.get("data-src") or img.get("src", "")
                title = link.get("title", "") or link.get_text(strip=True)
                results.append({
                    "url": page_url,
                    "thumbnail": thumbnail,
                    "title": (title or f"SpankBang video")[:200],
                    "type": "video",
                })
                if len(results) >= limit:
                    break
    except Exception as exc:
        logger.warning("spankbang: parsing error for '%s': %s", query, exc)

    logger.info("spankbang: collected %d items for query '%s'", len(results), query)
    return results


async def collect_spankbang_theme(
    settings: Settings, theme: Theme
) -> tuple[list[ResearchItem], list[ImageRecord]]:
    """Themed wrapper for SpankBang search."""
    limit = getattr(settings, "spankbang_results", 10)
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()

    for search_query in theme.queries or [theme.label]:
        if len(items) >= limit:
            break
        try:
            rows = await collect_spankbang(search_query, limit=max(1, limit - len(items)))
        except Exception as exc:
            logger.warning("spankbang_theme: error for '%s': %s", search_query, exc)
            continue
        for row in rows:
            url = row.get("url", "")
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            title = row.get("title", "SpankBang video")
            combined = f"{title} {search_query}"
            compounds, mechanisms = extract_terms(combined)
            item = ResearchItem(
                source_type="spankbang",
                theme=theme.slug,
                query=search_query,
                title=title,
                url=url,
                summary=title,
                content=title,
                author="",
                published_at="",
                domain="spankbang.com",
                image_url=row.get("thumbnail", ""),
                score=score_item(theme, combined, compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata={"duration": row.get("duration", ""), "type": "video"},
            )
            items.append(item)
            if row.get("thumbnail"):
                images.append(
                    ImageRecord(
                        source_type="spankbang_image",
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
