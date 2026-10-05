"""Environment helpers shared by the creator-index modules.

``app/config.py`` is owned by another stream, so everything here reads
``os.environ`` directly and never raises on malformed values.
"""

from __future__ import annotations

import os
import re

_HOST_RE = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")


def env_int(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        value = default
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def env_float(name: str, default: float, *, minimum: float | None = None) -> float:
    try:
        value = float(os.environ.get(name, "").strip() or default)
    except ValueError:
        value = default
    return max(minimum, value) if minimum is not None else value


def env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    return default if raw is None else raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str) -> list[str]:
    """Comma/space separated list, lower-cased, empties dropped, order kept, de-duplicated."""
    seen: dict[str, None] = {}
    for part in re.split(r"[,\s]+", os.environ.get(name, "")):
        part = part.strip().lower()
        if part:
            seen.setdefault(part, None)
    return list(seen)


def valid_public_hostname(value: str) -> bool:
    """A plain DNS hostname (no scheme, port, path or IP literal)."""
    return bool(_HOST_RE.match(value or "")) and not re.fullmatch(r"[\d.]+", value or "")
