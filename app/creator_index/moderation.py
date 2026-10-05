"""Takedown / hide requests and the suppression list.

A public takedown request is acted on immediately and reversibly:

1. the request is recorded (contact e-mail and IP only as salted digests);
2. matching creators get ``hidden = 1`` and matching items are stripped from stored sample media and
   links, so index reads stop returning them at once;
3. suppression rows are written (``creator_suppressions``). ``CreatorIndexRepository.upsert`` consults
   them for every write path (crawler, observe, submitted feeds), so a hidden creator or item is never
   re-added or re-shown by a later crawl.

An operator can then *restore* (lift a restorable suppression) or make it *permanent*. Requests are taken
at face value because the page is unauthenticated: the response is deliberately cheap to undo, and the
rate limits plus per-request match cap keep abuse bounded. Nothing here identifies a person: the
subject of a request is a public handle or URL.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from typing import Any, Callable, ContextManager
from urllib.parse import unquote, urlsplit

from app.creator_index.abuse import RateLimited, SlidingWindowLimiter
from app.creator_index.config import env_int
from app.creator_index.hygiene import canonical, canonical_url, clean_handle, redact
from app.creator_index.repository import PLATFORM_LABELS, _like_escape, now_iso, platform_key
from app.creator_index.suppression import SuppressionIndex, item_keys, load_suppression_index

MAX_MATCHED_CREATORS = 5
MAX_REASON = 500
REQUEST_STATUSES = ("hidden", "restored", "suppressed")

#: platforms whose handles are ``name@host`` (the host is part of the identity)
FEDERATED = frozenset({"mastodon", "lemmy", "peertube", "feed"})
_PLATFORM_ALIASES = {**{k: k for k in PLATFORM_LABELS}, **{canonical(v): k for k, v in PLATFORM_LABELS.items()}}


class ModerationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Target:
    """What a request points at."""

    creators: list[tuple[str, str]] = field(default_factory=list)   # (platform, handle) to hide
    items: list[str] = field(default_factory=list)                  # item keys ("id:..", "url:..")
    profiles: list[str] = field(default_factory=list)               # canonical profile URLs (creator pages)
    platform: str = ""
    handle: str = ""
    url: str = ""

    def describe(self) -> dict[str, str]:
        return {"platform": self.platform, "handle": self.handle, "url": self.url}


# ── parsing ──────────────────────────────────────────────────────────────────


def normalize_platform(value: str) -> str:
    key = _PLATFORM_ALIASES.get(canonical(value))
    if not key:
        raise ModerationError("unknown_platform", "platform must be one of: " + ", ".join(sorted(PLATFORM_LABELS)))
    return key


def _handle_for(platform: str, raw: str) -> str:
    handle = clean_handle(raw)
    if not canonical(handle):
        raise ModerationError("invalid_handle", "That handle is not valid.")
    if platform in FEDERATED and "@" not in handle.strip("@"):
        raise ModerationError("handle_needs_host", "For this platform use the full handle, e.g. name@instance.example.")
    if platform not in FEDERATED and "@" in handle:
        raise ModerationError("invalid_handle", "That handle is not valid for this platform.")
    return handle


def _federated_local(segment: str, host: str) -> str:
    """`@name` / `@name@other.host` / `name@other.host` path segment -> `name@host`."""
    seg = unquote(segment).lstrip("@")
    local, _, remote = seg.partition("@")
    return clean_handle(f"{local}@{(remote or host).lower()}")


def target_from_url(raw: str) -> Target:
    text = str(raw or "").strip()
    if not text or len(text) > 500:
        raise ModerationError("invalid_url", "Provide a profile or post URL of at most 500 characters.")
    try:
        parts = urlsplit(text)
        parts.port  # noqa: B018 - validates the port
    except ValueError as exc:
        raise ModerationError("invalid_url", "That URL is not valid.") from exc
    if parts.scheme.lower() != "https" or not parts.hostname or parts.username or parts.password:
        raise ModerationError("invalid_url", "Provide a plain https URL.")
    canon = canonical_url(text)
    host = parts.hostname.lower().removeprefix("www.")
    segs = [s for s in parts.path.split("/") if s]
    if not segs:
        raise ModerationError("target_not_specific", "Point at one profile or post, not a whole site.")
    t = Target(url=canon)

    def creator(platform: str, handle: str) -> None:
        if canonical(handle):
            t.creators.append((platform, handle))
            t.platform, t.handle = platform, handle

    if host.endswith("redgifs.com"):
        if segs[0] == "users" and len(segs) > 1:
            creator("redgifs", clean_handle(unquote(segs[1])))
        elif segs[0] in {"watch", "ifr"} and len(segs) > 1:
            gid = clean_handle(unquote(segs[1]))
            t.items += [f"id:rg-{gid}", f"url:{canonical_url('https://www.redgifs.com/watch/' + gid)}"]
            t.platform = "redgifs"
        return t if (t.creators or t.items) else _generic(t, canon)
    if host == "bsky.app" and segs[0] == "profile" and len(segs) > 1:
        handle = clean_handle(unquote(segs[1]))
        if len(segs) >= 4 and segs[2] == "post":
            t.items.append(f"url:{canon}")
            t.platform, t.handle = "bluesky", handle
        else:
            creator("bluesky", handle)
        return t if (t.creators or t.items) else _generic(t, canon)
    if segs[0].startswith("@"):
        if len(segs) >= 2:  # a status: hide the item, keep the account
            t.items.append(f"url:{canon}")
            t.platform, t.handle = "mastodon", _federated_local(segs[0], host)
        else:
            creator("mastodon", _federated_local(segs[0], host))
        return t
    if segs[0] == "users" and len(segs) == 2:
        creator("mastodon", _federated_local(segs[1], host))
        t.profiles.append(canonical_url(text, keep_query=False))
        return t
    if segs[0] == "u" and len(segs) >= 2:
        creator("lemmy", _federated_local(segs[1], host))
        return t
    if segs[0] in {"video-channels", "a", "accounts"} and len(segs) >= 2:
        creator("peertube", _federated_local(segs[1], host))
        t.profiles.append(canonical_url(text, keep_query=False))
        return t
    return _generic(t, canon)


def _generic(t: Target, canon: str) -> Target:
    """Unrecognised URL: hide any creator whose profile link it is, and any item that links to it."""
    t.profiles.append(canonical_url(canon, keep_query=False))
    t.items.append(f"url:{canon}")
    return t


def build_target(platform: str | None, handle: str | None, url: str | None) -> Target:
    if url and str(url).strip():
        target = target_from_url(url)
        if platform and handle:  # both supplied: the explicit pair adds a creator to hide
            plat = normalize_platform(platform)
            pair = (plat, _handle_for(plat, handle))
            if pair not in target.creators and not target.items:
                target.creators.append(pair)
        return target
    if not (platform and handle):
        raise ModerationError("target_required", "Provide a profile or post URL, or a platform and handle.")
    plat = normalize_platform(platform)
    clean = _handle_for(plat, handle)
    return Target(creators=[(plat, clean)], platform=plat, handle=clean)


# ── service ──────────────────────────────────────────────────────────────────


@dataclass
class Outcome:
    request_id: int
    status: str
    matched_creators: int = 0
    matched_items: int = 0


class ModerationService:
    def __init__(self, connect: Callable[[], ContextManager[sqlite3.Connection]]):
        self._connect = connect
        # public takedown endpoint: per client and global ceilings (in-process, single instance)
        self.per_ip = SlidingWindowLimiter(env_int("TAKEDOWN_PER_HOUR", 6, minimum=1), 3600)
        self.overall = SlidingWindowLimiter(env_int("TAKEDOWN_GLOBAL_PER_HOUR", 120, minimum=1), 3600)
        self.max_per_email_day = env_int("TAKEDOWN_PER_EMAIL_PER_DAY", 20, minimum=1)

    def check_rate(self, client_key: str) -> None:
        ok, retry = self.per_ip.hit(client_key)
        if not ok:
            raise RateLimited(retry, "client")
        ok, retry = self.overall.hit("*")
        if not ok:
            raise RateLimited(retry, "global")

    # ── writes ──

    def record_takedown(
        self, target: Target, *, reason: str, email_hash: str = "", ip_hash: str = "", source: str = "public",
        permanent: bool = False, now: str | None = None,
    ) -> Outcome:
        stamp = now or now_iso()
        level = "permanent" if permanent else "hidden"
        status = "suppressed" if permanent else "hidden"
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO takedown_requests (created_at, platform, handle, target_url, reason, contact_email_hash, "
                "submitted_ip_hash, source, status) VALUES (?,?,?,?,?,?,?,?,?)",
                (stamp, target.platform[:20], target.handle[:80], target.url[:500], redact(reason)[:MAX_REASON],
                 email_hash, ip_hash, source, status),
            )
            request_id = int(cur.lastrowid)
            for platform, handle in target.creators:
                self._suppress(conn, "creator", request_id, stamp, level, source, reason, platform=platform, handle=handle)
            for key in target.items:
                self._suppress(conn, "item", request_id, stamp, level, source, reason, item_key=key)
            for url in target.profiles:
                self._suppress(conn, "profile", request_id, stamp, level, source, reason, item_key=url)
            hidden_ids = set(self._hide_creators(conn, target))
            items = self._strip_items(conn, target.items)
            hidden_ids |= set(self._reject_feeds(conn, target, request_id, stamp, source, level))
            creators = len(hidden_ids)
            conn.execute(
                "UPDATE takedown_requests SET matched_creators = ?, matched_items = ? WHERE id = ?",
                (creators, items, request_id),
            )
            conn.commit()
        return Outcome(request_id, status, creators, items)

    @staticmethod
    def _suppress(conn: sqlite3.Connection, kind: str, request_id: int, stamp: str, level: str, source: str,
                  reason: str, *, platform: str = "", handle: str = "", item_key: str = "") -> None:
        conn.execute(
            "INSERT INTO creator_suppressions (kind, platform, handle, item_key, level, source, request_id, reason, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(kind, platform, handle, item_key) DO UPDATE SET "
            "level = CASE WHEN excluded.level = 'permanent' THEN 'permanent' ELSE level END, "
            "request_id = excluded.request_id",
            (kind, platform, handle, item_key, level, source, request_id, redact(reason)[:MAX_REASON], stamp),
        )

    @staticmethod
    def _hide_creators(conn: sqlite3.Connection, target: Target) -> list[int]:
        ids: set[int] = set()
        for platform, handle in target.creators:
            ids |= {r[0] for r in conn.execute(
                "SELECT id FROM creator_index WHERE platform = ? AND handle = ?", (platform, handle))}
        for canon in target.profiles:
            parts = urlsplit(canon)
            needle = f"%{_like_escape((parts.hostname or '').lower())}{_like_escape(parts.path)}%"
            for row in conn.execute(
                "SELECT id, profile_url FROM creator_index WHERE lower(profile_url) LIKE ? ESCAPE '\\'", (needle,)
            ):
                if canonical_url(row[1], keep_query=False) == canon:
                    ids.add(row[0])
        chosen = sorted(ids)[:MAX_MATCHED_CREATORS]
        for row_id in chosen:
            conn.execute("UPDATE creator_index SET hidden = 1 WHERE id = ?", (row_id,))
        return chosen

    @staticmethod
    def _strip_items(conn: sqlite3.Connection, keys: list[str]) -> int:
        if not keys:
            return 0
        index = SuppressionIndex(items=set(keys))
        needles = set()
        for key in keys:
            body = key.split(":", 1)[1]
            needles.add(body.removeprefix("https://") if key.startswith("url:") else body)
        row_ids: set[int] = set()
        for needle in needles:
            like = f"%{_like_escape(needle)}%"
            row_ids |= {r[0] for r in conn.execute(
                "SELECT id FROM creator_index WHERE sample_media_json LIKE ? ESCAPE '\\' OR links_json LIKE ? ESCAPE '\\'",
                (like, like))}
        removed = 0
        for row_id in sorted(row_ids):
            row = conn.execute("SELECT sample_media_json, links_json FROM creator_index WHERE id = ?", (row_id,)).fetchone()
            try:
                samples, links = json.loads(row[0] or "[]"), json.loads(row[1] or "[]")
            except ValueError:
                continue
            kept_s, kept_l = index.filter_items(samples), index.filter_items(links)
            dropped = (len(samples) - len(kept_s)) + (len(links) - len(kept_l))
            if dropped:
                removed += dropped
                conn.execute(
                    "UPDATE creator_index SET sample_media_json = ?, links_json = ? WHERE id = ?",
                    (json.dumps(kept_s, separators=(",", ":")), json.dumps(kept_l, separators=(",", ":")), row_id),
                )
        return removed

    def _reject_feeds(self, conn: sqlite3.Connection, target: Target, request_id: int, stamp: str, source: str, level: str) -> list[int]:
        """A takedown aimed at a submitted feed (its URL, site or creator) rejects the feed for good.
        Returns the ids of the creator rows it hid."""
        clauses, params = [], []
        for url in {*target.profiles, *(k[4:] for k in target.items if k.startswith("url:"))}:
            clauses.append("canonical_key = ? OR url = ? OR site_url = ?")
            params += [url, url, url]
        for platform, handle in target.creators:
            if platform == "feed":
                clauses.append("creator_handle = ?")
                params.append(handle)
        if not clauses:
            return []
        hidden: list[int] = []
        for row in conn.execute(f"SELECT id, canonical_key, creator_handle FROM submitted_feeds WHERE {' OR '.join(clauses)}", params).fetchall():
            conn.execute(
                "UPDATE submitted_feeds SET status = 'rejected', reason = 'takedown', updated_at = ? WHERE id = ?",
                (stamp, row["id"]),
            )
            self._suppress(conn, "feed", request_id, stamp, level, source, "takedown", item_key=row["canonical_key"])
            if row["creator_handle"]:
                self._suppress(conn, "creator", request_id, stamp, level, source, "takedown", platform="feed", handle=row["creator_handle"])
                hidden += [r[0] for r in conn.execute(
                    "SELECT id FROM creator_index WHERE platform = 'feed' AND handle = ?", (row["creator_handle"],))]
                conn.execute("UPDATE creator_index SET hidden = 1 WHERE platform = 'feed' AND handle = ?", (row["creator_handle"],))
        return hidden

    def make_permanent(self, request_id: int, note: str = "") -> bool:
        with self._connect() as conn:
            row = conn.execute("SELECT id FROM takedown_requests WHERE id = ?", (request_id,)).fetchone()
            if row is None:
                return False
            conn.execute("UPDATE creator_suppressions SET level = 'permanent' WHERE request_id = ?", (request_id,))
            conn.execute(
                "UPDATE takedown_requests SET status = 'suppressed', resolved_at = ?, admin_note = ? WHERE id = ?",
                (now_iso(), redact(note)[:MAX_REASON], request_id),
            )
            conn.commit()
        return True

    def restore(self, request_id: int, note: str = "") -> str:
        """'ok' | 'not_found' | 'permanent'. Lifts the request's restorable suppressions and unhides creators.

        Items that were stripped from stored samples are not re-inserted; the next crawl restores them."""
        with self._connect() as conn:
            row = conn.execute("SELECT status FROM takedown_requests WHERE id = ?", (request_id,)).fetchone()
            if row is None:
                return "not_found"
            rows = conn.execute("SELECT * FROM creator_suppressions WHERE request_id = ?", (request_id,)).fetchall()
            if row["status"] == "suppressed" or any(r["level"] == "permanent" for r in rows):
                return "permanent"
            conn.execute("DELETE FROM creator_suppressions WHERE request_id = ?", (request_id,))
            remaining = load_suppression_index(conn)
            for r in rows:
                if r["kind"] == "creator" and not remaining.creator_blocked(r["platform"], r["handle"]):
                    conn.execute("UPDATE creator_index SET hidden = 0 WHERE platform = ? AND handle = ?", (r["platform"], r["handle"]))
                elif r["kind"] == "profile":
                    self._unhide_profile(conn, r["item_key"], remaining)
                elif r["kind"] == "feed":
                    conn.execute(
                        "UPDATE submitted_feeds SET status = 'paused', reason = 'restored: needs re-approval', updated_at = ? "
                        "WHERE canonical_key = ? AND status = 'rejected' AND reason = 'takedown'",
                        (now_iso(), r["item_key"]),
                    )
            conn.execute(
                "UPDATE takedown_requests SET status = 'restored', resolved_at = ?, admin_note = ? WHERE id = ?",
                (now_iso(), redact(note)[:MAX_REASON], request_id),
            )
            conn.commit()
        return "ok"

    @staticmethod
    def _unhide_profile(conn: sqlite3.Connection, canon: str, remaining: SuppressionIndex) -> None:
        parts = urlsplit(canon)
        needle = f"%{_like_escape((parts.hostname or '').lower())}{_like_escape(parts.path)}%"
        for row in conn.execute(
            "SELECT id, platform, handle, profile_url FROM creator_index WHERE hidden = 1 AND lower(profile_url) LIKE ? ESCAPE '\\'",
            (needle,),
        ).fetchall():
            if canonical_url(row["profile_url"], keep_query=False) == canon and not remaining.creator_blocked(
                row["platform"], row["handle"], row["profile_url"]
            ):
                conn.execute("UPDATE creator_index SET hidden = 0 WHERE id = ?", (row["id"],))

    def set_hidden(self, platform: str, handle: str, hidden: bool) -> str:
        """Admin hide/unhide of one creator. 'ok' | 'not_found' | 'suppressed' (cannot unhide)."""
        plat = platform_key(platform)
        clean = clean_handle(handle)
        with self._connect() as conn:
            if not hidden and load_suppression_index(conn).creator_blocked(plat, clean):
                return "suppressed"
            cur = conn.execute("UPDATE creator_index SET hidden = ? WHERE platform = ? AND handle = ?",
                               (1 if hidden else 0, plat, clean))
            conn.commit()
            return "ok" if cur.rowcount else "not_found"

    # ── reads ──

    def is_feed_suppressed(self, canonical_key: str) -> bool:
        with self._connect() as conn:
            return conn.execute(
                "SELECT 1 FROM creator_suppressions WHERE kind = 'feed' AND item_key = ?", (canonical_key,)
            ).fetchone() is not None

    def count_recent_by_email(self, email_hash: str, since: str) -> int:
        if not email_hash:
            return 0
        with self._connect() as conn:
            return int(conn.execute(
                "SELECT COUNT(*) FROM takedown_requests WHERE contact_email_hash = ? AND created_at >= ?",
                (email_hash, since),
            ).fetchone()[0])

    def list_requests(self, *, status: str | None = None, limit: int = 50, before_id: int | None = None) -> list[dict[str, Any]]:
        clauses, params = ["1=1"], []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if before_id:
            clauses.append("id < ?")
            params.append(before_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM takedown_requests WHERE {' AND '.join(clauses)} ORDER BY id DESC LIMIT ?",
                [*params, max(1, min(200, limit))],
            ).fetchall()
        return [self.request_view(r) for r in rows]

    @staticmethod
    def request_view(r: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": r["id"], "createdAt": r["created_at"], "platform": r["platform"], "handle": r["handle"],
            "targetUrl": r["target_url"], "reason": r["reason"], "status": r["status"], "source": r["source"],
            "matchedCreators": r["matched_creators"], "matchedItems": r["matched_items"],
            "hasContact": bool(r["contact_email_hash"]), "resolvedAt": r["resolved_at"], "adminNote": r["admin_note"],
        }

    def list_suppressions(self, *, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM creator_suppressions ORDER BY id DESC LIMIT ?", (max(1, min(500, limit)),)
            ).fetchall()
        return [
            {"id": r["id"], "kind": r["kind"], "platform": r["platform"], "handle": r["handle"], "key": r["item_key"],
             "level": r["level"], "source": r["source"], "requestId": r["request_id"], "reason": r["reason"],
             "createdAt": r["created_at"]}
            for r in rows
        ]


__all__ = ["ModerationService", "ModerationError", "Target", "Outcome", "build_target", "item_keys"]
