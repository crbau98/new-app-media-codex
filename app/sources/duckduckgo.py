from __future__ import annotations

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

ANECDOTE_QUERIES = {
    "libido": ["male libido experience forum", "sexual desire increase experience"],
    "pssd": ["persistent ssri sexual dysfunction experience", "pssd story"],
    "ejaculation_latency": ["premature ejaculation talk to frank forum", "premature ejaculation experience"],
    "erections": ["erection problems forum", "franktalk erectile dysfunction"],
    "orgasm": ["anorgasmia experience forum", "orgasm dysfunction experience"],
}
IMAGE_QUERIES = {
    "libido": "testosterone molecule",
    "pssd": "serotonin synapse",
    "ejaculation_latency": "male reproductive anatomy",
    "erections": "erectile dysfunction medical illustration",
    "orgasm": "dopamine brain illustration",
}


def collect_anecdotes(session: requests.Session, settings: Settings, theme: Theme, query: str) -> tuple[list[ResearchItem], list[ImageRecord]]:
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()
    for search_query in ANECDOTE_QUERIES.get(theme.slug, [f"{theme.label} experience forum"]):
        results = search_web(session, settings, search_query, settings.anecdote_results)
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
    image_query = IMAGE_QUERIES.get(theme.slug, query)
    results = session.get(
        "https://api.openverse.org/v1/images/",
        params={"q": image_query, "page_size": settings.image_results},
        timeout=settings.request_timeout_seconds,
    ).json().get("results", [])
    for row in results:
        image_url = row.get("url")
        if not image_url:
            continue
        local_path = ""
        original_path = ""
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

    fallback_results = search_web(session, settings, f"{query} diagram image", settings.image_results)
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
