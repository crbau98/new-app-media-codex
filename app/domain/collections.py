"""Collections context: user-curated groupings of media (blueprint section 4).
Local-by-default per the product's privacy principles."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.ids import new_ulid


@dataclass
class Collection:
    name: str
    description: str = ""
    id: str = field(default_factory=new_ulid)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("Collection.name must not be empty")


@dataclass(frozen=True)
class PlaylistEntry:
    media_id: str
    position: int

    def __post_init__(self) -> None:
        if self.position < 0:
            raise ValueError("PlaylistEntry.position must be >= 0")


@dataclass
class Playlist:
    name: str
    entries: list[PlaylistEntry] = field(default_factory=list)
    id: str = field(default_factory=new_ulid)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("Playlist.name must not be empty")

    def append(self, media_id: str) -> PlaylistEntry:
        entry = PlaylistEntry(media_id=media_id, position=len(self.entries))
        self.entries.append(entry)
        return entry

    def move(self, from_position: int, to_position: int) -> None:
        if not (0 <= from_position < len(self.entries)):
            raise ValueError("from_position out of range")
        entry = self.entries.pop(from_position)
        self.entries.insert(max(0, min(to_position, len(self.entries))), entry)
        for index, e in enumerate(self.entries):
            object.__setattr__(e, "position", index)  # frozen dataclass: renumber via bypass
