"""Universal URL classification.

Given a pasted URL, decide what it is (direct media, HTML page with declared
media, HLS/DASH manifest, feed/ActivityPub/PeerTube, or extractor-supported
site) and return a ranked list of playable candidates plus display metadata.
Content is identified by magic bytes, never by extension alone.

Only what a URL publicly serves is read. Paywalled, DRM-protected or
login-gated streams are reported as `protected` and never returned as
candidates.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

from app.media_pipeline import feeds, manifests, mp4probe, ytdlp_adapter
from app.media_pipeline.canonical import canonicalize_url, resolve_shortener
from app.media_pipeline.html_extract import RawCandidate, extract_html
from app.media_pipeline.netsafe import FetchError, FetchResult, UnsafeUrlError, safe_fetch, validate_url
from app.media_pipeline.sniff import Sniff, sniff_bytes

HEAD_BYTES = 512 * 1024
MAX_PROBES = 6
Fetcher = Callable[..., FetchResult]


class ClassifyError(Exception):
    def __init__(self, code: str, message: str | None = None, status: int | None = None):
        super().__init__(message or code)
        self.code = code
        self.status = status


@dataclass
class Candidate:
    url: str
    kind: str  # video | image | hls | dash
    protocol: str = "progressive"  # progressive | hls | dash
    mime: str | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    bitrate: int | None = None
    codec: str | None = None
    origin: str = ""
    verified: bool = False
    size_bytes: int | None = None
    score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "kind": self.kind,
            "protocol": self.protocol,
            "mime": self.mime,
            "width": self.width,
            "height": self.height,
            "durationSeconds": self.duration_seconds,
            "bitrate": self.bitrate,
            "codec": self.codec,
            "origin": self.origin,
            "verified": self.verified,
            "sizeBytes": self.size_bytes,
        }


@dataclass
class Classification:
    input_url: str
    final_url: str
    canonical_url: str
    kind: str = "unsupported"  # video | image | gallery | page | feed | unsupported
    strategy: str = "none"  # direct | html | oembed | manifest | feed | peertube | activitypub | ytdlp
    title: str | None = None
    description: str | None = None
    source: str = ""
    site_name: str | None = None
    author: str | None = None
    thumbnail_url: str | None = None
    duration_seconds: float | None = None
    width: int | None = None
    height: int | None = None
    mime_type: str | None = None
    candidates: list[Candidate] = field(default_factory=list)
    gallery: list[str] = field(default_factory=list)
    feed_items: list[feeds.FeedItem] = field(default_factory=list)
    embed_urls: list[str] = field(default_factory=list)
    extractor: str | None = None
    protected: bool = False
    warnings: list[str] = field(default_factory=list)
    playable: bool = False

    @property
    def aspect(self) -> float | None:
        if self.width and self.height:
            return round(self.width / self.height, 4)
        return None

    @property
    def best_video(self) -> Candidate | None:
        return next((c for c in self.candidates if c.kind in {"video", "hls", "dash"}), None)

    def to_dict(self) -> dict[str, Any]:
        best = self.best_video
        return {
            "inputUrl": self.input_url,
            "finalUrl": self.final_url,
            "canonicalUrl": self.canonical_url,
            "kind": self.kind,
            "strategy": self.strategy,
            "title": self.title,
            "description": self.description,
            "source": self.source,
            "siteName": self.site_name,
            "author": self.author,
            "thumbnailUrl": self.thumbnail_url,
            "durationSeconds": self.duration_seconds,
            "width": self.width,
            "height": self.height,
            "aspect": self.aspect,
            "mimeType": self.mime_type,
            "candidates": [c.to_dict() for c in self.candidates],
            "streamCandidates": [c.url for c in self.candidates if c.kind in {"video", "hls"}],
            "mediaUrl": best.url if best else (self.candidates[0].url if self.candidates else None),
            "gallery": self.gallery,
            "feedItems": [
                {
                    "id": i.id,
                    "title": i.title,
                    "url": i.url,
                    "publishedAt": i.published_at,
                    "mediaUrl": i.media_url,
                    "thumbnail": i.thumbnail,
                    "durationSeconds": i.duration_seconds,
                    "kind": i.kind,
                }
                for i in self.feed_items
            ],
            "embedUrls": self.embed_urls,
            "extractor": self.extractor,
            "protected": self.protected,
            "playable": self.playable,
            "warnings": self.warnings,
        }


# --------------------------------------------------------------------------
# scoring
# --------------------------------------------------------------------------


def score_candidate(c: Candidate) -> float:
    h = c.height or 0
    if c.kind == "image":
        area = (c.width or 0) * (c.height or 0)
        return min(area / 10_000, 500) + (50 if c.verified else 0)
    base = {"video": 1000, "hls": 700, "dash": 300}.get(c.kind, 0)
    if c.kind == "video":
        mime = (c.mime or "").lower()
        if "mp4" in mime or "quicktime" in mime or c.url.lower().split("?", 1)[0].endswith((".mp4", ".m4v", ".mov")):
            base += 120
        elif "webm" in mime:
            base += 60
        elif "matroska" in mime or c.url.lower().split("?", 1)[0].endswith((".mkv", ".avi", ".flv")):
            base -= 250  # browsers can not play these natively
        if c.codec and c.codec.lower().startswith(("avc", "h264")):
            base += 40
        elif c.codec and c.codec.lower().startswith(("hev", "hvc", "h265")):
            base -= 60
    if h:
        base += h / 10 if h <= 1080 else -150 - (h - 1080) / 10
    if c.verified:
        base += 80
    return base


def _rank(candidates: list[Candidate]) -> list[Candidate]:
    for c in candidates:
        c.score = score_candidate(c)
    videos = sorted([c for c in candidates if c.kind != "image"], key=lambda c: c.score, reverse=True)
    images = sorted([c for c in candidates if c.kind == "image"], key=lambda c: c.score, reverse=True)
    return videos + images


# --------------------------------------------------------------------------
# probing helpers
# --------------------------------------------------------------------------


def _image_size(data: bytes) -> tuple[int, int] | None:
    try:
        from PIL import ImageFile

        parser = ImageFile.Parser()
        parser.feed(data)
        if parser.image is not None:
            return parser.image.size
    except Exception:
        pass
    return None


def _fetch_head(fetcher: Fetcher, url: str, max_bytes: int = HEAD_BYTES) -> FetchResult:
    """Range-GET the start of a URL, retrying without Range when a server
    rejects it. Does not raise on HTTP error statuses."""
    result = fetcher(url, range_bytes=max_bytes, max_bytes=max_bytes, timeout=8.0, total_timeout=15.0)
    if result.status in (400, 405, 416, 501):
        result = fetcher(url, max_bytes=max_bytes, timeout=8.0, total_timeout=15.0)
    return result


def probe_candidate(fetcher: Fetcher, cand: Candidate) -> Candidate | None:
    """Verify a candidate really serves media of the declared class. Returns the
    (enriched) candidate or None when it is dead / not media."""
    if cand.kind in {"hls", "dash"}:
        try:
            res = _fetch_head(fetcher, cand.url, 256 * 1024)
        except (FetchError, UnsafeUrlError):
            return None
        if not res.ok:
            return None
        sn = sniff_bytes(res.body)
        if sn.kind not in {"hls", "dash"}:
            return None
        cand.verified = True
        return cand
    try:
        res = _fetch_head(fetcher, cand.url, 96 * 1024 if cand.kind == "image" else 256 * 1024)
    except (FetchError, UnsafeUrlError):
        return None
    if not (res.ok or res.status == 206):
        return None
    sn = sniff_bytes(res.body)
    if cand.kind == "image":
        if sn.kind != "image":
            return None
        cand.mime = sn.mime
        size = _image_size(res.body)
        if size:
            cand.width, cand.height = size
    else:
        if sn.kind == "hls":
            cand.kind, cand.protocol = "hls", "hls"
        elif sn.kind == "dash":
            cand.kind, cand.protocol = "dash", "dash"
        elif sn.kind != "video":
            return None
        else:
            cand.mime = sn.mime
            if sn.mime in {"video/mp4", "video/quicktime"}:
                info = mp4probe.parse_head(res.body)
                cand.duration_seconds = cand.duration_seconds or info.duration_seconds
                cand.width = cand.width or info.width
                cand.height = cand.height or info.height
    cand.size_bytes = res.content_length
    cand.verified = True
    return cand


def _verify_all(fetcher: Fetcher, candidates: list[Candidate]) -> list[Candidate]:
    videos = [c for c in candidates if c.kind != "image"][:4]
    images = [c for c in candidates if c.kind == "image"][:3]
    batch = videos + images
    rest = [c for c in candidates if c not in batch]
    if not batch:
        return rest
    with ThreadPoolExecutor(max_workers=min(MAX_PROBES, len(batch))) as pool:
        results = list(pool.map(lambda c: probe_candidate(fetcher, c), batch))
    return [r for r in results if r is not None] + rest


# --------------------------------------------------------------------------
# main entry
# --------------------------------------------------------------------------

_PEERTUBE_PATH = re.compile(r"^/(?:w|videos/watch)/([A-Za-z0-9_-]{6,})/?$")


def _host_source(url: str) -> str:
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _from_raw(raw: RawCandidate) -> Candidate:
    protocol = {"hls": "hls", "dash": "dash"}.get(raw.kind, "progressive")
    return Candidate(
        url=raw.url,
        kind=raw.kind,
        protocol=protocol,
        mime=raw.mime,
        width=raw.width,
        height=raw.height,
        duration_seconds=raw.duration_seconds,
        origin=raw.origin,
    )


def _parse_peertube_video(data: dict, base_url: str) -> tuple[list[Candidate], dict[str, Any]]:
    cands: list[Candidate] = []
    for f in data.get("files") or []:
        url = f.get("fileUrl") or f.get("fileDownloadUrl")
        if not url:
            continue
        res = f.get("resolution") or {}
        height = int(res.get("id") or 0) or None
        cands.append(
            Candidate(url=url, kind="video", mime="video/mp4", height=height, width=None, origin="peertube:file",
                      duration_seconds=data.get("duration"), size_bytes=f.get("size"))
        )
    for pl in data.get("streamingPlaylists") or []:
        url = pl.get("playlistUrl")
        if url:
            cands.append(Candidate(url=url, kind="hls", protocol="hls", origin="peertube:hls", duration_seconds=data.get("duration")))
    meta = {
        "title": data.get("name"),
        "description": data.get("description"),
        "duration": data.get("duration"),
        "thumbnail": urljoin(base_url, data["previewPath"]) if data.get("previewPath") else (
            urljoin(base_url, data["thumbnailPath"]) if data.get("thumbnailPath") else None
        ),
        "author": ((data.get("account") or {}).get("displayName") or (data.get("channel") or {}).get("displayName")),
    }
    return cands, meta


def classify_url(
    raw_url: str,
    *,
    fetcher: Fetcher = safe_fetch,
    use_ytdlp: bool = True,
    ytdlp_extract: Callable[..., Any] | None = None,
    verify: bool = True,
) -> Classification:
    """Classify `raw_url`. Raises ClassifyError for policy/network failures."""
    try:
        validate_url(raw_url)
        resolved = resolve_shortener(raw_url.strip(), fetcher=fetcher)
        canonical = canonicalize_url(resolved)
        validate_url(canonical)
    except UnsafeUrlError as exc:
        raise ClassifyError(exc.code, str(exc)) from exc

    out = Classification(input_url=raw_url.strip(), final_url=resolved, canonical_url=canonical, source=_host_source(resolved))

    try:
        head = _fetch_head(fetcher, resolved)
    except UnsafeUrlError as exc:
        raise ClassifyError(exc.code, str(exc)) from exc
    except FetchError as exc:
        raise ClassifyError(exc.code, str(exc)) from exc

    if head.status in (401, 402, 407):
        out.protected = True
        out.warnings.append("requires_authentication")
        raise ClassifyError("auth_required", "This URL requires authentication and cannot be imported.", head.status)
    if head.status == 403 and not head.body:
        raise ClassifyError("forbidden", "The server refused access to this URL.", 403)
    if head.status == 404 or head.status == 410:
        raise ClassifyError("not_found", "The URL returned 404 (not found).", head.status)
    if head.status >= 400:
        # Some sites gate scrapers on the page but a yt-dlp extractor can still resolve them.
        if use_ytdlp:
            got = _try_ytdlp(out, resolved, ytdlp_extract)
            if got:
                return _finish(out, fetcher, verify=False)
        raise ClassifyError("http_error", f"The server responded with HTTP {head.status}.", head.status)

    out.final_url = head.url
    if head.url != resolved:
        out.canonical_url = canonicalize_url(head.url)
        out.source = _host_source(head.url)

    sn = sniff_bytes(head.body)
    ctype = head.content_type

    if sn.kind in {"image", "video"}:
        _classify_direct(out, head, sn)
    elif sn.kind in {"hls", "dash"}:
        _classify_manifest(out, head, sn)
    elif sn.kind == "html":
        _classify_html(out, head, fetcher, use_ytdlp, ytdlp_extract)
    elif sn.kind in {"feed", "json"}:
        _classify_structured(out, head, sn, fetcher)
    else:
        if ctype.startswith(("image/", "video/")):
            out.warnings.append("content_type_without_magic_bytes")
        out.kind = "unsupported"
        out.warnings.append("unrecognized_content")
    return _finish(out, fetcher, verify=verify)


# --------------------------------------------------------------------------
# strategies
# --------------------------------------------------------------------------


def _classify_direct(out: Classification, head: FetchResult, sn: Sniff) -> None:
    out.strategy = "direct"
    out.mime_type = sn.mime
    path_title = urlsplit(head.url).path.rsplit("/", 1)[-1]
    out.title = path_title or None
    if sn.kind == "image":
        cand = Candidate(url=head.url, kind="image", mime=sn.mime, origin="direct", verified=True, size_bytes=head.content_length)
        size = _image_size(head.body)
        if size:
            cand.width, cand.height = size
        out.candidates.append(cand)
        out.thumbnail_url = head.url
    else:
        cand = Candidate(url=head.url, kind="video", mime=sn.mime, origin="direct", verified=True, size_bytes=head.content_length)
        if sn.mime in {"video/mp4", "video/quicktime"}:
            info = mp4probe.parse_head(head.body)
            cand.duration_seconds, cand.width, cand.height = info.duration_seconds, info.width, info.height
            if not info.moov_in_head:
                out.warnings.append("moov_not_at_start")
        if sn.mime in {"video/x-matroska", "video/x-msvideo", "video/x-flv", "video/mp2t"}:
            out.warnings.append("needs_transcode_for_browser")
        out.candidates.append(cand)


def _classify_manifest(out: Classification, head: FetchResult, sn: Sniff) -> None:
    out.strategy = "manifest"
    text = head.body.decode("utf-8", "replace")
    info = manifests.parse_hls(text, head.url) if sn.kind == "hls" else manifests.parse_dash(text, head.url)
    out.mime_type = sn.mime
    out.duration_seconds = info.duration_seconds
    out.title = urlsplit(head.url).path.rsplit("/", 1)[-1] or None
    if info.protected:
        out.protected = True
        out.warnings.append("drm_protected")
        return
    if info.encrypted:
        out.warnings.append("encrypted_stream")
    if info.live:
        out.warnings.append("live_stream")
    best = info.best_variant
    out.candidates.append(
        Candidate(
            url=head.url,
            kind=sn.kind,
            protocol=sn.kind,
            mime=sn.mime,
            width=best.width if best else None,
            height=best.height if best else None,
            duration_seconds=info.duration_seconds,
            bitrate=best.bandwidth if best else None,
            codec=best.codecs if best else None,
            origin="manifest",
            verified=True,
        )
    )
    if best:
        out.width, out.height = best.width, best.height


def _classify_structured(out: Classification, head: FetchResult, sn: Sniff, fetcher: Fetcher) -> None:
    text = head.body.decode("utf-8", "replace")
    info: feeds.FeedInfo | None = None
    try:
        if sn.kind == "json":
            data = json.loads(text)
            if not isinstance(data, dict):
                data = {}
            if str(data.get("version", "")).startswith("https://jsonfeed.org"):
                info = feeds.parse_json_feed(text, head.url)
                out.strategy = "feed"
            elif isinstance(data, dict) and ("@context" in data or data.get("type") in {"Video", "Note", "OrderedCollection"}):
                info = feeds.parse_activitypub_object(data, head.url)
                out.strategy = "activitypub"
            elif isinstance(data, dict) and data.get("version") and data.get("type") in {"video", "photo", "rich", "link"}:
                _apply_oembed(out, data, head.url)
                out.strategy = "oembed"
                return
            elif isinstance(data, dict) and isinstance(data.get("uuid"), str) and ("files" in data or "streamingPlaylists" in data):
                cands, meta = _parse_peertube_video(data, head.url)
                out.candidates.extend(cands)
                out.title, out.description = meta["title"], meta["description"]
                out.thumbnail_url, out.duration_seconds, out.author = meta["thumbnail"], meta["duration"], meta["author"]
                out.strategy = "peertube"
                return
            elif isinstance(data, dict) and isinstance(data.get("items"), list):
                info = feeds.parse_json_feed(text, head.url)
                out.strategy = "feed"
        else:
            info = feeds.parse_xml_feed(text, head.url)
            out.strategy = "feed"
    except (ValueError, TypeError, AttributeError, KeyError) as exc:
        out.warnings.append(f"feed_parse_failed:{type(exc).__name__}")
    except Exception as exc:  # xml ParseError
        out.warnings.append(f"feed_parse_failed:{type(exc).__name__}")
    if info is None:
        out.kind = "unsupported"
        out.warnings.append("unrecognized_structured_content")
        return
    out.title = info.title
    out.feed_items = info.items
    out.kind = "feed"


def _apply_oembed(out: Classification, data: dict, base: str) -> None:
    out.title = out.title or (data.get("title") if isinstance(data.get("title"), str) else None)
    out.author = out.author or data.get("author_name")
    out.site_name = out.site_name or data.get("provider_name")
    thumb = data.get("thumbnail_url")
    if isinstance(thumb, str) and thumb.startswith(("http://", "https://")):
        out.candidates.append(
            Candidate(url=thumb, kind="image", width=data.get("thumbnail_width"), height=data.get("thumbnail_height"), origin="oembed:thumbnail")
        )
    if data.get("type") == "photo" and isinstance(data.get("url"), str):
        out.candidates.append(
            Candidate(url=data["url"], kind="image", width=data.get("width"), height=data.get("height"), origin="oembed:photo")
        )
    html = data.get("html")
    if isinstance(html, str):
        m = re.search(r'src=["\']([^"\']+)["\']', html)
        if m:
            src = urljoin(base, m.group(1))
            if src.startswith(("http://", "https://")):
                out.embed_urls.append(src)
    if isinstance(data.get("duration"), (int, float)):
        out.duration_seconds = float(data["duration"])


def _classify_html(out: Classification, head: FetchResult, fetcher: Fetcher, use_ytdlp: bool, ytdlp_extract) -> None:
    out.strategy = "html"
    try:
        html = head.body.decode(_charset(head), "replace")
    except LookupError:
        html = head.body.decode("utf-8", "replace")
    meta = extract_html(html, head.url)
    out.title, out.description = meta.title, meta.description
    out.site_name, out.author = meta.site_name, meta.author
    out.duration_seconds = meta.duration_seconds
    out.embed_urls = list(dict.fromkeys(meta.embed_urls))
    if meta.canonical_url:
        try:
            validate_url(meta.canonical_url)
            out.canonical_url = canonicalize_url(meta.canonical_url)
        except UnsafeUrlError:
            pass
    out.candidates.extend(_from_raw(r) for r in meta.candidates)

    # oEmbed discovery: enrich thumbnail/title when the page itself had little.
    if meta.oembed_urls and (not any(c.kind != "image" for c in out.candidates) or not out.title):
        try:
            res = fetcher(meta.oembed_urls[0], max_bytes=128 * 1024, timeout=6.0, total_timeout=10.0)
            if res.ok:
                _apply_oembed(out, json.loads(res.body.decode("utf-8", "replace")), res.url)
        except (FetchError, UnsafeUrlError, ValueError):
            out.warnings.append("oembed_failed")

    has_video = any(c.kind != "image" for c in out.candidates)
    parts = urlsplit(head.url)
    if not has_video and (meta.peertube or _PEERTUBE_PATH.match(parts.path or "")):
        m = _PEERTUBE_PATH.match(parts.path or "")
        if m:
            api = f"{parts.scheme}://{parts.netloc}/api/v1/videos/{m.group(1)}"
            try:
                res = fetcher(api, max_bytes=256 * 1024, timeout=6.0, total_timeout=10.0)
                if res.ok:
                    data = json.loads(res.body.decode("utf-8", "replace"))
                    if isinstance(data, dict) and data.get("uuid"):
                        cands, pm = _parse_peertube_video(data, api)
                        out.candidates.extend(cands)
                        out.title = out.title or pm["title"]
                        out.description = out.description or pm["description"]
                        out.duration_seconds = out.duration_seconds or pm["duration"]
                        out.author = out.author or pm["author"]
                        if pm["thumbnail"]:
                            out.candidates.append(Candidate(url=pm["thumbnail"], kind="image", origin="peertube:preview"))
                        out.strategy = "peertube"
                        has_video = any(c.kind != "image" for c in out.candidates)
            except (FetchError, UnsafeUrlError, ValueError):
                out.warnings.append("peertube_api_failed")

    if not has_video and use_ytdlp:
        if _try_ytdlp(out, head.url, ytdlp_extract):
            return
    if not any(c.kind != "image" for c in out.candidates) and not any(c.kind == "image" for c in out.candidates) and not out.embed_urls:
        out.warnings.append("no_media_found")


def _charset(head: FetchResult) -> str:
    ct = head.headers.get("content-type", "")
    m = re.search(r"charset=([\w-]+)", ct, re.I)
    return m.group(1) if m else "utf-8"


def _try_ytdlp(out: Classification, url: str, extract_fn) -> bool:
    fn = extract_fn or ytdlp_adapter.extract
    try:
        res = fn(url)
    except Exception:
        out.warnings.append("ytdlp_failed")
        return False
    if res is None:
        return False
    if getattr(res, "protected", False):
        out.protected = True
        out.warnings.append("drm_protected")
        return False
    if not res.formats:
        return False
    out.strategy = "ytdlp"
    out.extractor = res.extractor
    out.title = res.title or out.title
    out.description = res.description or out.description
    out.author = res.uploader or out.author
    out.duration_seconds = res.duration_seconds or out.duration_seconds
    if res.thumbnail:
        out.candidates.append(Candidate(url=res.thumbnail, kind="image", origin="ytdlp:thumbnail"))
    for f in res.formats[:6]:
        kind = {"progressive": "video", "hls": "hls", "dash": "dash"}[f.protocol]
        codec = ", ".join(x for x in (f.vcodec, f.acodec) if x and x != "none") or None
        out.candidates.append(
            Candidate(
                url=f.url,
                kind=kind,
                protocol=f.protocol,
                mime="video/mp4" if f.ext in {"mp4", "m4v"} else (f"video/{f.ext}" if f.ext else None),
                width=f.width,
                height=f.height,
                duration_seconds=res.duration_seconds,
                bitrate=int(f.tbr * 1000) if f.tbr else None,
                codec=codec,
                origin=f"ytdlp:{res.extractor or ''}",
            )
        )
        if not f.has_audio:
            out.warnings.append("selected_format_without_audio")
    return True


# --------------------------------------------------------------------------
# finalisation
# --------------------------------------------------------------------------


def _finish(out: Classification, fetcher: Fetcher, *, verify: bool) -> Classification:
    # Drop candidates that fail policy (never hand a private URL onward).
    safe: list[Candidate] = []
    seen: set[str] = set()
    for c in out.candidates:
        try:
            validate_url(c.url)
        except UnsafeUrlError:
            continue
        if c.url in seen:
            continue
        seen.add(c.url)
        safe.append(c)
    out.candidates = safe
    if verify and out.strategy not in {"direct", "manifest", "feed", "activitypub"}:
        out.candidates = _verify_all(fetcher, out.candidates)
    out.candidates = _rank(out.candidates)

    video = out.best_video
    images = [c for c in out.candidates if c.kind == "image"]
    if out.kind == "feed":
        out.playable = any(i.kind in {"video", "image"} and i.media_url for i in out.feed_items)
        return out
    if video:
        out.kind = "video"
        out.mime_type = out.mime_type or video.mime
        out.width, out.height = out.width or video.width, out.height or video.height
        out.duration_seconds = out.duration_seconds or video.duration_seconds
        out.playable = True
        if images:
            out.thumbnail_url = images[0].url
    elif images:
        top = images[0]
        out.width, out.height = top.width, top.height
        out.mime_type = out.mime_type or top.mime
        out.thumbnail_url = top.url
        out.playable = True
        unique = list(dict.fromkeys(c.url for c in images if c.origin in {"direct", "jsonld:ImageObject", "oembed:photo", "video:poster"} or out.strategy == "direct"))
        out.gallery = unique
        out.kind = "gallery" if len(out.gallery) > 1 else "image"
    elif out.protected:
        out.kind = "unsupported"
    elif out.embed_urls or out.strategy == "html":
        out.kind = "page"
    if out.kind == "video" and images and not out.thumbnail_url:
        out.thumbnail_url = images[0].url
    if out.protected:
        out.playable = False
        out.candidates = []
    if out.source and not out.site_name:
        out.site_name = out.source
    return out
