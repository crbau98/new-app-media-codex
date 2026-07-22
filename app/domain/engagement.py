"""Engagement context: append-only events that feed the analytics read
model. Local-by-default; nothing here leaves the device/account boundary."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.ids import new_ulid


class ReactionKind(StrEnum):
    LIKE = "like"
    DISLIKE = "dislike"
    FAVORITE = "favorite"


@dataclass(frozen=True)
class ViewEvent:
    media_id: str
    session_id: str
    watched_seconds: float = 0.0
    occurred_at: str = ""  # ISO-8601 UTC, set by the service
    id: str = field(default_factory=new_ulid)

    def __post_init__(self) -> None:
        if self.watched_seconds < 0:
            raise ValueError("ViewEvent.watched_seconds must be >= 0")
        if not self.occurred_at:
            raise ValueError("ViewEvent.occurred_at must be set")


@dataclass(frozen=True)
class Reaction:
    media_id: str
    kind: ReactionKind
    id: str = field(default_factory=new_ulid)


@dataclass(frozen=True)
class Bookmark:
    media_id: str
    note: str = ""
    id: str = field(default_factory=new_ulid)
