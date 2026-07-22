"""Unit tests for cursor pagination primitives. Run: python -m pytest tests/unit -q"""

from __future__ import annotations

import pytest

from app.core.errors import ApiProblem
from app.core.pagination import build_page, decode_cursor, encode_cursor


def test_cursor_roundtrip() -> None:
    token = encode_cursor("2026-07-22T00:00:00+00:00", "01J2ABC")
    sort_value, item_id = decode_cursor(token)
    assert sort_value == "2026-07-22T00:00:00+00:00"
    assert item_id == "01J2ABC"


def test_decode_rejects_malformed_cursor() -> None:
    with pytest.raises(ApiProblem) as exc_info:
        decode_cursor("not-a-cursor!!!")
    assert exc_info.value.status_code == 400
    assert "invalid-cursor" in exc_info.value.slug


def test_decode_rejects_wrong_shape() -> None:
    import base64
    import json

    bad = base64.urlsafe_b64encode(json.dumps({"v": 99}).encode()).decode().rstrip("=")
    with pytest.raises(ApiProblem):
        decode_cursor(bad)


def test_build_page_has_more_and_next_cursor() -> None:
    items = [(f"t{i}", f"id{i}") for i in range(4)]  # limit+1 rows
    page = build_page(items, limit=3, cursor_of=lambda it: it)
    assert page.page.has_more is True
    assert len(page.data) == 3
    assert page.page.next_cursor is not None
    sort_value, item_id = decode_cursor(page.page.next_cursor)
    assert (sort_value, item_id) == ("t2", "id2")


def test_build_page_last_page_has_no_cursor() -> None:
    items = [("t0", "id0"), ("t1", "id1")]
    page = build_page(items, limit=3, cursor_of=lambda it: it)
    assert page.page.has_more is False
    assert page.page.next_cursor is None
    assert len(page.data) == 2
