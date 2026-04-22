"""Structured JSON logging configuration."""
from __future__ import annotations

import logging
import logging.config
import os
import time
from typing import Any


_IS_PRODUCTION = os.environ.get("ENVIRONMENT", "development").lower() == "production"
_LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()


def configure_logging() -> None:
    """Configure root logger for JSON output in production."""
    if _IS_PRODUCTION:
        logging.config.dictConfig({
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "json": {
                    "()": "logging.Formatter",
                    "fmt": '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)s}',
                    "datefmt": "%Y-%m-%dT%H:%M:%S",
                },
            },
            "handlers": {
                "console": {"class": "logging.StreamHandler", "formatter": "json"},
            },
            "root": {"level": _LOG_LEVEL, "handlers": ["console"]},
        })
    else:
        logging.basicConfig(
            level=_LOG_LEVEL,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%H:%M:%S",
        )


def make_json_record(
    message: str,
    *,
    request_id: str | None = None,
    method: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    duration_ms: float | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    """Build a JSON log string manually for simple cases."""
    record: dict[str, Any] = {"msg": message}
    if request_id is not None:
        record["request_id"] = request_id
    if method is not None:
        record["method"] = method
    if path is not None:
        record["path"] = path
    if status_code is not None:
        record["status_code"] = status_code
    if duration_ms is not None:
        record["duration_ms"] = round(duration_ms, 3)
    if extra:
        record.update(extra)
    import json
    return json.dumps(record, separators=(",", ":"), default=str)


class RequestIdFilter(logging.Filter):
    """Inject request_id into LogRecord if available on the current context."""

    def filter(self, record: logging.LogRecord) -> bool:
        # FastAPI's request state is not accessible here; this is a placeholder
        # for future integration with contextvars.
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True
