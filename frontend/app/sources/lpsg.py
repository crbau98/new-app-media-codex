from __future__ import annotations

from urllib.parse import urlparse

import requests
import trafilatura
from bs4 import BeautifulSoup

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem
from app.sources.base import (
    build_image_records,
    canonicalize_url,
    clean_text,
    extract_image_candidates,
    extract_primary_image,
    extract_terms,
    score_item,
)

LPSG_QUERIES = {
    "onlyfans_creators": ["onlyfans", "gay-onlyfans", "gay-creator"],
    "fansly_creators": ["fansly", "gay-fansly", "gay-creator"],
    "reddit_gay": ["gay", "amateur-gay"],
    "x_gay_creators": ["twitter", "x-com", "gay-creator"],
    "lpsg_threads": ["cock", "dick", "cum", "bareback", "anal", "nude", "hung"],
    "twinks": ["twink", "young-gay", "gay-twink"],
    "muscle_bears": ["muscle", "bear", "hairy", "daddy", "gay-muscle"],
    "fetish_kink": ["fetish", "leather", "bdsm", "bondage", "gay-kink", "bareback"],
}


def discover_lpsg_urls(session: requests.Session, settings: Settings, theme: Theme, limit: int) -> list[tuple[str, str]]:
    index = session.get("https://www.lpsg.com/sitemap.php", timeout=settings.request_timeout_seconds)
    index.raise_for_status()
    xml = BeautifulSoup(index.text, "xml")
    sitemap_urls = [node.get_text(strip=True) for node in xml.find_all("loc")[:5]]
    keywords = [keyword.lower() for keyword in LPSG_QUERIES.get(theme.slug, [])]
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for sitemap_url in sitemap_urls:
        response = session.get(sitemap_url, timeout=settings.request_timeout_seconds)
        response.raise_for_status()
        site_xml = BeautifulSoup(response.text, "xml")
        for node in site_xml.find_all("loc"):
            url = node.get_text(strip=True)
            if "/threads/" not in url:
                continue
            slug = urlparse(url).path.lower()
            query = next((keyword for keyword in keywords if keyword in slug), "")
            if not query or url in seen:
                continue
            seen.add(url)
            found.append((query, url))
            if len(found) >= limit:
                return found
    return found


def collect_lpsg(session: requests.Session, settings: Settings, theme: Theme) -> tuple[list[ResearchItem], list[ImageRecord]]:
    items: list[ResearchItem] = []
    images: list[ImageRecord] = []
    seen_urls: set[str] = set()
    urls = discover_lpsg_urls(session, settings, theme, settings.lpsg_results * 3)
    for query, url in urls:
        url = canonicalize_url(url)
        if url in seen_urls:
            continue
        seen_urls.add(url)
        try:
            response = session.get(url, timeout=settings.request_timeout_seconds)
            response.raise_for_status()
            html_text = response.text
            extracted = trafilatura.extract(html_text, include_comments=False, include_images=False) or ""
            if not extracted or len(extracted) < 180:
                soup_fallback = BeautifulSoup(html_text, "html.parser")
                paragraphs = " ".join(node.get_text(" ", strip=True) for node in soup_fallback.select("p")[:8])
                extracted = extracted or paragraphs
            page_text = clean_text(extracted)
            page_image = extract_primary_image(html_text, url)
            soup = BeautifulSoup(html_text, "html.parser")
            raw_title = clean_text((soup.title.get_text(" ", strip=True) if soup.title else "") or "")
            description = ""
            for attrs in (
                {"property": "og:description"},
                {"name": "description"},
                {"name": "twitter:description"},
            ):
                node = soup.find("meta", attrs=attrs)
                if node and node.get("content"):
                    description = clean_text(node["content"])
                    if description:
                        break
            meta = {"title": raw_title, "description": description, "image_url": page_image}
            thread_images = extract_image_candidates(
                html_text,
                url,
                selectors=("img.bbImage", "img.js-lbImage", ".bbWrapper img", "figure img"),
                limit=8,
            )
        except Exception:
            continue
        slug_title = clean_text(urlparse(url).path.split("/")[-1].replace("-", " "))
        title = meta.get("title") if meta.get("title") not in {"", "LPSG"} else slug_title.title()
        summary = meta.get("description") or page_text[:320] or "No summary available."
        combined = "\n".join([title, summary, page_text])
        compounds, mechanisms = extract_terms(combined)
        item = ResearchItem(
            source_type="lpsg",
            theme=theme.slug,
            query=query,
            title=title,
            url=url,
            summary=summary,
            content=page_text[:6000],
            author="",
            published_at="",
            domain="lpsg.com",
            image_url=page_image or meta.get("image_url", ""),
            score=score_item(theme, combined, compounds, mechanisms),
            compounds=compounds,
            mechanisms=mechanisms,
            metadata={"engine": "sitemap"},
        )
        items.append(item)
        image_urls = thread_images or ([item.image_url] if item.image_url else [])
        images.extend(build_image_records("lpsg_image", theme.slug, item.title, url, image_urls))
        if len(items) >= settings.lpsg_results:
            return items, images
    return items, images
