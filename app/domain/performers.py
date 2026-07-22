"""Performer context: directory, candidates, and rights-gated captures
(blueprint sections 4 and 10 — the rights basis is a *domain* invariant,
not a router check)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.ids import new_ulid


class PerformerStatus(StrEnum):
    DIRECTORY = "directory"    # visible in the directory
    CANDIDATE = "candidate"    # suggested (TF-IDF or AI rerank), not yet promoted
    ARCHIVED = "archived"


class RightsBasis(StrEnum):
    PUBLIC_API = "public_api"              # provider's official public API
    CREATOR_AUTHORIZED = "creator_authorized"  # documented creator authorization


class CaptureState(StrEnum):
    QUEUED = "queued"
    ACTIVE = "active"
    PAUSED = "paused"
    BLOCKED = "blocked"


@dataclass(frozen=True)
class ProfileLink:
    provider: str
    url: str


@dataclass
class Performer:
    display_name: str
    status: PerformerStatus = PerformerStatus.CANDIDATE
    aliases: list[str] = field(default_factory=list)
    profile_links: list[ProfileLink] = field(default_factory=list)
    avatar_url: str | None = None
    confidence: float = 0.0
    id: str = field(default_factory=new_ulid)

    def __post_init__(self) -> None:
        if not self.display_name.strip():
            raise ValueError("Performer.display_name must not be empty")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("Performer.confidence must be in [0, 1]")

    def promote_to_directory(self) -> None:
        """Only high-confidence candidates become visible (matches the
        product rule that suggestions carry reasons and source attribution)."""
        if self.status is not PerformerStatus.CANDIDATE:
            raise ValueError(f"cannot promote performer in status {self.status}")
        if self.confidence < 0.5:
            raise ValueError("cannot promote a candidate with confidence < 0.5")
        self.status = PerformerStatus.DIRECTORY


@dataclass
class CaptureRequest:
    """A request to actively capture a performer's content.

    Invariant (mirrors ENABLE_EXTERNAL_CRAWLS policy): a capture can only
    become ACTIVE with a documented rights basis. No rights basis, no crawl.
    """

    performer_id: str
    rights_basis: RightsBasis | None = None
    state: CaptureState = CaptureState.QUEUED
    id: str = field(default_factory=new_ulid)

    def activate(self) -> None:
        if self.rights_basis is None:
            raise ValueError(
                "capture cannot activate without a documented rights basis "
                "(public_api or creator_authorized)"
            )
        if self.state is CaptureState.BLOCKED:
            raise ValueError("a blocked capture cannot be re-activated")
        self.state = CaptureState.ACTIVE

    def pause(self) -> None:
        if self.state is CaptureState.ACTIVE:
            self.state = CaptureState.PAUSED

    def block(self) -> None:
        """Takedown/rights failure path — terminal until operator review."""
        self.state = CaptureState.BLOCKED
