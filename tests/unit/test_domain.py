"""Unit tests for domain invariants — no database, no framework."""

from __future__ import annotations

import pytest

from app.domain.media import MediaItem, MediaKind, SourceProvider, SourceRef
from app.domain.performers import (
    CaptureRequest,
    CaptureState,
    Performer,
    PerformerStatus,
    RightsBasis,
)


def _source() -> SourceRef:
    return SourceRef(
        provider=SourceProvider.REDGIFS,
        external_id="abc123",
        canonical_url="https://www.redgifs.com/watch/abc123",
    )


def test_media_item_normalizes_tags() -> None:
    item = MediaItem(
        source=_source(),
        kind=MediaKind.VIDEO,
        tags=[" Fitness ", "FITNESS", "", "Outdoor"],
        captured_at="2026-07-22T00:00:00+00:00",
    )
    assert item.tags == ["fitness", "outdoor"]


def test_media_item_requires_captured_at() -> None:
    with pytest.raises(ValueError):
        MediaItem(source=_source(), kind=MediaKind.IMAGE)


def test_source_ref_requires_absolute_url() -> None:
    with pytest.raises(ValueError):
        SourceRef(provider=SourceProvider.X, external_id="1", canonical_url="not-a-url")


def test_capture_cannot_activate_without_rights_basis() -> None:
    capture = CaptureRequest(performer_id="p1")
    with pytest.raises(ValueError):
        capture.activate()
    assert capture.state is CaptureState.QUEUED


def test_capture_activates_with_rights_basis() -> None:
    capture = CaptureRequest(performer_id="p1", rights_basis=RightsBasis.PUBLIC_API)
    capture.activate()
    assert capture.state is CaptureState.ACTIVE
    capture.pause()
    assert capture.state is CaptureState.PAUSED


def test_blocked_capture_is_terminal() -> None:
    capture = CaptureRequest(performer_id="p1", rights_basis=RightsBasis.PUBLIC_API)
    capture.block()
    with pytest.raises(ValueError):
        capture.activate()


def test_performer_promotion_requires_confidence() -> None:
    performer = Performer(display_name="Example", confidence=0.3)
    with pytest.raises(ValueError):
        performer.promote_to_directory()
    assert performer.status is PerformerStatus.CANDIDATE


def test_performer_promotion_happy_path() -> None:
    performer = Performer(display_name="Example", confidence=0.9)
    performer.promote_to_directory()
    assert performer.status is PerformerStatus.DIRECTORY
