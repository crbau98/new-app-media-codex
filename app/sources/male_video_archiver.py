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
)

COOMER_HOSTS = ("coomer.su", "coomer.st")
COOMER_IMG_HOST = "https://img.coomer.st"
COOMER_VIDEO_HOST = "https://coomer.st"

KEMONO_HOSTS = ("kemono.su", "kemono.cr", "kemono.party")
KEMONO_IMG_HOST = "https://img.kemono.cr"
KEMONO_VIDEO_HOST = "https://kemono.cr"

# Extensions the /api/screenshots/cache-status SQL filter recognises as videos.
# Keep this set aligned with that query — other extensions would be orphaned
# rows that precache_coomer.py would never see.
VIDEO_EXTS = (".mp4", ".webm", ".mov")
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif")

# Hard-reject posts that mention female/straight content.
_FEMALE_KEYWORDS = {
    "female",
    "woman",
    "women",
    "girl",
    "girls",
    "lesbian",
    "straight",
    "pussy",
    "vagina",
    "vulva",
    "trans",
    "shemale",
    "ladyboy",
    "femboy",
    "hetero",
    "heterosexual",
    "couple",
    "bisex",
    "bisexual",
    "wife",
    "girlfriend",
    "bikini",
    "transgender",
}

# Boost posts that explicitly mention male/gay content.
_MALE_KEYWORDS = {
    "gay",
    "male",
    "man",
    "men",
    "twink",
    "bear",
    "daddy",
    "jock",
    "hunk",
    "muscle",
    "hairy",
    "otter",
    "wolf",
    "stud",
    "boy",
    "onlyfans male",
    "male nude",
    "male physique",
    "male model",
}

# Expanded queries per theme — more comprehensive than base coomer/kemono.
MALE_VIDEO_QUERIES = {
    "onlyfans_creators": [
        "gay onlyfans",
        "male onlyfans",
        "gay creator",
        "onlyfans gay male",
        "onlyfans muscle gay",
        "onlyfans twink",
        "onlyfans bear",
        "gay OF creator",
        "onlyfans daddy",
        "onlyfans jock",
        "onlyfans hung gay",
        "onlyfans amateur gay",
    ],
    "fansly_creators": [
        "gay fansly",
        "male fansly",
        "fansly gay creator",
        "fansly twink",
        "fansly bear",
        "fansly muscle gay",
        "fansly daddy",
        "fansly jock",
        "fansly hung gay",
        "fansly amateur gay",
    ],
    "reddit_gay": [
        "gay nude",
        "gay amateur",
        "gay porn",
        "gay male nsfw",
        "gay muscle nude",
        "gay twink nude",
        "gay bear nude",
        "gay jock nude",
        "gay hung",
        "gay cock",
        "gay dick",
    ],
    "x_gay_creators": [
        "gay twitter creator",
        "gay x creator",
        "gay male nude twitter",
        "gay onlyfans twitter",
        "gay muscle twitter",
        "gay twink twitter",
        "gay bear twitter",
        "gay jock twitter",
    ],
    "lpsg_threads": [
        "gay hung",
        "gay bareback",
        "male nude",
        "lpsg gay",
        "gay muscle lpsg",
        "gay cock",
        "gay dick",
        "lpsg hung",
        "lpsg bareback",
        "lpsg muscle",
    ],
    "twinks": [
        "twink",
        "gay twink",
        "young gay",
        "twink nude",
        "twink onlyfans",
        "gay twink amateur",
        "smooth twink",
        "twink boy",
        "twink young",
        "twink petite",
        "twink slim",
    ],
    "muscle_bears": [
        "gay muscle",
        "gay bear",
        "gay daddy",
        "muscle bear gay",
        "hairy bear gay",
        "gay bodybuilder",
        "muscle daddy gay",
        "gay jock muscle",
        "gay hunk",
        "gay muscle daddy",
    ],
    "fetish_kink": [
        "gay fetish",
        "gay bdsm",
        "gay leather",
        "gay kink",
        "gay bondage",
        "gay domination",
        "gay submissive",
        "gay slave",
        "gay master",
        "gay pup",
    ],
}


def _pick_coomer_host(session: requests.Session, settings: Settings) -> str:
    for host in COOMER_HOSTS:
        url = f"https://{host}/api/v1/creators.txt"
        try:
            response = session.get(url, timeout=settings.request_timeout_seconds)
            if response.status_code == 200:
                return host
        except requests.RequestException:
            continue
    return COOMER_HOSTS[0]


def _pick_kemono_host(session: requests.Session, settings: Settings) -> str:
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
    session: requests.Session,
    settings: Settings,
    host: str,
    query: str,
    limit: int,
    offset: int = 0,
) -> list[dict[str, Any]]:
    url = f"https://{host}/api/v1/posts?q={quote(query)}"
    if offset > 0:
        url += f"&o={offset}"
    response = session.get(url, timeout=settings.request_timeout_seconds)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        data = data.get("posts") or data.get("results") or []
    if not isinstance(data, list):
        return []
    return data[:limit]


def _search_posts_paginated(
    session: requests.Session,
    settings: Settings,
    host: str,
    query: str,
    limit: int,
    max_pages: int = 3,
) -> list[dict[str, Any]]:
    """Fetch posts across multiple pages, stopping on duplicates or empty pages."""
    all_posts: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    page_size = 50

    for page in range(max_pages):
        if len(all_posts) >= limit:
            break
        offset = page * page_size
        try:
            posts = _search_posts(session, settings, host, query, page_size, offset)
        except Exception:
            break
        if not posts:
            break

        page_ids = {str(p.get("id", "")) for p in posts}
        if page_ids.issubset(seen_ids):
            break  # Pagination not supported or exhausted
        seen_ids.update(page_ids)

        for post in posts:
            if len(all_posts) >= limit:
                break
            all_posts.append(post)

    return all_posts


def _is_male_content(text: str) -> bool:
    """Return True if text contains no female-oriented keywords."""
    lower = text.lower()
    return not any(kw in lower for kw in _FEMALE_KEYWORDS)


def _male_content_score(text: str) -> float:
    """Return a boost score based on presence of male keywords."""
    lower = text.lower()
    matches = sum(1 for kw in _MALE_KEYWORDS if kw in lower)
    return min(1.5, matches * 0.3)


def _classify_path(path: str) -> str:
    lowered = path.lower()
    if any(lowered.endswith(ext) for ext in VIDEO_EXTS):
        return "video"
    if any(lowered.endswith(ext) for ext in IMAGE_EXTS):
        return "image"
    return "other"


def _split_post_media(
    post: dict[str, Any], img_host: str, video_host: str
) -> tuple[list[str], list[dict[str, str]]]:
    """Return (image_urls, video_entries) extracted from a post."""
    image_urls: list[str] = []
    video_entries: list[dict[str, str]] = []
    attachments: list[dict[str, Any]] = []
    file_obj = post.get("file")
    if isinstance(file_obj, dict) and file_obj.get("path"):
        attachments.append(file_obj)
    for att in post.get("attachments") or []:
        if isinstance(att, dict) and att.get("path"):
            attachments.append(att)

    for att in attachments:
        path = str(att.get("path") or "")
        if not path:
            continue
        kind = _classify_path(path)
        filename = str(att.get("name") or path.rsplit("/", 1)[-1] or "")
        if kind == "video":
            video_entries.append(
                {
                    "source_url": f"{video_host}{path}",
                    "filename": filename,
                }
            )
        elif kind == "image":
            candidate = normalize_image_url(f"{img_host}{path}")
            if candidate and is_useful_image_url(candidate):
                image_urls.append(candidate)

    return dedupe_image_urls(image_urls), video_entries


def _post_path(post: dict[str, Any]) -> str:
    service = post.get("service") or ""
    user = post.get("user") or ""
    post_id = post.get("id") or ""
    if not (service and user and post_id):
        return ""
    return f"{service}/user/{user}/post/{post_id}"


def _post_page_url(host: str, post: dict[str, Any]) -> str:
    path = _post_path(post)
    if not path:
        return ""
    return f"https://{host}/{path}"


def _collect_from_platform(
    session: requests.Session,
    settings: Settings,
    theme: Theme,
    host: str,
    img_host: str,
    video_host: str,
    source_type: str,
    queries: list[str],
    per_query_limit: int,
    overall_limit: int,
    seen_paths: set[str],
    items: list[ResearchItem],
    images: list[ImageRecord],
) -> None:
    """Scrape one platform (Coomer or Kemono) for male video content."""

    for query in queries:
        if len(items) >= overall_limit:
            break
        try:
            posts = _search_posts_paginated(
                session, settings, host, query, per_query_limit, max_pages=3
            )
        except Exception:
            continue

        for post in posts:
            if len(items) >= overall_limit:
                break

            post_path = _post_path(post)
            if not post_path:
                continue
            if post_path in seen_paths:
                continue
            seen_paths.add(post_path)

            page_url = _post_page_url(host, post)
            if not page_url:
                continue
            page_url = canonicalize_url(page_url)

            title = clean_text(post.get("title", "") or "")
            body_text = clean_text(
                post.get("content", "") or post.get("substring", "") or ""
            )
            combined_text = f"{title} {body_text}"

            # Hard-reject female-oriented content.
            if not _is_male_content(combined_text):
                continue

            summary = body_text[:320] or title or "No summary available."
            combined = "\n".join(
                [title, body_text, query, post.get("service", "") or ""]
            )
            compounds, mechanisms = extract_terms(combined)

            image_urls, video_entries = _split_post_media(post, img_host, video_host)
            primary_image = image_urls[0] if image_urls else ""
            published = post.get("published") or post.get("added") or ""

            # Boost score for explicit male keywords and video content.
            score = score_item(theme, combined, compounds, mechanisms)
            score += _male_content_score(combined)
            if video_entries:
                score += 1.5

            item = ResearchItem(
                source_type=source_type,
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
                score=round(score, 2),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata={
                    "engine": f"{source_type}_api",
                    "service": post.get("service", ""),
                    "post_id": post.get("id", ""),
                    "videos": video_entries,
                    "has_videos": bool(video_entries),
                    "creator_id": post.get("user", ""),
                },
            )
            items.append(item)
            images.extend(
                build_image_records(
                    f"{source_type}_image", theme.slug, item.title, page_url, image_urls
                )
            )


def collect_male_video_archiver(
    session: requests.Session, settings: Settings, theme: Theme
) -> tuple[list[ResearchItem], list[ImageRecord]]:
    """Deep-scrape Coomer and Kemono for male creator videos.

    Features:
    - Paginated search (up to 3 pages per query)
    - Cross-platform URL deduplication
    - Female-content filtering
    - Video-post score boosting
    - Expanded per-theme query lists
    """
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []

    queries = MALE_VIDEO_QUERIES.get(theme.slug) or [theme.label]
    overall_limit = max(1, settings.male_video_archiver_results)
    # Allocate per-query budget generously so pagination has room to find videos.
    per_query = max(1, overall_limit // max(1, len(queries))) * 3

    # Shared dedup set across both platforms (post path without host).
    seen_paths: set[str] = set()

    coomer_host = _pick_coomer_host(session, settings)
    _collect_from_platform(
        session,
        settings,
        theme,
        coomer_host,
        COOMER_IMG_HOST,
        COOMER_VIDEO_HOST,
        "coomer",
        queries,
        per_query,
        overall_limit,
        seen_paths,
        items,
        images,
    )

    # Kemono — dedupes against Coomer post paths already in seen_paths.
    kemono_host = _pick_kemono_host(session, settings)
    _collect_from_platform(
        session,
        settings,
        theme,
        kemono_host,
        KEMONO_IMG_HOST,
        KEMONO_VIDEO_HOST,
        "kemono",
        queries,
        per_query,
        overall_limit,
        seen_paths,
        items,
        images,
    )

    return items, images
