from __future__ import annotations

import re
from typing import Any

import requests
from bs4 import BeautifulSoup

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import (
    build_image_records,
    clean_text,
    dedupe_image_urls,
    extract_image_candidates,
    extract_terms,
    is_useful_image_url,
    normalize_image_url,
    normalize_x_url,
    score_item,
    search_web,
)

X_QUERIES = {
    "onlyfans_creators": [
        "gay onlyfans creator nude x.com cock",
        "gay onlyfans male nude twitter explicit",
        "onlyfans link gay male nude x.com cock",
        "gay creator onlyfans x.com nude explicit",
    ],
    "fansly_creators": [
        "gay fansly creator nude x.com cock",
        "gay fansly male nude twitter explicit",
        "fansly gay male x.com nude explicit",
        "gay fansly content creator x.com nude",
    ],
    "reddit_gay": [
        "gay nude male x.com cock explicit",
        "gay porn x.com twitter nude cock",
        "gay amateur nude twitter cock cum",
        "gay bareback nude x.com cock",
    ],
    "x_gay_creators": [
        "gay nude creator x.com cock explicit",
        "gay male nude twitter explicit cock",
        "gay explicit x.com creator nude",
        "gay nude onlyfans twitter.com cock cum",
    ],
    "lpsg_threads": [
        "lpsg gay nude x.com cock hung",
        "gay hung cock nude twitter lpsg",
    ],
    "twinks": [
        "twink gay nude x.com cock cum",
        "gay twink nude twitter cock explicit",
        "twink cum gay x.com nude",
        "twink naked gay x.com cock explicit",
    ],
    "muscle_bears": [
        "muscle gay nude x.com cock daddy",
        "bear gay hairy nude twitter cock",
        "gay daddy nude x.com cock muscle",
        "hairy bear gay nude x.com cock",
    ],
    "fetish_kink": [
        "gay leather bdsm nude x.com cock",
        "gay bondage nude twitter cock explicit",
        "gay bareback x.com cock cum nude",
        "gay bondage nude x.com cock leather",
    ],
}


def scrape_x_post(session: requests.Session, settings: Settings, url: str) -> dict[str, Any]:
    response = session.get(url, timeout=settings.request_timeout_seconds)
    response.raise_for_status()
    html_text = response.text
    soup = BeautifulSoup(html_text, "html.parser")
    title = ""
    description = ""
    for attrs in (
        {"property": "og:title"},
        {"name": "twitter:title"},
    ):
        node = soup.find("meta", attrs=attrs)
        if node and node.get("content"):
            title = clean_text(node["content"])
            if title:
                break
    for attrs in (
        {"property": "og:description"},
        {"name": "twitter:description"},
        {"name": "description"},
    ):
        node = soup.find("meta", attrs=attrs)
        if node and node.get("content"):
            description = clean_text(node["content"])
            if description:
                break
    image_urls = extract_image_candidates(html_text, url, selectors=("img",), limit=6)
    author = ""
    match = re.search(r"x\.com/([^/]+)/status/", url)
    if match:
        author = match.group(1)
    fallback_title = f"Post by @{author}" if author else "X post"
    return {
        "title": title or fallback_title,
        "summary": description[:400],
        "content": description[:6000],
        "author": author,
        "published_at": "",
        "domain": "x.com",
        "image_url": image_urls[0] if image_urls else "",
        "image_urls": image_urls,
        "metadata": {"mode": "public_html"},
    }


def search_x_api(session: requests.Session, settings: Settings, query: str, max_results: int | None = None) -> list[dict[str, Any]]:
    if not settings.x_bearer_token:
        return []
    response = session.get(
        "https://api.x.com/2/tweets/search/recent",
        params={
            "query": query,
            "max_results": max(10, min(max_results or settings.x_results, 100)),
            "expansions": "author_id,attachments.media_keys",
            "tweet.fields": "created_at,text,author_id",
            "user.fields": "username,name",
            "media.fields": "preview_image_url,url",
        },
        headers={"Authorization": f"Bearer {settings.x_bearer_token}", "User-Agent": settings.user_agent},
        timeout=settings.request_timeout_seconds,
    )
    response.raise_for_status()
    payload = response.json()
    users = {user["id"]: user for user in payload.get("includes", {}).get("users", [])}
    media = {asset["media_key"]: asset for asset in payload.get("includes", {}).get("media", [])}
    records: list[dict[str, Any]] = []
    for tweet in payload.get("data", []):
        user = users.get(tweet.get("author_id", ""), {})
        media_keys = tweet.get("attachments", {}).get("media_keys", [])
        image_urls: list[str] = []
        for key in media_keys:
            asset = media.get(key, {})
            candidate = normalize_image_url(asset.get("url") or asset.get("preview_image_url") or "")
            if is_useful_image_url(candidate):
                image_urls.append(candidate)
        username = user.get("username", "")
        page_url = f"https://x.com/{username}/status/{tweet['id']}" if username else f"https://x.com/i/web/status/{tweet['id']}"
        records.append(
            {
                "title": f"Post by @{username}" if username else "X post",
                "summary": clean_text(tweet.get("text", "")[:400]),
                "content": clean_text(tweet.get("text", "")[:6000]),
                "author": username,
                "published_at": tweet.get("created_at", ""),
                "domain": "x.com",
                "image_url": image_urls[0] if image_urls else "",
                "image_urls": dedupe_image_urls(image_urls),
                "url": page_url,
                "metadata": {"mode": "api"},
            }
        )
    return records


def collect_x(session: requests.Session, settings: Settings, theme: Theme) -> tuple[list[ResearchItem], list[ImageRecord]]:
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()
    for query in X_QUERIES.get(theme.slug, []):
        api_records = []
        try:
            api_records = search_x_api(session, settings, query)
        except Exception:
            api_records = []
        for record in api_records:
            if record["url"] in seen_urls:
                continue
            seen_urls.add(record["url"])
            combined = "\n".join([record["title"], record["summary"], record["content"]])
            compounds, mechanisms = extract_terms(combined)
            item = ResearchItem(
                source_type="x",
                theme=theme.slug,
                query=query,
                title=record["title"],
                url=record["url"],
                summary=record["summary"] or "No summary available.",
                content=record["content"],
                author=record["author"],
                published_at=record["published_at"],
                domain=record["domain"],
                image_url=record["image_url"],
                score=score_item(theme, combined, compounds, mechanisms),
                compounds=compounds,
                mechanisms=mechanisms,
                metadata=record["metadata"],
            )
            items.append(item)
            images.extend(build_image_records("x_image", theme.slug, item.title, item.url, record.get("image_urls", [])))
        if items:
            continue

        results = search_web(session, settings, query, settings.x_results * 3)
        for row in results:
            url = normalize_x_url(row.get("href", ""))
            if not any(domain in url for domain in ("x.com/", "twitter.com/")):
                continue
            if "/status/" not in url or url in seen_urls:
                continue
            seen_urls.add(url)
            try:
                scraped = scrape_x_post(session, settings, url)
            except Exception:
                continue
            combined = "\n".join([scraped["title"], scraped["summary"], scraped["content"]])
            compounds, mechanisms = extract_terms(combined)
            item = ResearchItem(
                source_type="x",
                theme=theme.slug,
                query=query,
                title=scraped["title"],
                url=url,
                summary=scraped["summary"] or clean_text(row.get("body", "")) or "No summary available.",
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
            images.extend(build_image_records("x_image", theme.slug, item.title, url, scraped.get("image_urls", [])))
            if len(items) >= settings.x_results:
                return items, images
    return items, images
