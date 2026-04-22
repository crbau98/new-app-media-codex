"""Tests for the circuit breaker utility."""
from __future__ import annotations

import pytest

from app.utils.circuit_breaker import CircuitBreaker, CircuitState


def test_circuit_starts_closed():
    cb = CircuitBreaker("test")
    assert cb._state == CircuitState.CLOSED


def test_circuit_opens_after_failures():
    cb = CircuitBreaker("test", failure_threshold=3, recovery_timeout=1.0)
    count = 0

    def fail():
        nonlocal count
        count += 1
        raise RuntimeError("boom")

    for _ in range(3):
        with pytest.raises(RuntimeError):
            cb.call(fail)

    assert cb._state == CircuitState.OPEN

    with pytest.raises(RuntimeError, match="is OPEN"):
        cb.call(fail)


def test_circuit_closes_on_success():
    cb = CircuitBreaker("test", failure_threshold=3)
    result = cb.call(lambda: 42)
    assert result == 42
    assert cb._state == CircuitState.CLOSED
    assert cb._failure_count == 0


def test_async_circuit_breaker():
    import asyncio

    cb = CircuitBreaker("async_test", failure_threshold=2, recovery_timeout=1.0)

    async def fail():
        raise ValueError("async boom")

    async def run():
        for _ in range(2):
            with pytest.raises(ValueError):
                await cb.async_call(fail)
        assert cb._state == CircuitState.OPEN
        with pytest.raises(RuntimeError, match="is OPEN"):
            await cb.async_call(fail)

    asyncio.run(run())
