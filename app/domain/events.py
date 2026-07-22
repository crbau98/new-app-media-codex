"""Domain events and the transactional-outbox contract.

Services emit events in the *same database transaction* as the state change
(repositories enqueue the outbox row on the same connection). The relay
(app/workers/outbox.py) publishes them to subscribers: WebSocket fan-out,
cache invalidation, analytics rollups.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, ClassVar

from app.core.time import iso_now
from app.domain.ids import new_ulid


@dataclass(frozen=True)
class DomainEvent:
    """Base event. ``type`` is the stable routing key for subscribers."""

    type: ClassVar[str] = "domain.event"
    payload: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=new_ulid)
    occurred_at: str = field(default_factory=iso_now)

    def to_outbox_params(self) -> tuple[str, str, str, str]:
        """(id, type, payload_json, occurred_at) — the outbox insert shape."""
        return (
            self.id,
            self.type,
            json.dumps(self.payload, separators=(",", ":")),
            self.occurred_at,
        )


@dataclass(frozen=True)
class MediaCaptured(DomainEvent):
    type: ClassVar[str] = "media.captured"


@dataclass(frozen=True)
class PerformerAdded(DomainEvent):
    type: ClassVar[str] = "performer.added"


@dataclass(frozen=True)
class PerformerCandidateScored(DomainEvent):
    type: ClassVar[str] = "performer.candidate_scored"


@dataclass(frozen=True)
class CaptureRequested(DomainEvent):
    type: ClassVar[str] = "capture.requested"


@dataclass(frozen=True)
class TakedownRequested(DomainEvent):
    """Triggers purge of media rows, previews, and cache keys (security
    checklist — takedown is an event so every layer reacts consistently)."""

    type: ClassVar[str] = "takedown.requested"
