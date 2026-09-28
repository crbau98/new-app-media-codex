"""yt-dlp extractor fallback (metadata only; no downloads here).

Safety notes
* Only site-specific extractors are used. yt-dlp's Generic extractor follows
  arbitrary links found in a page, which would sidestep our SSRF policy, so a
  URL that only the Generic extractor claims is refused.
* Every URL yt-dlp returns is re-validated against the SSRF policy.
* DRM formats are dropped and never selected.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.media_pipeline.netsafe import UnsafeUrlError, validate_url

_logger = logging.getLogger(__name__)

PROGRESSIVE_PROTOCOLS = {"http", "https"}
HLS_PROTOCOLS = {"m3u8", "m3u8_native"}


@dataclass
class YtdlpFormat:
    url: str
    protocol: str  # progressive | hls | dash
    width: int | None
    height: int | None
    vcodec: str | None
    acodec: str | None
    ext: str | None
    tbr: float | None
    has_audio: bool
    has_video: bool
    score: float = 0.0


@dataclass
class YtdlpResult:
    title: str | None = None
    description: str | None = None
    uploader: str | None = None
    duration_seconds: float | None = None
    thumbnail: str | None = None
    webpage_url: str | None = None
    extractor: str | None = None
    tags: list[str] = field(default_factory=list)
    formats: list[YtdlpFormat] = field(default_factory=list)
    age_limit: int | None = None
    protected: bool = False


def _is_h264(codec: str | None) -> bool:
    return bool(codec) and codec.lower().startswith(("avc1", "avc3", "h264"))


def _is_aac(codec: str | None) -> bool:
    return bool(codec) and codec.lower().startswith(("mp4a", "aac"))


def _has(codec: str | None) -> bool:
    return bool(codec) and codec.lower() not in {"none", ""}


def _protocol_of(fmt: dict) -> str | None:
    proto = str(fmt.get("protocol") or "").lower()
    if proto in PROGRESSIVE_PROTOCOLS:
        return "progressive"
    if proto in HLS_PROTOCOLS:
        return "hls"
    if proto == "http_dash_segments":
        return "dash"
    return None


def score_format(f: YtdlpFormat, max_height: int = 1080) -> float:
    """Higher is better. Progressive H.264/AAC MP4 <=1080p wins outright; HLS is
    the second choice; everything else is a last resort."""
    height = f.height or 0
    score = 0.0
    if f.protocol == "progressive":
        score += 1000
    elif f.protocol == "hls":
        score += 500
    else:
        score += 100
    if f.has_video and f.has_audio:
        score += 300  # muxed: playable as-is
    if f.ext == "mp4" or f.ext == "m4v":
        score += 120
    if _is_h264(f.vcodec):
        score += 80
    if _is_aac(f.acodec):
        score += 40
    if height:
        if height <= max_height:
            score += min(height, max_height) / 10  # up to +108
        else:
            score -= 200 + (height - max_height) / 10
    return score


def convert_formats(raw_formats: list[dict], *, max_height: int = 1080) -> list[YtdlpFormat]:
    out: list[YtdlpFormat] = []
    for fmt in raw_formats or []:
        url = fmt.get("url")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            continue
        if fmt.get("has_drm") or fmt.get("drm") or fmt.get("format_note") == "DRM":
            continue
        protocol = _protocol_of(fmt)
        if protocol is None:
            continue
        vcodec, acodec = fmt.get("vcodec"), fmt.get("acodec")
        has_video = _has(vcodec) if vcodec is not None else bool(fmt.get("height"))
        has_audio = _has(acodec) if acodec is not None else True
        if not has_video:
            continue  # audio-only formats are useless for a video library
        try:
            validate_url(url)
        except UnsafeUrlError:
            continue
        item = YtdlpFormat(
            url=url,
            protocol=protocol,
            width=fmt.get("width") if isinstance(fmt.get("width"), int) else None,
            height=fmt.get("height") if isinstance(fmt.get("height"), int) else None,
            vcodec=vcodec,
            acodec=acodec,
            ext=fmt.get("ext"),
            tbr=float(fmt["tbr"]) if isinstance(fmt.get("tbr"), (int, float)) else None,
            has_audio=has_audio,
            has_video=True,
        )
        item.score = score_format(item, max_height)
        out.append(item)
    out.sort(key=lambda f: f.score, reverse=True)
    return out


def result_from_info(info: dict, *, max_height: int = 1080) -> YtdlpResult:
    formats = convert_formats(info.get("formats") or [], max_height=max_height)
    if not formats and isinstance(info.get("url"), str):
        formats = convert_formats([info], max_height=max_height)
    return YtdlpResult(
        title=info.get("title"),
        description=info.get("description"),
        uploader=info.get("uploader") or info.get("channel"),
        duration_seconds=float(info["duration"]) if isinstance(info.get("duration"), (int, float)) else None,
        thumbnail=info.get("thumbnail") if isinstance(info.get("thumbnail"), str) else None,
        webpage_url=info.get("webpage_url"),
        extractor=info.get("extractor_key") or info.get("extractor"),
        tags=[str(t) for t in (info.get("tags") or [])][:20],
        formats=formats,
        age_limit=info.get("age_limit") if isinstance(info.get("age_limit"), int) else None,
    )


def ytdlp_available() -> bool:
    try:
        import yt_dlp  # noqa: F401

        return True
    except Exception:
        return False


def site_extractor_for(url: str) -> str | None:
    """Name of the first non-generic yt-dlp extractor claiming this URL."""
    try:
        from yt_dlp.extractor import gen_extractor_classes
    except Exception:
        return None
    for ie in gen_extractor_classes():
        name = ie.ie_key()
        if name == "Generic":
            continue
        try:
            if ie.suitable(url):
                return name
        except Exception:
            continue
    return None


def extract(url: str, *, timeout: float = 25.0, max_height: int = 1080) -> YtdlpResult | None:
    """Run yt-dlp metadata extraction. Returns None if unsupported/unavailable."""
    if not ytdlp_available():
        return None
    extractor = site_extractor_for(url)
    if extractor is None:
        return None
    import yt_dlp

    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": timeout,
        "extract_flat": False,
        "cachedir": False,
        "ignoreconfig": True,
        "retries": 1,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:  # yt-dlp raises a wide family of errors
        _logger.info("yt-dlp extraction failed for %s: %s", url[:120], exc)
        text = str(exc).lower()
        if "drm" in text:
            return YtdlpResult(protected=True, extractor=extractor)
        return None
    if not isinstance(info, dict):
        return None
    result = result_from_info(info, max_height=max_height)
    result.extractor = result.extractor or extractor
    return result
