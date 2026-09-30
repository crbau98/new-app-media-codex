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
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol
from urllib.parse import urlsplit

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

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300 and self.data is not None


class Fetcher(Protocol):
    async def get_json(self, url: str, headers: dict[str, str] | None = None) -> JsonResponse: ...


def _parse(status: int, body: bytes) -> JsonResponse:
    if status == 429 or status >= 500:
        raise SourceError("http_%d" % status, f"HTTP {status}", status)
    if not (200 <= status < 300):
        return JsonResponse(status, None)
    try:
        return JsonResponse(status, json.loads(body.decode("utf-8", "replace")))
    except ValueError:
        return JsonResponse(status, None)


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
        return _parse(res.status, res.body)


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
        return _parse(res.status_code, res.content)


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
        host = (urlsplit(url).hostname or "").lower()
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:  # serialises requests per host so the interval is honoured
            wait = self.min_interval - (self._clock() - self._last.get(host, -1e9))
            if wait > 0 or self.jitter:
                await self._sleep(max(0.0, wait) + (self._rng.uniform(0, self.jitter) if self.jitter else 0.0))
            self._last[host] = self._clock()
            self.requests += 1
            try:
                return await self.breaker(host).async_call(self.inner.get_json, url, headers)
            except SourceError:
                raise
            except RuntimeError as exc:  # breaker OPEN
                raise SourceError("circuit_open", str(exc)) from exc


def _recovered(br: CircuitBreaker) -> bool:
    last = br._last_failure_time  # noqa: SLF001
    return last is not None and (time.monotonic() - last) >= br.recovery_timeout
