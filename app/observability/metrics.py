"""Prometheus metrics: RED signals per route + /metrics endpoint.

Uses ``prometheus_client`` when installed; otherwise a tiny in-memory
fallback keeps the middleware and endpoint functional (text exposition is
Prometheus-compatible either way, so dashboards don't notice the swap).
"""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import APIRouter, Request, Response

try:
    from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

    _REQUESTS = Counter(
        "http_requests_total", "HTTP requests", ["method", "route", "status"]
    )
    _DURATION = Histogram(
        "http_request_duration_seconds",
        "HTTP request latency",
        ["method", "route"],
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
    )
    outbox_pending = Gauge("outbox_pending_messages", "Unpublished outbox messages")

    def _observe(method: str, route: str, status: int, seconds: float) -> None:
        _REQUESTS.labels(method, route, str(status)).inc()
        _DURATION.labels(method, route).observe(seconds)

    def _render() -> bytes:
        return generate_latest()

    _CONTENT_TYPE = CONTENT_TYPE_LATEST

except ImportError:  # fallback registry — same contract, zero dependencies
    _counts: dict[tuple[str, str, str], int] = defaultdict(int)
    _latencies: dict[tuple[str, str], list[float]] = defaultdict(list)
    _gauges: dict[str, float] = {}

    class _GaugeShim:
        def __init__(self, name: str, _desc: str):
            self._name = name

        def set(self, value: float) -> None:
            _gauges[self._name] = value

    outbox_pending = _GaugeShim("outbox_pending_messages", "Unpublished outbox messages")

    def _observe(method: str, route: str, status: int, seconds: float) -> None:
        _counts[(method, route, str(status))] += 1
        samples = _latencies[(method, route)]
        samples.append(seconds)
        if len(samples) > 2048:
            del samples[:1024]

    def _render() -> bytes:
        lines = []
        for (method, route, status), count in sorted(_counts.items()):
            lines.append(
                f'http_requests_total{{method="{method}",route="{route}",status="{status}"}} {count}'
            )
        for (method, route), samples in sorted(_latencies.items()):
            ordered = sorted(samples)
            for quantile in (0.5, 0.9, 0.99):
                idx = min(len(ordered) - 1, int(quantile * len(ordered)))
                lines.append(
                    f'http_request_duration_seconds{{method="{method}",route="{route}",quantile="{quantile}"}} {ordered[idx]:.6f}'
                )
        for name, value in _gauges.items():
            lines.append(f"{name} {value}")
        return ("\n".join(lines) + "\n").encode("utf-8")

    _CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8"


def _route_template(request: Request) -> str:
    """Label by the route template ("/api/v1/media/{media_id}"), never the
    concrete path — unbounded label cardinality is a Prometheus outage."""
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path or "unmatched"


async def metrics_middleware(request: Request, call_next):
    if request.url.path == "/metrics":
        return await call_next(request)
    start = time.perf_counter()
    response = await call_next(request)
    _observe(request.method, _route_template(request), response.status_code, time.perf_counter() - start)
    return response


metrics_router = APIRouter(include_in_schema=False)


@metrics_router.get("/metrics")
def metrics() -> Response:
    return Response(content=_render(), media_type=_CONTENT_TYPE)
