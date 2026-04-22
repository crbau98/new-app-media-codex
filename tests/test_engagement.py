"""Tests for engagement endpoints."""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault("ENVIRONMENT", "testing")
os.environ.setdefault("ADMIN_TOKEN", "test-token")


@pytest.fixture(scope="module")
def temp_data_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    (d / "images").mkdir()
    return d


@pytest.fixture(scope="module")
def test_db(temp_data_dir):
    from app.db import Database

    os.environ["DATABASE_PATH"] = str(temp_data_dir / "engagement_test.db")
    database = Database(temp_data_dir / "engagement_test.db", timeout_seconds=5, busy_timeout_ms=5000)
    database.init()
    return database


@pytest.fixture(scope="module")
def app_client(test_db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    minimal_app = FastAPI()
    minimal_app.state.db = test_db

    import threading

    class _StubService:
        lock = threading.Lock()

        def add_progress_callback(self, *a):
            pass

        def remove_progress_callback(self, *a):
            pass

    minimal_app.state.service = _StubService()

    import app.main as _main_module
    _main_module.db = test_db

    from app.api.engagement import router as engagement_router
    from app.api.screenshots import router as screenshots_router
    from app.api.performers import router as performers_router

    minimal_app.include_router(engagement_router)
    minimal_app.include_router(screenshots_router)
    minimal_app.include_router(performers_router)

    with TestClient(minimal_app, raise_server_exceptions=True) as client:
        yield client


@pytest.fixture()
def sample_screenshot(test_db):
    with test_db.connect() as conn:
        page_url = f"https://example.com/{uuid.uuid4()}"
        cur = conn.execute(
            "INSERT INTO screenshots (term, source, page_url, local_path, captured_at) VALUES (?, ?, ?, ?, ?)",
            ("term", "ddg", page_url, "", "2024-01-10T00:00:00+00:00"),
        )
        conn.commit()
        return int(cur.lastrowid)


@pytest.fixture()
def sample_performer(test_db):
    with test_db.connect() as conn:
        username = f"testuser_{uuid.uuid4().hex[:8]}"
        cur = conn.execute(
            "INSERT INTO performers (username, platform, created_at) VALUES (?, ?, ?)",
            (username, "OnlyFans", "2024-01-10T00:00:00+00:00"),
        )
        conn.commit()
        return int(cur.lastrowid)


class TestLikes:
    def test_like_screenshot(self, app_client, sample_screenshot):
        resp = app_client.post("/api/like", json={"screenshot_id": sample_screenshot})
        assert resp.status_code == 200
        data = resp.json()
        assert data["liked"] is True
        assert data["likes_count"] == 1

    def test_unlike_screenshot(self, app_client, sample_screenshot):
        app_client.post("/api/like", json={"screenshot_id": sample_screenshot})
        resp = app_client.delete(f"/api/like?screenshot_id={sample_screenshot}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["liked"] is False
        assert data["likes_count"] == 0

    def test_get_likes_screenshot(self, app_client, sample_screenshot):
        app_client.post("/api/like", json={"screenshot_id": sample_screenshot})
        resp = app_client.get(f"/api/likes?screenshot_id={sample_screenshot}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_liked"] is True
        assert data["likes_count"] == 1

    def test_like_performer(self, app_client, sample_performer):
        resp = app_client.post("/api/like", json={"performer_id": sample_performer})
        assert resp.status_code == 200
        data = resp.json()
        assert data["liked"] is True
        assert data["likes_count"] == 1

    def test_unlike_performer(self, app_client, sample_performer):
        app_client.post("/api/like", json={"performer_id": sample_performer})
        resp = app_client.delete(f"/api/like?performer_id={sample_performer}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["liked"] is False
        assert data["likes_count"] == 0

    def test_like_missing_id_fails(self, app_client):
        resp = app_client.post("/api/like", json={})
        assert resp.status_code == 400


class TestViews:
    def test_record_view_screenshot(self, app_client, sample_screenshot):
        resp = app_client.post("/api/view", json={"screenshot_id": sample_screenshot, "source_page": "grid"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_record_view_performer(self, app_client, sample_performer):
        resp = app_client.post("/api/view", json={"performer_id": sample_performer})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestComments:
    def test_create_comment_screenshot(self, app_client, sample_screenshot):
        resp = app_client.post("/api/comments", json={"screenshot_id": sample_screenshot, "content": "Nice shot!"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] == "Nice shot!"
        assert data["screenshot_id"] == sample_screenshot

    def test_get_comments_screenshot(self, app_client, sample_screenshot):
        app_client.post("/api/comments", json={"screenshot_id": sample_screenshot, "content": "Nice shot!"})
        resp = app_client.get(f"/api/comments?screenshot_id={sample_screenshot}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["comments"]) == 1

    def test_delete_comment(self, app_client, sample_screenshot):
        create_resp = app_client.post("/api/comments", json={"screenshot_id": sample_screenshot, "content": "Delete me"})
        comment_id = create_resp.json()["id"]
        resp = app_client.delete(f"/api/comments/{comment_id}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_nonexistent_comment(self, app_client):
        resp = app_client.delete("/api/comments/999999")
        assert resp.status_code == 404

    def test_create_comment_missing_content_fails(self, app_client, sample_screenshot):
        resp = app_client.post("/api/comments", json={"screenshot_id": sample_screenshot, "content": ""})
        assert resp.status_code == 400

    def test_create_comment_missing_target_fails(self, app_client):
        resp = app_client.post("/api/comments", json={"content": "Orphan"})
        assert resp.status_code == 400


class TestFollows:
    def test_follow_performer(self, app_client, sample_performer):
        resp = app_client.post("/api/follow", json={"performer_id": sample_performer})
        assert resp.status_code == 200
        data = resp.json()
        assert data["following"] is True
        assert data["followers_count"] == 1

    def test_unfollow_performer(self, app_client, sample_performer):
        app_client.post("/api/follow", json={"performer_id": sample_performer})
        resp = app_client.delete(f"/api/follow?performer_id={sample_performer}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["following"] is False
        assert data["followers_count"] == 0

    def test_get_follows_performer(self, app_client, sample_performer):
        app_client.post("/api/follow", json={"performer_id": sample_performer})
        resp = app_client.get(f"/api/follows?performer_id={sample_performer}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_following"] is True
        assert data["followers_count"] == 1

    def test_get_follows_user(self, app_client, sample_performer):
        app_client.post("/api/follow", json={"performer_id": sample_performer})
        resp = app_client.get("/api/follows")
        assert resp.status_code == 200
        data = resp.json()
        assert sample_performer in data["following_list"]
