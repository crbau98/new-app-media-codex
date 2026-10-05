"""Shared building blocks for the official-API discovery collectors.

Nothing here touches disk, logs credentials, or follows redirects. Outbound
requests go through :func:`api_request`, which only talks to a fixed set of
official API hosts (SSRF-safe by construction: callers never pass a
user-controlled host).
"""

from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Sequence
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Text hygiene
# ---------------------------------------------------------------------------

_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
# International / NANP style numbers: optional +CC, optional (area), then 3+3-4 digit
# groups with optional space, dot or dash separators. Bounded so tweet ids and
# ISO dates are left alone (the lookbehind also skips URL path segments).
_PHONE = re.compile(r"(?<![\w/.])(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.\-]?\d{3}[\s.\-]?\d{3,4}(?![\w/])")
_HANDLE = re.compile(r"[^a-zA-Z0-9_]")
_SPACES = re.compile(r"[ \t ]{2,}")
_SHORTLINK = re.compile(r"https?://t\.co/\S+", re.I)


def clean_text(value: Any) -> str:
    """Redact emails and phone numbers and strip control characters."""
    # Provider text is capped before the regexes run (they are bounded, but input is untrusted).
    text = str(value or "")[:8000].replace("\x00", " ")
    text = _EMAIL.sub("", text)
    text = _PHONE.sub("", text)
    return _SPACES.sub(" ", text).strip()


def strip_shortlinks(value: Any) -> str:
    return _SHORTLINK.sub("", str(value or "")).strip()


def canonical(value: str) -> str:
    return _HANDLE.sub("", str(value or "").lstrip("@")).lower()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def iso_from_epoch(value: Any) -> str:
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")
    return now_iso()


def clean_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


# ---------------------------------------------------------------------------
# URL allow-lists
# ---------------------------------------------------------------------------


def safe_https(value: Any, host_suffix: str) -> str:
    return safe_https_any(value, (host_suffix,))


def safe_https_any(value: Any, host_suffixes: Iterable[str]) -> str:
    """Return the URL when it is https, credential-free and on an allowed domain, else ''."""
    candidate = clean_text(value)
    try:
        parsed = urlparse(candidate)
        parsed.port  # noqa: B018 - raises ValueError on a malformed port
    except ValueError:
        return ""
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or not host:
        return ""
    for suffix in host_suffixes:
        if host == suffix or host.endswith(f".{suffix}"):
            return candidate
    return ""


def url_host(value: Any) -> str:
    try:
        return (urlparse(str(value or "")).hostname or "").lower()
    except ValueError:
        return ""


# ---------------------------------------------------------------------------
# Response shapes (shared with the Vercel edge tier)
# ---------------------------------------------------------------------------


def source_status(
    source_id: str,
    name: str,
    mode: str,
    state: str,
    detail: str,
    *,
    media: int = 0,
    creators: int = 0,
    search_url: str = "",
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": source_id,
        "name": name,
        "mode": mode,
        "state": state,
        "mediaFound": media,
        "creatorsFound": creators,
        "detail": detail,
    }
    if search_url:
        result["searchUrl"] = search_url
    return result


def empty_result(status: dict[str, Any], attempted: int = 0, succeeded: int = 0) -> dict[str, Any]:
    return {"media": [], "leads": [], "status": status, "attempted": attempted, "succeeded": succeeded}


def _duration_label(seconds: float) -> str:
    whole = max(0, int(seconds or 0))
    return f"{whole // 60}:{whole % 60:02d}" if whole else ""


def media_item(
    *,
    item_id: str,
    title: str,
    thumbnail: str,
    source: str,
    creator: str,
    page_url: str,
    profile_url: str,
    created_at: str,
    tags: list[str],
    description: str,
    media_url: str = "",
    is_video: bool = False,
    views: int = 0,
    likes: int = 0,
    comments: int = 0,
    watched: bool = False,
    stream_candidates: Sequence[str] | None = None,
    reason: str = "",
    width: int = 0,
    height: int = 0,
    duration_seconds: float = 0,
) -> dict[str, Any]:
    if stream_candidates is None:
        candidates = [media_url] if media_url else []
    else:
        candidates = [url for url in stream_candidates if url]
    reasons: list[str] = []
    if reason:
        reasons.append(clean_text(reason)[:120])
    if watched:
        reasons.append("creator is on your watchlist")
    item: dict[str, Any] = {
        "id": item_id,
        "title": clean_text(title)[:96] or f"Public post by {creator}",
        "thumbnail": thumbnail or None,
        "source": source,
        "duration": _duration_label(duration_seconds),
        "isVideo": is_video,
        "category": f"{source} public posts",
        "creator": clean_text(creator) or "Public creator",
        "tags": [clean_text(tag)[:40] for tag in tags if clean_text(tag)][:12],
        "rating": 0,
        "createdAt": created_at or now_iso(),
        "views": max(0, views),
        "mediaUrl": media_url or None,
        "streamCandidates": candidates,
        "pageUrl": page_url,
        "profileUrl": profile_url,
        "description": clean_text(description)[:1000],
        "likes": max(0, likes),
        "comments": max(0, comments),
        "isLiked": False,
        "isNew": True,
        "isTrending": False,
        "curationScore": 0,
        "curationReasons": reasons,
        "isWatchedCreator": watched,
    }
    # Optional media-intelligence contract fields: only when the provider told us.
    if width > 0 and height > 0:
        item["width"] = int(width)
        item["height"] = int(height)
    if duration_seconds and duration_seconds > 0:
        item["durationSeconds"] = round(float(duration_seconds), 3)
    return item


def mark_watched(item: dict[str, Any], watched: bool) -> dict[str, Any]:
    """Copy of a (possibly cached) item with the watchlist flag applied."""
    copy = dict(item)
    reasons = [reason for reason in item.get("curationReasons", []) if reason != "creator is on your watchlist"]
    if watched:
        reasons.append("creator is on your watchlist")
    copy["curationReasons"] = reasons
    copy["isWatchedCreator"] = watched
    return copy


# ---------------------------------------------------------------------------
# Settings access (collectors accept the real Settings or a SimpleNamespace)
# ---------------------------------------------------------------------------


def int_setting(settings: Any, name: str, default: int, *, minimum: int = 0, maximum: int = 10_000) -> int:
    try:
        value = int(getattr(settings, name, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def text_setting(settings: Any, name: str, default: str = "") -> str:
    value = getattr(settings, name, default)
    return value.strip() if isinstance(value, str) else default


def split_list(raw: str, separator: str = ",") -> list[str]:
    seen: set[str] = set()
    values: list[str] = []
    for part in str(raw or "").split(separator):
        value = part.strip()
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            values.append(value)
    return values


# ---------------------------------------------------------------------------
# In-memory TTL cache (thread-safe, bounded, never persisted)
# ---------------------------------------------------------------------------


class TTLCache:
    def __init__(self, max_entries: int = 256, clock: Callable[[], float] = time.monotonic) -> None:
        self._max = max_entries
        self._clock = clock
        self._lock = threading.Lock()
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            expires, value = entry
            if expires <= self._clock():
                self._data.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        now = self._clock()
        with self._lock:
            if len(self._data) >= self._max and key not in self._data:
                for stale in [k for k, (expires, _) in self._data.items() if expires <= now]:
                    self._data.pop(stale, None)
                while len(self._data) >= self._max:
                    # Drop the entry closest to expiry (oldest write for equal TTLs).
                    self._data.pop(min(self._data, key=lambda k: self._data[k][0]), None)
            self._data[key] = (now + ttl, value)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)


# ---------------------------------------------------------------------------
# Official API transport
# ---------------------------------------------------------------------------

# Fixed hosts only. Collectors never build a request URL from provider data.
ALLOWED_API_HOSTS = frozenset({"api.x.com", "oauth.reddit.com", "www.reddit.com"})


@dataclass
class ApiResponse:
    status: int = 0
    data: Any = None
    headers: dict[str, str] = field(default_factory=dict)
    error: str = ""  # '' | 'blocked-host' | 'timeout' | 'network' | 'invalid-json'

    @property
    def ok(self) -> bool:
        return not self.error and 200 <= self.status < 300


def api_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    timeout: float,
    params: dict[str, Any] | None = None,
    data: dict[str, Any] | None = None,
    auth: tuple[str, str] | None = None,
) -> ApiResponse:
    """One bounded official-API request. Never raises, never follows redirects."""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
    except ValueError:
        return ApiResponse(error="blocked-host")
    if parsed.scheme != "https" or host not in ALLOWED_API_HOSTS or parsed.username or parsed.password:
        return ApiResponse(error="blocked-host")
    try:
        response = requests.request(
            method,
            url,
            headers=headers,
            params=params,
            data=data,
            auth=auth,
            timeout=timeout,
            allow_redirects=False,
        )
    except requests.Timeout:
        return ApiResponse(error="timeout")
    except requests.RequestException:
        return ApiResponse(error="network")
    except Exception:  # noqa: BLE001 - transport must never raise into the gateway
        return ApiResponse(error="network")
    lowered = {str(key).lower(): str(value) for key, value in dict(getattr(response, "headers", {}) or {}).items()}
    body: Any = None
    error = ""
    try:
        body = response.json()
    except ValueError:
        if 200 <= int(response.status_code) < 300:
            error = "invalid-json"
    return ApiResponse(status=int(response.status_code), data=body, headers=lowered, error=error)


def call_timeout(settings: Any, deadline: float, cap: float = 6.0) -> float | None:
    """Per-call timeout clamped to the source deadline; None when no time is left."""
    base = float(min(int_setting(settings, "request_timeout_seconds", 20, minimum=1, maximum=60), cap))
    remaining = deadline - time.monotonic()
    if remaining <= 0.3:
        return None
    return max(0.5, min(base, remaining))


def run_parallel(
    fn: Callable[[Any], Any],
    items: Sequence[Any],
    *,
    deadline: float,
    max_workers: int = 4,
) -> list[Any]:
    """Run ``fn`` over ``items`` concurrently; results keep order, failures/timeouts are None.

    Workers that outlive the deadline are abandoned (never joined) so one slow
    provider call cannot stall the gateway response.
    """
    if not items:
        return []

    def guarded(item: Any) -> Any:
        try:
            return fn(item)
        except Exception:  # noqa: BLE001
            return None

    pool = ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(items))), thread_name_prefix="discovery")
    try:
        futures = [pool.submit(guarded, item) for item in items]
        wait(futures, timeout=max(0.0, deadline - time.monotonic()))
        return [future.result() if future.done() and not future.cancelled() else None for future in futures]
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


class RunCounter:
    """Thread-safe request counters + problem log for one collector run."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.attempted = 0
        self.succeeded = 0
        self.data_succeeded = 0
        self.cache_hits = 0
        self.problems: list[dict[str, Any]] = []

    def attempt(self) -> None:
        with self._lock:
            self.attempted += 1

    def success(self, *, data: bool = True) -> None:
        """Count a successful request; ``data=False`` for auth handshakes that carry no content."""
        with self._lock:
            self.succeeded += 1
            if data:
                self.data_succeeded += 1

    def hit(self) -> None:
        with self._lock:
            self.cache_hits += 1

    def problem(self, kind: str, status: int = 0, detail: str = "", reset_epoch: float = 0.0) -> None:
        with self._lock:
            self.problems.append({"kind": kind, "status": status, "detail": detail, "reset": reset_epoch})
