"""Focused tests for FastAPI edge/security behaviors (C6, C21, C22, C26).

These exercise the real ``app.main`` middleware. We use ``TestClient(app)``
*without* the context manager so the lifespan (scheduler, crawls, service
startup) does not run — middleware and routing still execute, which is all
these tests need.
"""
from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient


def _client():
    from app.main import app

    return TestClient(app)  # no context manager → skip lifespan side effects


def test_unmatched_api_path_returns_json_404_not_spa():
    """C21: unmatched /api/* must return a JSON 404, never the SPA shell."""
    client = _client()
    resp = client.get("/api/definitely-not-a-real-route")
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"detail": "Not found"}


def test_response_headers_include_csp_and_no_referrer():
    """C22: FastAPI emits a CSP and unifies Referrer-Policy to no-referrer."""
    client = _client()
    resp = client.get("/api/definitely-not-a-real-route")
    assert resp.headers["referrer-policy"] == "no-referrer"
    csp = resp.headers.get("content-security-policy", "")
    assert csp, "expected a Content-Security-Policy header"
    assert "default-src 'self'" in csp
    assert "connect-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "https://*.redgifs.com" in csp
    assert "https://codex-research-radar.onrender.com" in csp


def test_rate_limiter_uses_rightmost_forwarded_for(monkeypatch: pytest.MonkeyPatch):
    """C6: the rate limiter keys on the right-most (trusted-proxy) XFF entry."""
    import app.main as m

    seen: dict[str, str] = {}
    real = m._check_rate_limit

    def spy(ip: str, cost: int = 1) -> bool:
        seen["ip"] = ip
        return real(ip, cost)

    monkeypatch.setattr(m, "_check_rate_limit", spy)
    client = _client()
    # A non-exempt, non-API path (hits the SPA fallback; no DB needed).
    client.get("/some-nonexistent-page", headers={"X-Forwarded-For": "1.2.3.4, 10.0.0.1, 9.9.9.9"})
    assert seen.get("ip") == "9.9.9.9"


def test_cors_origin_regex_safe_default_and_overrides(monkeypatch: pytest.MonkeyPatch):
    """C26: Vercel preview aliases allowed by default; env var overrides."""
    import app.main as m

    monkeypatch.delenv("CORS_ALLOW_ORIGIN_REGEX", raising=False)
    pattern = m._parse_cors_allow_origin_regex()
    assert pattern == m._DEFAULT_CORS_ORIGIN_REGEX
    # Matches the production alias and per-deploy preview aliases.
    assert re.match(pattern, "https://new-app-media-codex.vercel.app")
    assert re.match(pattern, "https://new-app-media-codex-chases-projects-cec7ce2c.vercel.app")
    # Does not match unrelated origins or look-alike domains.
    assert not re.match(pattern, "https://evil.vercel.app")
    assert not re.match(pattern, "https://new-app-media-codex.evil.com")
    assert not re.match(pattern, "http://new-app-media-codex.vercel.app")

    # Custom override is honored.
    monkeypatch.setenv("CORS_ALLOW_ORIGIN_REGEX", r"^https://example\.com$")
    assert m._parse_cors_allow_origin_regex() == r"^https://example\.com$"

    # Empty disables regex matching.
    monkeypatch.setenv("CORS_ALLOW_ORIGIN_REGEX", "")
    assert m._parse_cors_allow_origin_regex() is None
