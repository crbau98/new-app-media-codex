"""Cursor-based pagination primitives.

Cursors are opaque, URL-safe base64 JSON payloads ``{v, s, i}`` where ``s`` is
the sort value and ``i`` the tiebreaker id of the last item on the previous
page. Repositories translate them into keyset ("WHERE (sort, id) < (:s, :i)")
predicates — O(1) at any page depth, stable under concurrent inserts.

Offset pagination is intentionally absent (blueprint section 5).
"""

from __future__ import annotations

import base64
import binascii
import json
import time
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

from app.core.errors import ApiProblem

T = TypeVar("T")

MAX_LIMIT = 200
DEFAULT_LIMIT = 50


class PageInfo(BaseModel):
    next_cursor: str | None = None
    has_more: bool = False


class Page(BaseModel, Generic[T]):
    """Standard list envelope for every v1 collection endpoint."""

    data: list[T]
    page: PageInfo


def encode_cursor(sort_value: str, item_id: str) -> str:
    payload = {"v": 1, "s": sort_value, "i": item_id, "t": int(time.time())}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(token: str) -> tuple[str, str]:
    """Return ``(sort_value, item_id)``. Raises ApiProblem(400) on malformed input."""
    try:
        padding = "=" * (-len(token) % 4)
        payload = json.loads(base64.urlsafe_b64decode((token + padding).encode("ascii")))
        if payload.get("v") != 1 or not isinstance(payload.get("s"), str) or not isinstance(payload.get("i"), str):
            raise ValueError("unsupported cursor shape")
        return payload["s"], payload["i"]
    except (binascii.Error, ValueError, KeyError, UnicodeDecodeError) as exc:
        raise ApiProblem.bad_request("invalid-cursor", "The 'cursor' parameter is malformed.") from exc


def build_page(items: list[T], limit: int, cursor_of) -> Page[T]:
    """Slice a ``limit + 1`` result set into a Page.

    ``cursor_of`` maps an item to its ``(sort_value, id)`` cursor pair.
    """
    has_more = len(items) > limit
    visible = items[:limit]
    next_cursor = None
    if has_more and visible:
        sort_value, item_id = cursor_of(visible[-1])
        next_cursor = encode_cursor(sort_value, item_id)
    return Page(data=visible, page=PageInfo(next_cursor=next_cursor, has_more=has_more))


class LimitParam(int):
    """Marker type so routers read uniformly; validation lives in the route signature."""


LIMIT_FIELD = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT, description="Page size (1-200)")
