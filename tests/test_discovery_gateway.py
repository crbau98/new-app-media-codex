from __future__ import annotations

from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.discovery import router


def _client(**overrides: object) -> TestClient:
    settings = {
        "x_bearer_token": "",
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


def test_provider_gateway_reports_configuration_without_exposing_values() -> None:
    secret = "super-secret-provider-value"
    client = _client(
        x_bearer_token=secret,
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
    assert {status["id"] for status in payload["statuses"]} == {"x", "tumblr", "google"}
    assert all(status["state"] == "limited" for status in payload["statuses"])


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
