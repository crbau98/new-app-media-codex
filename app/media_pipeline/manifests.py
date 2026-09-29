"""HLS (.m3u8) and DASH (.mpd) manifest parsing for classification.

Only what ingestion needs: variant ladder, duration, and DRM detection. DRM
protected streams are reported (`protected=True`) and never ingested.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urljoin
from xml.etree import ElementTree

_ATTR_RE = re.compile(r'([A-Z0-9-]+)=("(?:[^"]*)"|[^,]*)')
_DRM_KEYFORMATS = ("com.apple.streamingkeydelivery", "com.microsoft.playready", "urn:uuid:edef8ba9", "com.widevine")


@dataclass
class Variant:
    url: str
    bandwidth: int | None = None
    width: int | None = None
    height: int | None = None
    codecs: str | None = None
    frame_rate: float | None = None


@dataclass
class ManifestInfo:
    kind: str  # hls | dash
    is_master: bool = False
    variants: list[Variant] = field(default_factory=list)
    duration_seconds: float | None = None
    live: bool = False
    protected: bool = False
    encrypted: bool = False
    has_audio_only_variants: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def best_variant(self) -> Variant | None:
        return pick_variant(self.variants)


def _attrs(line: str) -> dict[str, str]:
    body = line.split(":", 1)[1] if ":" in line else ""
    out: dict[str, str] = {}
    for key, value in _ATTR_RE.findall(body):
        out[key] = value.strip('"')
    return out


def parse_hls(text: str, base_url: str) -> ManifestInfo:
    lines = [ln.strip() for ln in text.replace("\r\n", "\n").split("\n") if ln.strip()]
    info = ManifestInfo(kind="hls")
    if not lines or not lines[0].startswith("#EXTM3U"):
        info.warnings.append("missing_extm3u")
    total = 0.0
    has_segments = False
    endlist = False
    pending: dict[str, str] | None = None
    for line in lines:
        if line.startswith("#EXT-X-STREAM-INF"):
            info.is_master = True
            pending = _attrs(line)
        elif line.startswith("#EXT-X-KEY") or line.startswith("#EXT-X-SESSION-KEY"):
            attrs = _attrs(line)
            method = attrs.get("METHOD", "NONE").upper()
            fmt = attrs.get("KEYFORMAT", "identity").lower()
            if method not in {"NONE"}:
                info.encrypted = True
            if method == "SAMPLE-AES" or any(fmt.startswith(k) for k in _DRM_KEYFORMATS):
                if fmt != "identity":
                    info.protected = True
        elif line.startswith("#EXTINF"):
            has_segments = True
            try:
                total += float(line.split(":", 1)[1].split(",", 1)[0])
            except (ValueError, IndexError):
                pass
        elif line.startswith("#EXT-X-ENDLIST"):
            endlist = True
        elif not line.startswith("#"):
            if pending is not None:
                width = height = None
                res = pending.get("RESOLUTION", "")
                if "x" in res:
                    try:
                        width, height = (int(v) for v in res.lower().split("x", 1))
                    except ValueError:
                        pass
                bandwidth = None
                for key in ("AVERAGE-BANDWIDTH", "BANDWIDTH"):
                    if pending.get(key, "").isdigit():
                        bandwidth = int(pending[key])
                        break
                try:
                    fps = float(pending["FRAME-RATE"]) if "FRAME-RATE" in pending else None
                except ValueError:
                    fps = None
                info.variants.append(
                    Variant(
                        url=urljoin(base_url, line),
                        bandwidth=bandwidth,
                        width=width,
                        height=height,
                        codecs=pending.get("CODECS"),
                        frame_rate=fps,
                    )
                )
                pending = None
    if has_segments and not info.is_master:
        info.duration_seconds = round(total, 3) if endlist else None
        info.live = not endlist
        if endlist:
            info.warnings.append("media_playlist")
    if info.is_master:
        info.has_audio_only_variants = any(v.width is None for v in info.variants)
    return info


_ISO_DUR = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$")


def parse_iso_duration(value: str | None) -> float | None:
    """ISO-8601 duration (PT1H2M3.5S) to seconds."""
    if not value:
        return None
    m = _ISO_DUR.match(value.strip().upper())
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = m.groups()
    return round(int(d or 0) * 86400 + int(h or 0) * 3600 + int(mi or 0) * 60 + float(s or 0), 3)


def safe_xml_root(text: str) -> ElementTree.Element:
    """Parse untrusted XML, refusing entity declarations (XXE / entity bombs)."""
    if "<!ENTITY" in text or "<!entity" in text:
        raise ElementTree.ParseError("entity declarations are not allowed")
    return ElementTree.fromstring(text)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_dash(text: str, base_url: str) -> ManifestInfo:
    info = ManifestInfo(kind="dash", is_master=True)
    try:
        root = safe_xml_root(text)
    except ElementTree.ParseError:
        info.warnings.append("invalid_mpd")
        return info
    if _local(root.tag) != "MPD":
        info.warnings.append("not_mpd")
        return info
    info.duration_seconds = parse_iso_duration(root.attrib.get("mediaPresentationDuration"))
    info.live = root.attrib.get("type", "static") == "dynamic"
    for elem in root.iter():
        if _local(elem.tag) == "ContentProtection":
            scheme = (elem.attrib.get("schemeIdUri") or "").lower()
            # mp4protection/cenc marker alone still means encrypted content.
            info.encrypted = True
            if "urn:uuid:" in scheme or "widevine" in scheme or "playready" in scheme or "fairplay" in scheme:
                info.protected = True
    for aset in root.iter():
        if _local(aset.tag) != "AdaptationSet":
            continue
        set_mime = aset.attrib.get("mimeType", "")
        for rep in aset:
            if _local(rep.tag) != "Representation":
                continue
            mime = rep.attrib.get("mimeType", set_mime)
            if mime and not mime.startswith("video"):
                info.has_audio_only_variants = True
                continue

            def _int(name: str, _rep=rep, _set=aset) -> int | None:
                raw = _rep.attrib.get(name) or _set.attrib.get(name)
                return int(raw) if raw and raw.isdigit() else None

            info.variants.append(
                Variant(
                    url=base_url,
                    bandwidth=_int("bandwidth"),
                    width=_int("width"),
                    height=_int("height"),
                    codecs=rep.attrib.get("codecs") or aset.attrib.get("codecs"),
                )
            )
    return info


def pick_variant(variants: list[Variant], max_height: int = 1080) -> Variant | None:
    """Highest quality variant not exceeding max_height (falls back to lowest
    above the cap when nothing fits); audio-only variants are ignored."""
    video = [v for v in variants if v.width or v.height or v.codecs and "avc" in v.codecs]
    if not video:
        return variants[0] if variants else None
    fits = [v for v in video if (v.height or 0) <= max_height]
    pool = fits or sorted(video, key=lambda v: v.height or 0)[:1]

    def key(v: Variant):
        return (v.height or 0, v.bandwidth or 0)

    return max(pool, key=key)
