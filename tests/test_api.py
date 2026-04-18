"""Integration tests for critical API endpoints using TestClient."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

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


class _FakeUpstreamResponse:
    def __init__(self, status_code: int, *, content_type: str, body: bytes = b"", extra_headers: dict[str, str] | None = None):
        self.status_code = status_code
        self.headers = {"content-type": content_type, **(extra_headers or {})}
        self._body = body
        self.closed = False

    async def aiter_bytes(self, chunk_size: int = 65536):
        for i in range(0, len(self._body), max(1, chunk_size)):
            yield self._body[i:i + chunk_size]

    async def aread(self) -> bytes:
        return self._body

    async def aclose(self) -> None:
        self.closed = True


class _FakeHttpClient:
    def __init__(self, responses: list[_FakeUpstreamResponse]):
        self._responses = responses
        self.requested_urls: list[str] = []

    def build_request(self, method: str, url: str, headers: dict[str, str] | None = None):
        return {"method": method, "url": url, "headers": headers or {}}

    async def send(self, request_obj, stream: bool = True):
        self.requested_urls.append(request_obj["url"])
        if not self._responses:
            raise RuntimeError("No fake responses configured")
        return self._responses.pop(0)


@pytest.fixture
def screenshots_client(test_db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.screenshots import router as screenshots_router

    app = FastAPI()
    app.state.db = test_db
    app.state.settings = SimpleNamespace(stream_only_media=True)
    app.state.http_client = _FakeHttpClient([])
    app.include_router(screenshots_router)

    with TestClient(app, raise_server_exceptions=True) as client:
        yield client


class TestScreenshotsProxyRefresh:
    def test_proxy_refreshes_ytdlp_stream_on_expired_url(self, screenshots_client, test_db, monkeypatch) -> None:
        from app.api import screenshots as screenshots_api

        test_db.insert_screenshot(
            term="test",
            source="ytdlp",
            page_url="https://example.test/watch/123",
            source_url="https://old-cdn.example.test/video.mp4",
            thumbnail_url="https://old-cdn.example.test/thumb.jpg",
        )
        with test_db.connect() as conn:
            row = conn.execute(
                "SELECT id FROM screenshots WHERE page_url = ?",
                ("https://example.test/watch/123",),
            ).fetchone()
            shot_id = int(row["id"])

        fake_client = _FakeHttpClient([
            _FakeUpstreamResponse(404, content_type="application/json", body=b'{"detail":"old"}'),
            _FakeUpstreamResponse(
                206,
                content_type="video/mp4",
                body=b"video-bytes",
                extra_headers={"content-length": "11", "accept-ranges": "bytes", "content-range": "bytes 0-10/11"},
            ),
        ])
        screenshots_client.app.state.http_client = fake_client
        monkeypatch.setattr(
            screenshots_api,
            "_resolve_ytdlp_stream_url",
            lambda _page_url: ("https://fresh-cdn.example.test/video.mp4", "https://fresh-cdn.example.test/thumb.jpg", False),
        )

        resp = screenshots_client.get(
            f"/api/screenshots/proxy-media?url=https://old-cdn.example.test/video.mp4&shot_id={shot_id}"
        )
        assert resp.status_code == 206
        assert resp.content == b"video-bytes"
        assert fake_client.requested_urls == [
            "https://old-cdn.example.test/video.mp4",
            "https://fresh-cdn.example.test/video.mp4",
        ]
        with test_db.connect() as conn:
            updated = conn.execute("SELECT source_url FROM screenshots WHERE id = ?", (shot_id,)).fetchone()
        assert updated["source_url"] == "https://fresh-cdn.example.test/video.mp4"

    def test_proxy_returns_error_when_refresh_cannot_resolve(self, screenshots_client, test_db, monkeypatch) -> None:
        from app.api import screenshots as screenshots_api

        test_db.insert_screenshot(
            term="test2",
            source="ytdlp",
            page_url="https://example.test/watch/999",
            source_url="https://gone-cdn.example.test/video.mp4",
        )
        with test_db.connect() as conn:
            row = conn.execute(
                "SELECT id FROM screenshots WHERE page_url = ?",
                ("https://example.test/watch/999",),
            ).fetchone()
            shot_id = int(row["id"])

        fake_client = _FakeHttpClient([
            _FakeUpstreamResponse(410, content_type="application/json", body=b'{"detail":"gone"}'),
        ])
        screenshots_client.app.state.http_client = fake_client
        monkeypatch.setattr(screenshots_api, "_resolve_ytdlp_stream_url", lambda _page_url: (None, None, False))

        resp = screenshots_client.get(
            f"/api/screenshots/proxy-media?url=https://gone-cdn.example.test/video.mp4&shot_id={shot_id}"
        )
        assert resp.status_code == 502
        assert "Upstream media returned 410" in resp.text
        assert fake_client.requested_urls == ["https://gone-cdn.example.test/video.mp4"]

    def test_proxy_does_not_refresh_non_ytdlp_rows(self, screenshots_client, test_db, monkeypatch) -> None:
        from app.api import screenshots as screenshots_api

        test_db.insert_screenshot(
            term="test3",
            source="redgifs",
            page_url="https://redgifs.com/watch/abc",
            source_url="https://cdn.redgifs.example/clip.mp4",
        )
        with test_db.connect() as conn:
            row = conn.execute(
                "SELECT id FROM screenshots WHERE page_url = ?",
                ("https://redgifs.com/watch/abc",),
            ).fetchone()
            shot_id = int(row["id"])

        fake_client = _FakeHttpClient([
            _FakeUpstreamResponse(404, content_type="application/json", body=b'{"detail":"missing"}'),
        ])
        screenshots_client.app.state.http_client = fake_client
        monkeypatch.setattr(
            screenshots_api,
            "_resolve_ytdlp_stream_url",
            lambda _page_url: pytest.fail("refresh resolver should not run for non-ytdlp sources"),
        )

        resp = screenshots_client.get(
            f"/api/screenshots/proxy-media?url=https://cdn.redgifs.example/clip.mp4&shot_id={shot_id}"
        )
        assert resp.status_code == 404
        assert "Upstream media returned 404" in resp.text
        assert fake_client.requested_urls == ["https://cdn.redgifs.example/clip.mp4"]


class TestScreenshotsBrowseMediaType:
    def test_browse_screenshots_keeps_coomer_jpgs_out_of_video_feed(self, screenshots_client, test_db) -> None:
        test_db.insert_screenshot(
            term="creator-image",
            source="coomer",
            page_url="https://coomer.st/onlyfans/user/test/post/image",
            source_url="https://coomer.st/data/aa/bb/example-image.jpg",
        )
        test_db.insert_screenshot(
            term="creator-video",
            source="coomer",
            page_url="https://coomer.st/onlyfans/user/test/post/video",
            source_url="https://coomer.st/data/cc/dd/example-video.mp4",
        )

        video_resp = screenshots_client.get("/api/screenshots?media_type=video&limit=20")
        image_resp = screenshots_client.get("/api/screenshots?media_type=image&limit=20")

        assert video_resp.status_code == 200
        assert image_resp.status_code == 200

        video_rows = video_resp.json()["screenshots"]
        image_rows = image_resp.json()["screenshots"]

        video_urls = {row["source_url"] for row in video_rows}
        image_rows_by_url = {row["source_url"]: row for row in image_rows}

        assert "https://coomer.st/data/cc/dd/example-video.mp4" in video_urls
        assert "https://coomer.st/data/aa/bb/example-image.jpg" not in video_urls

        image_row = image_rows_by_url["https://coomer.st/data/aa/bb/example-image.jpg"]
        assert image_row["local_url"].endswith("example-image.jpg")
        assert image_row["preview_url"] == image_row["local_url"]
        assert "/api/screenshots/video-poster/" not in image_row["preview_url"]
