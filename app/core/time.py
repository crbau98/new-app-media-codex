"""Time seam. Domain code calls ``utcnow()`` — never ``datetime.now()`` —
so tests can freeze time and every persisted timestamp is UTC ISO-8601."""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utcnow().isoformat()
