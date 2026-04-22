"""Shared pytest fixtures."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI

# Configure environment before importing the app
os.environ.setdefault("ENVIRONMENT", "testing")
os.environ.setdefault("ADMIN_TOKEN", "test-token")


@pytest.fixture(scope="session")
def temp_data_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    d = tmp_path_factory.mktemp("data")
    (d / "images").mkdir()
    (d / "screenshots").mkdir()
    (d / "previews").mkdir()
    return d


@pytest.fixture(scope="session")
def test_db(temp_data_dir: Path):
    """Return an initialised Database on a temp file."""
    from app.db import Database

    os.environ["DATABASE_PATH"] = str(temp_data_dir / "test.db")
    database = Database(temp_data_dir / "test.db", timeout_seconds=5, busy_timeout_ms=5000)
    database.init()
    return database


@pytest.fixture
def app_client(test_db):
    """Create a minimal FastAPI app with routers, no lifespan side effects."""
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

    # Many endpoints lazily import db from app.main rather than using request.app.state.db.
    import app.main as _main_module
    _main_module.db = test_db

    from app.api.items import router as items_router, browse_router as items_browse_router
    from app.api.search import router as search_router
    from app.api.export import router as export_router
    from app.api.settings_api import router as settings_router
    from app.api.images import router as images_router, browse_router as images_browse_router
    from app.api.screenshots import router as screenshots_router
    from app.api.performers import router as performers_router

    minimal_app.include_router(items_router)
    minimal_app.include_router(items_browse_router)
    minimal_app.include_router(search_router)
    minimal_app.include_router(export_router)
    minimal_app.include_router(settings_router, prefix="/api/settings")
    minimal_app.include_router(images_router)
    minimal_app.include_router(images_browse_router)
    minimal_app.include_router(screenshots_router)
    minimal_app.include_router(performers_router)

    @minimal_app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    with TestClient(minimal_app, raise_server_exceptions=True) as client:
        yield client


@pytest.fixture
def async_client(test_db) -> AsyncIterator[httpx.AsyncClient]:
    """Async HTTPX client wired to an ASGI app instance."""
    from httpx import ASGITransport

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

    from app.api.items import browse_router as items_browse_router
    from app.api.images import browse_router as images_browse_router
    from app.api.screenshots import router as screenshots_router

    minimal_app.include_router(items_browse_router)
    minimal_app.include_router(images_browse_router)
    minimal_app.include_router(screenshots_router)

    @minimal_app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    transport = ASGITransport(app=minimal_app)
    client = httpx.AsyncClient(transport=transport, base_url="http://test")
    yield client
    # httpx.AsyncClient.aclose is a coroutine; pytest-asyncio handles async fixtures


@pytest.fixture
def mock_openai(monkeypatch: pytest.MonkeyPatch):
    """Patch OpenAI chat completions to return a canned response."""

    class FakeMessage:
        content = "mocked response"

    class FakeChoice:
        message = FakeMessage()

    class FakeCompletion:
        choices = [FakeChoice()]

    class FakeCompletions:
        def create(self, *args, **kwargs):
            return FakeCompletion()

    class FakeOpenAI:
        chat = SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr("openai.OpenAI", lambda **kwargs: FakeOpenAI())
    return FakeOpenAI()
