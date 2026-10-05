"""Creator index HTTP API: public reads, admin-gated writes, validation."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.creator_index.repository import CreatorObservation
from app.creator_index.runtime import get_runtime, scheduling_enabled, start_creator_index
from app.db import Database

ADMIN = {"X-Admin-Token": "test-token"}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    db = Database(tmp_path / "api.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()
    import app.security as security

    monkeypatch.setattr(security, "settings", SimpleNamespace(admin_token="test-token", environment="testing"))
    app = FastAPI()
    app.state.db = db
    from app.api.v1.router import v1_router

    app.include_router(v1_router)
    rt = get_runtime(app)
    rt.repo.upsert([
        CreatorObservation(platform="redgifs", handle=f"user{i}", display_name=f"User {i}", media_count=i, view_count=i * 10,
                           tags={"gay": 1}, last_seen_at=f"2026-01-{i + 1:02d}T00:00:00Z")
        for i in range(8)
    ])
    return SimpleNamespace(app=app, client=TestClient(app), rt=rt)


def test_public_read_shape_and_cache_headers(env):
    r = env.client.get("/api/v1/creators/index?limit=3")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=60, s-maxage=300"
    body = r.json()
    assert set(body) == {"creators", "nextCursor", "total", "sources", "updatedAt"}
    assert body["total"] == 8 and len(body["creators"]) == 3 and body["nextCursor"]
    assert body["sources"] == [{"platform": "Redgifs", "count": 8}]
    assert body["creators"][0]["id"].startswith("creator-user") and body["creators"][0]["platform"] == "Redgifs"
    nxt = env.client.get("/api/v1/creators/index", params={"limit": 50, "cursor": body["nextCursor"]}).json()
    assert len(nxt["creators"]) == 5 and nxt["nextCursor"] is None


def test_filters_and_sort_via_http(env):
    assert env.client.get("/api/v1/creators/index?tag=gay&sort=count&limit=2").json()["creators"][0]["username"] == "user7"
    assert env.client.get("/api/v1/creators/index?q=user3").json()["total"] == 1
    assert env.client.get("/api/v1/creators/index?platform=bluesky").json()["total"] == 0
    assert env.client.get("/api/v1/creators/index?limit=9999").status_code == 200  # clamped


def test_validation_errors(env):
    assert env.client.get("/api/v1/creators/index?sort=weird").status_code == 400
    bad = env.client.get("/api/v1/creators/index?cursor=garbage!!")
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "invalid_cursor"
    cur = env.client.get("/api/v1/creators/index?limit=2&sort=smart").json()["nextCursor"]
    assert env.client.get("/api/v1/creators/index", params={"cursor": cur, "sort": "newest"}).status_code == 400
    assert env.client.get("/api/v1/creators/index?limit=abc").status_code == 422


def test_stats(env):
    body = env.client.get("/api/v1/creators/index/stats").json()
    assert body["total"] == 8 and body["byPlatform"] == {"Redgifs": 8} and body["crawlRunning"] is False
    assert "lastCrawlAt" in body
    assert env.client.get("/api/v1/creators/index/stats").headers["cache-control"].startswith("public")


def test_writes_require_admin(env):
    for path, kw in [("/api/v1/creators/index/crawl", {}), ("/api/v1/creators/index/observe", {"json": {"creators": []}})]:
        assert env.client.post(path, **kw).status_code == 401
        assert env.client.post(path, headers={"X-Admin-Token": "wrong"}, **kw).status_code == 401
    assert env.client.get("/api/v1/creators/index").status_code == 200  # reads stay public


def test_observe_validates_caps_and_sanitizes(env):
    ok = {"platform": "redgifs", "handle": "Fresh_One", "displayName": "Fresh One", "followers": 5, "tags": ["Gay", "#Bear"],
          "media": [{"id": "rg-9", "title": "hi bob@example.com", "thumbnail": "/api/archiver-proxy?url=https%3A%2F%2Fthumbs44.redgifs.com%2Fa.jpg",
                     "streamCandidates": ["/api/archiver-proxy?url=https%3A%2F%2Fmedia.redgifs.com%2Fa.mp4", "https://evil.example/x.mp4"],
                     "views": 10, "width": 100, "height": 50}]}
    bad_marker = {"platform": "redgifs", "handle": "gal", "tags": ["female"]}
    bad_platform = {"platform": "nope", "handle": "x"}
    bad_media = {"platform": "redgifs", "handle": "nomedia", "media": [{"id": "1", "thumbnail": "https://evil.example/t.jpg", "mediaUrl": "https://evil.example/v.mp4"}]}
    r = env.client.post("/api/v1/creators/index/observe", json={"creators": [ok, bad_marker, bad_platform, bad_media]}, headers=ADMIN)
    assert r.status_code == 200 and r.json() == {"received": 4, "accepted": 2, "rejected": 2}
    c = env.client.get("/api/v1/creators/index?q=fresh_one").json()["creators"][0]
    assert c["discoveryTags"] == ["bear", "gay"] and c["followers"] == 5
    m = c["media"][0]
    assert m["thumbnail"] == "https://thumbs44.redgifs.com/a.jpg" and m["streamCandidates"] == ["https://media.redgifs.com/a.mp4"]
    assert "@" not in m["title"] and m["aspect"] == 2.0
    assert env.client.get("/api/v1/creators/index?q=nomedia").json()["creators"][0]["media"] == []

    too_many = {"creators": [{"platform": "redgifs", "handle": f"h{i}"} for i in range(201)]}
    big = env.client.post("/api/v1/creators/index/observe", json=too_many, headers=ADMIN)
    assert big.status_code == 422 and big.json()["detail"]["code"] == "validation_error"
    assert env.client.post("/api/v1/creators/index/observe", json={"creators": [{"handle": "x"}]}, headers=ADMIN).status_code == 422
    assert env.client.post("/api/v1/creators/index/observe", json={}, headers=ADMIN).status_code == 422
    exactly = {"creators": [{"platform": "redgifs", "handle": f"h{i}"} for i in range(200)]}
    assert env.client.post("/api/v1/creators/index/observe", json=exactly, headers=ADMIN).json()["accepted"] == 200


def test_crawl_trigger_runs_and_reports(env):
    from app.creator_index.fetcher import JsonResponse

    class Fake:
        async def get_json(self, url, headers=None):
            return JsonResponse(404, None)

    env.rt.crawler.fetcher = Fake()
    env.rt.crawler.config.max_pages = 3
    r = env.client.post("/api/v1/creators/index/crawl?wait=true&source=bluesky", headers=ADMIN)
    assert r.status_code == 200 and r.json()["started"] is True and r.json()["state"] in {"ok", "partial"}
    assert env.client.post("/api/v1/creators/index/crawl?source=bogus", headers=ADMIN).status_code == 422
    assert env.rt.repo.recent_runs()[0]["source"] == "bluesky"


def test_scheduler_disabled_under_tests(env, monkeypatch):
    assert scheduling_enabled(env.rt.crawler.config) is False  # ENVIRONMENT=testing
    start_creator_index(env.app)
    assert env.rt.scheduler is None
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("CREATOR_INDEX_ENABLED", "false")
    from app.creator_index.crawler import CrawlConfig

    assert scheduling_enabled(CrawlConfig.from_env()) is False
    monkeypatch.setenv("CREATOR_INDEX_ENABLED", "true")
    monkeypatch.setenv("CREATOR_INDEX_INTERVAL_MINUTES", "30")
    cfg = CrawlConfig.from_env()
    assert scheduling_enabled(cfg) and cfg.interval_minutes == 30


@pytest.mark.asyncio
async def test_scheduler_registers_job_when_enabled(env, monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    rt = start_creator_index(env.app)
    try:
        assert rt.scheduler is not None
        job = rt.scheduler.get_job("creator-index-crawl")
        assert job is not None and job.max_instances == 1 and job.trigger.jitter == rt.crawler.config.jitter_seconds
    finally:
        rt.scheduler.shutdown(wait=False)
