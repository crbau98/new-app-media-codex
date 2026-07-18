"""Tests for creator discovery (C15-C18) and browse attribution (C17)."""
from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def discovery_client(test_db, monkeypatch: pytest.MonkeyPatch):
    minimal_app = FastAPI()
    minimal_app.state.db = test_db
    # Settings with no AI key and crawls disabled: honest heuristic path only.
    minimal_app.state.settings = SimpleNamespace(
        openai_api_key="",
        openai_base_url="https://api.openai.com/v1",
        openai_model="gpt-test",
        enable_external_crawls=False,
        image_dir="/tmp",
    )

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

    from app.api.performers import router as performers_router

    minimal_app.include_router(performers_router)

    with TestClient(minimal_app, raise_server_exceptions=True) as client:
        client.headers.update({"X-Admin-Token": "test-token"})
        yield client


@pytest.fixture
def watchlist_performer(test_db):
    # test_db is session-scoped and shared across the whole run, so seed the
    # watchlist performer idempotently (get-or-create) to avoid UNIQUE
    # constraint violations when several tests in the session need it.
    performer = test_db.get_performer_by_username("musclecreator99")
    if performer is None:
        performer = test_db.add_performer(
            username="musclecreator99",
            platform="OnlyFans",
            display_name="Muscle Creator",
            bio="Gay muscle creator",
            tags=["muscle"],
            discovered_via="url_import",
        )
    with test_db.connect() as conn:
        conn.execute("UPDATE performers SET is_favorite = 1 WHERE id = ?", (performer["id"],))
        conn.commit()
    return performer


def test_discover_returns_watchlist_suggestions_on_fresh_deploy(
    discovery_client, watchlist_performer
):
    """C16: with no screenshots/items, discover still suggests from the watchlist."""
    resp = discovery_client.post(
        "/api/performers/discover", json={"query": "muscle", "limit": 5}
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    # Honest fallback label: no AI key configured.
    assert payload["provider"] == "heuristic"
    assert payload["ai_available"] is False
    assert payload["suggestions"], "expected watchlist-mined suggestions"
    for suggestion in payload["suggestions"]:
        assert suggestion["reason"]
        assert suggestion["source"] in {"watchlist", "local_library", "recent_items"}
    sources = {s["source"] for s in payload["suggestions"]}
    assert "watchlist" in sources


def test_discover_requires_query_or_seed(discovery_client):
    resp = discovery_client.post("/api/performers/discover", json={})
    assert resp.status_code == 400


def test_discover_import_does_not_enqueue_when_crawls_disabled(
    discovery_client, test_db
):
    """C18: imports succeed but never enqueue captures while crawls are off."""
    resp = discovery_client.post(
        "/api/performers/discover/import",
        json={"creators": [{"username": "newcreator1", "platform": "OnlyFans"}]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["created"] == 1
    assert resp.json()["captures_enabled"] is False
    assert test_db.get_capture_queue() == []


def test_capture_endpoint_blocked_when_crawls_disabled(
    discovery_client, watchlist_performer
):
    resp = discovery_client.post(f"/api/performers/{watchlist_performer['id']}/capture")
    assert resp.status_code == 403


def test_browse_performers_exposes_attribution_fields(
    discovery_client, watchlist_performer
):
    """C17: browse payload carries provenance and identity context."""
    resp = discovery_client.get("/api/performers")
    assert resp.status_code == 200, resp.text
    performers = resp.json()["performers"]
    assert performers
    target = next(p for p in performers if p["username"] == "musclecreator99")
    assert target["source_attribution"] == "url_import"
    assert isinstance(target["profile_links"], list)
    assert "last_seen_at" in target
    assert target["evidence_count"] >= 0
    assert "musclecreator99" in target["matched_aliases"]


def test_similar_performers_exposes_attribution_fields(
    discovery_client, test_db, watchlist_performer
):
    other = test_db.get_performer_by_username("othermuscle")
    if other is None:
        other = test_db.add_performer(
            username="othermuscle",
            platform="OnlyFans",
            display_name="Other Muscle",
            tags=["muscle"],
            discovered_via="ai_discovery",
        )
    resp = discovery_client.get(f"/api/performers/{watchlist_performer['id']}/similar")
    assert resp.status_code == 200, resp.text
    results = resp.json()
    assert results, "expected at least one similar performer"
    match = next(r for r in results if r["username"] == "othermuscle")
    assert match["source_attribution"] == "ai_discovery"
    assert isinstance(match["profile_links"], list)
    assert "matched_aliases" in match
    assert "evidence_count" in match
