from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlparse

import requests

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import (
    build_image_records,
    canonicalize_url,
    clean_text,
    dedupe_image_urls,
    extract_terms,
    is_useful_image_url,
    normalize_image_url,
    score_item,
    to_iso8601,
)

KEMONO_HOSTS = ("kemono.su", "kemono.cr", "kemono.party")
KEMONO_IMG_HOST = "https://img.kemono.cr"

KEMONO_QUERIES = {
    "onlyfans_creators": ["gay onlyfans", "male onlyfans", "gay creator"],
    "fansly_creators": ["gay fansly", "male fansly", "gay creator fansly"],
    "reddit_gay": ["gay nude", "gay amateur", "gay porn"],
    "x_gay_creators": ["gay twitter creator", "gay x creator", "gay male nude"],
    "lpsg_threads": ["gay hung", "gay bareback", "male nude"],
    "twinks": ["twink", "gay twink nude", "young gay"],
    "muscle_bears": ["gay muscle", "gay bear", "gay daddy"],
    "fetish_kink": ["gay fetish", "gay bdsm", "gay leather"],
}


def _pick_api_host(session: requests.Session, settings: Settings) -> str:
    """Try kemono hosts in order, return the first that responds to /api/v1/creators."""
    for host in KEMONO_HOSTS:
        url = f"https://{host}/api/v1/creators.txt"
        try:
            response = session.get(url, timeout=settings.request_timeout_seconds)
            if response.status_code == 200:
                return host
        except requests.RequestException:
            continue
    return KEMONO_HOSTS[0]


def _search_posts(
    session: requests.Session, settings: Settings, host: str, query: str, limit: int
) -> list[dict[str, Any]]:
    url = f"https://{host}/api/v1/posts?q={quote(query)}"
    response = session.get(url, timeout=settings.request_timeout_seconds)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        data = data.get("posts") or data.get("results") or []
    if not isinstance(data, list):
        return []
    return data[:limit]


def _post_image_urls(post: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    file_obj = post.get("file") or {}
    path = file_obj.get("path") if isinstance(file_obj, dict) else None
    if path:
        urls.append(f"{KEMONO_IMG_HOST}{path}")
    for att in post.get("attachments") or []:
        if not isinstance(att, dict):
            continue
        att_path = att.get("path")
        if att_path:
            urls.append(f"{KEMONO_IMG_HOST}{att_path}")
    normalized = [normalize_image_url(u) for u in urls]
    return dedupe_image_urls([u for u in normalized if is_useful_image_url(u)])


def _post_page_url(host: str, post: dict[str, Any]) -> str:
    service = post.get("service") or ""
    user = post.get("user") or ""
    post_id = post.get("id") or ""
    if not (service and user and post_id):
        return ""
    return f"https://{host}/{service}/user/{user}/post/{post_id}"


def collect_kemono(
    session: requests.Session, settings: Settings, theme: Theme
) -> tuple[list[ResearchItem], list[ImageRecord]]:
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()

    queries = KEMONO_QUERIES.get(theme.slug) or [theme.label]
    per_query = max(1, settings.kemono_results)
    host = _pick_api_host(session, settings)

    for query in queries:
        if len(items) >= settings.kemono_results:
            break
        try:
            posts = _search_posts(session, settings, host, query, per_query * 2)
        except Exception:
            continue
        for post in posts:
            if len(items) >= settings.kemono_results:
                break
            page_url = _post_page_url(host, post)
            if not page_url:
                continue
            page_url = canonicalize_url(page_url)
            if page_url in seen_urls:
                continue
            seen_urls.add(page_url)

            title = clean_text(post.get("title", "") or "")
            body_text = clean_text(post.get("content", "") or post.get("substring", "") or "")
            summary = body_text[:320] or title or "No summary available."
            combined = "\n".join([title, body_text, query, post.get("service", "") or ""])
            compounds, mechanisms = extract_terms(combined)
            image_urls = _post_image_urls(post)
            primary_image = image_urls[0] if image_urls else ""
            published = post.get("published") or post.get("added") or ""

            item = ResearchItem(
                source_type="kemono",
                theme=theme.slug,
                query=query,
                title=title or f"{post.get('service', '')}/{post.get('user', '')}",
                url=page_url,
                summary=summary,
                content=body_text[:6000],
                author=str(post.get("user", "") or ""),
                published_at=str(published),
                domain=urlparse(page_url).netloc,
                image_url=primary_image,
                score=score_item(theme, combined, compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata={
                    "engine": "kemono_api",
                    "service": post.get("service", ""),
                    "post_id": post.get("id", ""),
                },
            )
            items.append(item)
            images.extend(
                build_image_records("kemono_image", theme.slug, item.title, page_url, image_urls)
            )
    return items, images
