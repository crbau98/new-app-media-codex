"""Tests for notification endpoints and WebSocket."""
from __future__ import annotations

import os
from pathlib import Path

import pytest

os.environ.setdefault("ENVIRONMENT", "testing")
os.environ.setdefault("ADMIN_TOKEN", "test-token")


@pytest.fixture(scope="module")
def temp_data_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    (d / "images").mkdir()
    (d / "screenshots").mkdir()
    (d / "previews").mkdir()
    return d


@pytest.fixture(scope="module")
def test_db(temp_data_dir):
    from app.db import Database

    os.environ["DATABASE_PATH"] = str(temp_data_dir / "notifications_test.db")
    database = Database(temp_data_dir / "notifications_test.db", timeout_seconds=5, busy_timeout_ms=5000)
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

    from app.api.notifications import router as notifications_router

    minimal_app.include_router(notifications_router)

    with TestClient(minimal_app, raise_server_exceptions=True) as client:
        yield client


@pytest.fixture(autouse=True)
def clear_notifications(test_db):
    with test_db.connect() as conn:
        conn.execute("DELETE FROM notifications")
        conn.commit()


@pytest.fixture()
def sample_notification(test_db):
    return test_db.add_notification("default", "test", {"msg": "hello"})


class TestListNotifications:
    def test_list_empty(self, app_client):
        resp = app_client.get("/api/notifications")
        assert resp.status_code == 200
        data = resp.json()
        assert data["notifications"] == []
        assert data["unread_count"] == 0

    def test_list_with_notification(self, app_client, sample_notification):
        resp = app_client.get("/api/notifications")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["notifications"]) == 1
        assert data["notifications"][0]["type"] == "test"
        assert data["unread_count"] == 1


class TestUnreadCount:
    def test_unread_count(self, app_client, sample_notification):
        resp = app_client.get("/api/notifications/unread-count")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1


class TestMarkRead:
    def test_mark_read(self, app_client, sample_notification):
        nid = sample_notification["id"]
        resp = app_client.post(f"/api/notifications/{nid}/read")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        resp = app_client.get("/api/notifications/unread-count")
        assert resp.json()["count"] == 0

    def test_mark_read_not_found(self, app_client):
        resp = app_client.post("/api/notifications/999999/read")
        assert resp.status_code == 404


class TestMarkAllRead:
    def test_mark_all_read(self, app_client, sample_notification):
        resp = app_client.post("/api/notifications/read-all")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resp.json()["marked"] == 1

        resp = app_client.get("/api/notifications/unread-count")
        assert resp.json()["count"] == 0


class TestDeleteNotification:
    def test_delete_notification(self, app_client, sample_notification):
        nid = sample_notification["id"]
        resp = app_client.delete(f"/api/notifications/{nid}")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        resp = app_client.get("/api/notifications")
        assert len(resp.json()["notifications"]) == 0

    def test_delete_not_found(self, app_client):
        resp = app_client.delete("/api/notifications/999999")
        assert resp.status_code == 404


class TestWebSocket:
    def test_ws_initial_unread_count(self, app_client, sample_notification):
        with app_client.websocket_connect("/ws/notifications") as ws:
            data = ws.receive_json()
            assert data["type"] == "unread_count"
            assert data["count"] == 1

    def test_ws_ping_pong(self, app_client):
        with app_client.websocket_connect("/ws/notifications") as ws:
            ws.receive_json()  # initial unread_count
            ws.send_text("ping")
            pong = ws.receive_text()
            assert pong == "pong"
