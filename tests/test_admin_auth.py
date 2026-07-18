"""Admin-auth sweep: every mutating endpoint must reject anonymous callers.

Pattern follows tests/conftest.py: a minimal FastAPI app with the real routers,
a temp Database, and app.security.settings monkeypatched so the admin token is
configured ("test-token"). Requests WITHOUT the X-Admin-Token header must get
401; the same requests WITH the token must not get 401 (they may 404/422).
"""
from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _build_app(test_db, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    minimal_app = FastAPI()
    minimal_app.state.db = test_db

    class _StubService:
        lock = threading.Lock()

        def add_progress_callback(self, *a):
            pass

        def remove_progress_callback(self, *a):
            pass

    minimal_app.state.service = _StubService()

    import app.main as _main_module

    _main_module.db = test_db

    import app.security as _security_module

    monkeypatch.setattr(
        _security_module,
        "settings",
        SimpleNamespace(admin_token="test-token", environment="testing"),
    )

    from app.api.assistant import router as assistant_router
    from app.api.collections import router as collections_router
    from app.api.crawl import router as crawl_router
    from app.api.engagement import router as engagement_router
    from app.api.hypotheses import router as hypotheses_router
    from app.api.items import router as items_router, tags_router
    from app.api.notifications import router as notifications_router
    from app.api.performers import router as performers_router
    from app.api.playlists import router as playlists_router
    from app.api.screenshots import router as screenshots_router
    from app.api.telegram import router as telegram_router
    from app.api.themes import router as themes_router

    for r in (
        assistant_router,
        collections_router,
        crawl_router,
        engagement_router,
        hypotheses_router,
        items_router,
        tags_router,
        notifications_router,
        performers_router,
        playlists_router,
        screenshots_router,
        telegram_router,
        themes_router,
    ):
        minimal_app.include_router(r)

    return minimal_app


@pytest.fixture
def anon_client(test_db, monkeypatch: pytest.MonkeyPatch):
    app = _build_app(test_db, monkeypatch)
    with TestClient(app, raise_server_exceptions=True) as client:
        yield client


@pytest.fixture
def admin_client(test_db, monkeypatch: pytest.MonkeyPatch):
    app = _build_app(test_db, monkeypatch)
    with TestClient(app, raise_server_exceptions=True) as client:
        client.headers.update({"X-Admin-Token": "test-token"})
        yield client


# (method, path, kwargs) — every entry is a mutation that must be admin-only.
GATED_MUTATIONS = [
    # crawl
    ("POST", "/api/run", {}),
    # collections
    ("POST", "/api/collections", {"json": {"name": "x"}}),
    ("PATCH", "/api/collections/1", {"json": {"name": "y"}}),
    ("DELETE", "/api/collections/1", {}),
    ("POST", "/api/collections/1/items", {"json": {"item_ids": [1]}}),
    ("DELETE", "/api/collections/1/items", {}),
    # playlists
    ("POST", "/api/playlists", {"json": {"name": "x"}}),
    ("PATCH", "/api/playlists/1", {"json": {}}),
    ("DELETE", "/api/playlists/1", {}),
    ("POST", "/api/playlists/1/items", {"json": {"screenshot_ids": [1]}}),
    ("DELETE", "/api/playlists/1/items", {}),
    ("POST", "/api/playlists/1/reorder", {"json": {"screenshot_ids": [1]}}),
    ("POST", "/api/playlists/1/populate", {"json": {}}),
    # engagement
    ("POST", "/api/like", {"json": {"screenshot_id": 1}}),
    ("DELETE", "/api/like", {"params": {"screenshot_id": 1}}),
    ("POST", "/api/view", {"json": {"screenshot_id": 1}}),
    ("POST", "/api/comments", {"json": {"screenshot_id": 1, "content": "hi"}}),
    ("DELETE", "/api/comments/1", {}),
    ("POST", "/api/follow", {"json": {"performer_id": 1}}),
    ("DELETE", "/api/follow", {"params": {"performer_id": 1}}),
    # themes
    ("POST", "/api/themes", {"json": {"slug": "t", "label": "T", "queries": []}}),
    ("DELETE", "/api/themes/t", {}),
    # items + tags
    ("POST", "/api/items/bulk", {"json": {"ids": [1]}}),
    ("POST", "/api/items/merge", {"json": {"source_id": 1, "target_id": 2}}),
    ("PATCH", "/api/items/1", {"json": {}}),
    ("POST", "/api/tags", {"json": {"name": "x"}}),
    ("DELETE", "/api/tags/1", {}),
    ("POST", "/api/items/1/tags", {"json": {"tag": "x"}}),
    ("DELETE", "/api/items/1/tags/1", {}),
    # telegram
    ("POST", "/api/telegram/channels", {"json": {"username": "chan"}}),
    ("DELETE", "/api/telegram/channels/chan", {}),
    ("PATCH", "/api/telegram/channels/chan", {"json": {}}),
    ("POST", "/api/telegram/channels/discover", {"json": {}}),
    ("POST", "/api/telegram/scan", {"json": {}}),
    # notifications
    ("POST", "/api/notifications/1/read", {}),
    ("POST", "/api/notifications/read-all", {}),
    ("DELETE", "/api/notifications/1", {}),
    # assistant
    ("POST", "/api/assistant/chat", {"json": {"message": "hi"}}),
    # hypotheses
    ("PATCH", "/api/hypotheses/1", {"json": {"status": "reviewing"}}),
    # performers
    ("POST", "/api/performers", {"json": {"username": "u", "platform": "onlyfans"}}),
    ("PATCH", "/api/performers/1", {"json": {}}),
    ("DELETE", "/api/performers/1", {}),
    ("POST", "/api/performers/auto-link", {"json": {}}),
    ("POST", "/api/performers/discover", {"json": {}}),
    ("POST", "/api/performers/discover/import", {"json": {"creators": []}}),
    ("POST", "/api/performers/import-url", {"json": {"url": "https://x.com/u"}}),
    ("POST", "/api/performers/bulk-import", {"json": {"urls": []}}),
    ("DELETE", "/api/performers/capture-queue/1", {}),
    ("POST", "/api/performers/capture-stale", {"json": {}}),
    ("POST", "/api/performers/capture-all", {"json": {}}),
    ("POST", "/api/performers/watchlist/capture-all", {"json": {}}),
    ("POST", "/api/performers/1/links", {"json": {"url": "https://x.com/u"}}),
    ("DELETE", "/api/performers/1/links/1", {}),
    ("POST", "/api/performers/1/media", {"json": {"url": "https://x.com/v.mp4"}}),
    ("POST", "/api/performers/1/capture", {"json": {}}),
    ("POST", "/api/performers/enrich/1", {"json": {}}),
    # screenshots
    ("DELETE", "/api/screenshots/1", {}),
    ("PATCH", "/api/screenshots/1/tags", {"json": {"tags": []}}),
    ("POST", "/api/screenshots/generate-posters", {}),
    ("GET", "/api/screenshots/cache-status", {}),
    ("POST", "/api/screenshots/capture", {"json": {}}),
    ("DELETE", "/api/screenshots/clear-posters", {}),
    ("DELETE", "/api/screenshots/clear-all", {}),
    ("POST", "/api/screenshots/scan", {"json": {}}),
    ("DELETE", "/api/screenshots/bulk", {"json": {"ids": [1]}}),
    ("POST", "/api/screenshots/batch-describe", {"json": {"ids": [1]}}),
    ("POST", "/api/screenshots/auto-tag", {"json": {}}),
    ("POST", "/api/screenshots/capture-url", {"json": {"url": "https://x.com"}}),
    ("POST", "/api/screenshots/purge-women", {"json": {}}),
    ("POST", "/api/screenshots/recover-videos", {"json": {}}),
    ("POST", "/api/screenshots/capture-videos", {"json": {}}),
    ("POST", "/api/screenshots/cleanup", {"json": {}}),
    ("POST", "/api/screenshots/purge-archiver", {"json": {}}),
    ("POST", "/api/screenshots/backfill-performers", {"json": {}}),
    ("POST", "/api/screenshots/1/upload-cached-video", {}),
    ("POST", "/api/screenshots/1/evict-cached-video", {}),
    ("POST", "/api/screenshots/1/summarize", {"json": {}}),
]


@pytest.mark.parametrize("method,path,kwargs", GATED_MUTATIONS,
                         ids=[f"{m} {p}" for m, p, _ in GATED_MUTATIONS])
def test_mutation_requires_admin_token(anon_client, method, path, kwargs):
    """No X-Admin-Token header -> 401 on every mutating endpoint."""
    resp = anon_client.request(method, path, **kwargs)
    assert resp.status_code == 401, (
        f"{method} {path} returned {resp.status_code}, expected 401: {resp.text[:200]}"
    )


def test_mutation_with_token_is_not_rejected_for_auth(admin_client):
    """Positive control: with the token the auth layer steps aside."""
    resp = admin_client.post("/api/collections", json={"name": "auth-check"})
    assert resp.status_code == 201
    resp = admin_client.request("DELETE", "/api/like", params={"screenshot_id": 999999})
    assert resp.status_code != 401
    resp = admin_client.get("/api/screenshots/cache-status")
    assert resp.status_code != 401


def test_public_reads_stay_public(anon_client):
    """Reads must remain reachable without a token."""
    assert anon_client.get("/api/performers").status_code == 200
    assert anon_client.get("/api/collections").status_code == 200
    # Ratings intentionally stay public (low-risk preference signal; see
    # note in app/api/screenshots.py).
    resp = anon_client.patch("/api/screenshots/999999/rate", json={"rating": 3})
    assert resp.status_code in (200, 404)


def test_require_admin_production_fail_closed(monkeypatch):
    """Production with no ADMIN_TOKEN configured -> 503 (fail closed)."""
    import app.security as security

    monkeypatch.setattr(
        security, "settings", SimpleNamespace(admin_token=None, environment="production")
    )
    with pytest.raises(Exception) as excinfo:
        security.require_admin(None)
    assert getattr(excinfo.value, "status_code", None) == 503

    monkeypatch.setattr(
        security, "settings", SimpleNamespace(admin_token="s3cret", environment="production")
    )
    with pytest.raises(Exception) as excinfo:
        security.require_admin("wrong")
    assert getattr(excinfo.value, "status_code", None) == 401
    # Correct token passes
    security.require_admin("s3cret")


def test_require_admin_dev_open_when_unconfigured(monkeypatch):
    """Non-production without a configured token stays open for local dev."""
    import app.security as security

    monkeypatch.setattr(
        security, "settings", SimpleNamespace(admin_token=None, environment="development")
    )
    security.require_admin(None)  # must not raise
