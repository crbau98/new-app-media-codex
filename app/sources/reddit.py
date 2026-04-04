from __future__ import annotations

from typing import Any

import requests

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import (
    build_image_records,
    canonicalize_url,
    clean_text,
    dedupe_image_urls,
    extract_terms,
    is_direct_image_asset,
    is_useful_image_url,
    normalize_image_url,
    normalize_reddit_url,
    score_item,
    search_web,
    to_iso8601,
)

REDDIT_QUERIES = {
    "libido": ["penis libido reddit", "cock dick libido men reddit", "twink twunk cum libido reddit", "precum ejaculate hyperspermia libido reddit"],
    "pssd": ["penis cock PSSD reddit", "dick ejaculate PSSD dysfunction reddit", "cum hyperspermia PSSD reddit", "twink twunk cock ejaculate PSSD reddit"],
    "ejaculation_latency": ["penis cock premature ejaculation reddit", "dick ejaculate hyperspermia latency reddit", "cum precum ejaculate control reddit", "twink twunk cock ejaculate timing reddit"],
    "erections": ["penis cock erection reddit", "dick cum erection dysfunction reddit", "twink twunk cock erection reddit", "ejaculate hyperspermia erection reddit"],
    "orgasm": ["penis cock orgasm reddit", "ejaculate cum hyperspermia orgasm reddit", "twink twunk cock ejaculate orgasm reddit", "dick precum ejaculate orgasm reddit"],
}


def extract_reddit_post_image_urls(post: dict[str, Any]) -> list[str]:
    image_urls: list[str] = []
    direct_url = normalize_image_url(post.get("url_overridden_by_dest", ""))
    if is_useful_image_url(direct_url) and is_direct_image_asset(direct_url):
        image_urls.append(direct_url)
    preview = post.get("preview", {}).get("images", [])
    for image in preview:
        source = image.get("source", {})
        url_value = normalize_image_url(source.get("url", ""))
        if is_useful_image_url(url_value):
            image_urls.append(url_value)
    for asset in post.get("media_metadata", {}).values():
        source = asset.get("s", {})
        url_value = normalize_image_url(source.get("u", ""))
        if is_useful_image_url(url_value):
            image_urls.append(url_value)
    thumb_url = normalize_image_url(post.get("thumbnail", ""))
    if is_useful_image_url(thumb_url):
        image_urls.append(thumb_url)
    return dedupe_image_urls(image_urls)


def scrape_reddit_thread(session: requests.Session, settings: Settings, url: str) -> dict[str, Any]:
    canonical = canonicalize_url(url)
    json_url = canonical + ".json?raw_json=1&limit=8"
    response = session.get(json_url, timeout=settings.request_timeout_seconds)
    response.raise_for_status()
    payload = response.json()
    post = payload[0]["data"]["children"][0]["data"]
    comments = payload[1]["data"]["children"] if len(payload) > 1 else []
    comment_snippets: list[str] = []
    for comment in comments[:5]:
        if comment.get("kind") != "t1":
            continue
        body = clean_text(comment.get("data", {}).get("body", ""))
        if body:
            comment_snippets.append(body)
    image_urls = extract_reddit_post_image_urls(post)
    text_parts = [clean_text(post.get("selftext", ""))] + comment_snippets
    content = "\n".join(part for part in text_parts if part)
    return {
        "title": clean_text(post.get("title", "")),
        "summary": clean_text(post.get("selftext", "")[:400] or (comment_snippets[0] if comment_snippets else "")),
        "content": content[:6000],
        "author": post.get("author", ""),
        "published_at": to_iso8601(post.get("created_utc")),
        "domain": f"reddit.com/r/{post.get('subreddit', '')}",
        "image_url": image_urls[0] if image_urls else "",
        "image_urls": image_urls,
        "metadata": {
            "subreddit": post.get("subreddit", ""),
            "num_comments": post.get("num_comments", 0),
            "score": post.get("score", 0),
        },
    }


def collect_reddit(session: requests.Session, settings: Settings, theme: Theme) -> tuple[list[ResearchItem], list[ImageRecord]]:
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()
    for query in REDDIT_QUERIES.get(theme.slug, []):
        results = search_web(session, settings, query, settings.reddit_results * 3)
        for row in results:
            url = normalize_reddit_url(row.get("href") or "")
            if "/comments/" not in url:
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)
            snippet = clean_text(row.get("body", ""))
            try:
                scraped = scrape_reddit_thread(session, settings, url)
            except Exception:
                continue
            combined = "\n".join([scraped["title"], snippet, scraped["content"]])
            compounds, mechanisms = extract_terms(combined)
            item = ResearchItem(
                source_type="reddit",
                theme=theme.slug,
                query=query,
                title=scraped["title"] or clean_text(row.get("title", "")),
                url=url,
                summary=scraped["summary"] or snippet or "No summary available.",
                content=scraped["content"],
                author=scraped["author"],
                published_at=scraped["published_at"],
                domain=scraped["domain"],
                image_url=scraped["image_url"],
                score=score_item(theme, combined, compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata=scraped["metadata"],
            )
            items.append(item)
            images.extend(build_image_records("reddit_image", theme.slug, item.title, url, scraped.get("image_urls", [])))
            if len(items) >= settings.reddit_results:
                return items, images
    return items, images
