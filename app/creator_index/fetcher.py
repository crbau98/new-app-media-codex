"""Outbound HTTP for the crawler.

Every production request goes through ``app.media_pipeline.netsafe.safe_fetch``
(SSRF policy enforced at connect time, manual redirects re-validated, byte and
wall-clock caps, process proxy env ignored). ``HttpxFetcher`` exists so tests can
drive the crawler with ``httpx.MockTransport``; it still applies the syntactic
``validate_url`` policy first and is never wired in production.

``GuardedFetcher`` adds, per host: a circuit breaker, a minimum request
interval (rate limit) and random jitter.
"""

from __future__ import annotations

import asyncio
import json
import random
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol
from urllib.parse import urljoin, urlsplit

from app.media_pipeline.netsafe import FetchError, UnsafeUrlError, safe_fetch, validate_url
from app.utils.circuit_breaker import CircuitBreaker

USER_AGENT = "MediaCodexCreatorIndex/1.0 (+public-api; contact via operator)"
MAX_BODY_BYTES = 2 * 1024 * 1024


class SourceError(RuntimeError):
    """A soft failure from a source: the crawler records it and moves on."""

    def __init__(self, code: str, message: str | None = None, status: int | None = None):
        super().__init__(message or code)
        self.code = code
        self.status = status


@dataclass
class JsonResponse:
    status: int
    data: Any
    #: lower-cased response headers (``Link`` pagination for Mastodon); empty for fetchers that do not supply them
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300 and self.data is not None


@dataclass
class TextResponse:
    """A text body (RSS/Atom/HTML). ``url`` is the final URL after redirects."""

    status: int
    text: str
    content_type: str = ""
    url: str = ""
    headers: dict[str, str] = field(default_factory=dict)
    truncated: bool = False

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300 and not self.truncated


class Fetcher(Protocol):
    async def get_json(self, url: str, headers: dict[str, str] | None = None) -> JsonResponse: ...


FEED_ACCEPT = (
    "application/rss+xml, application/atom+xml, application/feed+json, application/json;q=0.9, "
    "application/xml;q=0.8, text/xml;q=0.8, text/html;q=0.4"
)
MAX_REDIRECTS = 5


def _lower(headers: Any) -> dict[str, str]:
    try:
        return {str(k).lower(): str(v) for k, v in dict(headers or {}).items()}
    except (TypeError, ValueError):
        return {}


def _parse(status: int, body: bytes, headers: Any = None) -> JsonResponse:
    if status == 429 or status >= 500:
        raise SourceError("http_%d" % status, f"HTTP {status}", status)
    if not (200 <= status < 300):
        return JsonResponse(status, None)
    try:
        return JsonResponse(status, json.loads(body.decode("utf-8", "replace")), _lower(headers))
    except ValueError:
        return JsonResponse(status, None)


def _text(status: int, body: bytes, headers: Any, url: str, truncated: bool = False) -> TextResponse:
    if status == 429 or status >= 500:
        raise SourceError("http_%d" % status, f"HTTP {status}", status)
    lowered = _lower(headers)
    return TextResponse(
        status=status, text=body.decode("utf-8", "replace"),
        content_type=(lowered.get("content-type") or "").split(";", 1)[0].strip().lower(),
        url=url, headers=lowered, truncated=truncated,
    )


class SafeFetcher:
    """Production fetcher: blocking ``safe_fetch`` executed in a worker thread."""

    def __init__(self, *, timeout: float = 8.0, total_timeout: float = 15.0):
        self.timeout = timeout
        self.total_timeout = total_timeout

    async def get_json(self, url: str, headers: dict[str, str] | None = None) -> JsonResponse:
        hdrs = {"Accept": "application/json", "User-Agent": USER_AGENT, **(headers or {})}
        try:
            res = await asyncio.to_thread(
                safe_fetch, url, headers=hdrs, max_bytes=MAX_BODY_BYTES,
                timeout=self.timeout, total_timeout=self.total_timeout,
            )
        except UnsafeUrlError as exc:
            raise SourceError("unsafe_url", str(exc)) from exc
        except FetchError as exc:
            raise SourceError(exc.code, str(exc)) from exc
        if res.truncated:
            return JsonResponse(res.status, None)
        return _parse(res.status, res.body, getattr(res, "headers", None))

    async def get_text(self, url: str, headers: dict[str, str] | None = None) -> TextResponse:
        hdrs = {"Accept": FEED_ACCEPT, "User-Agent": USER_AGENT, **(headers or {})}
        try:
            res = await asyncio.to_thread(
                safe_fetch, url, headers=hdrs, max_bytes=MAX_BODY_BYTES,
                timeout=self.timeout, total_timeout=self.total_timeout,
            )
        except UnsafeUrlError as exc:
            raise SourceError("unsafe_url", str(exc)) from exc
        except FetchError as exc:
            raise SourceError(exc.code, str(exc)) from exc
        return _text(res.status, res.body, getattr(res, "headers", None), getattr(res, "url", url) or url, bool(res.truncated))


class HttpxFetcher:
    """Test fetcher over an ``httpx.AsyncClient`` (typically a MockTransport)."""

    def __init__(self, client: Any):
        self.client = client

    async def get_json(self, url: str, headers: dict[str, str] | None = None) -> JsonResponse:
        try:
            validate_url(url)
        except UnsafeUrlError as exc:
            raise SourceError("unsafe_url", str(exc)) from exc
        try:
            res = await self.client.get(url, headers={"Accept": "application/json", **(headers or {})})
        except Exception as exc:  # timeouts, connect errors
            raise SourceError(type(exc).__name__.lower(), str(exc)) from exc
        return _parse(res.status_code, res.content, res.headers)

    async def get_text(self, url: str, headers: dict[str, str] | None = None) -> TextResponse:
        current = url
        for _hop in range(MAX_REDIRECTS + 1):
            try:
                validate_url(current)
            except UnsafeUrlError as exc:
                raise SourceError("unsafe_url", str(exc)) from exc
            try:
                res = await self.client.get(current, headers={"Accept": FEED_ACCEPT, **(headers or {})})
            except Exception as exc:
                raise SourceError(type(exc).__name__.lower(), str(exc)) from exc
            if res.status_code in (301, 302, 303, 307, 308) and res.headers.get("location"):
                current = urljoin(current, res.headers["location"])
                continue
            return _text(res.status_code, res.content, res.headers, current)
        raise SourceError("too_many_redirects")


class GuardedFetcher:
    """Per-host circuit breaker + rate limit + jitter around any ``Fetcher``."""

    def __init__(
        self,
        inner: Fetcher,
        *,
        min_interval: float = 0.6,
        jitter: float = 0.4,
        failure_threshold: int = 4,
        recovery_timeout: float = 300.0,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
        rng: random.Random | None = None,
    ):
        self.inner = inner
        self.min_interval = min_interval
        self.jitter = jitter
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._sleep = sleep
        self._clock = clock
        self._rng = rng or random.Random()
        self._breakers: dict[str, CircuitBreaker] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._last: dict[str, float] = {}
        self.requests = 0

    def breaker(self, host: str) -> CircuitBreaker:
        if host not in self._breakers:
            self._breakers[host] = CircuitBreaker(
                f"creator-index:{host}", failure_threshold=self.failure_threshold,
                recovery_timeout=self.recovery_timeout, expected_exception=SourceError,
            )
        return self._breakers[host]

    def is_open(self, host: str) -> bool:
        br = self._breakers.get(host)
        return bool(br and br._state.value == "open" and not _recovered(br))  # noqa: SLF001

    async def get_json(self, url: str, headers: dict[str, str] | None = None) -> JsonResponse:
        return await self._guarded(url, "get_json", headers)

    async def get_text(self, url: str, headers: dict[str, str] | None = None) -> TextResponse:
        if not hasattr(self.inner, "get_text"):
            raise SourceError("unsupported", "fetcher cannot read text bodies")
        return await self._guarded(url, "get_text", headers)

    async def _guarded(self, url: str, method: str, headers: dict[str, str] | None) -> Any:
        host = (urlsplit(url).hostname or "").lower()
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:  # serialises requests per host so the interval is honoured
            wait = self.min_interval - (self._clock() - self._last.get(host, -1e9))
            if wait > 0 or self.jitter:
                await self._sleep(max(0.0, wait) + (self._rng.uniform(0, self.jitter) if self.jitter else 0.0))
            self._last[host] = self._clock()
            self.requests += 1
            try:
                return await self.breaker(host).async_call(getattr(self.inner, method), url, headers)
            except SourceError:
                raise
            except RuntimeError as exc:  # breaker OPEN
                raise SourceError("circuit_open", str(exc)) from exc


def _recovered(br: CircuitBreaker) -> bool:
    last = br._last_failure_time  # noqa: SLF001
    return last is not None and (time.monotonic() - last) >= br.recovery_timeout
