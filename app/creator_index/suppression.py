"""Suppression list: creators / items / profile URLs / feeds that must never (re)enter the index.

``CreatorIndexRepository.upsert`` loads this once per batch and applies it to every observation, so the
crawler, the admin ``observe`` endpoint and submitted feeds are all covered by a single choke point.
This module deliberately has no dependency on the repository (the repository imports it).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any, Iterable

from app.creator_index.hygiene import canonical_url, clean_handle


def item_keys(item: Any) -> set[str]:
    """Identity keys for a sample-media item or a profile link (``id:`` / ``url:``)."""
    keys: set[str] = set()
    if not isinstance(item, dict):
        return keys
    if item.get("id"):
        keys.add(f"id:{str(item['id']).strip().lower()}")
    for field_name in ("pageUrl", "url"):
        canon = canonical_url(item.get(field_name))
        if canon:
            keys.add(f"url:{canon}")
    return keys


@dataclass
class SuppressionIndex:
    creators: set[tuple[str, str]] = field(default_factory=set)
    items: set[str] = field(default_factory=set)
    profiles: set[str] = field(default_factory=set)
    feeds: set[str] = field(default_factory=set)

    @property
    def empty(self) -> bool:
        return not (self.creators or self.items or self.profiles or self.feeds)

    def creator_blocked(self, platform: str, handle: str, profile_url: str = "") -> bool:
        if (platform, clean_handle(handle)) in self.creators:
            return True
        canon = canonical_url(profile_url, keep_query=False)
        return bool(canon and canon in self.profiles)

    def item_blocked(self, item: Any) -> bool:
        return not self.items.isdisjoint(item_keys(item))

    def filter_items(self, items: Iterable[Any]) -> list[Any]:
        if not self.items:
            return list(items)
        return [i for i in items if not self.item_blocked(i)]


def load_suppression_index(conn: sqlite3.Connection) -> SuppressionIndex:
    index = SuppressionIndex()
    for row in conn.execute("SELECT kind, platform, handle, item_key FROM creator_suppressions"):
        kind = row[0]
        if kind == "creator" and row[1] and row[2]:
            index.creators.add((row[1], row[2]))
        elif kind == "item" and row[3]:
            index.items.add(row[3])
        elif kind == "profile" and row[3]:
            index.profiles.add(row[3])
        elif kind == "feed" and row[3]:
            index.feeds.add(row[3])
    return index
