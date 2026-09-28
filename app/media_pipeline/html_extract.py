"""Extract publicly declared media from an HTML document.

Sources, in priority order: OpenGraph / Twitter player tags, JSON-LD
(VideoObject / ImageObject), <video>/<source> elements, oEmbed discovery
links. Only what the page itself declares is returned; nothing is guessed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from app.media_pipeline.manifests import parse_iso_duration


@dataclass
class RawCandidate:
    url: str
    kind: str  # video | image | hls | dash
    origin: str
    mime: str | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None


@dataclass
class HtmlMeta:
    title: str | None = None
    description: str | None = None
    site_name: str | None = None
    author: str | None = None
    canonical_url: str | None = None
    published_at: str | None = None
    duration_seconds: float | None = None
    candidates: list[RawCandidate] = field(default_factory=list)
    oembed_urls: list[str] = field(default_factory=list)
    feed_urls: list[str] = field(default_factory=list)
    embed_urls: list[str] = field(default_factory=list)
    generator: str | None = None
    peertube: bool = False
    robots_noindex: bool = False


def _int(value) -> int | None:
    try:
        n = int(float(str(value).strip()))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _kind_for(url: str, mime: str | None) -> str:
    low = (url or "").lower().split("?", 1)[0]
    m = (mime or "").lower()
    if low.endswith(".m3u8") or "mpegurl" in m:
        return "hls"
    if low.endswith(".mpd") or "dash+xml" in m:
        return "dash"
    if m.startswith("image/") or low.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif")):
        return "image"
    return "video"


def _abs(base: str, value: str | None) -> str | None:
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    if not value or value.startswith(("data:", "blob:", "javascript:")):
        return None
    try:
        joined = urljoin(base, value)
    except ValueError:
        return None
    return joined if joined.startswith(("http://", "https://")) else None


def _walk_jsonld(node, out: list[dict]):
    if isinstance(node, list):
        for child in node:
            _walk_jsonld(child, out)
    elif isinstance(node, dict):
        out.append(node)
        for key in ("@graph", "mainEntity", "mainEntityOfPage", "video", "image", "hasPart", "itemListElement"):
            if key in node:
                _walk_jsonld(node[key], out)


def _first_str(value) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for v in value:
            got = _first_str(v)
            if got:
                return got
    if isinstance(value, dict):
        return _first_str(value.get("url") or value.get("contentUrl"))
    return None


def extract_html(html: str, page_url: str) -> HtmlMeta:
    soup = BeautifulSoup(html, "lxml")
    meta = HtmlMeta()
    base_tag = soup.find("base", href=True)
    base = _abs(page_url, base_tag["href"]) if base_tag else page_url
    base = base or page_url

    def prop(*names: str) -> list[str]:
        found: list[str] = []
        lowered = {n.lower() for n in names}
        for tag in soup.find_all("meta"):
            key = (tag.get("property") or tag.get("name") or "").strip().lower()
            content = tag.get("content")
            if key in lowered and content:
                found.append(content.strip())
        return found

    def first(*names: str) -> str | None:
        got = prop(*names)
        return got[0] if got else None

    meta.title = first("og:title", "twitter:title") or (soup.title.string.strip() if soup.title and soup.title.string else None)
    meta.description = first("og:description", "twitter:description", "description")
    meta.site_name = first("og:site_name", "application-name")
    meta.author = first("author", "article:author", "og:video:director")
    meta.published_at = first("article:published_time", "og:video:release_date", "og:updated_time")
    meta.generator = first("generator")
    robots = (first("robots") or "").lower()
    meta.robots_noindex = "noindex" in robots
    link_canonical = soup.find("link", rel=lambda v: v and "canonical" in (v if isinstance(v, list) else [v]))
    meta.canonical_url = _abs(base, link_canonical.get("href")) if link_canonical else _abs(base, first("og:url"))
    og_type = (first("og:type") or "").lower()
    meta.peertube = "peertube" in (meta.generator or "").lower() or (first("og:platform") or "").lower() == "peertube"

    duration = first("video:duration", "og:video:duration")
    if duration and _int(duration):
        meta.duration_seconds = float(_int(duration))  # type: ignore[arg-type]

    # OpenGraph / Twitter video
    og_w = _int(first("og:video:width", "twitter:player:width"))
    og_h = _int(first("og:video:height", "twitter:player:height"))
    og_type_mime = first("og:video:type")
    for index, content in enumerate(prop("og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream")):
        url = _abs(base, content)
        if not url:
            continue
        kind = _kind_for(url, og_type_mime)
        # og:video frequently points at an HTML embed player; keep it as an
        # embed URL unless it looks like media (extension/manifest, or the
        # declared og:video:type applies to the first, non-embed-looking URL).
        mime = og_type_mime
        path = url.lower().split("?", 1)[0]
        looks_media = (
            kind in {"hls", "dash"}
            or path.endswith((".mp4", ".webm", ".m4v", ".mov", ".m3u8", ".mpd"))
            or ((mime or "").startswith("video/") and index == 0 and "/embed" not in path)
        )
        if looks_media:
            meta.candidates.append(
                RawCandidate(url, kind, "og:video", mime=mime, width=og_w, height=og_h, duration_seconds=meta.duration_seconds)
            )
        else:
            meta.embed_urls.append(url)
    if prop("twitter:player") and not meta.candidates:
        for content in prop("twitter:player"):
            url = _abs(base, content)
            if url:
                meta.embed_urls.append(url)

    img_w = _int(first("og:image:width", "twitter:image:width"))
    img_h = _int(first("og:image:height", "twitter:image:height"))
    for content in prop("og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src"):
        url = _abs(base, content)
        if url:
            meta.candidates.append(RawCandidate(url, "image", "og:image", width=img_w, height=img_h))

    # JSON-LD
    for script in soup.find_all("script", attrs={"type": lambda v: v and "ld+json" in v.lower()}):
        raw = script.string or script.get_text() or ""
        if not raw.strip() or len(raw) > 400_000:
            continue
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        nodes: list[dict] = []
        _walk_jsonld(data, nodes)
        for node in nodes:
            types = node.get("@type")
            types = [types] if isinstance(types, str) else (types or [])
            types = [str(t) for t in types]
            if "VideoObject" in types:
                dur = parse_iso_duration(node.get("duration"))
                meta.duration_seconds = meta.duration_seconds or dur
                meta.title = meta.title or (node.get("name") if isinstance(node.get("name"), str) else None)
                meta.description = meta.description or (node.get("description") if isinstance(node.get("description"), str) else None)
                meta.published_at = meta.published_at or (node.get("uploadDate") if isinstance(node.get("uploadDate"), str) else None)
                content_url = _abs(base, _first_str(node.get("contentUrl")))
                if content_url:
                    meta.candidates.append(
                        RawCandidate(
                            content_url,
                            _kind_for(content_url, node.get("encodingFormat")),
                            "jsonld:VideoObject",
                            mime=node.get("encodingFormat") if isinstance(node.get("encodingFormat"), str) else None,
                            width=_int(node.get("width")),
                            height=_int(node.get("height")),
                            duration_seconds=dur,
                        )
                    )
                embed = _abs(base, _first_str(node.get("embedUrl")))
                if embed:
                    meta.embed_urls.append(embed)
                thumb = _abs(base, _first_str(node.get("thumbnailUrl")))
                if thumb:
                    meta.candidates.append(RawCandidate(thumb, "image", "jsonld:thumbnail"))
            elif "ImageObject" in types:
                content_url = _abs(base, _first_str(node.get("contentUrl") or node.get("url")))
                if content_url:
                    meta.candidates.append(
                        RawCandidate(
                            content_url, "image", "jsonld:ImageObject", width=_int(node.get("width")), height=_int(node.get("height"))
                        )
                    )

    # <video>/<source>
    for video in soup.find_all("video"):
        poster = _abs(base, video.get("poster"))
        if poster:
            meta.candidates.append(RawCandidate(poster, "image", "video:poster"))
        vw, vh = _int(video.get("width")), _int(video.get("height"))
        sources = [(video.get("src"), video.get("type"))] + [(s.get("src"), s.get("type")) for s in video.find_all("source")]
        for src, mime in sources:
            url = _abs(base, src)
            if url:
                meta.candidates.append(RawCandidate(url, _kind_for(url, mime), "video:source", mime=mime, width=vw, height=vh))

    # oEmbed + feeds discovery
    for link in soup.find_all("link", href=True):
        rel = link.get("rel") or []
        rel = [rel] if isinstance(rel, str) else rel
        ltype = (link.get("type") or "").lower()
        href = _abs(base, link["href"])
        if not href or "alternate" not in [r.lower() for r in rel]:
            continue
        if "oembed" in ltype:
            meta.oembed_urls.append(href)
        elif any(t in ltype for t in ("rss", "atom", "feed+json")):
            meta.feed_urls.append(href)

    # de-duplicate preserving order
    seen: set[tuple[str, str]] = set()
    unique: list[RawCandidate] = []
    for cand in meta.candidates:
        key = (cand.kind, cand.url)
        if key not in seen:
            seen.add(key)
            unique.append(cand)
    meta.candidates = unique
    _ = og_type
    return meta
