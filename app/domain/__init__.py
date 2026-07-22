"""Media Codex domain model — pure Python, zero framework imports.

Entities enforce their own invariants in ``__post_init__``; application
services (``app/services/``) orchestrate them; repositories persist them.
If this package imports fastapi/sqlite3/httpx, something has gone wrong.

See docs/architecture/backend-redesign.md, section 4.
"""

from app.domain.events import (
    CaptureRequested,
    DomainEvent,
    MediaCaptured,
    PerformerAdded,
    TakedownRequested,
)
from app.domain.ids import new_ulid
from app.domain.media import MediaItem, MediaKind, PreviewRef, SourceProvider, SourceRef
from app.domain.performers import (
    CaptureRequest,
    CaptureState,
    Performer,
    PerformerStatus,
    RightsBasis,
)

__all__ = [
    "CaptureRequest",
    "CaptureRequested",
    "CaptureState",
    "DomainEvent",
    "MediaCaptured",
    "MediaItem",
    "MediaKind",
    "Performer",
    "PerformerAdded",
    "PerformerStatus",
    "PreviewRef",
    "RightsBasis",
    "SourceProvider",
    "SourceRef",
    "TakedownRequested",
    "new_ulid",
]
