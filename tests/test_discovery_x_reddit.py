"""Official-API discovery: X (v2) and Reddit (OAuth2 app-only) collectors.

Every network call is mocked (the sandbox cannot reach X or Reddit): a tiny
router replaces ``requests.request`` and records the calls so request shapes,
budgets and caching can be asserted.
"""
from __future__ import annotations

import re
import time
from types import SimpleNamespace
from typing import Any, Callable

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import discovery as gateway
from app.discovery import common, reddit_api, x_api
from app.discovery.safety import is_paywall_host, is_unsafe_text, looks_like_adult_promo


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status: int = 200, payload: Any = None, headers: dict[str, str] | None = None) -> None:
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}

    def json(self) -> Any:
        if self._payload is None:
            raise ValueError("no body")
        return self._payload


class FakeApi:
    """Replacement for ``requests.request`` with pattern routes and a call log."""

    def __init__(self) -> None:
        self.routes: list[tuple[str, re.Pattern[str], Any]] = []
        self.calls: list[dict[str, Any]] = []

    def add(self, method: str, pattern: str, response: Any) -> None:
        self.routes.append((method, re.compile(pattern), response))

    def __call__(self, method: str, url: str, headers: dict[str, str] | None = None, params: dict[str, Any] | None = None,
                 data: dict[str, Any] | None = None, auth: Any = None, timeout: Any = None, allow_redirects: bool = True) -> FakeResponse:
        self.calls.append({"method": method, "url": url, "headers": headers or {}, "params": params or {}, "data": data, "auth": auth,
                           "timeout": timeout, "allow_redirects": allow_redirects})
        for route_method, pattern, response in self.routes:
            if route_method == method and pattern.search(url):
                outcome = response(params or {}) if callable(response) else response
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome
        return FakeResponse(404, {"error": "no route"})

    def to(self, fragment: str) -> list[dict[str, Any]]:
        return [call for call in self.calls if fragment in call["url"]]


@pytest.fixture(autouse=True)
def _fresh_state():
    x_api.reset_state()
    reddit_api.reset_state()
    yield
    x_api.reset_state()
    reddit_api.reset_state()


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeApi:
    fake = FakeApi()
    monkeypatch.setattr(requests, "request", fake)
    return fake


def make_settings(**overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        "x_bearer_token": "x-secret-bearer",
        "reddit_client_id": "rid",
        "reddit_client_secret": "rsecret",
        "reddit_user_agent": "web:media-codex-test:1.0 (by /u/operator)",
        "reddit_subreddits": "",
        "x_discovery_queries": "",
        "x_search_calls_per_request": 2,
        "x_search_max_calls_per_hour": 30,
        "x_search_cache_ttl_seconds": 900,
        "x_timeline_handles_per_request": 4,
        "x_timeline_cache_ttl_seconds": 600,
        "reddit_calls_per_request": 8,
        "reddit_cache_ttl_seconds": 600,
        "request_timeout_seconds": 5,
        "user_agent": "MediaCodex/Test",
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def deadline(seconds: float = 8.0) -> float:
    return time.monotonic() + seconds


# ---------------------------------------------------------------------------
# X fixtures
# ---------------------------------------------------------------------------

PHOTO = "https://pbs.twimg.com/media/PhotoKey.jpg"
THUMB = "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/thumb.jpg"
GIF_THUMB = "https://pbs.twimg.com/tweet_video_thumb/gif.jpg"


def x_user(user_id: str = "100", username: str = "muscle_max", **extra: Any) -> dict[str, Any]:
    user = {
        "id": user_id,
        "name": "Muscle Max",
        "username": username,
        "profile_image_url": "https://pbs.twimg.com/profile_images/1/abc_normal.jpg",
        "public_metrics": {"followers_count": 12345, "following_count": 10},
        "description": "Gay muscle creator. Business: max@example.com or +1 (555) 123-4567. Link in bio",
    }
    user.update(extra)
    return user


def video_asset(key: str = "3_vid") -> dict[str, Any]:
    base = "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1"
    return {
        "media_key": key, "type": "video", "preview_image_url": THUMB, "duration_ms": 12500, "width": 1920, "height": 1080,
        "variants": [
            {"content_type": "application/x-mpegURL", "url": "https://video.twimg.com/ext_tw_video/1/pu/pl/master.m3u8"},
            {"content_type": "video/mp4", "bit_rate": 256000, "url": f"{base}/480x270/low.mp4?tag=12"},
            {"content_type": "video/mp4", "bit_rate": 2176000, "url": f"{base}/1280x720/mid.mp4?tag=12"},
            {"content_type": "video/mp4", "bit_rate": 8000000, "url": f"{base}/3840x2160/uhd.mp4?tag=12"},
            {"content_type": "video/mp4", "bit_rate": 832000, "url": "https://evil.example/avc1/1920x1080/off.mp4"},
        ],
    }


def timeline_body(user: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "data": [
            {"id": "9001", "author_id": "100", "created_at": "2026-10-01T12:00:00.000Z", "text": "New set live 18+ #gaymuscle https://t.co/abc",
             "possibly_sensitive": True, "public_metrics": {"like_count": 50, "reply_count": 3, "impression_count": 1000},
             "attachments": {"media_keys": ["3_photo"]}},
            {"id": "9002", "author_id": "100", "created_at": "2026-10-02T12:00:00.000Z", "text": "Gym clip", "possibly_sensitive": False,
             "public_metrics": {"like_count": 5}, "attachments": {"media_keys": ["3_vid"]}},
            {"id": "9003", "author_id": "100", "created_at": "2026-10-03T12:00:00.000Z", "text": "Loop", "attachments": {"media_keys": ["3_gif"]}},
        ],
        "includes": {
            "media": [
                {"media_key": "3_photo", "type": "photo", "url": PHOTO, "width": 1200, "height": 1600},
                video_asset(),
                {"media_key": "3_gif", "type": "animated_gif", "preview_image_url": GIF_THUMB, "width": 480, "height": 480,
                 "variants": [{"bit_rate": 0, "content_type": "video/mp4", "url": "https://video.twimg.com/tweet_video/gif.mp4"}]},
            ],
            **({"users": [user]} if user else {}),
        },
    }


def mock_x_timeline(api: FakeApi, username: str = "muscle_max", user: dict[str, Any] | None = None) -> None:
    api.add("GET", rf"/2/users/by/username/{username}$", FakeResponse(200, {"data": user or x_user(username=username)}))
    api.add("GET", r"/2/users/\d+/tweets$", FakeResponse(200, timeline_body()))


def search_body(user_id: str = "200", username: str = "feed_creator") -> dict[str, Any]:
    user = x_user(user_id, username, description="Gay content creator. OnlyFans link in bio")
    return {
        "data": [
            {"id": "7001", "author_id": user_id, "created_at": "2026-10-04T10:00:00.000Z", "text": "spicy new video",
             "possibly_sensitive": True, "attachments": {"media_keys": ["m1"]}},
            {"id": "7002", "author_id": user_id, "created_at": "2026-10-04T11:00:00.000Z", "text": "my page is live, subscribe!",
             "possibly_sensitive": False, "attachments": {"media_keys": ["m2"]}},
            {"id": "7003", "author_id": user_id, "created_at": "2026-10-04T12:00:00.000Z", "text": "Pride parade downtown today",
             "possibly_sensitive": False, "attachments": {"media_keys": ["m3"]}},
        ],
        "includes": {
            "users": [{**user, "description": "Photographer"}],
            "media": [
                {"media_key": "m1", "type": "photo", "url": "https://pbs.twimg.com/media/A.jpg"},
                {"media_key": "m2", "type": "photo", "url": "https://pbs.twimg.com/media/B.jpg"},
                {"media_key": "m3", "type": "photo", "url": "https://pbs.twimg.com/media/C.jpg"},
            ],
        },
    }


# ---------------------------------------------------------------------------
# common helpers + safety
# ---------------------------------------------------------------------------


def test_clean_text_redacts_emails_and_phones_but_keeps_ids_and_dates() -> None:
    cleaned = common.clean_text("Call 555-123-4567 or +1 (555) 123-4567 or (555)123 4567, mail me a.b@example.com. Posted 2026-10-05, id 1234567890123456789, 6'2 190lbs")
    assert "555" not in cleaned and "@example" not in cleaned
    assert "2026-10-05" in cleaned and "1234567890123456789" in cleaned and "190lbs" in cleaned


def test_safe_https_any_enforces_scheme_credentials_and_domain() -> None:
    allowed = ("pbs.twimg.com",)
    assert common.safe_https_any("https://pbs.twimg.com/media/a.jpg", allowed)
    assert not common.safe_https_any("http://pbs.twimg.com/media/a.jpg", allowed)
    assert not common.safe_https_any("https://user:pw@pbs.twimg.com/a.jpg", allowed)
    assert not common.safe_https_any("https://pbs.twimg.com.evil.example/a.jpg", allowed)
    assert not common.safe_https_any("https://evilpbs.twimg.com/a.jpg", allowed)  # suffix match is dot-anchored
    assert not common.safe_https_any("https://evil.example/pbs.twimg.com", allowed)


def test_api_request_only_talks_to_fixed_official_hosts(api: FakeApi) -> None:
    for url in ("https://example.com/2/tweets", "http://api.x.com/2/tweets", "https://api.x.com.evil.example/x", "https://u:p@api.x.com/x"):
        response = common.api_request("GET", url, headers={}, timeout=1)
        assert response.error == "blocked-host"
    assert api.calls == []


def test_ttl_cache_expires_and_bounds() -> None:
    clock = {"t": 0.0}
    cache = common.TTLCache(max_entries=2, clock=lambda: clock["t"])
    cache.set("a", 1, ttl=10)
    cache.set("b", 2, ttl=20)
    cache.set("c", 3, ttl=30)  # evicts the entry closest to expiry
    assert len(cache) == 2 and cache.get("a") is None and cache.get("b") == 2
    clock["t"] = 21
    assert cache.get("b") is None and cache.get("c") == 3


def test_safety_screens() -> None:
    assert is_unsafe_text("barely legal teen") and is_unsafe_text("16yo twink") and is_unsafe_text("leaked vid") and is_unsafe_text("no consent, forced")
    assert not is_unsafe_text("Gay muscle creator, new set, 18+", "bear", "gaybrosgonewild")
    assert looks_like_adult_promo("link in bio") and not looks_like_adult_promo("Pride parade")
    assert is_paywall_host("www.onlyfans.com") and is_paywall_host("fansly.com") and not is_paywall_host("i.redd.it")


# ---------------------------------------------------------------------------
# X: timelines
# ---------------------------------------------------------------------------


def test_x_not_configured_skips_cleanly(api: FakeApi) -> None:
    result = x_api.collect_x(make_settings(x_bearer_token=""), ["muscle_max"], "")
    assert result["status"]["state"] == "not-configured" and result["status"]["id"] == "x"
    assert result["media"] == [] and result["attempted"] == 0 and api.calls == []


def test_x_timeline_maps_photos_mp4_variants_and_gifs(api: FakeApi) -> None:
    mock_x_timeline(api)
    result = x_api.collect_x(make_settings(), ["muscle_max"], "", deadline=deadline())

    lookup, timeline = api.calls
    assert lookup["url"].endswith("/2/users/by/username/muscle_max")
    assert timeline["url"].endswith("/2/users/100/tweets")
    assert lookup["headers"]["Authorization"] == "Bearer x-secret-bearer"
    assert lookup["allow_redirects"] is False
    params = timeline["params"]
    assert params["exclude"] == "retweets,replies" and params["max_results"] == 20
    assert params["expansions"] == "attachments.media_keys,author_id"
    assert params["media.fields"] == "type,url,preview_image_url,variants,duration_ms,width,height"
    assert params["tweet.fields"] == "created_at,public_metrics,possibly_sensitive,lang"
    assert result["attempted"] == 2 and result["succeeded"] == 2

    by_id = {item["id"]: item for item in result["media"]}
    assert set(by_id) == {"x-9001-3_photo", "x-9002-3_vid", "x-9003-3_gif"}

    photo = by_id["x-9001-3_photo"]
    assert photo["source"] == "X" and photo["isVideo"] is False
    assert photo["mediaUrl"] == PHOTO and photo["thumbnail"] == PHOTO and photo["streamCandidates"] == []
    assert photo["pageUrl"] == "https://x.com/muscle_max/status/9001" and photo["profileUrl"] == "https://x.com/muscle_max"
    assert photo["isWatchedCreator"] is True and "creator is on your watchlist" in photo["curationReasons"]
    assert "t.co" not in photo["title"] and photo["title"].startswith("New set live")
    assert photo["likes"] == 50 and photo["comments"] == 3 and photo["views"] == 1000
    assert "adult" in photo["tags"] and "#gaymuscle" in photo["tags"]
    assert any("adult-labelled" in reason for reason in photo["curationReasons"])

    video = by_id["x-9002-3_vid"]
    assert video["isVideo"] is True and video["thumbnail"] == THUMB
    # 1080p-or-lower mp4 only, best first, off-host and >1080p (short side) variants excluded, no HLS.
    assert video["streamCandidates"] == [
        "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/mid.mp4?tag=12",
        "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/480x270/low.mp4?tag=12",
    ]
    assert video["mediaUrl"] == video["streamCandidates"][0]
    assert video["durationSeconds"] == 12.5 and video["duration"] == "0:12"
    assert (video["width"], video["height"]) == (1280, 720)
    assert "adult" not in video["tags"]

    gif = by_id["x-9003-3_gif"]
    assert gif["isVideo"] is True and gif["streamCandidates"] == ["https://video.twimg.com/tweet_video/gif.mp4"]
    assert gif["thumbnail"] == GIF_THUMB

    (lead,) = result["leads"]
    assert lead["id"] == "x-muscle_max" and lead["platform"] == "X" and lead["profileUrl"] == "https://x.com/muscle_max"
    assert lead["avatar"] == "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg"
    assert lead["followers"] == 12345 and lead["exactWatchMatch"] is True
    assert "example.com" not in lead["description"] and "555" not in lead["description"] and "Gay muscle creator" in lead["description"]
    assert result["status"]["state"] == "connected" and result["status"]["mediaFound"] == 3 and result["status"]["creatorsFound"] == 1


def test_x_drops_foreign_hosts_unsafe_text_and_unknown_authors() -> None:
    body = {
        "data": [
            {"id": "1", "author_id": "1", "text": "ok post", "attachments": {"media_keys": ["off"]}},
            {"id": "2", "author_id": "1", "text": "teen boy pics", "attachments": {"media_keys": ["ok"]}},
            {"id": "3", "author_id": "999", "text": "who is this", "attachments": {"media_keys": ["ok"]}},
            {"id": "4", "author_id": "2", "text": "fine", "attachments": {"media_keys": ["ok"]}},
            {"id": "5", "author_id": "1", "text": "good", "attachments": {"media_keys": ["ok", "off"]}},
        ],
        "includes": {
            "users": [x_user("1", "good_user"), x_user("2", "bad_user", description="underage content")],
            "media": [
                {"media_key": "off", "type": "photo", "url": "https://cdn.evil.example/a.jpg"},
                {"media_key": "ok", "type": "photo", "url": "https://pbs.twimg.com/media/ok.jpg"},
            ],
        },
    }
    media, leads = x_api.map_x_payload(body)
    assert [item["id"] for item in media] == ["x-5-ok"]
    assert list(leads) == ["x-good_user"]


def test_x_video_without_playable_variant_becomes_link_out_still() -> None:
    asset = {"media_key": "v", "type": "video", "preview_image_url": THUMB,
             "variants": [{"content_type": "video/mp4", "url": "https://video.twimg.com/a/3840x2160/x.mp4"}]}
    body = {"data": [{"id": "5", "author_id": "1", "text": "clip", "attachments": {"media_keys": ["v"]}}],
            "includes": {"users": [x_user("1", "good_user")], "media": [asset]}}
    (item,), _ = x_api.map_x_payload(body)
    assert item["isVideo"] is False and item["mediaUrl"] is None and item["thumbnail"] == THUMB and item["streamCandidates"] == []


def test_x_only_exact_handles_are_looked_up_and_cap_rotates(api: FakeApi) -> None:
    api.add("GET", r"/2/users/by/username/(\w+)$", lambda p: FakeResponse(200, {"data": x_user("100", "someone")}))
    api.add("GET", r"/2/users/\d+/tweets$", FakeResponse(200, {"data": [], "meta": {"result_count": 0}}))
    watch = ["Creator One", "h1", "h2", "h3", "h4", "h5", "h6", "@h1"]
    settings = make_settings(x_timeline_handles_per_request=4)

    x_api.collect_x(settings, watch, "", deadline=deadline())
    looked = [call["url"].rsplit("/", 1)[-1] for call in api.to("/by/username/")]
    assert len(looked) == 4 and "Creator One" not in looked and "Creator%20One" not in looked

    api.calls.clear()
    x_api.collect_x(settings, watch, "", deadline=deadline())
    again = [call["url"].rsplit("/", 1)[-1] for call in api.to("/by/username/")]
    assert set(again) == {"h5", "h6"}  # rotation reaches the handles skipped by the per-request cap


def test_x_user_lookup_and_timeline_are_cached(api: FakeApi) -> None:
    mock_x_timeline(api)
    settings = make_settings()
    first = x_api.collect_x(settings, ["muscle_max"], "", deadline=deadline())
    count = len(api.calls)
    second = x_api.collect_x(settings, ["muscle_max"], "", deadline=deadline())
    assert len(api.calls) == count and len(second["media"]) == len(first["media"])
    assert second["status"]["state"] == "connected"


# ---------------------------------------------------------------------------
# X: default feed (search), budgets and cache
# ---------------------------------------------------------------------------


def test_x_default_feed_rotates_queries_within_budget_and_caches(api: FakeApi) -> None:
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, search_body()))
    settings = make_settings()

    first = x_api.collect_x(settings, [], "", deadline=deadline())
    searches = api.to("/search/recent")
    assert len(searches) == 2  # default budget: <= 2 search calls per backend request
    for call in searches:
        assert "has:media" in call["params"]["query"] and "-is:retweet" in call["params"]["query"]
        assert call["params"]["expansions"] == "attachments.media_keys,author_id"
        assert call["params"]["tweet.fields"] == "created_at,public_metrics,possibly_sensitive,lang"
    assert {call["params"]["query"] for call in searches} <= set(x_api.DEFAULT_QUERIES)

    second = x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.to("/search/recent")) == 3  # the remaining query; the first two come from cache
    third = x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.to("/search/recent")) == 3  # everything cached now
    assert {c["params"]["query"] for c in api.to("/search/recent")} == set(x_api.DEFAULT_QUERIES)
    assert first["status"]["state"] == second["status"]["state"] == third["status"]["state"] == "connected"
    assert third["media"] and "feed" in third["status"]["detail"].lower()


def test_x_default_feed_keeps_sensitive_or_promo_posts_only(api: FakeApi) -> None:
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, search_body()))
    result = x_api.collect_x(make_settings(x_search_calls_per_request=1), [], "", deadline=deadline())
    ids = {item["id"] for item in result["media"]}
    assert ids == {"x-7001-m1", "x-7002-m2"}  # the plain pride-parade photo is not creator marketing
    sensitive = next(item for item in result["media"] if item["id"] == "x-7001-m1")
    assert "adult" in sensitive["tags"] and sensitive["isWatchedCreator"] is False
    (lead,) = result["leads"]
    assert lead["exactWatchMatch"] is False and lead["confidence"] < 92


def test_x_search_cache_has_a_ten_minute_floor(api: FakeApi, monkeypatch: pytest.MonkeyPatch) -> None:
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, search_body()))
    clock = {"t": 1000.0}
    x_api._STATE.search_cache._clock = lambda: clock["t"]
    settings = make_settings(x_discovery_queries="(#gay) has:media", x_search_cache_ttl_seconds=1)

    x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.to("/search/recent")) == 1
    clock["t"] += 599
    x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.to("/search/recent")) == 1  # still cached: floor is 10 minutes even with TTL=1
    clock["t"] += 2
    x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.to("/search/recent")) == 2


def test_x_hourly_search_budget_is_enforced(api: FakeApi) -> None:
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, search_body()))
    settings = make_settings(x_search_max_calls_per_hour=1, x_search_calls_per_request=2)
    result = x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.to("/search/recent")) == 1 and result["attempted"] == 1
    x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.to("/search/recent")) == 1  # hourly cap reached; cache serves the rest


def test_x_custom_queries_from_settings(api: FakeApi) -> None:
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, {"data": []}))
    settings = make_settings(x_discovery_queries="(#bears) has:media || (#otters) has:media ||  || (#bears) has:media", x_search_calls_per_request=5)
    x_api.collect_x(settings, [], "", deadline=deadline())
    assert sorted(call["params"]["query"] for call in api.to("/search/recent")) == ["(#bears) has:media", "(#otters) has:media"]


def test_x_typed_query_runs_one_text_search_and_explicit_handle_uses_lookup(api: FakeApi) -> None:
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, search_body()))
    x_api.collect_x(make_settings(), [], "muscle bear <script>", deadline=deadline())
    (search,) = api.to("/search/recent")
    assert search["params"]["query"] == "(muscle bear script) has:media -is:retweet -is:reply"

    api.calls.clear()
    mock_x_timeline(api)
    result = x_api.collect_x(make_settings(), [], "@muscle_max", deadline=deadline())
    assert not api.to("/search/recent") and len(api.to("/by/username/")) == 1
    assert result["media"]


@pytest.mark.parametrize(
    ("status", "headers", "body", "needle"),
    [
        (401, {}, {"title": "Unauthorized"}, "401"),
        (403, {}, {"title": "Forbidden", "type": "https://api.twitter.com/2/problems/client-forbidden"}, "plan/credentials do not allow search"),
        (403, {}, {"reason": "client-not-enrolled"}, "not attached"),
        (429, {"x-rate-limit-reset": "1790000000"}, {"title": "Too Many Requests"}, "2026-09-"),
    ],
)
def test_x_soft_fails_with_limited_state_and_cools_down(api: FakeApi, status: int, headers: dict[str, str], body: dict[str, Any], needle: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(x_api, "_epoch", lambda: 1_789_990_000.0)
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(status, body, headers))
    settings = make_settings()

    result = x_api.collect_x(settings, [], "", deadline=deadline())
    assert result["status"]["state"] == "limited" and needle in result["status"]["detail"]
    assert result["media"] == [] and result["succeeded"] == 0
    assert "x-secret-bearer" not in repr(result)

    calls_before = len(api.calls)
    again = x_api.collect_x(settings, [], "", deadline=deadline())
    assert len(api.calls) == calls_before  # cooldown: a feed reload never re-spends quota
    assert again["status"]["state"] == "limited"


def test_x_rate_limit_detail_includes_reset_time(api: FakeApi, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(x_api, "_epoch", lambda: 1_700_000_000.0)
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(429, {"title": "Too Many Requests"}, {"x-rate-limit-reset": "1700000600"}))
    result = x_api.collect_x(make_settings(), [], "", deadline=deadline())
    assert "2023-11-14T22:23:20Z" in result["status"]["detail"] and "rate limit" in result["status"]["detail"]


def test_x_network_failure_is_error_not_exception(api: FakeApi) -> None:
    api.add("GET", r"/2/tweets/search/recent$", requests.ConnectionError("boom"))
    result = x_api.collect_x(make_settings(), [], "", deadline=deadline())
    assert result["status"]["state"] == "error" and result["attempted"] >= 1 and result["succeeded"] == 0


def test_x_timeline_forbidden_does_not_block_search(api: FakeApi) -> None:
    api.add("GET", r"/2/users/by/username/", FakeResponse(403, {"title": "Forbidden"}))
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, search_body()))
    settings = make_settings()
    blocked = x_api.collect_x(settings, ["muscle_max"], "", deadline=deadline())
    assert blocked["status"]["state"] == "limited" and "timelines" in blocked["status"]["detail"]
    feed = x_api.collect_x(settings, [], "", deadline=deadline())
    assert feed["status"]["state"] == "connected" and feed["media"]


# ---------------------------------------------------------------------------
# Reddit fixtures
# ---------------------------------------------------------------------------


def post(post_id: str = "abc123", **overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": post_id, "author": "bear_creator", "subreddit": "gaybears", "title": "Fresh set",
        "permalink": f"/r/gaybears/comments/{post_id}/fresh_set/", "over_18": True, "created_utc": 1_790_000_000.0,
        "score": 321, "num_comments": 12, "url": f"https://i.redd.it/{post_id}.jpg", "domain": "i.redd.it", "is_video": False,
        "link_flair_text": "Solo",
        "preview": {"images": [{
            "source": {"url": f"https://preview.redd.it/{post_id}.jpg?auto=webp&s=sig", "width": 1080, "height": 1350},
            "resolutions": [
                {"url": f"https://preview.redd.it/{post_id}.jpg?width=108&s=a", "width": 108, "height": 135},
                {"url": f"https://preview.redd.it/{post_id}.jpg?width=320&s=b", "width": 320, "height": 400},
                {"url": f"https://preview.redd.it/{post_id}.jpg?width=640&s=c", "width": 640, "height": 800},
            ],
        }]},
    }
    data.update(overrides)
    return data


def listing(*posts: dict[str, Any]) -> dict[str, Any]:
    return {"kind": "Listing", "data": {"children": [{"kind": "t3", "data": item} for item in posts], "after": None}}


def token_ok(expires_in: int = 86400) -> FakeResponse:
    return FakeResponse(200, {"access_token": "tok-123", "token_type": "bearer", "expires_in": expires_in, "scope": "*"})


# ---------------------------------------------------------------------------
# Reddit: mapping + filters
# ---------------------------------------------------------------------------


def test_reddit_maps_image_gallery_video_and_embeds() -> None:
    gallery = post(
        "gal1", is_gallery=True, url="https://www.reddit.com/gallery/gal1", domain="reddit.com",
        gallery_data={"items": [{"media_id": "m1"}, {"media_id": "m2"}, {"media_id": "m3"}, {"media_id": "bad"}]},
        media_metadata={
            "m1": {"status": "valid", "e": "Image", "s": {"u": "https://preview.redd.it/g1.jpg?s=1", "x": 1000, "y": 1200},
                   "p": [{"u": "https://preview.redd.it/g1.jpg?width=108", "x": 108}, {"u": "https://preview.redd.it/g1.jpg?width=320", "x": 320}]},
            "m2": {"status": "valid", "e": "Image", "s": {"u": "https://i.redd.it/g2.png"}},
            "m3": {"status": "valid", "e": "Image", "s": {"u": "https://evil.example/x.jpg"}},
            "bad": {"status": "failed"},
        },
    )
    video = post(
        "vid1", is_video=True, url="https://v.redd.it/xyz", domain="v.redd.it",
        media={"reddit_video": {"fallback_url": "https://v.redd.it/xyz/DASH_720.mp4", "duration": 42, "width": 720, "height": 1280}},
    )
    redgifs = post("rg1", url="https://www.redgifs.com/watch/foo", domain="redgifs.com", post_hint="rich:video",
                   media={"type": "redgifs.com", "oembed": {"thumbnail_url": "https://thumbs2.redgifs.com/foo.jpg"}})
    imgur = post("im1", url="https://i.imgur.com/abc.jpg", domain="i.imgur.com")
    media, leads = reddit_api.map_reddit_posts([post(), gallery, video, redgifs, imgur])
    by_id = {item["id"]: item for item in media}
    assert set(by_id) == {"reddit-abc123", "reddit-gal1-0", "reddit-gal1-1", "reddit-vid1", "reddit-rg1", "reddit-im1"}

    image = by_id["reddit-abc123"]
    assert image["source"] == "Reddit" and image["isVideo"] is False
    assert image["mediaUrl"] == "https://i.redd.it/abc123.jpg" and image["thumbnail"].endswith("width=320&s=b")
    assert image["pageUrl"] == "https://www.reddit.com/r/gaybears/comments/abc123/fresh_set/"
    assert image["profileUrl"] == "https://www.reddit.com/user/bear_creator" and image["creator"] == "bear_creator"
    assert image["likes"] == 321 and image["comments"] == 12 and "adult" in image["tags"] and "r/gaybears" in image["tags"]
    assert (image["width"], image["height"]) == (1080, 1350)

    assert by_id["reddit-gal1-0"]["mediaUrl"] == "https://preview.redd.it/g1.jpg?s=1"
    assert by_id["reddit-gal1-0"]["thumbnail"].endswith("width=320")

    # v.redd.it cannot be played (CSP media-src / proxy allow-list): still + link-out, no stream candidates.
    clip = by_id["reddit-vid1"]
    assert clip["streamCandidates"] == [] and clip["mediaUrl"] is None and clip["thumbnail"] and "video" in clip["tags"]
    assert clip["isVideo"] is False and clip["duration"] == "0:42" and clip["durationSeconds"] == 42
    assert "v.redd.it" not in repr(clip)
    assert by_id["reddit-rg1"]["thumbnail"] and by_id["reddit-rg1"]["mediaUrl"] is None
    assert by_id["reddit-im1"]["mediaUrl"] == "https://i.imgur.com/abc.jpg"
    assert set(leads) == {"reddit-bear_creator"} and leads["reddit-bear_creator"]["platform"] == "Reddit"
    assert leads["reddit-bear_creator"]["username"] == "bear_creator"


@pytest.mark.parametrize(
    "overrides",
    [
        {"removed_by_category": "moderator"},
        {"removed_by_category": "deleted"},
        {"banned_by": "mod"},
        {"spam": True},
        {"author": "[deleted]"},
        {"author": "AutoModerator"},
        {"selftext": "[removed]"},
        {"stickied": True},
        {"over_18": False},
        {"link_flair_text": "teen"},
        {"title": "16yo twink pics"},
        {"title": "leaked without consent"},
        {"subreddit": "teenboys"},
        {"url": "https://onlyfans.com/someone", "domain": "onlyfans.com"},
        {"url": "https://example.com/page", "domain": "example.com"},
        {"is_self": True, "url": "https://www.reddit.com/r/gaybears/comments/abc123/", "domain": "self.gaybears", "preview": None},
        {"permalink": "https://evil.example/r/x/comments/abc/"},
        {"preview": None, "url": "https://i.redd.it/x.jpg", "domain": "i.redd.it", "is_video": True},
    ],
)
def test_reddit_filters_drop_unsafe_removed_and_non_media_posts(overrides: dict[str, Any]) -> None:
    media, leads = reddit_api.map_reddit_posts([post(**overrides)])
    assert media == [] and leads == {}


def test_reddit_nsfw_gate_allows_configured_adult_subs() -> None:
    sfw_flagged = post(over_18=False)
    assert reddit_api.map_reddit_posts([sfw_flagged])[0] == []
    media, _ = reddit_api.map_reddit_posts([sfw_flagged], nsfw_subs=frozenset({"gaybears"}))
    assert len(media) == 1


# ---------------------------------------------------------------------------
# Reddit: transport, token, budgets
# ---------------------------------------------------------------------------


def mock_reddit(api: FakeApi, listings: dict[str, Any] | None = None) -> None:
    api.add("POST", r"/api/v1/access_token$", token_ok())
    for sub, response in (listings or {}).items():
        api.add("GET", rf"oauth\.reddit\.com/r/{sub}/new$", response)
    api.add("GET", r"oauth\.reddit\.com/r/\w+/new$", FakeResponse(200, listing()))


def test_reddit_not_configured_skips_cleanly(api: FakeApi) -> None:
    for kwargs in ({"reddit_client_id": ""}, {"reddit_client_secret": ""}):
        result = reddit_api.collect_reddit(make_settings(**kwargs), [], "")
        assert result["status"]["state"] == "not-configured" and result["status"]["id"] == "reddit"
        assert result["attempted"] == 0
    assert api.calls == []


def test_reddit_token_flow_and_default_subreddit_listing(api: FakeApi) -> None:
    mock_reddit(api, {"gaybears": FakeResponse(200, listing(post("p1"), post("p2", over_18=False)))})
    result = reddit_api.collect_reddit(make_settings(reddit_subreddits="r/gaybears, /r/gaybrosgonewild, bad name, gaybears"), [], "", deadline=deadline())

    token_call = api.to("/api/v1/access_token")[0]
    assert token_call["method"] == "POST" and token_call["url"] == "https://www.reddit.com/api/v1/access_token"
    assert token_call["data"] == {"grant_type": "client_credentials"} and token_call["auth"] == ("rid", "rsecret")
    assert token_call["headers"]["User-Agent"].startswith("web:media-codex-test")

    listing_calls = api.to("oauth.reddit.com/r/")
    assert {call["url"] for call in listing_calls} == {"https://oauth.reddit.com/r/gaybears/new", "https://oauth.reddit.com/r/gaybrosgonewild/new"}
    for call in listing_calls:
        assert call["params"]["limit"] == 25 and call["params"]["raw_json"] == 1
        assert call["headers"]["Authorization"] == "bearer tok-123" and call["headers"]["User-Agent"].startswith("web:media-codex-test")

    assert {item["id"] for item in result["media"]} == {"reddit-p1", "reddit-p2"}
    # The sub is operator-configured adult content, so posts from it are kept even when not individually flagged.
    assert result["status"]["state"] == "connected" and result["status"]["id"] == "reddit"
    assert result["attempted"] == 3 and result["succeeded"] == 3
    assert "rsecret" not in repr(result) and "tok-123" not in repr(result)


def test_reddit_token_is_cached_until_expiry(api: FakeApi) -> None:
    mock_reddit(api)
    settings = make_settings(reddit_subreddits="gaybears")
    reddit_api.collect_reddit(settings, ["user_one"], "", deadline=deadline())
    reddit_api.collect_reddit(settings, ["user_two"], "", deadline=deadline())
    assert len(api.to("/api/v1/access_token")) == 1
    reddit_api._STATE.expires = 0.0  # expired
    reddit_api.collect_reddit(settings, ["user_three"], "", deadline=deadline())
    assert len(api.to("/api/v1/access_token")) == 2


def test_reddit_listing_results_are_cached(api: FakeApi) -> None:
    mock_reddit(api, {"gaybears": FakeResponse(200, listing(post()))})
    settings = make_settings(reddit_subreddits="gaybears")
    first = reddit_api.collect_reddit(settings, [], "", deadline=deadline())
    count = len(api.calls)
    second = reddit_api.collect_reddit(settings, [], "", deadline=deadline())
    assert len(api.calls) == count and second["media"] == first["media"] and second["status"]["state"] == "connected"


def test_reddit_unknown_private_and_banned_subreddits_fail_soft(api: FakeApi) -> None:
    api.add("POST", r"/api/v1/access_token$", token_ok())
    api.add("GET", r"/r/missing/new$", FakeResponse(404, {"message": "Not Found", "error": 404}))
    api.add("GET", r"/r/private/new$", FakeResponse(403, {"reason": "private", "error": 403}))
    api.add("GET", r"/r/gaybears/new$", FakeResponse(200, listing(post())))
    settings = make_settings(reddit_subreddits="missing,private,gaybears")
    result = reddit_api.collect_reddit(settings, [], "", deadline=deadline())
    assert len(result["media"]) == 1 and result["status"]["state"] == "connected"
    assert "2 subreddit/user targets unavailable" in result["status"]["detail"]

    api.calls.clear()
    reddit_api.collect_reddit(settings, [], "", deadline=deadline())
    assert not api.to("/r/missing") and not api.to("/r/private")  # dead targets are not retried for an hour


def test_reddit_all_targets_dead_is_limited_not_error(api: FakeApi) -> None:
    api.add("POST", r"/api/v1/access_token$", token_ok())
    api.add("GET", r"/new$", FakeResponse(404, {"error": 404}))
    result = reddit_api.collect_reddit(make_settings(reddit_subreddits="a1,b2"), [], "", deadline=deadline())
    assert result["status"]["state"] == "limited" and "REDDIT_SUBREDDITS" in result["status"]["detail"]


def test_reddit_watchlist_uses_user_submitted_and_search(api: FakeApi) -> None:
    api.add("POST", r"/api/v1/access_token$", token_ok())
    api.add("GET", r"/user/bear_creator/submitted$", FakeResponse(200, listing(post("u1"))))
    api.add("GET", r"/search$", FakeResponse(200, listing(post("s1", author="someone_else"), post("s2", over_18=False, author="third_user", subreddit="somesub", permalink="/r/somesub/comments/s2/x/"))))
    api.add("GET", r"/r/\w+/new$", FakeResponse(200, listing()))
    result = reddit_api.collect_reddit(make_settings(), ["bear_creator", "Muscle Bear"], "", deadline=deadline())

    (user_call,) = api.to("/user/")
    assert user_call["url"] == "https://oauth.reddit.com/user/bear_creator/submitted"
    assert user_call["params"]["sort"] == "new" and user_call["params"]["raw_json"] == 1
    (search_call,) = api.to("oauth.reddit.com/search")
    assert search_call["params"]["q"] == "Muscle Bear" and search_call["params"]["include_over_18"] == "on" and search_call["params"]["raw_json"] == 1

    by_id = {item["id"]: item for item in result["media"]}
    assert set(by_id) == {"reddit-u1", "reddit-s1"}  # s2 is not over_18 and not from an adult sub
    assert by_id["reddit-u1"]["isWatchedCreator"] is True and by_id["reddit-s1"]["isWatchedCreator"] is False
    leads = {lead["username"]: lead for lead in result["leads"]}
    assert leads["bear_creator"]["exactWatchMatch"] is True and leads["someone_else"]["exactWatchMatch"] is False


def test_reddit_typed_query_searches_without_listing_calls(api: FakeApi) -> None:
    api.add("POST", r"/api/v1/access_token$", token_ok())
    api.add("GET", r"/search$", FakeResponse(200, listing(post("q1"))))
    result = reddit_api.collect_reddit(make_settings(), [], "gay bear", deadline=deadline())
    assert not api.to("oauth.reddit.com/r/") and len(api.to("oauth.reddit.com/search")) == 1
    assert [item["id"] for item in result["media"]] == ["reddit-q1"]


def test_reddit_call_budget_per_request_is_enforced_and_rotates(api: FakeApi) -> None:
    mock_reddit(api)
    subs = ",".join(f"sub{i}" for i in range(10))
    settings = make_settings(reddit_subreddits=subs, reddit_calls_per_request=3)
    reddit_api.collect_reddit(settings, [], "", deadline=deadline())
    first = {call["url"] for call in api.to("oauth.reddit.com/r/")}
    assert len(first) == 3
    api.calls.clear()
    reddit_api.collect_reddit(settings, [], "", deadline=deadline())
    second = {call["url"] for call in api.to("oauth.reddit.com/r/")}
    assert len(second) == 3 and not (first & second)


@pytest.mark.parametrize(
    ("response", "needle"),
    [
        (FakeResponse(401, {"message": "Unauthorized", "error": 401}), "rejected the app credentials"),
        (FakeResponse(200, {"error": "unsupported_grant_type"}), "rejected the app credentials"),
        (FakeResponse(429, {"error": 429}, {"retry-after": "90"}), "rate limit"),
    ],
)
def test_reddit_token_failures_are_limited_and_cool_down(api: FakeApi, response: FakeResponse, needle: str) -> None:
    api.add("POST", r"/api/v1/access_token$", response)
    settings = make_settings(reddit_subreddits="gaybears")
    result = reddit_api.collect_reddit(settings, [], "", deadline=deadline())
    assert result["status"]["state"] == "limited" and needle in result["status"]["detail"]
    assert result["media"] == [] and not api.to("oauth.reddit.com")
    assert "rsecret" not in repr(result)
    count = len(api.calls)
    reddit_api.collect_reddit(settings, ["someone_x"], "", deadline=deadline())
    assert len(api.calls) == count  # cooldown: no hammering the token endpoint


def test_reddit_api_429_and_401_soft_fail(api: FakeApi) -> None:
    api.add("POST", r"/api/v1/access_token$", token_ok())
    api.add("GET", r"/r/gaybears/new$", FakeResponse(429, {"error": 429}, {"x-ratelimit-reset": "30"}))
    result = reddit_api.collect_reddit(make_settings(reddit_subreddits="gaybears"), [], "", deadline=deadline())
    assert result["status"]["state"] == "limited" and "rate limit" in result["status"]["detail"]

    reddit_api.reset_state()
    api.routes.clear()
    api.add("POST", r"/api/v1/access_token$", token_ok())
    api.add("GET", r"/r/gaybears/new$", FakeResponse(401, {"error": 401}))
    result = reddit_api.collect_reddit(make_settings(reddit_subreddits="gaybears"), [], "", deadline=deadline())
    assert result["status"]["state"] == "limited" and reddit_api._STATE.token == ""  # token dropped, refreshed next request


def test_reddit_network_failure_is_error_not_exception(api: FakeApi) -> None:
    api.add("POST", r"/api/v1/access_token$", requests.ConnectionError("down"))
    result = reddit_api.collect_reddit(make_settings(), [], "", deadline=deadline())
    assert result["status"]["state"] == "error" and result["media"] == []


# ---------------------------------------------------------------------------
# Gateway wiring
# ---------------------------------------------------------------------------


def gateway_client(**overrides: Any) -> TestClient:
    app = FastAPI()
    app.state.settings = make_settings(tumblr_api_key="", google_cse_api_key="", google_cse_id="", **overrides)
    app.include_router(gateway.router)
    return TestClient(app)


def test_gateway_response_shape_is_backward_compatible(api: FakeApi) -> None:
    mock_x_timeline(api)
    mock_reddit(api, {"gaybears": FakeResponse(200, listing(post()))})
    api.add("GET", r"oauth\.reddit\.com/user/muscle_max/submitted$", FakeResponse(200, listing(post("wl1", author="muscle_max"))))
    client = gateway_client(reddit_subreddits="gaybears")
    response = client.post("/api/discovery/providers", json={"watchlist": ["muscle_max"], "query": ""})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store" and response.headers["x-media-codex-tier"] == "render"
    payload = response.json()
    assert {"media", "leads", "statuses", "requestsAttempted", "requestsSucceeded", "updatedAt"} <= set(payload)
    statuses = {status["id"]: status for status in payload["statuses"]}
    assert set(statuses) == {"x", "reddit", "tumblr", "google"}
    assert statuses["x"]["state"] == "connected" and statuses["reddit"]["state"] == "connected"
    assert statuses["tumblr"]["state"] == statuses["google"]["state"] == "not-configured"
    for status in statuses.values():
        assert {"id", "name", "mode", "state", "mediaFound", "creatorsFound", "detail"} <= set(status)
    assert {item["source"] for item in payload["media"]} == {"X", "Reddit"}
    assert payload["requestsSucceeded"] == payload["requestsAttempted"] > 0
    assert "x-secret-bearer" not in response.text and "rsecret" not in response.text and "tok-123" not in response.text


def test_gateway_honors_watchlist_cap_of_eight(api: FakeApi) -> None:
    api.add("GET", r"/2/users/by/username/", FakeResponse(200, {"data": x_user("1", "anyone")}))
    api.add("GET", r"/2/users/\d+/tweets$", FakeResponse(200, {"data": []}))
    api.add("POST", r"/api/v1/access_token$", token_ok())
    api.add("GET", r"oauth\.reddit\.com", FakeResponse(200, listing()))
    client = gateway_client(x_timeline_handles_per_request=8, reddit_calls_per_request=30)
    too_many = client.post("/api/discovery/providers", json={"watchlist": [f"creator{i}" for i in range(9)]})
    assert too_many.status_code == 422
    ok = client.post("/api/discovery/providers", json={"watchlist": [f"creator{i}" for i in range(8)]})
    assert ok.status_code == 200
    assert len(api.to("/by/username/")) <= 8
    assert len(api.to("oauth.reddit.com/user/")) <= 4  # reddit user lookups are budgeted below the cap


def test_gateway_abandons_a_slow_source_instead_of_stalling(api: FakeApi, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway, "GATEWAY_DEADLINE_SECONDS", 0.4)

    def slow(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        time.sleep(1.5)
        return {"media": [], "leads": [], "attempted": 0, "succeeded": 0, "status": {}}

    monkeypatch.setattr(gateway, "_collect_x", slow)
    mock_reddit(api)
    started = time.monotonic()
    response = gateway_client().post("/api/discovery/providers", json={})
    assert time.monotonic() - started < 1.2
    statuses = {status["id"]: status for status in response.json()["statuses"]}
    assert statuses["x"]["state"] == "limited" and "deferred" in statuses["x"]["detail"]
    assert statuses["reddit"]["state"] == "connected"


def test_gateway_survives_a_crashing_source(api: FakeApi, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(gateway, "_collect_reddit", boom)
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, {"data": []}))
    response = gateway_client().post("/api/discovery/providers", json={})
    assert response.status_code == 200
    statuses = {status["id"]: status for status in response.json()["statuses"]}
    assert statuses["reddit"]["state"] == "limited" and statuses["x"]["state"] == "connected"


def test_gateway_default_feed_hits_x_search_and_reddit_listings(api: FakeApi) -> None:
    api.add("GET", r"/2/tweets/search/recent$", FakeResponse(200, search_body()))
    mock_reddit(api, {"gaybears": FakeResponse(200, listing(post("feed1")))})
    client = gateway_client(reddit_subreddits="gaybears")
    payload: Callable[[], dict[str, Any]] = lambda: client.post("/api/discovery/providers", json={}).json()  # noqa: E731
    body = payload()
    assert {item["source"] for item in body["media"]} == {"X", "Reddit"}
    searches = len(api.to("/search/recent"))
    assert searches == 2
    payload()
    assert len(api.to("/search/recent")) == 3  # the rest of the rotation; nothing re-fetched
    payload()
    assert len(api.to("/search/recent")) == 3
