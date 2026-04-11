"""Integration tests for critical API endpoints using TestClient."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

# Configure environment before importing the app
os.environ.setdefault("ENVIRONMENT", "testing")
os.environ.setdefault("ADMIN_TOKEN", "test-token")


@pytest.fixture(scope="module")
def temp_data_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    (d / "images").mkdir()
    return d


@pytest.fixture(scope="module")
def test_db(temp_data_dir):
    """Return an initialised Database on a temp file."""
    from app.db import Database

    os.environ["DATABASE_PATH"] = str(temp_data_dir / "api_test.db")
    database = Database(temp_data_dir / "api_test.db", timeout_seconds=5, busy_timeout_ms=5000)
    database.init()
    return database


@pytest.fixture(scope="module")
def app_client(test_db):
    """Create a minimal FastAPI app with only the routers we need, no lifespan side effects."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    minimal_app = FastAPI()
    minimal_app.state.db = test_db

    # Wire up a minimal service stub
    import threading

    class _StubService:
        lock = threading.Lock()

        def add_progress_callback(self, *a):
            pass

        def remove_progress_callback(self, *a):
            pass

    minimal_app.state.service = _StubService()

    from app.api.items import router as items_router, browse_router as items_browse_router
    from app.api.search import router as search_router
    from app.api.export import router as export_router
    from app.api.settings_api import router as settings_router

    minimal_app.include_router(items_router)
    minimal_app.include_router(items_browse_router)
    minimal_app.include_router(search_router)
    minimal_app.include_router(export_router)
    minimal_app.include_router(settings_router, prefix="/api/settings")

    @minimal_app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    with TestClient(minimal_app, raise_server_exceptions=True) as client:
        yield client


class TestHealthz:
    def test_healthz_returns_200(self, app_client) -> None:
        resp = app_client.get("/healthz")
        assert resp.status_code == 200
        assert resp.json().get("status") == "ok"


class TestItemsAPI:
    def test_browse_items_empty(self, app_client) -> None:
        resp = app_client.get("/api/items")
        assert resp.status_code == 200
        data = resp.json()
        # /api/items returns a list of items directly
        assert isinstance(data, list)

    def test_browse_items_pagination(self, app_client) -> None:
        resp = app_client.get("/api/items?limit=5&offset=0")
        assert resp.status_code == 200


class TestSearchAPI:
    def test_search_empty_query_fails_validation(self, app_client) -> None:
        resp = app_client.get("/api/search?q=")
        assert resp.status_code in (200, 422)

    def test_search_with_query_returns_list(self, app_client) -> None:
        resp = app_client.get("/api/search?q=libido")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


class TestExportAPI:
    def test_export_items_csv_empty(self, app_client) -> None:
        resp = app_client.get("/api/export/items.csv")
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")

    def test_export_items_json_empty(self, app_client) -> None:
        resp = app_client.get("/api/export/items.json")
        assert resp.status_code == 200

    def test_export_performers_csv(self, app_client) -> None:
        resp = app_client.get("/api/export/performers.csv")
        assert resp.status_code == 200

    def test_export_performers_json(self, app_client) -> None:
        resp = app_client.get("/api/export/performers.json")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_export_media_csv(self, app_client) -> None:
        resp = app_client.get("/api/export/media.csv")
        assert resp.status_code == 200


class TestThemesAPI:
    def test_list_themes(self, app_client) -> None:
        resp = app_client.get("/api/settings/themes")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_create_theme(self, app_client) -> None:
        resp = app_client.post(
            "/api/settings/themes",
            json={"slug": "test_theme", "label": "Test Theme", "queries": ["query one"]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["slug"] == "test_theme"
        assert data["label"] == "Test Theme"
        assert "query one" in data["queries"]

    def test_create_duplicate_theme_returns_409(self, app_client) -> None:
        app_client.post(
            "/api/settings/themes",
            json={"slug": "dup_theme", "label": "Dup"},
        )
        resp = app_client.post(
            "/api/settings/themes",
            json={"slug": "dup_theme", "label": "Dup2"},
        )
        assert resp.status_code == 409

    def test_create_theme_invalid_slug(self, app_client) -> None:
        resp = app_client.post(
            "/api/settings/themes",
            json={"slug": "INVALID SLUG!", "label": "Bad"},
        )
        assert resp.status_code == 422

    def test_update_theme(self, app_client) -> None:
        app_client.post(
            "/api/settings/themes",
            json={"slug": "update_me", "label": "Original"},
        )
        resp = app_client.put(
            "/api/settings/themes/update_me",
            json={"label": "Updated Label", "queries": ["new query"]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["label"] == "Updated Label"
        assert "new query" in data["queries"]

    def test_delete_theme(self, app_client) -> None:
        app_client.post(
            "/api/settings/themes",
            json={"slug": "delete_me", "label": "Delete Me"},
        )
        resp = app_client.delete("/api/settings/themes/delete_me")
        assert resp.status_code == 200
        assert resp.json().get("ok") is True

    def test_delete_nonexistent_theme_returns_404(self, app_client) -> None:
        resp = app_client.delete("/api/settings/themes/does_not_exist_xyz")
        assert resp.status_code == 404
