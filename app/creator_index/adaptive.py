"""Adaptive crawling state: per-lane yield with exponential back-off, the persisted related-tag
frequency table (tag snowballing) and runtime-discovered lanes (niches, communities, promoted tags).

Yield = new creators per request. A lane that attempted work in a run but found no new creator
counts a "zero run"; after ``after`` consecutive zero runs it is skipped for
``base_hours * 2 ** (zero_runs - after)`` hours (capped at ``max_hours``). Any new creator resets it,
so a lane that goes quiet is retried less and less often but is never abandoned for good.
"""

from __future__ import annotations

import json
import sqlite3
import time
from typing import Any, Callable, ContextManager, Iterable

from app.creator_index.repository import now_iso


class AdaptiveStore:
    def __init__(self, connect: Callable[[], ContextManager[sqlite3.Connection]]):
        self._connect = connect

    # ── lane yield / back-off ────────────────────────────────────────────────

    def backed_off(self, source: str, now: float | None = None) -> set[str]:
        stamp = now_iso(now)
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT lane_key FROM creator_lane_stats WHERE source = ? AND backoff_until IS NOT NULL AND backoff_until > ?",
                (source, stamp),
            ).fetchall()
        return {r[0] for r in rows}

    def record_lane_runs(
        self, source: str, results: dict[str, tuple[int, int]], *, now: float | None = None,
        after: int = 3, base_hours: float = 3.0, max_hours: float = 168.0,
    ) -> dict[str, str]:
        """Fold one run's per-lane ``(requests, new_creators)`` into the stats.

        Returns ``{lane_key: backoff_until}`` for the lanes that are now backed off."""
        ts = time.time() if now is None else now
        stamp = now_iso(ts)
        entered: dict[str, str] = {}
        with self._connect() as conn:
            for key, (requests, new) in results.items():
                row = conn.execute("SELECT * FROM creator_lane_stats WHERE lane_key = ?", (key,)).fetchone()
                runs = (row["runs"] if row else 0) + 1
                total_req = (row["requests"] if row else 0) + max(0, requests)
                total_new = (row["new_creators"] if row else 0) + max(0, new)
                last_new = row["last_new_at"] if row else None
                if new > 0:
                    zero_runs, backoff, last_new = 0, None, stamp
                else:
                    zero_runs = (row["zero_runs"] if row else 0) + 1
                    backoff = None
                    if zero_runs >= max(1, after):
                        hours = min(max_hours, base_hours * (2 ** min(30, zero_runs - max(1, after))))
                        backoff = now_iso(ts + hours * 3600)
                        entered[key] = backoff
                conn.execute(
                    "INSERT INTO creator_lane_stats (lane_key, source, runs, requests, new_creators, zero_runs, "
                    "last_run_at, last_new_at, backoff_until) VALUES (?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(lane_key) DO UPDATE SET runs = excluded.runs, requests = excluded.requests, "
                    "new_creators = excluded.new_creators, zero_runs = excluded.zero_runs, "
                    "last_run_at = excluded.last_run_at, last_new_at = excluded.last_new_at, "
                    "backoff_until = excluded.backoff_until",
                    (key, source, runs, total_req, total_new, zero_runs, stamp, last_new, backoff),
                )
            conn.commit()
        return entered

    def lane_stats(self, *, source: str | None = None, limit: int = 100, only_backed_off: bool = False) -> list[dict[str, Any]]:
        clauses, params = ["1=1"], []
        if source:
            clauses.append("source = ?")
            params.append(source)
        if only_backed_off:
            clauses.append("backoff_until IS NOT NULL AND backoff_until > ?")
            params.append(now_iso())
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM creator_lane_stats WHERE {' AND '.join(clauses)} "
                "ORDER BY zero_runs DESC, requests DESC, lane_key LIMIT ?",
                [*params, max(1, min(500, limit))],
            ).fetchall()
        return [
            {
                "lane": r["lane_key"], "source": r["source"], "runs": r["runs"], "requests": r["requests"],
                "newCreators": r["new_creators"], "zeroRuns": r["zero_runs"], "lastRunAt": r["last_run_at"],
                "lastNewAt": r["last_new_at"], "backoffUntil": r["backoff_until"],
                "yieldPerRequest": round(r["new_creators"] / r["requests"], 3) if r["requests"] else 0.0,
            }
            for r in rows
        ]

    def reset_lane(self, lane_key: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE creator_lane_stats SET zero_runs = 0, backoff_until = NULL WHERE lane_key = ?", (lane_key,)
            )
            conn.commit()
            return cur.rowcount > 0

    # ── related-tag frequency (snowballing) ──────────────────────────────────

    def bump_tags(self, platform: str, tag_counts: dict[str, int], *, now: float | None = None) -> None:
        stamp = now_iso(now)
        with self._connect() as conn:
            for tag, items in tag_counts.items():
                conn.execute(
                    "INSERT INTO creator_tag_freq (platform, tag, items, sightings, first_seen_at, last_seen_at) "
                    "VALUES (?,?,?,?,?,?) ON CONFLICT(platform, tag) DO UPDATE SET "
                    "items = items + excluded.items, sightings = sightings + 1, last_seen_at = excluded.last_seen_at",
                    (platform, tag, max(1, int(items)), 1, stamp, stamp),
                )
            conn.commit()

    def tag_candidates(self, platform: str, *, min_items: int, limit: int) -> list[tuple[str, int]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT tag, items FROM creator_tag_freq WHERE platform = ? AND promoted_at IS NULL AND items >= ? "
                "ORDER BY items DESC, tag LIMIT ?",
                (platform, max(1, min_items), max(1, min(500, limit))),
            ).fetchall()
        return [(r[0], r[1]) for r in rows]

    def mark_promoted(self, platform: str, tag: str, *, now: float | None = None) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE creator_tag_freq SET promoted_at = ? WHERE platform = ? AND tag = ?",
                (now_iso(now), platform, tag),
            )
            conn.commit()

    def tag_frequencies(self, platform: str, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT tag, items, sightings, promoted_at FROM creator_tag_freq WHERE platform = ? "
                "ORDER BY items DESC, tag LIMIT ?",
                (platform, max(1, min(500, limit))),
            ).fetchall()
        return [{"tag": r[0], "items": r[1], "sightings": r[2], "promotedAt": r[3]} for r in rows]

    # ── discovered lanes ─────────────────────────────────────────────────────

    def upsert_lane(self, source: str, lane_key: str, kind: str, payload: dict[str, Any], *, score: int = 0,
                    now: float | None = None) -> bool:
        """Insert or refresh a discovered lane; True when it is new."""
        stamp = now_iso(now)
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM creator_discovered_lanes WHERE source = ? AND lane_key = ?", (source, lane_key)
            ).fetchone()
            conn.execute(
                "INSERT INTO creator_discovered_lanes (source, lane_key, kind, payload_json, score, created_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?) ON CONFLICT(source, lane_key) DO UPDATE SET payload_json = excluded.payload_json, "
                "score = excluded.score, updated_at = excluded.updated_at",
                (source, lane_key, kind, json.dumps(payload, separators=(",", ":")), int(score), stamp, stamp),
            )
            conn.commit()
        return row is None

    def discovered_lanes(self, source: str, kind: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        """Oldest first, so appended units keep stable cursor positions as lanes are added."""
        clauses, params = ["source = ?"], [source]
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT lane_key, kind, payload_json, score, created_at FROM creator_discovered_lanes "
                f"WHERE {' AND '.join(clauses)} ORDER BY created_at ASC, lane_key ASC LIMIT ?",
                [*params, max(1, min(500, limit))],
            ).fetchall()
        out = []
        for r in rows:
            try:
                payload = json.loads(r["payload_json"])
            except ValueError:
                payload = {}
            out.append({"lane": r["lane_key"], "kind": r["kind"], "payload": payload if isinstance(payload, dict) else {},
                        "score": r["score"], "createdAt": r["created_at"]})
        return out

    def count_lanes(self, source: str, kind: str | None = None) -> int:
        clauses, params = ["source = ?"], [source]
        if kind:
            clauses.append("kind = ?")
            params.append(kind)
        with self._connect() as conn:
            return int(conn.execute(
                f"SELECT COUNT(*) FROM creator_discovered_lanes WHERE {' AND '.join(clauses)}", params
            ).fetchone()[0])

    def delete_lane(self, source: str, lane_key: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM creator_discovered_lanes WHERE source = ? AND lane_key = ?", (source, lane_key))
            conn.commit()
