from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.discovery import router
from app.discovery import reddit_api, x_api


@pytest.fixture(autouse=True)
def _reset_provider_state():
    x_api.reset_state()
    reddit_api.reset_state()
    yield
    x_api.reset_state()
    reddit_api.reset_state()


class _Denied:
    """Stand-in provider response: every official API says 'no' (never touches the network)."""

    status_code = 403
    headers: dict[str, str] = {}

    def json(self) -> Any:
        return {"title": "Forbidden"}


def _client(**overrides: object) -> TestClient:
    settings = {
        "x_bearer_token": "",
        "reddit_client_id": "",
        "reddit_client_secret": "",
        "tumblr_api_key": "",
        "google_cse_api_key": "",
        "google_cse_id": "",
        "request_timeout_seconds": 1,
        "user_agent": "MediaCodex/Test",
    }
    settings.update(overrides)
    app = FastAPI()
    app.state.settings = SimpleNamespace(**settings)
    app.include_router(router)
    return TestClient(app)


def test_provider_gateway_reports_configuration_without_exposing_values(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "super-secret-provider-value"
    calls: list[str] = []

    def denied(method: str, url: str, **_kwargs: Any) -> _Denied:
        calls.append(url)
        return _Denied()

    monkeypatch.setattr(requests, "request", denied)
    client = _client(
        x_bearer_token=secret,
        reddit_client_id=secret,
        reddit_client_secret=secret,
        tumblr_api_key=secret,
        google_cse_api_key=secret,
        google_cse_id=secret,
    )

    response = client.post("/api/discovery/providers", json={})

    assert response.status_code == 200
    assert response.headers["x-media-codex-tier"] == "render"
    assert response.headers["cache-control"] == "private, no-store"
    assert secret not in response.text
    payload = response.json()
    assert payload["media"] == []
    assert payload["leads"] == []
    assert {status["id"] for status in payload["statuses"]} == {"x", "reddit", "tumblr", "google"}
    # X plan / Reddit credentials refused: soft-fail as 'limited', never an exception.
    assert all(status["state"] == "limited" for status in payload["statuses"])
    assert calls and all(url.startswith(("https://api.x.com/", "https://www.reddit.com/", "https://oauth.reddit.com/")) for url in calls)


def test_provider_gateway_bounds_and_cleans_user_context() -> None:
    client = _client()

    response = client.post(
        "/api/discovery/providers",
        json={
            "watchlist": [" @Creator_One ", "creator one", "person@example.com", "x"] * 2,
            "query": " public profile ",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requestsAttempted"] == 0
    assert payload["requestsSucceeded"] == 0
    assert all(status["state"] == "not-configured" for status in payload["statuses"])


def test_versioned_routes_are_mounted_in_composition_root() -> None:
    from app.main import app

    paths = {getattr(route, "path", "") for route in app.routes}
    assert "/api/v1/healthz" in paths
    assert "/api/v1/media" in paths
