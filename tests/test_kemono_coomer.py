"""Unit tests for the Kemono and Coomer collectors."""
from __future__ import annotations

from typing import Any

import pytest

from app.config import Settings, Theme
from app.sources.coomer import collect_coomer
from app.sources.kemono import collect_kemono


class _FakeResponse:
    def __init__(self, json_data: Any = None, status_code: int = 200, text: str = "") -> None:
        self._json = json_data
        self.status_code = status_code
        self.text = text

    def json(self) -> Any:
        return self._json

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeSession:
    """Session that returns queued responses based on URL substring matching."""

    def __init__(self, routes: dict[str, _FakeResponse]) -> None:
        self.routes = routes
        self.calls: list[str] = []

    def get(self, url: str, timeout: int = 0, **kwargs: Any) -> _FakeResponse:
        self.calls.append(url)
        for needle, response in self.routes.items():
            if needle in url:
                return response
        return _FakeResponse(status_code=404)


@pytest.fixture
def theme() -> Theme:
    return Theme(slug="twinks", label="Gay Twinks", queries=["twink nude"])


@pytest.fixture
def settings() -> Settings:
    s = Settings()
    s.kemono_results = 2
    s.coomer_results = 2
    return s


def _sample_posts() -> list[dict[str, Any]]:
    return [
        {
            "id": "12345",
            "user": "creator_one",
            "service": "onlyfans",
            "title": "Sample post one",
            "content": "Gay twink preview content with dopamine mentioned.",
            "published": "2025-01-15T10:00:00",
            "file": {"name": "a.jpg", "path": "/data/aa/bb/one.jpg"},
            "attachments": [
                {"name": "extra.jpg", "path": "/data/aa/bb/two.jpg"},
            ],
        },
        {
            "id": "67890",
            "user": "creator_two",
            "service": "fansly",
            "title": "Sample post two",
            "content": "Another body of text",
            "published": "2025-02-01T12:30:00",
            "file": {"name": "c.jpg", "path": "/data/cc/dd/three.jpg"},
            "attachments": [],
        },
    ]


def test_collect_kemono_parses_posts(theme: Theme, settings: Settings) -> None:
    session = _FakeSession(
        {
            "/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "/api/v1/posts": _FakeResponse(json_data=_sample_posts()),
        }
    )
    items, images = collect_kemono(session, settings, theme)  # type: ignore[arg-type]

    assert len(items) == 2
    first = items[0]
    assert first.source_type == "kemono"
    assert first.theme == "twinks"
    assert first.author == "creator_one"
    assert "kemono" in first.domain
    assert "/onlyfans/user/creator_one/post/12345" in first.url
    assert first.image_url.startswith("https://img.kemono.cr/data/")

    assert len(images) >= 2
    assert all(img.source_type == "kemono_image" for img in images)
    assert any("one.jpg" in img.image_url for img in images)
    assert any("two.jpg" in img.image_url for img in images)


def test_collect_coomer_parses_posts(theme: Theme, settings: Settings) -> None:
    session = _FakeSession(
        {
            "/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "/api/v1/posts": _FakeResponse(json_data=_sample_posts()),
        }
    )
    items, images = collect_coomer(session, settings, theme)  # type: ignore[arg-type]

    assert len(items) == 2
    first = items[0]
    assert first.source_type == "coomer"
    assert first.image_url.startswith("https://img.coomer.st/data/")
    assert "/onlyfans/user/creator_one/post/12345" in first.url
    assert all(img.source_type == "coomer_image" for img in images)


def test_collect_kemono_respects_result_limit(theme: Theme, settings: Settings) -> None:
    settings.kemono_results = 1
    big_batch = _sample_posts() * 3
    session = _FakeSession(
        {
            "/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "/api/v1/posts": _FakeResponse(json_data=big_batch),
        }
    )
    items, _images = collect_kemono(session, settings, theme)  # type: ignore[arg-type]
    assert len(items) == 1


def test_collect_coomer_handles_api_failure(theme: Theme, settings: Settings) -> None:
    session = _FakeSession(
        {
            "/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "/api/v1/posts": _FakeResponse(status_code=500),
        }
    )
    items, images = collect_coomer(session, settings, theme)  # type: ignore[arg-type]
    assert items == []
    assert images == []


def test_collect_kemono_skips_malformed_posts(theme: Theme, settings: Settings) -> None:
    posts = [
        {"title": "no id/user/service"},
        {
            "id": "1",
            "user": "u",
            "service": "s",
            "title": "good",
            "content": "text",
            "file": {"path": "/data/x.jpg"},
            "attachments": [],
        },
    ]
    session = _FakeSession(
        {
            "/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "/api/v1/posts": _FakeResponse(json_data=posts),
        }
    )
    items, _images = collect_kemono(session, settings, theme)  # type: ignore[arg-type]
    assert len(items) == 1
    assert items[0].url.endswith("/s/user/u/post/1")


def test_collect_kemono_dedupes_by_url(theme: Theme, settings: Settings) -> None:
    duplicate_post = {
        "id": "1",
        "user": "u",
        "service": "s",
        "title": "t",
        "content": "",
        "file": {"path": "/data/x.jpg"},
        "attachments": [],
    }
    session = _FakeSession(
        {
            "/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "/api/v1/posts": _FakeResponse(json_data=[duplicate_post, duplicate_post]),
        }
    )
    items, _images = collect_kemono(session, settings, theme)  # type: ignore[arg-type]
    assert len(items) == 1
