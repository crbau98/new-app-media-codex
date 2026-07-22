"""Media context: the library's core aggregate (blueprint section 4)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from app.domain.ids import new_ulid


class MediaKind(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    GIF = "gif"


class SourceProvider(StrEnum):
    REDGIFS = "redgifs"
    X = "x"
    TUMBLR = "tumblr"
    TELEGRAM = "telegram"
    DIRECT = "direct"
    OTHER = "other"


@dataclass(frozen=True)
class SourceRef:
    """Where a media item came from. Provenance is a product principle:
    every item must be traceable back to its originating public post."""

    provider: SourceProvider
    external_id: str
    canonical_url: str

    def __post_init__(self) -> None:
        if not self.external_id.strip():
            raise ValueError("SourceRef.external_id must not be empty")
        if not self.canonical_url.startswith(("https://", "http://")):
            raise ValueError("SourceRef.canonical_url must be an absolute http(s) URL")


@dataclass(frozen=True)
class PreviewRef:
    thumbnail_url: str | None = None
    preview_url: str | None = None
    duration_seconds: float | None = None


@dataclass
class MediaItem:
    """Aggregate root for the media context."""

    source: SourceRef
    kind: MediaKind
    title: str = ""
    tags: list[str] = field(default_factory=list)
    preview: PreviewRef = field(default_factory=PreviewRef)
    checksum: str | None = None
    captured_at: str = ""  # ISO-8601 UTC; set by the application service
    id: str = field(default_factory=new_ulid)

    def __post_init__(self) -> None:
        if not self.captured_at:
            raise ValueError("MediaItem.captured_at must be set (ISO-8601 UTC)")
        # Normalize tags at the boundary so queries never deal with case drift.
        self.tags = sorted({t.strip().lower() for t in self.tags if t.strip()})

    @property
    def attribution_url(self) -> str:
        """The link back to the originating public post — always reachable."""
        return self.source.canonical_url

    def add_tags(self, *tags: str) -> None:
        self.tags = sorted(set(self.tags) | {t.strip().lower() for t in tags if t.strip()})
