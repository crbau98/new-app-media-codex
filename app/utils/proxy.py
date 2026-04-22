from __future__ import annotations

import itertools
import os
import threading
from typing import Any


class ProxyRotator:
    """Round-robin proxy selection with fallback to direct connection."""

    def __init__(self, proxy_list: str | None = None) -> None:
        raw = proxy_list or os.getenv("PROXY_LIST", "")
        self._proxies = [p.strip() for p in raw.split(",") if p.strip()]
        self._counter = itertools.count()
        self._lock = threading.Lock()

    @property
    def has_proxies(self) -> bool:
        return bool(self._proxies)

    def _next(self) -> str | None:
        if not self._proxies:
            return None
        with self._lock:
            idx = next(self._counter) % len(self._proxies)
            return self._proxies[idx]

    def get_proxy(self) -> dict[str, str] | None:
        """Return proxy dict for ``requests`` library."""
        url = self._next()
        if url is None:
            return None
        return {"http": url, "https": url}

    def get_httpx_proxy(self) -> dict[str, str] | None:
        """Return proxy dict for ``httpx`` library."""
        url = self._next()
        if url is None:
            return None
        return {"http://": url, "https://": url}


def get_proxy_for_requests(proxy_list: str | None = None) -> dict[str, str] | None:
    return ProxyRotator(proxy_list).get_proxy()


def get_proxy_for_httpx(proxy_list: str | None = None) -> dict[str, str] | None:
    return ProxyRotator(proxy_list).get_httpx_proxy()
