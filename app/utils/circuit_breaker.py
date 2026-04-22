from __future__ import annotations

import asyncio
import logging
import threading
import time
from enum import Enum
from typing import Any, Callable

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    """Simple in-memory circuit breaker for external HTTP requests.

    States:
      * CLOSED  – requests flow through normally.
      * OPEN    – requests are rejected immediately.
      * HALF_OPEN – after recovery_timeout, one request is allowed to test
                    whether the remote service is healthy again.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        expected_exception: type[Exception] = Exception,
    ) -> None:
        self.name = name
        self.failure_threshold = max(1, failure_threshold)
        self.recovery_timeout = max(0.1, recovery_timeout)
        self.expected_exception = expected_exception

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._last_failure_time: float | None = None
        self._sync_lock = threading.Lock()
        self._async_lock: asyncio.Lock | None = None

    def _get_async_lock(self) -> asyncio.Lock:
        if self._async_lock is None:
            self._async_lock = asyncio.Lock()
        return self._async_lock

    def _trip(self) -> None:
        self._state = CircuitState.OPEN
        self._last_failure_time = time.monotonic()
        logger.warning("circuit_breaker: %s tripped OPEN", self.name)

    def _try_reset(self) -> bool:
        if self._last_failure_time is None:
            return True
        if (time.monotonic() - self._last_failure_time) >= self.recovery_timeout:
            self._state = CircuitState.HALF_OPEN
            self._failure_count = 0
            logger.info("circuit_breaker: %s moved to HALF_OPEN", self.name)
            return True
        return False

    # ── sync API ──────────────────────────────────────────────────────────────

    def call(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        with self._sync_lock:
            if self._state == CircuitState.OPEN and not self._try_reset():
                raise RuntimeError(f"Circuit breaker '{self.name}' is OPEN")

        try:
            result = func(*args, **kwargs)
            with self._sync_lock:
                self._state = CircuitState.CLOSED
                self._failure_count = 0
            return result
        except self.expected_exception as exc:
            with self._sync_lock:
                self._failure_count += 1
                if self._failure_count >= self.failure_threshold:
                    self._trip()
            raise

    # ── async API ─────────────────────────────────────────────────────────────

    async def async_call(self, func: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        async with self._get_async_lock():
            if self._state == CircuitState.OPEN and not self._try_reset():
                raise RuntimeError(f"Circuit breaker '{self.name}' is OPEN")

        try:
            if asyncio.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = await asyncio.to_thread(func, *args, **kwargs)
            async with self._get_async_lock():
                self._state = CircuitState.CLOSED
                self._failure_count = 0
            return result
        except self.expected_exception as exc:
            async with self._get_async_lock():
                self._failure_count += 1
                if self._failure_count >= self.failure_threshold:
                    self._trip()
            raise
