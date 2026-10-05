"""Abuse controls for the two unauthenticated write endpoints (feed submission, takedown).

* contact e-mails and client IPs are only ever stored as salted HMAC digests;
* a sliding-window limiter (per client + global) with an injectable clock;
* strict e-mail / body validation helpers.

Salt: ``PRIVACY_HASH_SALT`` (recommended, set it on Render) else a random salt generated once and
persisted in ``creator_crawl_state`` so digests stay stable across restarts.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import threading
import time
from collections import deque
from typing import Any, Callable

from fastapi import Request

from app.creator_index.config import env_flag

SALT_STATE_KEY = "privacy_salt"
_EMAIL_RE = re.compile(r"^[a-z0-9._%+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")
_SALT_LOCK = threading.Lock()


def normalize_email(value: Any) -> str | None:
    """Lower-cased e-mail, or None when it is not a plausible address."""
    email = str(value or "").strip().lower()
    if len(email) > 254 or not _EMAIL_RE.match(email):
        return None
    return email


def hash_value(value: str, salt: str) -> str:
    """Salted HMAC-SHA256 digest (hex, truncated to 40 chars): not reversible without the salt."""
    return hmac.new(salt.encode("utf-8"), value.strip().lower().encode("utf-8"), hashlib.sha256).hexdigest()[:40]


def get_salt(get_state: Callable[[str, Any], Any], set_state: Callable[[str, Any], None]) -> str:
    configured = os.environ.get("PRIVACY_HASH_SALT", "").strip()
    if configured:
        return configured
    with _SALT_LOCK:
        stored = get_state(SALT_STATE_KEY, "")
        if isinstance(stored, str) and len(stored) >= 16:
            return stored
        fresh = secrets.token_hex(24)
        set_state(SALT_STATE_KEY, fresh)
        return fresh


def client_ip(request: Request) -> str:
    """Best-effort client address.

    The Vercel gateway forwards the visitor address as ``X-Client-IP`` (the backend only ever sees
    the gateway otherwise). Direct callers can spoof it, which is why every limiter also has a
    global ceiling; set ``TRUST_GATEWAY_CLIENT_IP=0`` to ignore the header entirely.
    """
    if env_flag("TRUST_GATEWAY_CLIENT_IP", True):
        forwarded = (request.headers.get("x-client-ip") or "").strip()
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return request.client.host if request.client else "unknown"


class RateLimited(Exception):
    def __init__(self, retry_after: float, scope: str = "client"):
        super().__init__("rate_limited")
        self.retry_after = retry_after
        self.scope = scope


class SlidingWindowLimiter:
    """At most ``limit`` events per ``window`` seconds per key (in-process; single instance)."""

    def __init__(self, limit: int, window: float = 3600.0, *, clock: Callable[[], float] = time.monotonic,
                 max_keys: int = 8192):
        self.limit = max(1, int(limit))
        self.window = float(window)
        self._clock = clock
        self._max_keys = max_keys
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> tuple[bool, float]:
        """Record an attempt. Returns ``(allowed, retry_after_seconds)``; a denied attempt is not recorded."""
        now = self._clock()
        with self._lock:
            events = self._events.get(key)
            if events is None:
                if len(self._events) >= self._max_keys:
                    self._prune(now)
                events = self._events[key] = deque()
            while events and now - events[0] >= self.window:
                events.popleft()
            if len(events) >= self.limit:
                return False, max(1.0, self.window - (now - events[0]))
            events.append(now)
            return True, 0.0

    def _prune(self, now: float) -> None:
        for key in [k for k, ev in self._events.items() if not ev or now - ev[-1] >= self.window]:
            del self._events[key]
        while len(self._events) >= self._max_keys:  # still full: drop the stalest key
            del self._events[min(self._events, key=lambda k: self._events[k][-1])]
