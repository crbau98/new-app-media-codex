from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class ResearchItem:
    source_type: str
    theme: str
    query: str
    title: str
    url: str
    summary: str
    content: str = ""
    author: str = ""
    published_at: str = ""
    domain: str = ""
    image_url: str = ""
    score: float = 0.0
    compounds: list[str] = field(default_factory=list)
    mechanisms: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_record(self) -> dict[str, Any]:
        record = asdict(self)
        record["metadata_json"] = record.pop("metadata")
        return record


@dataclass
class ImageRecord:
    source_type: str
    theme: str
    title: str
    image_url: str
    page_url: str = ""
    thumb_url: str = ""
    local_path: str = ""
    original_path: str = ""


@dataclass
class HypothesisRecord:
    title: str
    rationale: str
    evidence: str
    novelty_score: float
    safety_flags: str
