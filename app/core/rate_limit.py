"""Rate limiting behind a protocol: in-process now, Valkey at multi-instance.

The middleware/routers depend only on ``RateLimiter``. Swapping the
implementation is a one-line change in ``app/api/deps.py`` when the first
second instance is deployed (blueprint section 8/11).
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    remaining: int
    retry_after_seconds: float


class RateLimiter(Protocol):
    async def check(self, key: str, cost: int = 1) -> RateLimitDecision: ...


class InMemoryTokenBucket:
    """Thread-safe token bucket per key. Single-instance only (ADR-0002).

    Behaviour matches the legacy ``_check_rate_limit`` in main.py; the state
    just lives behind a swappable protocol now.
    """

    def __init__(self, capacity: int = 60, refill_per_second: float = 30.0, max_buckets: int = 8192):
        self._capacity = capacity
        self._refill = refill_per_second
        self._max_buckets = max_buckets
        self._lock = threading.Lock()
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, last_refill)

    async def check(self, key: str, cost: int = 1) -> RateLimitDecision:
        now = time.monotonic()
        with self._lock:
            tokens, last = self._buckets.get(key, (float(self._capacity), now))
            tokens = min(self._capacity, tokens + (now - last) * self._refill)
            if key not in self._buckets and len(self._buckets) >= self._max_buckets:
                oldest = min(self._buckets, key=lambda k: self._buckets[k][1])
                del self._buckets[oldest]
            if tokens >= cost:
                self._buckets[key] = (tokens - cost, now)
                return RateLimitDecision(True, int(tokens - cost), 0.0)
            self._buckets[key] = (tokens, now)
            deficit = cost - tokens
            retry = deficit / self._refill if self._refill > 0 else 1.0
            return RateLimitDecision(False, 0, max(retry, 0.5))


_LUA_TOKEN_BUCKET = """
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(bucket[1]) or tonumber(ARGV[1])
local ts = tonumber(bucket[2]) or tonumber(ARGV[4])
local elapsed = math.max(0, tonumber(ARGV[4]) - ts)
tokens = math.min(tonumber(ARGV[1]), tokens + elapsed * tonumber(ARGV[2]))
local cost = tonumber(ARGV[3])
if tokens >= cost then
  redis.call('HMSET', KEYS[1], 'tokens', tokens - cost, 'ts', ARGV[4])
  redis.call('EXPIRE', KEYS[1], 120)
  return {1, math.floor(tokens - cost), 0}
else
  redis.call('HMSET', KEYS[1], 'tokens', tokens, 'ts', ARGV[4])
  redis.call('EXPIRE', KEYS[1], 120)
  return {0, 0, (cost - tokens) / tonumber(ARGV[2])}
end
"""


class ValkeyTokenBucket:
    """Distributed token bucket (atomic Lua). Drop-in at multi-instance.

    ``client`` is any redis-py-compatible async client (valkey-glide works).
    """

    def __init__(self, client, capacity: int = 60, refill_per_second: float = 30.0, prefix: str = "rl"):
        self._client = client
        self._capacity = capacity
        self._refill = refill_per_second
        self._prefix = prefix

    async def check(self, key: str, cost: int = 1) -> RateLimitDecision:
        now = time.time()
        allowed, remaining, retry = await self._client.eval(
            _LUA_TOKEN_BUCKET,
            1,
            f"{self._prefix}:{key}",
            self._capacity,
            self._refill,
            cost,
            now,
        )
        return RateLimitDecision(bool(allowed), int(remaining), float(retry))


def build_limiter(redis_url: str | None, capacity: int, refill_per_second: float) -> RateLimiter:
    """Factory used by app/api/deps.py. Memory unless a Valkey/Redis URL is set."""
    if redis_url:
        try:  # optional dependency until multi-instance (blueprint section 1)
            import redis.asyncio as redis_async  # type: ignore

            return ValkeyTokenBucket(redis_async.from_url(redis_url), capacity, refill_per_second)
        except ImportError:
            import logging

            logging.getLogger("app.core.rate_limit").warning(
                "REDIS_URL set but redis-py is not installed; falling back to in-memory rate limiting"
            )
    return InMemoryTokenBucket(capacity, refill_per_second)
