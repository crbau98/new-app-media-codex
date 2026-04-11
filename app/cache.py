"""Thread-safe, TTL-based in-memory cache with LRU-style eviction."""
from __future__ import annotations

import time
from threading import Lock
from typing import Any, Callable, Generic, TypeVar

_MISSING = object()

K = TypeVar("K")
V = TypeVar("V")


class TimedCache(Generic[K, V]):
    """A simple thread-safe cache with per-entry TTL and a maximum size.

    When the cache reaches ``max_size`` entries, the oldest (by insertion/
    expiry order) entries are evicted first.  Expired entries are lazily
    removed on every read or write.

    Usage::

        cache: TimedCache[str, dict] = TimedCache(ttl=60.0, max_size=256)

        value = cache.get("key")          # None on miss
        cache.set("key", payload, ttl=30) # optional per-entry TTL override
        value = cache.get_or_set("key", builder, ttl=60)
    """

    def __init__(self, ttl: float = 60.0, max_size: int = 512) -> None:
        self._ttl = ttl
        self._max_size = max_size
        self._data: dict[Any, dict[str, Any]] = {}
        self._lock = Lock()

    # ── internals ────────────────────────────────────────────────────────

    def _evict_expired(self, now: float) -> None:
        """Remove expired entries. Must be called with lock held."""
        expired = [k for k, v in self._data.items() if now >= v["exp"]]
        for k in expired:
            del self._data[k]

    def _evict_oldest(self) -> None:
        """Remove the entry with the smallest expiry. Must be called with lock held."""
        if not self._data:
            return
        oldest_key = min(self._data, key=lambda k: self._data[k]["exp"])
        del self._data[oldest_key]

    # ── public API ────────────────────────────────────────────────────────

    def get(self, key: K) -> V | None:
        """Return the cached value or ``None`` if missing / expired."""
        now = time.monotonic()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            if now >= entry["exp"]:
                del self._data[key]
                return None
            return entry["val"]

    def set(self, key: K, value: V, ttl: float | None = None) -> None:
        """Store *value* under *key* with an optional per-entry TTL override."""
        exp = time.monotonic() + (ttl if ttl is not None else self._ttl)
        with self._lock:
            now = time.monotonic()
            self._evict_expired(now)
            # Evict oldest until we have room (allow replacing an existing key)
            while len(self._data) >= self._max_size and key not in self._data:
                self._evict_oldest()
            self._data[key] = {"val": value, "exp": exp}

    def get_or_set(
        self,
        key: K,
        builder: Callable[[], V],
        ttl: float | None = None,
    ) -> V:
        """Return cached value if fresh; otherwise call *builder*, cache, and return the result."""
        hit = self.get(key)
        if hit is not None:
            return hit
        value = builder()
        self.set(key, value, ttl=ttl)
        return value

    def invalidate(self, key: K) -> None:
        """Remove a single entry if present."""
        with self._lock:
            self._data.pop(key, None)

    def clear(self) -> None:
        """Remove all entries."""
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)
