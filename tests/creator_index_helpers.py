"""Shared helpers for the creator-index tests (mocked transports only; no network)."""

from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.creator_index.fetcher import GuardedFetcher, HttpxFetcher
from app.creator_index.runtime import get_runtime
from app.db import Database

import itertools

_COUNTER = itertools.count()
ADMIN = {"X-Admin-Token": "test-token"}


class Net:
    """Programmable mock network: ``routes`` maps a URL substring to a responder (or a JSON-able value)."""

    def __init__(self, routes=None):
        self.routes = routes or {}
        self.seen: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.seen.append(url)
        for prefix, responder in self.routes.items():
            if prefix in url:
                out = responder(request) if callable(responder) else responder
                if isinstance(out, Exception):
                    raise out
                return out if isinstance(out, httpx.Response) else httpx.Response(200, json=out)
        return httpx.Response(404, json={})

    def count(self, part: str) -> int:
        return sum(1 for u in self.seen if part in u)


def guarded(net: Net, **kw) -> GuardedFetcher:
    client = httpx.AsyncClient(transport=httpx.MockTransport(net))

    async def no_sleep(_s):
        return None

    return GuardedFetcher(HttpxFetcher(client), min_interval=0, jitter=0, sleep=no_sleep, failure_threshold=kw.pop("failure_threshold", 3), **kw)


def xml(body: str, status: int = 200, ctype: str = "application/rss+xml") -> httpx.Response:
    return httpx.Response(status, text=body, headers={"content-type": ctype})


def rss(items: list[tuple[str, str]], title: str = "Bear Studio", extra: str = "", author: str = "") -> str:
    rows = "".join(
        f"<item><title>{t}</title><link>{u}</link><guid>{u}</guid><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item>"
        for t, u in items
    )
    mgr = f"<managingEditor>{author}</managingEditor>" if author else ""
    return (f'<?xml version="1.0"?><rss version="2.0"><channel><title>{title}</title><link>https://bearstudio.example/</link>'
            f"<description>Official feed</description>{mgr}{extra}{rows}</channel></rss>")


def make_env(tmp_path, monkeypatch, net: Net | None = None, env: dict[str, str] | None = None):
    """FastAPI app with the v1 router, an admin-token stub and (optionally) a mock-network crawler fetcher."""
    for name in ("FEED_DENYLIST", "FEED_MAX_PENDING", "FEED_SUBMIT_PER_HOUR", "FEED_SUBMIT_GLOBAL_PER_HOUR",
                 "TAKEDOWN_PER_HOUR", "TAKEDOWN_GLOBAL_PER_HOUR", "PRIVACY_HASH_SALT", "TRUST_GATEWAY_CLIENT_IP",
                 "FEED_REFRESH_MINUTES", "FEED_MAX_PER_RUN", "FEED_MAX_FAILURES"):
        monkeypatch.delenv(name, raising=False)
    for key, value in (env or {}).items():
        monkeypatch.setenv(key, value)
    db = Database(tmp_path / f"sub-{next(_COUNTER)}.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()
    import app.security as security

    monkeypatch.setattr(security, "settings", SimpleNamespace(admin_token="test-token", environment="testing"))
    app = FastAPI()
    app.state.db = db
    from app.api.v1.router import v1_router

    app.include_router(v1_router)
    rt = get_runtime(app)
    if net is not None:
        rt.crawler.fetcher = guarded(net)
    return SimpleNamespace(app=app, client=TestClient(app), rt=rt, db=db, net=net)


@pytest.fixture()
def feed_env(tmp_path, monkeypatch):
    return make_env(tmp_path, monkeypatch, Net())


@pytest.fixture()
def make_feed_env(tmp_path, monkeypatch):
    """Factory for tests that need specific env limits (set before the runtime is built)."""
    return lambda **env: make_env(tmp_path, monkeypatch, Net(), env=env)
