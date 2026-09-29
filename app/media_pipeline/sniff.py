"""Magic-byte content sniffing. Content-Type headers and file extensions lie;
the first bytes do not."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Extension -> canonical mime for the formats ingestion accepts.
EXT_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".ts": "video/mp2t",
    ".flv": "video/x-flv",
    ".ogv": "video/ogg",
    ".m3u8": "application/vnd.apple.mpegurl",
    ".mpd": "application/dash+xml",
}

# mime -> extensions considered a valid match for that sniffed mime.
MIME_EXTS: dict[str, tuple[str, ...]] = {}
for _ext, _mime in EXT_MIME.items():
    MIME_EXTS.setdefault(_mime, ())
    MIME_EXTS[_mime] = MIME_EXTS[_mime] + (_ext,)
MIME_EXTS["video/mp4"] = (".mp4", ".m4v", ".mov")
MIME_EXTS["video/quicktime"] = (".mov", ".mp4", ".m4v")
MIME_EXTS["image/heic"] = (".heic", ".heif")
MIME_EXTS["image/heif"] = (".heic", ".heif")


@dataclass(frozen=True)
class Sniff:
    kind: str  # image | video | hls | dash | html | feed | json | unknown
    mime: str | None
    ext: str | None = None
    detail: str = ""

    @property
    def is_media(self) -> bool:
        return self.kind in {"image", "video"}


_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"heif"}
_AVIF_BRANDS = {b"avif", b"avis"}
_QT_BRANDS = {b"qt  "}


def _iso_bmff_brand(head: bytes) -> tuple[bytes, list[bytes]] | None:
    if len(head) < 12 or head[4:8] != b"ftyp":
        return None
    size = int.from_bytes(head[0:4], "big")
    major = head[8:12]
    compat: list[bytes] = []
    end = min(len(head), size if size >= 16 else 32)
    for i in range(16, end - 3, 4):
        compat.append(head[i : i + 4])
    return major, compat


def _matroska_doctype(head: bytes) -> str:
    idx = head.find(b"\x42\x82")  # EBML DocType element id
    if idx < 0 or idx + 3 >= len(head):
        return "matroska"
    length = head[idx + 2] & 0x7F
    return head[idx + 3 : idx + 3 + length].decode("ascii", "ignore").lower() or "matroska"


def sniff_bytes(head: bytes) -> Sniff:
    """Classify by leading bytes (needs at least ~16 bytes; more is better)."""
    if not head:
        return Sniff("unknown", None)
    b = head[:4096]
    if b.startswith(b"\xff\xd8\xff"):
        return Sniff("image", "image/jpeg", ".jpg")
    if b.startswith(b"\x89PNG\r\n\x1a\n"):
        return Sniff("image", "image/png", ".png")
    if b.startswith((b"GIF87a", b"GIF89a")):
        return Sniff("image", "image/gif", ".gif")
    if b.startswith(b"RIFF") and len(b) >= 12:
        form = b[8:12]
        if form == b"WEBP":
            return Sniff("image", "image/webp", ".webp")
        if form == b"AVI ":
            return Sniff("video", "video/x-msvideo", ".avi")
    if b.startswith(b"BM") and len(b) > 14 and b[6:10] == b"\x00\x00\x00\x00":
        return Sniff("image", "image/bmp", ".bmp")
    if b.startswith((b"II*\x00", b"MM\x00*")):
        return Sniff("image", "image/tiff", ".tiff")
    brand = _iso_bmff_brand(b)
    if brand is not None:
        major, compat = brand
        brands = {major, *compat}
        if brands & _AVIF_BRANDS:
            return Sniff("image", "image/avif", ".avif", detail="avif")
        if major in _HEIC_BRANDS and not brands & {b"isom", b"mp41", b"mp42"}:
            return Sniff("image", "image/heic", ".heic", detail="heic")
        if major in _QT_BRANDS:
            return Sniff("video", "video/quicktime", ".mov", detail="qt")
        return Sniff("video", "video/mp4", ".mp4", detail=major.decode("ascii", "ignore"))
    if b.startswith(b"\x1a\x45\xdf\xa3"):
        doctype = _matroska_doctype(b)
        if "webm" in doctype:
            return Sniff("video", "video/webm", ".webm")
        return Sniff("video", "video/x-matroska", ".mkv")
    if b.startswith(b"FLV\x01"):
        return Sniff("video", "video/x-flv", ".flv")
    if b.startswith(b"OggS"):
        return Sniff("video", "video/ogg", ".ogv", detail="ogg")
    if len(b) >= 377 and b[0] == 0x47 and b[188] == 0x47 and b[376] == 0x47:
        return Sniff("video", "video/mp2t", ".ts")
    # Text formats: strip BOM/whitespace.
    text = b.lstrip(b"\xef\xbb\xbf \t\r\n")
    lower = text[:512].lower()
    if lower.startswith(b"#extm3u"):
        return Sniff("hls", "application/vnd.apple.mpegurl", ".m3u8")
    if b"<mpd" in lower[:400]:
        return Sniff("dash", "application/dash+xml", ".mpd")
    if lower.startswith((b"<!doctype html", b"<html", b"<head", b"<body")) or re.search(rb"<html[\s>]", lower):
        return Sniff("html", "text/html")
    if lower.startswith((b"<?xml", b"<rss", b"<feed", b"<rdf")):
        if b"<rss" in lower or b"<feed" in lower or b"<rdf" in lower or b"<channel" in b[:2048].lower():
            return Sniff("feed", "application/xml")
        return Sniff("feed" if b"<rss" in b[:2048].lower() else "unknown", "application/xml")
    if lower.startswith((b"{", b"[")):
        return Sniff("json", "application/json")
    if b"<svg" in lower:
        return Sniff("unknown", "image/svg+xml", detail="svg-not-accepted")
    return Sniff("unknown", None)


def extension_of(name_or_url: str) -> str:
    path = name_or_url.split("?", 1)[0].split("#", 1)[0]
    dot = path.rfind(".")
    slash = max(path.rfind("/"), path.rfind("\\"))
    if dot <= slash or dot < 0:
        return ""
    return path[dot:].lower()


def extension_matches(sniffed_mime: str | None, filename: str) -> bool:
    """True when the filename extension is consistent with the sniffed mime.
    A missing extension is tolerated."""
    ext = extension_of(filename)
    if not ext or not sniffed_mime:
        return True
    allowed = MIME_EXTS.get(sniffed_mime)
    if allowed is None:
        return True
    if ext in allowed:
        return True
    # jpeg aliases etc.
    return EXT_MIME.get(ext) == sniffed_mime
