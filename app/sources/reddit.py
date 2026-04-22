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
    "onlyfans_creators": [
        "gay onlyfans creator nude reddit site:reddit.com",
        "gay onlyfans male leaked nude reddit r/GayNSFW",
        "gay onlyfans performer reddit nude cock",
        "gay male onlyfans content reddit nude amateur",
    ],
    "fansly_creators": [
        "gay fansly creator nude reddit site:reddit.com",
        "gay fansly male reddit nude cock",
        "gay fansly performer reddit nude amateur",
        "gay fansly content reddit nude explicit",
    ],
    "reddit_gay": [
        "gay porn nude reddit r/gayporn cock",
        "gay nude male reddit r/GayNSFW cock",
        "gay twink nude reddit r/gaytwink cock",
        "gay muscle nude reddit r/gaymuscle cock",
        "gay bear nude reddit r/gaybear cock",
        "gay amateur nude reddit cock bareback",
    ],
    "x_gay_creators": [
        "gay creator onlyfans twitter.com nude cock",
        "gay nude x.com creator explicit",
        "gay male nude twitter creator",
        "gay content creator x.com nude",
    ],
    "lpsg_threads": [
        "lpsg gay nude male cock reddit",
        "gay nude cock hung reddit lpsg site:reddit.com",
    ],
    "twinks": [
        "gay twink nude reddit cock cum",
        "twink gay onlyfans reddit nude",
        "gay young twink reddit nude cock amateur",
        "twink cum gay reddit site:reddit.com",
    ],
    "muscle_bears": [
        "gay muscle nude reddit cock daddy",
        "gay bear hairy nude reddit cock",
        "gay daddy muscle reddit nude cock amateur",
        "bear gay hairy nude reddit bareback",
    ],
    "fetish_kink": [
        "gay fetish bdsm nude reddit cock leather",
        "gay bareback nude reddit cock cum",
        "gay bondage nude reddit leather cock",
        "gay kink nude reddit cock anal bareback",
    ],
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


def extract_reddit_post_video_urls(post: dict[str, Any]) -> list[dict[str, str]]:
    """Extract Reddit-hosted video URLs from a post's media metadata.

    Returns a list of dicts shaped like:
        [{"source_url": "https://v.redd.it/.../DASH_720.mp4", "page_url": permalink}]
    """
    videos: list[dict[str, str]] = []
    if not post.get("is_video"):
        return videos

    permalink = post.get("permalink") or ""
    page_url = f"https://www.reddit.com{permalink}" if permalink.startswith("/") else permalink

    # Reddit stores video info in media → reddit_video
    for media_key in ("secure_media", "media"):
        media = post.get(media_key) or {}
        rv = media.get("reddit_video") if isinstance(media, dict) else None
        if not rv:
            continue
        fallback = rv.get("fallback_url")
        hls = rv.get("hls_url")
        # Prefer direct MP4 fallback, fall back to HLS
        url = fallback or hls
        if url:
            videos.append({"source_url": url, "page_url": page_url})
            break  # secure_media and media are duplicates; stop after first hit

    # Some posts link to external video hosts (e.g. redgifs) via url_overridden_by_dest
    direct = post.get("url_overridden_by_dest", "")
    if direct and ".redd.it" not in direct and "/comments/" not in direct:
        # External video link — keep it so yt-dlp can resolve on playback
        if direct not in {v["source_url"] for v in videos}:
            videos.append({"source_url": direct, "page_url": page_url})

    return videos


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
    video_urls = extract_reddit_post_video_urls(post)
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
        "video_urls": video_urls,
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
            metadata = dict(scraped["metadata"])
            metadata["videos"] = scraped.get("video_urls", [])
            metadata["has_videos"] = bool(scraped.get("video_urls"))
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
                metadata=metadata,
            )
            items.append(item)
            images.extend(build_image_records("reddit_image", theme.slug, item.title, url, scraped.get("image_urls", [])))
            if len(items) >= settings.reddit_results:
                return items, images
    return items, images
