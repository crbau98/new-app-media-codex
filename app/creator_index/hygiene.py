"""Shared hygiene rules: redaction, exclusion markers, media-host allow-list.

These mirror the edge (`frontend/api/_lib/redgifs.ts`, `discovery-lanes.ts`):
exclusion markers apply to structured fields only (user name, tags, niches),
never to free-text descriptions, and only one item is dropped, never a whole
creator on the strength of a caption.
"""

from __future__ import annotations

import re
from typing import Any, Iterable
from urllib.parse import urlsplit

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(r"(?<![\w])(?:\+?\d[\d\s().-]{7,}\d)(?![\w])")

EXCLUDED_MARKERS = frozenset({
    "female", "woman", "women", "girl", "lesbian", "straight", "pussy", "vagina", "hetero",
    "girlfriend", "wife", "b/g", "m/f", "boob", "breast", "tits", "milf", "femdom",
    "girls", "chick", "chicks", "females",
})

# Same allow-list the edge uses for proxied media URLs (`safeProviderMediaUrl`).
_ALLOWED_MEDIA_HOST = re.compile(r"^(?:media|thumbs\d*)\.redgifs\.com$", re.I)

MAX_TAGS_STORED = 40
MAX_TAGS_SERVED = 20
MAX_SAMPLE_MEDIA = 6


def redact(value: Any) -> str:
    """Strip emails and phone numbers from display text."""
    text = str(value or "")
    text = EMAIL_RE.sub("", text)
    text = PHONE_RE.sub("", text)
    text = re.sub(r"\s{2,}", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text.strip()


def has_contact_info(value: Any) -> bool:
    text = str(value or "")
    return bool(EMAIL_RE.search(text) or PHONE_RE.search(text))


def canonical(value: str) -> str:
    """Matching identity; identical to the edge's `canonicalCreator`."""
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def clean_handle(value: str) -> str:
    """Stored handle: lowercase, keeps `_ . - @` so distinct accounts stay distinct.

    Federated ids (`name@host`) look like emails, so emails are not redacted here; callers
    reject `@` handles for platforms that cannot have them. Phone-number-like handles are dropped."""
    text = str(value or "").strip()
    if PHONE_RE.search(text):
        return ""
    return re.sub(r"[^a-z0-9_.@-]+", "", text.lstrip("@").lower())[:80]


def clean_tag(value: Any) -> str:
    tag = redact(value).strip().lstrip("#").lower()
    tag = re.sub(r"\s+", " ", tag)
    tag = re.sub(r"[^\w +&'/-]+", "", tag, flags=re.UNICODE).strip()
    return tag[:40] if len(tag) >= 2 else ""


def has_excluded_marker(fields: Iterable[str]) -> bool:
    tokens = {t for t in re.split(r"[^a-z0-9/]+", " ".join(f for f in fields if f).lower()) if t}
    return not EXCLUDED_MARKERS.isdisjoint(tokens)


def safe_media_url(value: Any) -> str | None:
    """Return the URL only when it is an allow-listed https provider media host."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parts = urlsplit(value)
        if parts.scheme != "https" or parts.username or parts.password or parts.port:
            return None
        if not _ALLOWED_MEDIA_HOST.match(parts.hostname or ""):
            return None
    except ValueError:
        return None
    return value


def safe_profile_url(value: Any) -> str:
    """Profile/page links only need to be plain https URLs (they are links, not fetched)."""
    if not isinstance(value, str) or not value:
        return ""
    try:
        parts = urlsplit(value)
        if parts.scheme != "https" or parts.username or parts.password or not parts.hostname:
            return ""
    except ValueError:
        return ""
    return value[:500]


def to_int(value: Any, default: int = 0) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, n)
