"""Structured JSON logging with request-id binding and secret redaction.

Stdlib-only (no structlog dependency yet — Phase 3 may swap the formatter
implementation without touching call sites, since everything goes through
``configure_json_logging`` + the ``request_id_context`` var).
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone

request_id_context: ContextVar[str] = ContextVar("request_id", default="-")

_SECRET_KEYS = re.compile(r"(token|secret|api[_-]?key|authorization|password)", re.IGNORECASE)


def _redact(record: logging.LogRecord) -> dict:
    extras = {
        k: v
        for k, v in record.__dict__.items()
        if k not in logging.LogRecord("", 0, "", 0, "", (), None).__dict__
    }
    return {k: ("***" if _SECRET_KEYS.search(k) else v) for k, v in extras.items()}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_context.get(),
        }
        payload.update(_redact(record))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_json_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())


class RequestIdMiddleware:
    """Pure-ASGI middleware: propagate or mint X-Request-ID, bind it to the
    context var, echo it on the response. Mirrors the legacy behaviour in
    main.py; adopted centrally in Phase 1."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        request_id = headers.get(b"x-request-id", b"").decode() or uuid.uuid4().hex
        token = request_id_context.set(request_id)
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"x-request-id", request_id.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            request_id_context.reset(token)
