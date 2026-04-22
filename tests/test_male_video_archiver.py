"""Unit tests for the Male Video Archiver collector."""
from __future__ import annotations

from typing import Any

import pytest

from app.config import Settings, Theme
from app.sources.male_video_archiver import collect_male_video_archiver


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
    s.male_video_archiver_results = 4
    return s


def _sample_posts() -> list[dict[str, Any]]:
    return [
        {
            "id": "111",
            "user": "creator_a",
            "service": "onlyfans",
            "title": "Twink video preview",
            "content": "Gay twink content with muscle mentioned.",
            "published": "2025-01-15T10:00:00",
            "file": {"name": "poster.jpg", "path": "/data/aa/bb/poster.jpg"},
            "attachments": [
                {"name": "clip.mp4", "path": "/data/aa/bb/clip.mp4"},
            ],
        },
        {
            "id": "222",
            "user": "creator_b",
            "service": "fansly",
            "title": "Another post",
            "content": "More body text here",
            "published": "2025-02-01T12:30:00",
            "file": {"name": "thumb.jpg", "path": "/data/cc/dd/thumb.jpg"},
            "attachments": [],
        },
    ]


def test_collect_male_video_archiver_parses_both_platforms(
    theme: Theme, settings: Settings
) -> None:
    """The collector should return items from both Coomer and Kemono."""
    coomer_posts = _sample_posts()
    # Kemono returns different posts so cross-platform dedup does not remove them.
    kemono_posts = [
        {
            "id": "333",
            "user": "creator_c",
            "service": "onlyfans",
            "title": "Kemono post one",
            "content": "Gay bear content.",
            "published": "2025-03-10T10:00:00",
            "file": {"name": "pic.jpg", "path": "/data/ee/ff/pic.jpg"},
            "attachments": [],
        },
        {
            "id": "444",
            "user": "creator_d",
            "service": "fansly",
            "title": "Kemono post two",
            "content": "More kemono text",
            "published": "2025-04-01T12:30:00",
            "file": {"name": "thumb.jpg", "path": "/data/gg/hh/thumb.jpg"},
            "attachments": [],
        },
    ]
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(json_data=coomer_posts),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(json_data=kemono_posts),
        }
    )
    items, images = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]

    # We should get items from both platforms (2 coomer + 2 kemono = 4).
    assert len(items) == 4

    coomer_items = [i for i in items if i.source_type == "coomer"]
    kemono_items = [i for i in items if i.source_type == "kemono"]
    assert len(coomer_items) == 2
    assert len(kemono_items) == 2

    # First coomer item assertions
    first = coomer_items[0]
    assert first.theme == "twinks"
    assert first.author == "creator_a"
    assert "/onlyfans/user/creator_a/post/111" in first.url
    assert first.metadata.get("has_videos") is True
    assert len(first.metadata["videos"]) == 1
    assert first.metadata["videos"][0]["source_url"].endswith(".mp4")

    # Kemono image URLs use img.kemono.cr
    kemono_first = kemono_items[0]
    assert "img.kemono.cr" in kemono_first.image_url


def test_collect_male_video_archiver_filters_female_content(
    theme: Theme, settings: Settings
) -> None:
    """Posts with female keywords should be skipped."""
    posts = [
        {
            "id": "1",
            "user": "u",
            "service": "s",
            "title": "Straight girl content",
            "content": "woman and girlfriend",
            "file": {"path": "/data/x.jpg"},
            "attachments": [],
        },
        {
            "id": "2",
            "user": "u",
            "service": "s",
            "title": "Gay twink",
            "content": "male muscle",
            "file": {"path": "/data/x.jpg"},
            "attachments": [],
        },
    ]
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(json_data=posts),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(json_data=[]),
        }
    )
    items, _images = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]

    # Only the male-oriented post should survive.
    assert len(items) == 1
    assert items[0].title == "Gay twink"


def test_collect_male_video_archiver_dedupes_cross_platform(
    theme: Theme, settings: Settings
) -> None:
    """The same URL should not appear twice across Coomer and Kemono."""
    same_post = {
        "id": "1",
        "user": "u",
        "service": "onlyfans",
        "title": "Same post",
        "content": "gay male",
        "file": {"path": "/data/x.jpg"},
        "attachments": [],
    }
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(json_data=[same_post]),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(json_data=[same_post]),
        }
    )
    items, _images = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]

    # Only one item because the URL is deduped across platforms.
    assert len(items) == 1
    assert items[0].source_type == "coomer"  # Coomer is scraped first


def test_collect_male_video_archiver_respects_limit(theme: Theme, settings: Settings) -> None:
    settings.male_video_archiver_results = 2
    big_batch = _sample_posts() * 5
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(json_data=big_batch),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(json_data=[]),
        }
    )
    items, _images = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]
    assert len(items) == 2


def test_collect_male_video_archiver_boosts_video_posts(
    theme: Theme, settings: Settings
) -> None:
    """Posts with videos should have a higher score."""
    posts = [
        {
            "id": "1",
            "user": "u",
            "service": "s",
            "title": "No video",
            "content": "gay male",
            "file": {"path": "/data/x.jpg"},
            "attachments": [],
        },
        {
            "id": "2",
            "user": "u",
            "service": "s",
            "title": "Has video",
            "content": "gay male",
            "file": {"path": "/data/x.jpg"},
            "attachments": [
                {"name": "v.mp4", "path": "/data/x.mp4"},
            ],
        },
    ]
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(json_data=posts),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(json_data=[]),
        }
    )
    items, _images = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]

    no_video = next(i for i in items if i.title == "No video")
    has_video = next(i for i in items if i.title == "Has video")
    assert has_video.score > no_video.score


def test_collect_male_video_archiver_handles_api_failure(
    theme: Theme, settings: Settings
) -> None:
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(status_code=500),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(status_code=500),
        }
    )
    items, images = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]
    assert items == []
    assert images == []


def test_collect_male_video_archiver_skips_malformed_posts(
    theme: Theme, settings: Settings
) -> None:
    posts = [
        {"title": "no id/user/service"},
        {
            "id": "1",
            "user": "u",
            "service": "s",
            "title": "good",
            "content": "gay male",
            "file": {"path": "/data/x.jpg"},
            "attachments": [],
        },
    ]
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(json_data=posts),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(json_data=[]),
        }
    )
    items, _images = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]
    assert len(items) == 1
    assert items[0].url.endswith("/s/user/u/post/1")


def test_collect_male_video_archiver_video_urls_match_cache_status_filter(
    theme: Theme, settings: Settings
) -> None:
    """The cache-status endpoint's SQL only matches source_url endings
    .mp4/.webm/.mov; any video URL we emit must satisfy that filter."""
    posts = [
        {
            "id": "1",
            "user": "u",
            "service": "s",
            "title": "Video post",
            "content": "gay male",
            "file": {"path": "/data/x.jpg"},
            "attachments": [
                {"name": "clip.mp4", "path": "/data/aa/bb/clip.mp4"},
                {"name": "clip2.webm", "path": "/data/aa/bb/clip2.webm"},
            ],
        }
    ]
    session = _FakeSession(
        {
            "coomer.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "coomer.su/api/v1/posts": _FakeResponse(json_data=posts),
            "kemono.su/api/v1/creators.txt": _FakeResponse(status_code=200, text="ok"),
            "kemono.su/api/v1/posts": _FakeResponse(json_data=[]),
        }
    )
    items, _ = collect_male_video_archiver(session, settings, theme)  # type: ignore[arg-type]
    for video in items[0].metadata["videos"]:
        url = video["source_url"].lower()
        assert url.endswith((".mp4", ".webm", ".mov"))
