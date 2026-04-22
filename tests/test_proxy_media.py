"""Tests for proxy allowlist enforcement."""
from __future__ import annotations

import os

import pytest

from app.utils.proxy import ProxyRotator, get_proxy_for_requests, get_proxy_for_httpx


@pytest.fixture(autouse=True)
def _clean_proxy_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("PROXY_LIST", raising=False)


def test_proxy_rotator_empty():
    rotator = ProxyRotator("")
    assert rotator.has_proxies is False
    assert rotator._next() is None


def test_proxy_rotator_round_robin():
    rotator = ProxyRotator("http://proxy1:8080, http://proxy2:8080")
    assert rotator.has_proxies is True
    p1 = rotator._next()
    p2 = rotator._next()
    p3 = rotator._next()
    assert p1 == "http://proxy1:8080"
    assert p2 == "http://proxy2:8080"
    assert p3 == "http://proxy1:8080"


def test_get_proxy_for_requests():
    os.environ["PROXY_LIST"] = "http://p1:3128"
    proxies = get_proxy_for_requests()
    assert proxies == {"http": "http://p1:3128", "https": "http://p1:3128"}


def test_get_proxy_for_httpx():
    os.environ["PROXY_LIST"] = "http://p1:3128"
    proxies = get_proxy_for_httpx()
    assert proxies == {"http://": "http://p1:3128", "https://": "http://p1:3128"}
