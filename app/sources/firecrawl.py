"""Firecrawl-powered research source.

Uses the Firecrawl REST API for high-quality web search with embedded content
extraction. Requires FIRECRAWL_API_KEY — silently returns [] if not set.

Anatomical queries expand each theme with "penis" and "ejaculation" terms and
naturally surface content from Reddit, X, and the general web.
"""
from __future__ import annotations

from urllib.parse import urlparse

import requests

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import (
    canonicalize_url,
    clean_text,
    extract_signals,
    is_useful_image_url,
    score_item,
)

_SEARCH_URL = "https://api.firecrawl.dev/v1/search"
_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"

# Per-theme anatomical/medical queries that include "penis" and "ejaculation"
# phrasing. These target Reddit, X, and general web via natural language and
# site-specific phrasing that search engines will pick up.
FIRECRAWL_QUERIES: dict[str, list[str]] = {
    "libido": [
        "penis cock dick libido men health reddit",
        "twink twunk cum precum libido sexual health reddit",
        "penis ejaculate hyperspermia libido men forum",
        "cock dick cum libido male health discussion",
    ],
    "pssd": [
        "penis cock ejaculate PSSD antidepressant dysfunction reddit",
        "dick cum hyperspermia PSSD sexual dysfunction men",
        "twink twunk cock ejaculate PSSD reddit forum",
        "precum ejaculate hyperspermia PSSD men health discussion",
    ],
    "ejaculation_latency": [
        "penis cock ejaculate premature ejaculation control reddit",
        "dick cum hyperspermia ejaculate timing men health",
        "twink twunk cock ejaculate latency reddit forum",
        "precum ejaculate hyperspermia volume control men discussion",
    ],
    "erections": [
        "penis cock dick erection dysfunction reddit men health",
        "twink twunk cock cum erection quality men forum",
        "penis ejaculate cum erection problems health reddit",
        "dick cock hyperspermia erection men health discussion",
    ],
    "orgasm": [
        "penis cock ejaculate orgasm intensity reddit men",
        "cum precum hyperspermia orgasm male health forum",
        "twink twunk cock ejaculate orgasm discussion reddit",
        "dick cum ejaculate hyperspermia orgasm men health",
    ],
}

# Queries used specifically for image search — targets real photos of real men.
IMAGE_QUERIES: dict[str, str] = {
    "libido": "real man penis cock dick cum libido photo",
    "pssd": "real man penis cock ejaculate cum hyperspermia PSSD photo",
    "ejaculation_latency": "real man penis cock ejaculate cum hyperspermia photo",
    "erections": "real man penis cock dick cum erection photo",
    "orgasm": "real man penis cock ejaculate cum precum orgasm photo",
}


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def collect_firecrawl(
    session: requests.Session,
    settings: Settings,
    theme: Theme,
) -> list[ResearchItem]:
    """Search for research content using Firecrawl, including anatomical queries.

    Uses both the theme's configured queries and per-theme anatomical expansions
    to surface content from the general web, Reddit, and X. Populates image_url
    from og:image metadata when available so the academic source loop picks it up.

    Silently returns [] when FIRECRAWL_API_KEY is not configured.
    """
    if not settings.firecrawl_api_key:
        return []

    items: list[ResearchItem] = []
    seen_urls: set[str] = set()
    headers = _headers(settings.firecrawl_api_key)

    # Combine theme queries with anatomical expansions; cap at 4 total
    all_queries = list(theme.queries[:2]) + FIRECRAWL_QUERIES.get(theme.slug, [])[:2]

    for query in all_queries:
        try:
            r = session.post(
                _SEARCH_URL,
                headers=headers,
                json={
                    "query": query,
                    "limit": settings.firecrawl_results,
                    "scrapeOptions": {"formats": ["markdown"]},
                },
                timeout=settings.request_timeout_seconds * 3,
            )
            r.raise_for_status()
            results = r.json().get("data", [])
        except Exception:
            continue

        for row in results:
            url = canonicalize_url(row.get("url", ""))
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)

            title = clean_text(row.get("title") or "")
            description = clean_text(row.get("description") or "")
            markdown = clean_text(row.get("markdown") or "")

            if not title:
                continue

            # Extract og:image from scrape metadata when present
            og_image = row.get("metadata", {}).get("ogImage", "") if isinstance(row.get("metadata"), dict) else ""
            if og_image and not is_useful_image_url(og_image):
                og_image = ""

            combined = f"{title}\n{description}\n{markdown[:2000]}"
            compounds, mechanisms = extract_signals(combined)

            items.append(
                ResearchItem(
                    source_type="firecrawl",
                    theme=theme.slug,
                    query=query,
                    title=title,
                    url=url,
                    summary=description or markdown[:400] or "No summary available.",
                    content=markdown[:6000] or description,
                    author="",
                    published_at="",
                    domain=urlparse(url).netloc,
                    image_url=og_image,
                    score=score_item(theme, combined, compounds, mechanisms),
                    compounds=compounds,
                    mechanisms=mechanisms,
                    metadata={"source": "firecrawl_search", "query": query},
                )
            )

        if len(items) >= settings.firecrawl_results * 2:
            break

    return items[: settings.firecrawl_results * 2]


def collect_firecrawl_images(
    session: requests.Session,
    settings: Settings,
    theme: Theme,
) -> list[ImageRecord]:
    """Search for medical/anatomical images using the Firecrawl image search API.

    Uses anatomical query terms ("penis", "ejaculation") with medical phrasing
    to retrieve diagrams and illustrations from across the web.
    Returns [] when FIRECRAWL_API_KEY is not configured.
    """
    if not settings.firecrawl_api_key:
        return []

    headers = _headers(settings.firecrawl_api_key)
    image_query = IMAGE_QUERIES.get(theme.slug, f"{theme.label} anatomy medical illustration")

    try:
        r = session.post(
            _SEARCH_URL,
            headers=headers,
            json={
                "query": image_query,
                "limit": settings.image_results,
                "sources": ["images", "web"],
            },
            timeout=settings.request_timeout_seconds * 3,
        )
        r.raise_for_status()
        data = r.json()
        # Image search returns either data.images[] or data[] depending on API version
        raw = data.get("data", {})
        if isinstance(raw, list):
            image_rows = raw
        elif isinstance(raw, dict):
            image_rows = raw.get("images", [])
        else:
            image_rows = []
    except Exception:
        return []

    images: list[ImageRecord] = []
    for row in image_rows:
        # Image search rows have url = direct image URL, sourceUrl = page it came from
        image_url = row.get("url", "")
        if not image_url or not is_useful_image_url(image_url):
            continue
        images.append(
            ImageRecord(
                source_type="firecrawl_image",
                theme=theme.slug,
                title=(row.get("title") or image_query)[:180],
                image_url=image_url,
                page_url=row.get("sourceUrl") or row.get("source_url") or "",
                thumb_url=image_url,
            )
        )
        if len(images) >= settings.image_results:
            break

    return images


def scrape_with_firecrawl(
    api_key: str,
    session: requests.Session,
    url: str,
    timeout: int,
) -> tuple[str, str]:
    """Scrape a single URL via Firecrawl. Returns (markdown_content, og_image_url).

    Returns ("", "") on any error or if api_key is empty.
    """
    if not api_key:
        return ("", "")
    try:
        r = session.post(
            _SCRAPE_URL,
            headers=_headers(api_key),
            json={"url": url, "formats": ["markdown"]},
            timeout=timeout * 3,
        )
        r.raise_for_status()
        data = r.json().get("data", {})
        markdown = clean_text(data.get("markdown") or "")
        og_image = data.get("metadata", {}).get("ogImage") or ""
        return (markdown, og_image)
    except Exception:
        return ("", "")
