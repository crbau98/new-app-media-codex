from __future__ import annotations

import logging
import random
import time
from typing import Any, Callable, TypeVar
from urllib.parse import urlparse

import requests

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import (
    build_image_records,
    cache_image,
    clean_text,
    extract_terms,
    score_item,
    scrape_page,
    search_web,
)

logger = logging.getLogger(__name__)

_ANECDOTE_QUERIES = {
    "libido": ["male libido experience forum", "sexual desire increase experience"],
    "pssd": ["persistent ssri sexual dysfunction experience", "pssd story"],
    "ejaculation_latency": ["premature ejaculation talk to frank forum", "premature ejaculation experience"],
    "erections": ["erection problems forum", "franktalk erectile dysfunction"],
    "orgasm": ["anorgasmia experience forum", "orgasm dysfunction experience"],
}
_IMAGE_QUERIES = {
    "libido": "testosterone molecule",
    "pssd": "serotonin synapse",
    "ejaculation_latency": "male reproductive anatomy",
    "erections": "erectile dysfunction medical illustration",
    "orgasm": "dopamine brain illustration",
}

_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
]

T = TypeVar("T")


def _rotate_user_agent(session: requests.Session) -> None:
    session.headers["User-Agent"] = random.choice(_USER_AGENTS)


def _retry_with_backoff(
    func: Callable[..., T],
    *args: Any,
    max_attempts: int = 3,
    **kwargs: Any,
) -> T:
    """Call *func* up to *max_attempts* times with exponential backoff."""
    last_error: Exception | None = None
    for attempt in range(max_attempts):
        if attempt > 0:
            sleep_time = min(2 ** attempt + random.uniform(0, 1), 30.0)
            time.sleep(sleep_time)
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            last_error = exc
            logger.debug("duckduckgo: attempt %d failed for %s: %s", attempt + 1, func.__name__, exc)
    if last_error:
        raise last_error
    raise RuntimeError("Unexpected empty retry loop")


def search_web_retry(session: requests.Session, settings: Settings, query: str, limit: int) -> list[dict[str, str]]:
    """Wrapper around base.search_web with user-agent rotation and retry logic."""
    _rotate_user_agent(session)
    try:
        return _retry_with_backoff(search_web, session, settings, query, limit, max_attempts=3)
    except Exception as exc:
        logger.warning("duckduckgo: search_web failed after retries for '%s': %s", query, exc)
        return []


def collect_anecdotes(session: requests.Session, settings: Settings, theme: Theme, query: str) -> tuple[list[ResearchItem], list[ImageRecord]]:
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()
    for search_query in _ANECDOTE_QUERIES.get(theme.slug, [f"{theme.label} experience forum"]):
        results = search_web_retry(session, settings, search_query, settings.anecdote_results)
        for row in results:
            url = row.get("href") or row.get("url")
            title = (row.get("title") or "").strip()
            snippet = (row.get("body") or row.get("snippet") or "").strip()
            if not url or not title or url in seen_urls:
                continue
            seen_urls.add(url)
            try:
                page_text, page_image = scrape_page(session, url, settings.request_timeout_seconds)
            except Exception:
                page_text, page_image = snippet, ""
            combined = "\n".join(part for part in [title, snippet, page_text] if part)
            compounds, mechanisms = extract_terms(combined)
            parsed = urlparse(url)
            item = ResearchItem(
                source_type="anecdote",
                theme=theme.slug,
                query=search_query,
                title=title,
                url=url,
                summary=clean_text(snippet or page_text[:320] or "No snippet available."),
                content=clean_text(page_text[:6000]),
                author="",
                published_at="",
                domain=parsed.netloc,
                image_url=page_image,
                score=score_item(theme, combined, compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata={"engine": "duckduckgo"},
            )
            items.append(item)
            if page_image:
                images.append(
                    ImageRecord(
                        source_type="page_image",
                        theme=theme.slug,
                        title=title,
                        image_url=page_image,
                        page_url=url,
                        thumb_url=page_image,
                    )
                )
            if len(items) >= settings.anecdote_results:
                return items, images
    return items, images


def collect_images(session: requests.Session, settings: Settings, theme: Theme, query: str) -> list[ImageRecord]:
    images: list[ImageRecord] = []
    image_query = _IMAGE_QUERIES.get(theme.slug, query)
    try:
        response = session.get(
            "https://api.openverse.org/v1/images/",
            params={"q": image_query, "page_size": settings.image_results},
            timeout=settings.request_timeout_seconds,
        )
        response.raise_for_status()
        results = response.json().get("results", [])
    except Exception as exc:
        logger.warning("duckduckgo: openverse request failed: %s", exc)
        results = []

    for row in results:
        image_url = row.get("url")
        if not image_url:
            continue
        local_path = ""
        original_path = ""
        if not settings.stream_only_media:
            try:
                local_path, original_path = cache_image(session, settings, image_url)
            except Exception:
                local_path = ""
        images.append(
            ImageRecord(
                source_type="image_search",
                theme=theme.slug,
                title=(row.get("title") or query)[:180],
                image_url=image_url,
                page_url=row.get("foreign_landing_url") or row.get("creator_url") or "",
                thumb_url=row.get("thumbnail") or image_url,
                local_path=local_path,
                original_path=original_path,
            )
        )

    if images:
        return images

    fallback_results = search_web_retry(session, settings, f"{query} diagram image", settings.image_results)
    for row in fallback_results:
        page_url = row.get("href") or row.get("url")
        title = (row.get("title") or query)[:180]
        if not page_url:
            continue
        try:
            _text, image_url = scrape_page(session, page_url, settings.request_timeout_seconds)
        except Exception:
            continue
        if not image_url:
            continue
        local_path = ""
        original_path = ""
        if not settings.stream_only_media:
            try:
                local_path, original_path = cache_image(session, settings, image_url)
            except Exception:
                local_path = ""
        images.append(
            ImageRecord(
                source_type="page_image_search",
                theme=theme.slug,
                title=title,
                image_url=image_url,
                page_url=page_url,
                thumb_url=image_url,
                local_path=local_path,
                original_path=original_path,
            )
        )
    return images
