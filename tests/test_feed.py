"""Tests for feed endpoints (trending pagination coherence + hours_ago clamp).

The screenshots table stores its timestamp as ``captured_at`` (not created_at)
and has no preview_url column; the feed maps these onto the keys it returns.
These tests seed screenshots directly and exercise the real router.
"""
from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def feed_client(test_db, monkeypatch: pytest.MonkeyPatch):
    minimal_app = FastAPI()
    minimal_app.state.db = test_db
    minimal_app.state.settings = SimpleNamespace(enable_external_crawls=False)

    class _StubService:
        lock = threading.Lock()

        def add_progress_callback(self, *a):
            pass

        def remove_progress_callback(self, *a):
            pass

    minimal_app.state.service = _StubService()

    import app.main as _main_module

    _main_module.db = test_db

    from app.api.feed import router as feed_router

    minimal_app.include_router(feed_router)
    with TestClient(minimal_app, raise_server_exceptions=True) as client:
        yield client


def _get_or_create_performer(db, username: str) -> dict:
    performer = db.get_performer_by_username(username)
    if performer is None:
        performer = db.add_performer(username=username, platform="OnlyFans")
    return performer


def _seed_shot(
    db,
    page_url: str,
    performer_id: int,
    captured_at: str,
    *,
    likes: int = 0,
    views: int = 0,
    comments: int = 0,
    rating: int = 0,
) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO screenshots (term, source, page_url, local_path, captured_at, "
            "performer_id, source_url, thumbnail_url, rating, likes_count, views_count, comments_count) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "term", "redgifs", page_url, page_url, captured_at,
                performer_id, page_url, page_url, rating, likes, views, comments,
            ),
        )
        conn.commit()


def test_trending_pagination_is_coherent_with_real_total(feed_client, test_db):
    performer = _get_or_create_performer(test_db, "feedtrending")
    now = datetime.now(timezone.utc).isoformat()
    # Seed 5 shots with descending engagement so scores are distinct.
    for i in range(5):
        _seed_shot(
            test_db,
            page_url=f"https://example.com/feed-trend-{i}",
            performer_id=performer["id"],
            captured_at=now,
            likes=(5 - i) * 10,  # 50,40,30,20,10 → strictly decreasing scores
        )

    page1 = feed_client.get("/api/feed/trending", params={"limit": 2, "offset": 0}).json()
    page2 = feed_client.get("/api/feed/trending", params={"limit": 2, "offset": 2}).json()
    page3 = feed_client.get("/api/feed/trending", params={"limit": 2, "offset": 4}).json()

    # Real total (all matching rows), not just the page size.
    assert page1["total"] == 5
    assert page2["total"] == 5
    assert page3["total"] == 5
    assert len(page1["screenshots"]) == 2
    assert len(page2["screenshots"]) == 2
    assert len(page3["screenshots"]) == 1

    # Pages are disjoint and together cover the whole score-ordered set.
    ids = [s["id"] for s in page1["screenshots"] + page2["screenshots"] + page3["screenshots"]]
    assert len(ids) == len(set(ids)) == 5

    # Ordered by descending trending score (highest engagement first).
    first_page_urls = [s["page_url"] for s in page1["screenshots"]]
    assert first_page_urls == [
        "https://example.com/feed-trend-0",
        "https://example.com/feed-trend-1",
    ]


def test_compute_trending_score_clamps_future_timestamps():
    """A future created_at must not inflate the score (decay must stay <= 1)."""
    from app.api.feed import _compute_trending_score

    future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    score = _compute_trending_score(likes=10, views=0, comments=0, rating=0, created_at=future)
    # raw = 10*3 = 30; with the clamp decay == 1 (never > 1).
    assert score == pytest.approx(30.0)

    recent = datetime.now(timezone.utc).isoformat()
    recent_score = _compute_trending_score(likes=10, views=0, comments=0, rating=0, created_at=recent)
    assert recent_score <= 30.0


def test_other_feed_endpoints_do_not_500(feed_client, test_db):
    """All feed endpoints must run against the real screenshots schema."""
    performer = _get_or_create_performer(test_db, "feedsmoke")
    now = datetime.now(timezone.utc).isoformat()
    _seed_shot(
        test_db,
        page_url="https://example.com/feed-smoke-0",
        performer_id=performer["id"],
        captured_at=now,
        likes=5,
    )

    for path in ("/api/feed/popular", "/api/feed/following", "/api/feed/for-you", "/api/feed/trending"):
        resp = feed_client.get(path)
        assert resp.status_code == 200, f"{path}: {resp.text}"
        assert "screenshots" in resp.json()
