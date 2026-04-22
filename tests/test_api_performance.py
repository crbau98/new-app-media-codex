"""Performance tests for browse endpoints."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    "path",
    [
        "/api/browse/items?limit=20",
        "/api/browse/images?limit=20",
        "/healthz",
    ],
)
def test_browse_response_time(path: str, app_client: TestClient):
    """Browse endpoints should respond in <200ms on an empty db."""
    import time

    start = time.perf_counter()
    response = app_client.get(path)
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert response.status_code == 200
    assert elapsed_ms < 200, f"{path} took {elapsed_ms:.1f}ms"
