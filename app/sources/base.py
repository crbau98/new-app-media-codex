from __future__ import annotations

import hashlib
import html
import mimetypes
import re
import tempfile
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urljoin, urlparse

import imagehash
import requests
import trafilatura
from bs4 import BeautifulSoup
from PIL import Image

from app.config import Settings, Theme
from app.models import ImageRecord, ResearchItem

IMAGE_EXCLUDE_MARKERS = (
    "avatar",
    "communityicon",
    "emoji",
    "icon",
    "logo",
    "profile_images",
    "sprite",
    # stock image sites — return watermarked/licensed images, not real content
    "shutterstock.com",
    "istockphoto.com",
    "gettyimages.com",
    "alamy.com",
    "dreamstime.com",
    "depositphotos.com",
    "stock.adobe.com",
    "123rf.com",
    "vectorstock.com",
    "freepik.com",
    "canstockphoto.com",
    "bigstockphoto.com",
)


MECHANISM_TERMS = {
    "dopamine": "dopaminergic tone",
    "dopaminergic": "dopaminergic tone",
    "melanocortin": "melanocortin signaling",
    "kisspeptin": "kisspeptin axis",
    "oxytocin": "oxytocin signaling",
    "serotonin": "serotonergic tone",
    "ssri": "serotonergic tone",
    "nitric oxide": "nitric oxide signaling",
    "endothelial": "endothelial function",
    "prolactin": "prolactin modulation",
    "neurosteroid": "neurosteroid signaling",
    "androgen": "androgen signaling",
    "testosterone": "androgen signaling",
    "pde5": "PDE5 signaling",
    "acetylcholine": "cholinergic signaling",
    "glutamate": "glutamatergic tone",
    "gaba": "GABAergic tone",
}

COMPOUND_TERMS = {
    "bremelanotide",
    "pt-141",
    "kisspeptin",
    "cabergoline",
    "apomorphine",
    "tadalafil",
    "sildenafil",
    "vardenafil",
    "avanafil",
    "oxytocin",
    "buspirone",
    "bupropion",
    "vortioxetine",
    "cyproheptadine",
    "allopregnanolone",
    "flibanserin",
    "semax",
    "selank",
    "melanotan",
    "melanotan ii",
    "pramipexole",
    "piribedil",
    "selegiline",
    "yohimbine",
    "L-citrulline",
    "L-arginine",
}

ABBREVIATION_PATTERN = re.compile(r"\b[A-Z]{2,6}(?:-\d{1,3})?\b")
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
WHITESPACE_PATTERN = re.compile(r"\s+")
BLOCKED_TOKENS = {
    "AND",
    "ARE",
    "BUT",
    "CI",
    "CSFQ",
    "DOI",
    "ED",
    "FAQ",
    "FDA",
    "FOR",
    "FSFI",
    "GRADE",
    "HT",
    "IELT",
    "II",
    "IIEF",
    "LILACS",
    "MED",
    "MORE",
    "NO",
    "NOT",
    "NOS",
    "OR",
    "PE",
    "PEDT",
    "PPR",
    "PSSD",
    "RCT",
    "RR",
    "SD",
    "SNRI",
    "SRI",
    "SSRI",
    "TCM",
    "THE",
    "TRT",
    "VED",
    "VERY",
    "WAY",
    "WITH",
}


def build_session(settings: Settings) -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": settings.user_agent})
    return session


def clean_text(value: str) -> str:
    without_tags = HTML_TAG_PATTERN.sub(" ", value or "")
    return WHITESPACE_PATTERN.sub(" ", html.unescape(without_tags)).strip()


def to_iso8601(timestamp: float | int | None) -> str:
    if not timestamp:
        return ""
    return datetime.fromtimestamp(float(timestamp), tz=timezone.utc).isoformat()


def canonicalize_url(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme:
        return url
    clean_path = parsed.path.rstrip("/") or "/"
    return parsed._replace(query="", fragment="", path=clean_path).geturl()


def normalize_reddit_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    if "redditmedia.com" in parsed.netloc and path.startswith("/r/"):
        return f"https://www.reddit.com{path}"
    if "reddit.com" in parsed.netloc and "/comments/" in path:
        return f"https://www.reddit.com{path}"
    return canonicalize_url(url)


def normalize_x_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.netloc in {"twitter.com", "www.twitter.com"}:
        return f"https://x.com{parsed.path.rstrip('/')}"
    if parsed.netloc in {"x.com", "www.x.com"}:
        return f"https://x.com{parsed.path.rstrip('/')}"
    return canonicalize_url(url)


def normalize_image_url(url: str, page_url: str = "") -> str:
    if not url:
        return ""
    normalized = html.unescape(url.strip())
    if normalized.startswith("data:"):
        return ""
    normalized = urljoin(page_url, normalized) if page_url else normalized
    parsed = urlparse(normalized)
    has_image_path = bool(re.search(r"\.(avif|gif|jpe?g|png|svg|webp)$", parsed.path.lower()))
    strip_query_hosts = {"i.redd.it", "preview.redd.it", "pbs.twimg.com", "upload.wikimedia.org", "live.staticflickr.com"}
    if parsed.query and (has_image_path or parsed.netloc.lower() in strip_query_hosts):
        normalized = parsed._replace(query="", fragment="").geturl()
    return normalized


def is_useful_image_url(url: str) -> bool:
    normalized = url.lower()
    if not normalized.startswith(("http://", "https://")):
        return False
    return not any(marker in normalized for marker in IMAGE_EXCLUDE_MARKERS)


def dedupe_image_urls(urls: list[str], limit: int = 8) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for url in urls:
        normalized = normalize_image_url(url)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        results.append(normalized)
        if len(results) >= limit:
            break
    return results


def is_direct_image_asset(url: str) -> bool:
    parsed = urlparse(url)
    path = parsed.path.lower()
    if re.search(r"\.(avif|gif|jpe?g|png|svg|webp)$", path):
        return True
    return parsed.netloc.lower() in {
        "i.redd.it",
        "preview.redd.it",
        "i.imgur.com",
        "upload.wikimedia.org",
        "live.staticflickr.com",
        "pbs.twimg.com",
    }


def extract_terms(text: str) -> tuple[list[str], list[str]]:
    clean = clean_text(text)
    normalized = clean.lower()
    compounds = set()
    mechanisms = set()
    for term in COMPOUND_TERMS:
        if term.lower() in normalized:
            compounds.add(term)
    for raw, label in MECHANISM_TERMS.items():
        if raw in normalized:
            mechanisms.add(label)
    for token in ABBREVIATION_PATTERN.findall(clean):
        if token in BLOCKED_TOKENS:
            continue
        if len(token) <= 2 and "-" not in token:
            continue
        compounds.add(token)
    return sorted(compounds), sorted(mechanisms)


def extract_signals(text: str) -> tuple[list[str], list[str]]:
    lower = text.lower()
    compounds = sorted({term for term in COMPOUND_TERMS if term.lower() in lower})
    mechanisms = sorted({label for raw, label in MECHANISM_TERMS.items() if raw in lower})
    return compounds, mechanisms


def score_item(theme: Theme, text: str, compounds: list[str], mechanisms: list[str]) -> float:
    score = 1.0
    score += min(3.0, len(compounds) * 0.35)
    score += min(2.0, len(mechanisms) * 0.45)
    if theme.slug in text.lower():
        score += 0.5
    if "review" in text.lower() or "meta-analysis" in text.lower():
        score += 0.4
    return round(score, 2)


def extract_primary_image(html: str, page_url: str) -> str:
    candidates = extract_image_candidates(html, page_url)
    return candidates[0] if candidates else ""


def extract_image_candidates(html: str, page_url: str, selectors: tuple[str, ...] | None = None, limit: int = 8) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    candidates: list[str] = []
    for attrs in (
        {"property": "og:image"},
        {"name": "twitter:image"},
        {"property": "og:image:url"},
        {"name": "twitter:image:src"},
    ):
        node = soup.find("meta", attrs=attrs)
        if node and node.get("content"):
            url = normalize_image_url(node["content"], page_url)
            if is_useful_image_url(url):
                candidates.append(url)

    image_selectors = selectors or ("article img", "main img", "img")
    for image in soup.select(", ".join(image_selectors)):
        source = image.get("src") or image.get("data-src") or image.get("data-original")
        if not source:
            continue
        source = normalize_image_url(source, page_url)
        if not is_useful_image_url(source):
            continue
        candidates.append(source)
    return dedupe_image_urls(candidates, limit=limit)


def scrape_page(session: requests.Session, url: str, timeout: int) -> tuple[str, str]:
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    html = response.text
    extracted = trafilatura.extract(html, include_comments=False, include_images=False) or ""
    image_url = extract_primary_image(html, url)
    if not extracted or len(extracted) < 180:
        soup = BeautifulSoup(html, "html.parser")
        paragraphs = " ".join(node.get_text(" ", strip=True) for node in soup.select("p")[:8])
        extracted = extracted or paragraphs
    return clean_text(extracted), image_url


def scrape_page_meta(session: requests.Session, url: str, timeout: int) -> dict[str, str]:
    response = session.get(url, timeout=timeout)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    title = clean_text((soup.title.get_text(" ", strip=True) if soup.title else "") or "")
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
    image_url = extract_primary_image(response.text, url)
    return {"title": title, "description": description, "image_url": image_url}


def build_image_records(source_type: str, theme: str, title: str, page_url: str, image_urls: list[str]) -> list[ImageRecord]:
    records: list[ImageRecord] = []
    for image_url in dedupe_image_urls(image_urls):
        records.append(
            ImageRecord(
                source_type=source_type,
                theme=theme,
                title=title,
                image_url=image_url,
                page_url=page_url,
                thumb_url=image_url,
            )
        )
    return records


def cache_image(session: requests.Session, settings: Settings, image_url: str) -> tuple[str, str]:
    """Download image, deduplicate via perceptual hash, generate thumbnail.

    Returns (thumb_path, orig_path) as absolute path strings.
    Returns ("", "") on any error or when image downloads are disabled.
    """
    if not settings.enable_image_downloads or not image_url:
        return ("", "")
    try:
        settings.image_dir.mkdir(parents=True, exist_ok=True)
        # Download to a temporary file so we can open it with Pillow.
        with tempfile.NamedTemporaryFile(delete=False, suffix=".tmp", dir=settings.image_dir) as tmp_file:
            tmp_path = Path(tmp_file.name)
        try:
            response = session.get(image_url, timeout=settings.request_timeout_seconds)
            response.raise_for_status()
            tmp_path.write_bytes(response.content)

            with Image.open(tmp_path) as img:
                img.load()
                hash_val = imagehash.average_hash(img)
                hash_hex = str(hash_val)

            thumb_dest = settings.image_dir / f"{hash_hex}.jpg"
            orig_dest = settings.image_dir / f"{hash_hex}_orig.jpg"

            if thumb_dest.exists():
                # Duplicate detected — return existing paths.
                tmp_path.unlink(missing_ok=True)
                return (str(thumb_dest), str(orig_dest) if orig_dest.exists() else "")

            # Save the full-size original, converting to RGB for JPEG.
            with Image.open(tmp_path) as raw_img:
                raw_img.load()
                img = raw_img.convert("RGB") if raw_img.mode not in ("RGB", "L") else raw_img
                try:
                    img.save(orig_dest, format="JPEG", quality=95, optimize=True)

                    # Generate thumbnail (max 400×400, preserving aspect ratio).
                    thumb = img.copy()
                    thumb.thumbnail((400, 400), Image.LANCZOS)
                    thumb.save(thumb_dest, format="JPEG", quality=85, optimize=True)
                finally:
                    if img is not raw_img:
                        img.close()

        finally:
            tmp_path.unlink(missing_ok=True)

        return (str(thumb_dest), str(orig_dest))
    except Exception:
        return ("", "")


def search_web(session: requests.Session, settings: Settings, query: str, limit: int) -> list[dict[str, str]]:
    last_error: Exception | None = None
    for attempt in range(2):
        if attempt:
            time.sleep(1.0)
        else:
            time.sleep(0.35)
        try:
            response = session.post(
                "https://html.duckduckgo.com/html/",
                data={"q": query},
                timeout=settings.request_timeout_seconds,
            )
            response.raise_for_status()
            break
        except requests.RequestException as exc:
            last_error = exc
    else:
        if last_error:
            raise last_error
        return []
    soup = BeautifulSoup(response.text, "html.parser")
    results: list[dict[str, str]] = []
    for result in soup.select(".result"):
        link = result.select_one(".result__a")
        snippet = result.select_one(".result__snippet")
        if not link:
            continue
        href = (link.get("href") or "").strip()
        if not href:
            continue
        results.append(
            {
                "title": link.get_text(" ", strip=True),
                "href": href,
                "body": snippet.get_text(" ", strip=True) if snippet else "",
            }
        )
        if len(results) >= limit:
            break
    return results


def summarize_topic_signals(items: list[dict[str, Any]]) -> dict[str, Any]:
    by_theme = Counter(item["theme"] for item in items)
    by_source = Counter(item["source_type"] for item in items)
    compounds = Counter()
    mechanisms = Counter()
    for item in items:
        compounds.update(item.get("compounds", []))
        mechanisms.update(item.get("mechanisms", []))
    return {
        "themes": by_theme.most_common(),
        "sources": by_source.most_common(),
        "compounds": compounds.most_common(15),
        "mechanisms": mechanisms.most_common(15),
    }
