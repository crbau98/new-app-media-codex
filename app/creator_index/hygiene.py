"""Shared hygiene rules: redaction, exclusion markers, media-host allow-list.

These mirror the edge (`frontend/api/_lib/redgifs.ts`, `discovery-lanes.ts`):
exclusion markers apply to structured fields only (user name, tags, niches),
never to free-text descriptions, and only one item is dropped, never a whole
creator on the strength of a caption.
"""

from __future__ import annotations

import re
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(r"(?<![\w])(?:\+?\d[\d\s().-]{7,}\d)(?![\w])")

EXCLUDED_MARKERS = frozenset({
    "female", "woman", "women", "girl", "lesbian", "straight", "pussy", "vagina", "hetero",
    "girlfriend", "wife", "b/g", "m/f", "boob", "breast", "tits", "milf", "femdom",
    "girls", "chick", "chicks", "females",
})

# Hard safety markers: minor-related and non-consent / voyeur / stolen-content terms. Unlike the
# exclusion markers above these are matched on titles as well as structured fields: a false
# positive only drops one item, a false negative is unacceptable.
_SAFETY_RE = re.compile(
    r"\b(?:under-?age|minors?|jail-?bait|lolita?s?|loli-?con|shota(?:con)?|pre-?teens?|pedo\w*|paedo\w*|"
    r"child(?:ren)?|kiddie|kids?|school-?boys?|non-?consen\w*|rap(?:e|ed|es|ing)|drugged|roofie\w*|"
    r"revenge-?porn|hidden-?cams?|spy-?cams?|voyeur\w*|upskirts?|creep-?shots?)\b",
    re.I,
)
# Leak / mirror / rip markers (used on URL path segments and feed titles at submission time).
_LEAK_RE = re.compile(
    r"\b(?:leaks?|leaked|leakers?|stolen|hacked|doxx?(?:ed|ing)?|mega-?links?|piracy|pirated|"
    r"onlyfans-?rips?|nudes-?leak)\b",
    re.I,
)
# Male/gay allow tokens: a *provider-supplied* tag, niche or community name must contain one of these
# before it is promoted into a crawl lane (keeps tag snowballing inside the product's scope).
MALE_TOKENS = frozenset({
    "gay", "male", "men", "man", "guy", "guys", "bear", "bears", "twink", "twinks", "jock", "jocks",
    "daddy", "daddies", "hunk", "hunks", "otter", "otters", "muscle", "muscles", "dilf", "stud", "studs",
    "bi", "bisexual", "msm", "mlm", "twunk", "cub", "cubs", "lads", "boys",
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


def safety_marker(*fields: Any) -> str:
    """First minor-related / non-consent marker found in the given text, else ''."""
    text = " ".join(str(f) for f in fields if f)
    match = _SAFETY_RE.search(re.sub(r"[_/.]+", "-", text))
    return match.group(0).lower() if match else ""


def leak_marker(*fields: Any) -> str:
    """First leak / mirror / rip marker in the given text (URL path words, titles), else ''."""
    text = " ".join(str(f) for f in fields if f)
    match = _LEAK_RE.search(re.sub(r"[_/.]+", "-", text))
    return match.group(0).lower() if match else ""


def has_male_token(value: Any) -> bool:
    tokens = {t for t in re.split(r"[^a-z0-9]+", str(value or "").lower()) if t}
    return not MALE_TOKENS.isdisjoint(tokens)


_TRACKING_PARAMS = ("utm_", "fbclid", "gclid", "mc_", "ref", "igshid")


def canonical_url(value: Any, *, keep_query: bool = True) -> str:
    """Stable identity for a URL: https scheme, lowercase host without ``www.``, default port, fragment,
    tracking params and trailing slash removed. Returns '' for anything that is not an http(s) URL."""
    try:
        parts = urlsplit(str(value or "").strip())
        port = parts.port
    except ValueError:
        return ""
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        return ""
    host = parts.hostname.lower().rstrip(".").removeprefix("www.")
    netloc = host if port in (None, 80, 443) else f"{host}:{port}"
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    if len(path) > 1:
        path = path.rstrip("/")
    query = ""
    if keep_query and parts.query:
        pairs = sorted(
            (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not k.lower().startswith(_TRACKING_PARAMS)
        )
        query = urlencode(pairs)
    return f"https://{netloc}{path}" + (f"?{query}" if query else "")


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
