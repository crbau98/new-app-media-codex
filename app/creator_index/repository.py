"""Creator index persistence: merge-safe upsert, keyset pagination, filters, stats.

Merge rules (a partial crawl must never lose data):
  * counts (media/view/like/followers) only grow unless the observation is
    flagged ``authoritative`` (a full catalog read), which replaces them;
  * tags accumulate with counts and are bounded to the top ``MAX_TAGS_STORED``;
  * sample media merge by id, bounded to ``MAX_SAMPLE_MEDIA`` best items;
  * display name / avatar / profile URL are only replaced by non-empty values;
  * ``first_seen_at`` is immutable, ``hidden`` is never touched by crawlers;
  * every batch is filtered through the suppression list (takedowns / admin removals): a suppressed
    creator is never written and suppressed items are stripped from stored samples and links.
"""

from __future__ import annotations

import calendar
import json
import math
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, Callable, ContextManager, Iterable
from urllib.parse import urlsplit

from app.core.pagination import decode_cursor, encode_cursor
from app.creator_index.hygiene import (
    MAX_SAMPLE_MEDIA,
    MAX_TAGS_SERVED,
    MAX_TAGS_STORED,
    canonical,
    clean_handle,
    clean_tag,
    redact,
    safe_profile_url,
    to_int,
)
from app.creator_index.suppression import SuppressionIndex, load_suppression_index

PLATFORM_LABELS = {
    "redgifs": "Redgifs",
    "bluesky": "Bluesky",
    "mastodon": "Mastodon",
    "lemmy": "Lemmy",
    "peertube": "PeerTube",
    "feed": "Creator feed",
}
SORTS = ("smart", "newest", "popular", "count")
MAX_LIMIT = 96
DEFAULT_LIMIT = 48
MAX_OBSERVE_BATCH = 200
MAX_LINKS = 8

# Keyset columns per sort; every column is NOT NULL and sorted DESC, with the
# row id as the final tiebreaker, so `(a, b, id) < (?, ?, ?)` is a valid seek.
_SORT_COLUMNS = {
    "smart": ("curation_score", "view_count"),
    "newest": ("last_seen_at",),
    "popular": ("view_count", "like_count"),
    "count": ("media_count", "view_count"),
}


class InvalidCursor(ValueError):
    """Raised for malformed or mismatched cursors (HTTP 400)."""


def now_iso(ts: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts if ts is not None else time.time()))


def platform_key(value: str) -> str:
    return canonical(value)


def platform_label(key: str) -> str:
    return PLATFORM_LABELS.get(key, key[:1].upper() + key[1:])


@dataclass
class CreatorObservation:
    platform: str
    handle: str
    display_name: str = ""
    avatar_url: str = ""
    profile_url: str = ""
    followers: int | None = None
    media_count: int = 0
    view_count: int = 0
    like_count: int = 0
    tags: dict[str, int] = field(default_factory=dict)
    last_seen_at: str = ""
    source: str = ""
    sample_media: list[dict[str, Any]] = field(default_factory=list)
    #: True when media_count/followers come from a complete catalog read and may replace stored
    #: values (views/likes from a partial page are never allowed to shrink a stored total).
    authoritative: bool = False
    #: attribution line shown with the creator (defaults to the platform-level text)
    attribution: str = ""
    #: extra outbound links (feed items, recent posts): [{"label", "url"}], https only, bounded
    links: list[dict[str, str]] = field(default_factory=list)


@dataclass
class UpsertResult:
    written: int = 0
    #: cleaned handles that did not exist before this batch (the "yield" of a lane)
    new: list[str] = field(default_factory=list)
    suppressed: int = 0


def sanitize_links(links: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for link in links if isinstance(links, list) else []:
        if not isinstance(link, dict):
            continue
        url = safe_profile_url(link.get("url"))
        if not url or url in seen:
            continue
        seen.add(url)
        host = (urlsplit(url).hostname or "link").removeprefix("www.")
        out.append({"label": redact(link.get("label"))[:80] or host, "url": url})
        if len(out) >= MAX_LINKS:
            break
    return out


def curation_score(views: int, likes: int, media: int, last_seen_at: str) -> int:
    """Explainable 0-100 ordering signal from absolute engagement + freshness."""
    v = min(1.0, math.log10(1 + max(0, views)) / 7.0)
    lk = min(1.0, math.log10(1 + max(0, likes)) / 5.0)
    m = min(1.0, max(0, media) / 60.0)
    fresh = 0.0
    if last_seen_at:
        try:
            age_days = max(0.0, (time.time() - calendar.timegm(time.strptime(last_seen_at[:19], "%Y-%m-%dT%H:%M:%S"))) / 86400)
            fresh = math.exp(-age_days / 30.0)
        except ValueError:
            fresh = 0.0
    return max(0, min(100, round(v * 40 + lk * 25 + m * 15 + fresh * 20)))


def _sample_rank(item: dict[str, Any]) -> tuple[int, int, str]:
    return (to_int(item.get("views")), to_int(item.get("likes")), str(item.get("createdAt") or ""))


def merge_samples(old: list[dict[str, Any]], new: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for item in [*old, *new]:  # new wins for the same id
        if isinstance(item, dict) and item.get("id"):
            by_id[str(item["id"])] = item
    ranked = sorted(by_id.values(), key=_sample_rank, reverse=True)
    return ranked[:MAX_SAMPLE_MEDIA]


def merge_tags(old: dict[str, int], new: dict[str, int]) -> dict[str, int]:
    merged: dict[str, int] = dict(old)
    for tag, n in new.items():
        label = clean_tag(tag)
        if label:
            merged[label] = merged.get(label, 0) + max(1, to_int(n, 1))
    top = sorted(merged.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_TAGS_STORED]
    return dict(top)


def _load(value: str | None, default: Any) -> Any:
    try:
        out = json.loads(value) if value else default
    except ValueError:
        return default
    return out if isinstance(out, type(default)) else default


def creator_id(platform: str, handle: str) -> str:
    canon = canonical(handle)
    return f"creator-{canon}" if platform == "redgifs" else f"creator-{platform}-{canon}"


def row_to_creator(row: sqlite3.Row) -> dict[str, Any]:
    platform = row["platform"]
    label = platform_label(platform)
    tags: dict[str, int] = _load(row["tags_json"], {})
    ordered_tags = [t for t, _ in sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))][:MAX_TAGS_SERVED]
    profile = row["profile_url"] or ""
    links = []
    if profile:
        host = (urlsplit(profile).hostname or label).removeprefix("www.")
        links.append({"label": host, "url": profile})
    links.extend(l for l in sanitize_links(_load(row["links_json"], [])) if l["url"] != profile)
    return {
        "id": creator_id(platform, row["handle"]),
        "name": row["display_name"] or row["handle"],
        "username": row["handle"],
        "avatar": row["avatar_url"] or "",
        "followers": row["followers"],
        "platform": label,
        "platforms": [label],
        "profileUrl": profile,
        "profileLinks": links,
        "mediaCount": row["media_count"],
        "evidenceCount": row["media_count"],
        "viewCount": row["view_count"],
        "likeCount": row["like_count"],
        "curationScore": row["curation_score"],
        "lastSeenAt": row["last_seen_at"] or None,
        "observedAt": row["last_crawled_at"] or "",
        "discoveryTags": ordered_tags,
        "sourceAttribution": (row["attribution"] or f"Public source metadata: {label} (creator index)")[:200],
        "media": _load(row["sample_media_json"], []),
    }


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CreatorIndexRepository:
    def __init__(self, connect: Callable[[], ContextManager[sqlite3.Connection]]):
        self._connect = connect

    @property
    def connect(self) -> Callable[[], ContextManager[sqlite3.Connection]]:
        return self._connect

    # ── writes ──────────────────────────────────────────────────────────────

    def upsert(self, observations: Iterable[CreatorObservation], *, now: str | None = None) -> int:
        """Merge observations; returns how many creators were written."""
        return self.upsert_detailed(observations, now=now).written

    def upsert_detailed(self, observations: Iterable[CreatorObservation], *, now: str | None = None) -> UpsertResult:
        """Merge observations, honouring the suppression list; reports which creators are new."""
        stamp = now or now_iso()
        result = UpsertResult()
        with self._connect() as conn:
            sup = load_suppression_index(conn)
            for obs in observations:
                outcome = self._upsert_one(conn, obs, stamp, sup)
                if outcome == "suppressed":
                    result.suppressed += 1
                elif outcome:
                    result.written += 1
                    if outcome == "new":
                        result.new.append(clean_handle(obs.handle))
            conn.commit()
        return result

    def _upsert_one(self, conn: sqlite3.Connection, obs: CreatorObservation, stamp: str, sup: SuppressionIndex) -> str | None:
        """'new' | 'updated' | 'suppressed' | None (rejected)."""
        platform = platform_key(obs.platform)
        handle = clean_handle(obs.handle)
        if not platform or not canonical(handle):
            return None
        if "@" in handle and platform in {"redgifs", "bluesky"}:
            return None  # these platforms have no `name@host` ids; such a value is an email
        if not sup.empty and sup.creator_blocked(platform, handle, obs.profile_url):
            return "suppressed"
        new_tags = merge_tags({}, obs.tags)
        new_samples = merge_samples([], sup.filter_items(obs.sample_media))
        new_links = sup.filter_items(sanitize_links(obs.links))
        attribution = (obs.attribution or "")[:200]
        profile = safe_profile_url(obs.profile_url)
        row = conn.execute(
            "SELECT * FROM creator_index WHERE platform = ? AND handle = ?", (platform, handle)
        ).fetchone()
        if row is None:
            score = curation_score(obs.view_count, obs.like_count, obs.media_count, obs.last_seen_at)
            conn.execute(
                """INSERT INTO creator_index (platform, handle, display_name, avatar_url, profile_url, followers,
                   media_count, view_count, like_count, curation_score, tags_json, first_seen_at, last_seen_at,
                   last_crawled_at, source, sample_media_json, attribution, links_json)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    platform, handle, obs.display_name[:120], obs.avatar_url[:500], profile,
                    None if obs.followers is None else to_int(obs.followers),
                    to_int(obs.media_count), to_int(obs.view_count), to_int(obs.like_count), score,
                    json.dumps(new_tags, separators=(",", ":")), stamp, obs.last_seen_at or stamp, stamp,
                    obs.source[:40], json.dumps(new_samples, separators=(",", ":")),
                    attribution, json.dumps(new_links, separators=(",", ":")),
                ),
            )
            self._replace_tags(conn, platform, handle, new_tags)
            return "new"

        pick = (lambda old, new: new) if obs.authoritative else max
        media = pick(row["media_count"], to_int(obs.media_count))
        views = max(row["view_count"], to_int(obs.view_count))
        likes = max(row["like_count"], to_int(obs.like_count))
        followers = row["followers"]
        if obs.followers is not None:
            followers = to_int(obs.followers) if obs.authoritative or followers is None else max(followers, to_int(obs.followers))
        tags = merge_tags(_load(row["tags_json"], {}), new_tags)
        samples = merge_samples(sup.filter_items(_load(row["sample_media_json"], [])), new_samples)
        links = new_links or sup.filter_items(_load(row["links_json"], []))
        last_seen = max(row["last_seen_at"] or "", obs.last_seen_at or "")
        conn.execute(
            """UPDATE creator_index SET display_name = ?, avatar_url = ?, profile_url = ?, followers = ?,
               media_count = ?, view_count = ?, like_count = ?, curation_score = ?, tags_json = ?,
               last_seen_at = ?, last_crawled_at = ?, source = ?, sample_media_json = ?,
               attribution = ?, links_json = ?
               WHERE id = ?""",
            (
                (obs.display_name or row["display_name"])[:120], (obs.avatar_url or row["avatar_url"])[:500],
                profile or row["profile_url"], followers, media, views, likes,
                curation_score(views, likes, media, last_seen), json.dumps(tags, separators=(",", ":")),
                last_seen, stamp, (obs.source or row["source"])[:40],
                json.dumps(samples, separators=(",", ":")),
                attribution or row["attribution"], json.dumps(links, separators=(",", ":")), row["id"],
            ),
        )
        self._replace_tags(conn, platform, handle, tags)
        return "updated"

    @staticmethod
    def _replace_tags(conn: sqlite3.Connection, platform: str, handle: str, tags: dict[str, int]) -> None:
        conn.execute("DELETE FROM creator_tags WHERE platform = ? AND handle = ?", (platform, handle))
        conn.executemany(
            "INSERT OR IGNORE INTO creator_tags (handle, platform, tag) VALUES (?,?,?)",
            [(handle, platform, tag) for tag in tags],
        )

    def set_hidden(self, platform: str, handle: str, hidden: bool) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE creator_index SET hidden = ? WHERE platform = ? AND handle = ?",
                (1 if hidden else 0, platform_key(platform), clean_handle(handle)),
            )
            conn.commit()
            return cur.rowcount > 0

    def hidden_keys(self) -> list[str]:
        """``label:canonical-handle`` (lower-case platform label, alphanumeric handle) for every hidden or suppressed
        creator: the same identity the edge uses to de-duplicate creators (`creatorDedupeKey`). No reasons or contacts."""
        keys: set[str] = set()
        with self._connect() as conn:
            for row in conn.execute("SELECT platform, handle FROM creator_index WHERE hidden = 1"):
                keys.add(f"{platform_label(row[0]).lower()}:{canonical(row[1])}")
            for row in conn.execute("SELECT platform, handle FROM creator_suppressions WHERE kind = 'creator'"):
                keys.add(f"{platform_label(row[0]).lower()}:{canonical(row[1])}")
        return sorted(keys)

    # ── reads ───────────────────────────────────────────────────────────────

    @staticmethod
    def _where(tag: str | None, q: str | None, platform: str | None) -> tuple[list[str], list[Any]]:
        clauses = ["hidden = 0"]
        params: list[Any] = []
        if platform:
            clauses.append("platform = ?")
            params.append(platform_key(platform))
        if tag:
            label = clean_tag(tag)
            clauses.append(
                "EXISTS (SELECT 1 FROM creator_tags t WHERE t.platform = creator_index.platform "
                "AND t.handle = creator_index.handle AND t.tag = ?)"
            )
            params.append(label or "\x00")
        if q:
            needle = f"%{_like_escape(q.strip().lower())}%"
            clauses.append(
                "(lower(handle) LIKE ? ESCAPE '\\' OR lower(display_name) LIKE ? ESCAPE '\\' "
                "OR lower(tags_json) LIKE ? ESCAPE '\\')"
            )
            params += [needle, needle, needle]
        return clauses, params

    def list(
        self,
        *,
        cursor: str | None = None,
        limit: int = DEFAULT_LIMIT,
        tag: str | None = None,
        q: str | None = None,
        sort: str = "smart",
        platform: str | None = None,
    ) -> dict[str, Any]:
        if sort not in SORTS:
            raise ValueError("sort must be one of " + ", ".join(SORTS))
        limit = max(1, min(MAX_LIMIT, int(limit)))
        columns = _SORT_COLUMNS[sort]
        clauses, params = self._where(tag, q, platform)
        count_clauses, count_params = list(clauses), list(params)
        if cursor:
            values, last_id = self._decode(cursor, sort, len(columns))
            tuple_cols = ", ".join([*columns, "id"])
            marks = ", ".join("?" for _ in range(len(columns) + 1))
            clauses.append(f"({tuple_cols}) < ({marks})")
            params += [*values, last_id]
        order = ", ".join(f"{c} DESC" for c in [*columns, "id"])
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM creator_index WHERE {' AND '.join(clauses)} ORDER BY {order} LIMIT ?",
                [*params, limit + 1],
            ).fetchall()
            total = conn.execute(
                f"SELECT COUNT(*) FROM creator_index WHERE {' AND '.join(count_clauses)}", count_params
            ).fetchone()[0]
            src_clauses, src_params = self._where(tag, q, None)
            sources = conn.execute(
                f"SELECT platform, COUNT(*) AS n FROM creator_index WHERE {' AND '.join(src_clauses)} "
                "GROUP BY platform ORDER BY n DESC, platform",
                src_params,
            ).fetchall()
            updated = conn.execute("SELECT MAX(last_crawled_at) FROM creator_index").fetchone()[0]
        visible = rows[:limit]
        next_cursor = None
        if len(rows) > limit and visible:
            last = visible[-1]
            next_cursor = encode_cursor(json.dumps([sort, *[last[c] for c in columns]]), str(last["id"]))
        return {
            "creators": [row_to_creator(r) for r in visible],
            "nextCursor": next_cursor,
            "total": total,
            "sources": [{"platform": platform_label(r["platform"]), "count": r["n"]} for r in sources],
            "updatedAt": updated or now_iso(),
        }

    @staticmethod
    def _decode(cursor: str, sort: str, width: int) -> tuple[list[Any], int]:
        try:
            raw, raw_id = decode_cursor(cursor)
        except Exception as exc:  # ApiProblem or anything else malformed
            raise InvalidCursor("cursor is malformed") from exc
        try:
            payload = json.loads(raw)
            last_id = int(raw_id)
        except (ValueError, TypeError) as exc:
            raise InvalidCursor("cursor is malformed") from exc
        if not isinstance(payload, list) or len(payload) != width + 1 or payload[0] != sort:
            raise InvalidCursor("cursor does not match this sort")
        values = payload[1:]
        if sort == "newest":
            if not isinstance(values[0], str):
                raise InvalidCursor("cursor is malformed")
        elif not all(isinstance(v, int) and not isinstance(v, bool) for v in values):
            raise InvalidCursor("cursor is malformed")
        return values, last_id

    def stats(self) -> dict[str, Any]:
        with self._connect() as conn:
            total = conn.execute("SELECT COUNT(*) FROM creator_index WHERE hidden = 0").fetchone()[0]
            by = conn.execute(
                "SELECT platform, COUNT(*) AS n FROM creator_index WHERE hidden = 0 GROUP BY platform"
            ).fetchall()
            last = conn.execute(
                "SELECT MAX(finished_at) FROM creator_crawl_runs WHERE finished_at IS NOT NULL"
            ).fetchone()[0]
            seeds = conn.execute("SELECT COUNT(*) FROM creator_seed_queue WHERE crawled_at IS NULL").fetchone()[0]
        return {
            "total": total,
            "byPlatform": {platform_label(r["platform"]): r["n"] for r in by},
            "lastCrawlAt": last,
            "seedQueue": seeds,
        }

    # ── crawl bookkeeping ───────────────────────────────────────────────────

    def get_state(self, key: str, default: Any = None) -> Any:
        with self._connect() as conn:
            row = conn.execute("SELECT value_json FROM creator_crawl_state WHERE key = ?", (key,)).fetchone()
        if row is None:
            return default
        try:
            return json.loads(row["value_json"])
        except ValueError:
            return default

    def set_state(self, key: str, value: Any) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO creator_crawl_state (key, value_json, updated_at) VALUES (?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
                (key, json.dumps(value), now_iso()),
            )
            conn.commit()

    def start_run(self, source: str = "all") -> int:
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO creator_crawl_runs (started_at, source, state) VALUES (?,?, 'running')",
                (now_iso(), source),
            )
            conn.commit()
            return int(cur.lastrowid)

    def finish_run(
        self, run_id: int, *, state: str, pages: int, creators: int, lane: str, errors: list[str],
        new_creators: int = 0, requests: int | None = None, yields: dict[str, Any] | None = None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE creator_crawl_runs SET finished_at = ?, state = ?, pages = ?, creators_upserted = ?, "
                "lane = ?, errors_json = ?, new_creators = ?, requests = ?, yield_json = ? WHERE id = ?",
                (
                    now_iso(), state, pages, creators, lane[:200], json.dumps(errors[:50]), new_creators,
                    pages if requests is None else requests, json.dumps(yields or {}, separators=(",", ":")), run_id,
                ),
            )
            conn.commit()

    def abandon_stale_runs(self) -> int:
        """Runs left 'running' by a process that died are closed at startup."""
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE creator_crawl_runs SET state = 'abandoned', finished_at = ? WHERE state = 'running'",
                (now_iso(),),
            )
            conn.commit()
            return cur.rowcount

    def recent_runs(self, limit: int = 10) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM creator_crawl_runs ORDER BY id DESC LIMIT ?", (max(1, min(50, limit)),)
            ).fetchall()
        return [
            {
                "id": r["id"], "startedAt": r["started_at"], "finishedAt": r["finished_at"], "source": r["source"],
                "lane": r["lane"], "pages": r["pages"], "creatorsUpserted": r["creators_upserted"],
                "errors": _load(r["errors_json"], []), "state": r["state"],
                "newCreators": r["new_creators"], "requests": r["requests"], "yield": _load(r["yield_json"], {}),
            }
            for r in rows
        ]

    # ── snowball seed queue ─────────────────────────────────────────────────

    def enqueue_seeds(self, platform: str, handles: Iterable[str], *, reason: str = "", priority: int = 0,
                      recrawl_after_days: int = 7) -> int:
        stamp = now_iso()
        cutoff = now_iso(time.time() - recrawl_after_days * 86400)
        added = 0
        with self._connect() as conn:
            for raw in handles:
                handle = clean_handle(raw)
                if not canonical(handle):
                    continue
                row = conn.execute(
                    "SELECT crawled_at, priority FROM creator_seed_queue WHERE platform = ? AND handle = ?",
                    (platform_key(platform), handle),
                ).fetchone()
                if row is None:
                    conn.execute(
                        "INSERT INTO creator_seed_queue (platform, handle, priority, reason, enqueued_at) VALUES (?,?,?,?,?)",
                        (platform_key(platform), handle, priority, reason[:80], stamp),
                    )
                    added += 1
                elif row["crawled_at"] is not None and row["crawled_at"] < cutoff:
                    conn.execute(
                        "UPDATE creator_seed_queue SET crawled_at = NULL, priority = ?, enqueued_at = ? "
                        "WHERE platform = ? AND handle = ?",
                        (priority, stamp, platform_key(platform), handle),
                    )
                    added += 1
                elif row["crawled_at"] is None and priority > row["priority"]:
                    conn.execute(
                        "UPDATE creator_seed_queue SET priority = ? WHERE platform = ? AND handle = ?",
                        (priority, platform_key(platform), handle),
                    )
            conn.commit()
        return added

    def next_seeds(self, platform: str, limit: int) -> list[str]:
        with self._connect() as conn:
            # a creator removed by a takedown is never fetched again, not even to refresh its catalog
            rows = conn.execute(
                "SELECT handle FROM creator_seed_queue q WHERE platform = ? AND crawled_at IS NULL "
                "AND NOT EXISTS (SELECT 1 FROM creator_suppressions s WHERE s.kind = 'creator' "
                "AND s.platform = q.platform AND s.handle = q.handle) "
                "ORDER BY priority DESC, enqueued_at ASC LIMIT ?",
                (platform_key(platform), max(0, limit)),
            ).fetchall()
        return [r["handle"] for r in rows]

    def mark_seed_crawled(self, platform: str, handle: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE creator_seed_queue SET crawled_at = ? WHERE platform = ? AND handle = ?",
                (now_iso(), platform_key(platform), clean_handle(handle)),
            )
            conn.commit()

    def known_handles(self, platform: str, handles: Iterable[str]) -> set[str]:
        wanted = [clean_handle(h) for h in handles]
        if not wanted:
            return set()
        found: set[str] = set()
        with self._connect() as conn:
            for i in range(0, len(wanted), 400):
                chunk = wanted[i : i + 400]
                marks = ",".join("?" for _ in chunk)
                found |= {
                    r["handle"]
                    for r in conn.execute(
                        f"SELECT handle FROM creator_index WHERE platform = ? AND handle IN ({marks})",
                        [platform_key(platform), *chunk],
                    )
                }
        return found
