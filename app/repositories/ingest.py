"""Durable ingestion queue + media asset registry (SQLite).

Additive schema only (CREATE TABLE/INDEX IF NOT EXISTS): safe to apply on top
of an existing production database. Patterns follow ``outbox.py`` — a tiny
store over a connection factory, atomic claim, exponential backoff with
jitter, idempotency keys.

Job states: queued -> running -> succeeded | failed | cancelled.
A retryable failure puts the job back to ``queued`` with ``next_run_at`` in
the future until ``max_attempts`` is exhausted.
"""

from __future__ import annotations

import json
import random
import sqlite3
import time
import uuid
from contextlib import AbstractContextManager
from typing import Any, Callable

INGEST_DDL = """
CREATE TABLE IF NOT EXISTS ingest_jobs (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  idempotency_key  TEXT,
  request_hash     TEXT,
  dedupe_key       TEXT,
  payload_json     TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'queued',
  stage            TEXT,
  progress         INTEGER NOT NULL DEFAULT 0,
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  next_run_at      REAL NOT NULL,
  locked_by        TEXT,
  locked_at        REAL,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  error_code       TEXT,
  error_message    TEXT,
  result_json      TEXT,
  created_at       REAL NOT NULL,
  updated_at       REAL NOT NULL,
  started_at       REAL,
  finished_at      REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_jobs_idem
  ON ingest_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_ready ON ingest_jobs(state, next_run_at);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_dedupe ON ingest_jobs(dedupe_key, state);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_created ON ingest_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS ingest_job_events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id    TEXT NOT NULL REFERENCES ingest_jobs(id) ON DELETE CASCADE,
  ts        REAL NOT NULL,
  stage     TEXT,
  level     TEXT NOT NULL DEFAULT 'info',
  message   TEXT NOT NULL,
  progress  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ingest_events_job ON ingest_job_events(job_id, id);

CREATE TABLE IF NOT EXISTS media_assets (
  id               TEXT PRIMARY KEY,
  screenshot_id    INTEGER,
  kind             TEXT NOT NULL,
  title            TEXT,
  canonical_url    TEXT,
  source_url       TEXT,
  origin           TEXT,
  sha256           TEXT,
  phash            TEXT,
  dhash            TEXT,
  width            INTEGER,
  height           INTEGER,
  aspect           REAL,
  duration_seconds REAL,
  mime_type        TEXT,
  codec            TEXT,
  has_audio        INTEGER,
  bitrate          INTEGER,
  dominant_color   TEXT,
  lqip             TEXT,
  media_path       TEXT,
  thumb_path       TEXT,
  poster_path      TEXT,
  preview_path     TEXT,
  sprite_path      TEXT,
  sprite_grid_json TEXT,
  hls_path         TEXT,
  gallery_json     TEXT,
  faststart        INTEGER,
  needs_transcode  INTEGER,
  pipeline_json    TEXT,
  status           TEXT NOT NULL DEFAULT 'ready',
  dup_of           TEXT,
  created_at       REAL NOT NULL,
  updated_at       REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_assets_sha ON media_assets(sha256);
CREATE INDEX IF NOT EXISTS idx_media_assets_canonical ON media_assets(canonical_url);
CREATE INDEX IF NOT EXISTS idx_media_assets_shot ON media_assets(screenshot_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_phash ON media_assets(phash) WHERE phash IS NOT NULL;

CREATE TABLE IF NOT EXISTS media_asset_dupes (
  asset_id   TEXT NOT NULL,
  other_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  distance   INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL,
  PRIMARY KEY (asset_id, other_id)
);
"""

ACTIVE_STATES = ("queued", "running")
TERMINAL_STATES = ("succeeded", "failed", "cancelled")

ConnectFactory = Callable[[], AbstractContextManager[sqlite3.Connection]]


def ensure_ingest_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(INGEST_DDL)
    conn.commit()


def backoff_seconds(attempts: int, *, base: float = 5.0, cap: float = 900.0, rng: random.Random | None = None) -> float:
    """Exponential backoff with +-25% jitter. `attempts` is the number of
    attempts already made (>=1)."""
    r = rng or random
    raw = min(cap, base * (2 ** max(0, attempts - 1)))
    return raw * r.uniform(0.75, 1.25)


def _load(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except ValueError:
        return None


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def job_row_to_dict(row: sqlite3.Row, events: list[dict] | None = None) -> dict[str, Any]:
    """Public, poll/SSE-friendly job shape."""
    error = None
    if row["error_code"] or row["error_message"]:
        error = {"code": row["error_code"], "message": row["error_message"]}
    out = {
        "id": row["id"],
        "kind": row["kind"],
        "state": row["state"],
        "stage": row["stage"],
        "progress": row["progress"],
        "attempts": row["attempts"],
        "maxAttempts": row["max_attempts"],
        "cancelRequested": bool(row["cancel_requested"]),
        "error": error,
        "result": _load(row["result_json"]),
        "payload": _public_payload(_load(row["payload_json"])),
        "createdAt": _iso(row["created_at"]),
        "updatedAt": _iso(row["updated_at"]),
        "startedAt": _iso(row["started_at"]),
        "finishedAt": _iso(row["finished_at"]),
        "nextRunAt": _iso(row["next_run_at"]) if row["state"] == "queued" else None,
        "terminal": row["state"] in TERMINAL_STATES,
    }
    if events is not None:
        out["events"] = events
    return out


def _public_payload(payload: Any) -> Any:
    """Never leak server-side file paths to API clients."""
    if not isinstance(payload, dict):
        return payload
    out = {k: v for k, v in payload.items() if k not in {"path", "tmpPath"}}
    if isinstance(out.get("files"), list):
        out["files"] = [
            {k: v for k, v in f.items() if k != "path"} if isinstance(f, dict) else f for f in out["files"]
        ]
    return out


class IngestStore:
    def __init__(self, connect: ConnectFactory):
        self._connect = connect

    # ---- jobs -----------------------------------------------------------

    def enqueue(
        self,
        kind: str,
        payload: dict[str, Any],
        *,
        idempotency_key: str | None = None,
        request_hash: str | None = None,
        dedupe_key: str | None = None,
        max_attempts: int = 3,
        run_at: float | None = None,
    ) -> tuple[dict[str, Any], bool, bool]:
        """Insert a job. Returns (job, created, key_conflict).

        * same idempotency key + same request -> existing job, created=False
        * same idempotency key + different request -> existing job, key_conflict=True
        * an active job with the same dedupe key -> that job, created=False
        """
        now = time.time()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                if idempotency_key:
                    row = conn.execute("SELECT * FROM ingest_jobs WHERE idempotency_key = ?", (idempotency_key,)).fetchone()
                    if row is not None:
                        conflict = bool(request_hash and row["request_hash"] and row["request_hash"] != request_hash)
                        conn.execute("COMMIT")
                        return job_row_to_dict(row), False, conflict
                if dedupe_key:
                    row = conn.execute(
                        "SELECT * FROM ingest_jobs WHERE dedupe_key = ? AND state IN ('queued','running')"
                        " ORDER BY created_at LIMIT 1",
                        (dedupe_key,),
                    ).fetchone()
                    if row is not None:
                        conn.execute("COMMIT")
                        return job_row_to_dict(row), False, False
                job_id = uuid.uuid4().hex
                conn.execute(
                    "INSERT INTO ingest_jobs (id, kind, idempotency_key, request_hash, dedupe_key, payload_json,"
                    " state, progress, attempts, max_attempts, next_run_at, created_at, updated_at)"
                    " VALUES (?,?,?,?,?,?, 'queued', 0, 0, ?, ?, ?, ?)",
                    (job_id, kind, idempotency_key, request_hash, dedupe_key, json.dumps(payload, separators=(",", ":")),
                     max_attempts, run_at or now, now, now),
                )
                self._event(conn, job_id, "queued", "info", "Job queued", 0, now)
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            row = conn.execute("SELECT * FROM ingest_jobs WHERE id = ?", (job_id,)).fetchone()
            return job_row_to_dict(row), True, False

    @staticmethod
    def _event(conn: sqlite3.Connection, job_id: str, stage: str | None, level: str, message: str, progress: int | None, ts: float) -> None:
        conn.execute(
            "INSERT INTO ingest_job_events (job_id, ts, stage, level, message, progress) VALUES (?,?,?,?,?,?)",
            (job_id, ts, stage, level, message[:500], progress),
        )

    def get(self, job_id: str, *, with_events: bool = False) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM ingest_jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                return None
            events = self._events(conn, job_id) if with_events else None
            return job_row_to_dict(row, events)

    def get_raw_payload(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT payload_json FROM ingest_jobs WHERE id = ?", (job_id,)).fetchone()
            return _load(row["payload_json"]) if row else None

    @staticmethod
    def _events(conn: sqlite3.Connection, job_id: str, after_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        rows = conn.execute(
            "SELECT id, ts, stage, level, message, progress FROM ingest_job_events WHERE job_id = ? AND id > ?"
            " ORDER BY id LIMIT ?",
            (job_id, after_id, limit),
        ).fetchall()
        return [
            {"id": r["id"], "at": _iso(r["ts"]), "stage": r["stage"], "level": r["level"], "message": r["message"], "progress": r["progress"]}
            for r in rows
        ]

    def events(self, job_id: str, after_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        with self._connect() as conn:
            return self._events(conn, job_id, after_id, limit)

    def list(self, *, state: str | None = None, limit: int = 30, before: float | None = None) -> list[dict[str, Any]]:
        clauses, params = [], []
        if state:
            clauses.append("state = ?")
            params.append(state)
        if before:
            clauses.append("created_at < ?")
            params.append(before)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM ingest_jobs {where} ORDER BY created_at DESC LIMIT ?", (*params, max(1, min(limit, 100)))
            ).fetchall()
            return [job_row_to_dict(r) for r in rows]

    def counts(self) -> dict[str, int]:
        with self._connect() as conn:
            rows = conn.execute("SELECT state, COUNT(*) AS n FROM ingest_jobs GROUP BY state").fetchall()
        out = {s: 0 for s in ("queued", "running", "succeeded", "failed", "cancelled")}
        out.update({r["state"]: r["n"] for r in rows})
        return out

    def claim_next(self, worker_id: str, now: float | None = None) -> dict[str, Any] | None:
        """Atomically move the oldest due queued job to running."""
        now = now or time.time()
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute(
                    "SELECT * FROM ingest_jobs WHERE state = 'queued' AND next_run_at <= ? AND cancel_requested = 0"
                    " ORDER BY next_run_at, created_at LIMIT 1",
                    (now,),
                ).fetchone()
                if row is None:
                    conn.execute("COMMIT")
                    return None
                conn.execute(
                    "UPDATE ingest_jobs SET state='running', attempts = attempts + 1, locked_by = ?, locked_at = ?,"
                    " started_at = COALESCE(started_at, ?), updated_at = ?, stage = 'starting' WHERE id = ?",
                    (worker_id, now, now, now, row["id"]),
                )
                self._event(conn, row["id"], "starting", "info", f"Attempt {row['attempts'] + 1} started", row["progress"], now)
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            fresh = conn.execute("SELECT * FROM ingest_jobs WHERE id = ?", (row["id"],)).fetchone()
            return job_row_to_dict(fresh)

    def progress(self, job_id: str, stage: str, progress: int, message: str | None = None, level: str = "info") -> None:
        now = time.time()
        progress = max(0, min(100, int(progress)))
        with self._connect() as conn:
            conn.execute(
                "UPDATE ingest_jobs SET stage = ?, progress = MAX(progress, ?), updated_at = ?, locked_at = ? WHERE id = ?",
                (stage, progress, now, now, job_id),
            )
            if message:
                self._event(conn, job_id, stage, level, message, progress, now)
            conn.commit()

    def succeed(self, job_id: str, result: dict[str, Any]) -> None:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "UPDATE ingest_jobs SET state='succeeded', progress=100, stage='done', result_json=?, error_code=NULL,"
                " error_message=NULL, finished_at=?, updated_at=?, locked_by=NULL, locked_at=NULL WHERE id=?",
                (json.dumps(result, separators=(",", ":")), now, now, job_id),
            )
            self._event(conn, job_id, "done", "info", "Completed", 100, now)
            conn.commit()

    def fail(self, job_id: str, code: str, message: str, *, retryable: bool, rng: random.Random | None = None) -> str:
        """Record a failure; returns the resulting state (queued for a retry,
        failed when permanent or attempts exhausted)."""
        now = time.time()
        with self._connect() as conn:
            row = conn.execute("SELECT attempts, max_attempts, cancel_requested FROM ingest_jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                return "failed"
            if row["cancel_requested"]:
                return self._finish_cancel(conn, job_id, now)
            if retryable and row["attempts"] < row["max_attempts"]:
                delay = backoff_seconds(row["attempts"], rng=rng)
                conn.execute(
                    "UPDATE ingest_jobs SET state='queued', next_run_at=?, error_code=?, error_message=?, updated_at=?,"
                    " locked_by=NULL, locked_at=NULL WHERE id=?",
                    (now + delay, code, message[:500], now, job_id),
                )
                self._event(conn, job_id, "retry", "warn", f"{code}: {message[:200]} (retry in {int(delay)}s)", None, now)
                conn.commit()
                return "queued"
            conn.execute(
                "UPDATE ingest_jobs SET state='failed', error_code=?, error_message=?, finished_at=?, updated_at=?,"
                " locked_by=NULL, locked_at=NULL WHERE id=?",
                (code, message[:500], now, now, job_id),
            )
            self._event(conn, job_id, "failed", "error", f"{code}: {message[:300]}", None, now)
            conn.commit()
            return "failed"

    def _finish_cancel(self, conn: sqlite3.Connection, job_id: str, now: float) -> str:
        conn.execute(
            "UPDATE ingest_jobs SET state='cancelled', finished_at=?, updated_at=?, locked_by=NULL, locked_at=NULL WHERE id=?",
            (now, now, job_id),
        )
        self._event(conn, job_id, "cancelled", "warn", "Cancelled", None, now)
        conn.commit()
        return "cancelled"

    def mark_cancelled(self, job_id: str) -> None:
        with self._connect() as conn:
            self._finish_cancel(conn, job_id, time.time())

    def request_cancel(self, job_id: str) -> dict[str, Any] | None:
        """Queued jobs cancel immediately; running ones flip a flag the worker
        polls; terminal jobs are returned unchanged."""
        now = time.time()
        with self._connect() as conn:
            row = conn.execute("SELECT state FROM ingest_jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                return None
            if row["state"] == "queued":
                conn.execute("UPDATE ingest_jobs SET cancel_requested = 1 WHERE id = ?", (job_id,))
                self._finish_cancel(conn, job_id, now)
            elif row["state"] == "running":
                conn.execute("UPDATE ingest_jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?", (now, job_id))
                self._event(conn, job_id, "cancel", "warn", "Cancellation requested", None, now)
                conn.commit()
        return self.get(job_id)

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute("SELECT cancel_requested FROM ingest_jobs WHERE id = ?", (job_id,)).fetchone()
            return bool(row and row["cancel_requested"])

    def retry(self, job_id: str) -> dict[str, Any] | None:
        """Manually re-queue a failed/cancelled job with a fresh attempt budget."""
        now = time.time()
        with self._connect() as conn:
            row = conn.execute("SELECT state FROM ingest_jobs WHERE id = ?", (job_id,)).fetchone()
            if row is None:
                return None
            if row["state"] in ("failed", "cancelled"):
                conn.execute(
                    "UPDATE ingest_jobs SET state='queued', attempts=0, progress=0, cancel_requested=0, error_code=NULL,"
                    " error_message=NULL, finished_at=NULL, next_run_at=?, updated_at=?, idempotency_key=NULL WHERE id=?",
                    (now, now, job_id),
                )
                self._event(conn, job_id, "queued", "info", "Re-queued manually", 0, now)
                conn.commit()
        return self.get(job_id)

    def recover_stale(self, lock_timeout: float = 900.0) -> int:
        """Return jobs abandoned by a crashed worker to the queue."""
        now = time.time()
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id FROM ingest_jobs WHERE state='running' AND COALESCE(locked_at, started_at, 0) < ?", (now - lock_timeout,)
            ).fetchall()
            for r in rows:
                conn.execute(
                    "UPDATE ingest_jobs SET state='queued', locked_by=NULL, locked_at=NULL, next_run_at=?, updated_at=? WHERE id=?",
                    (now, now, r["id"]),
                )
                self._event(conn, r["id"], "recovered", "warn", "Recovered after worker interruption", None, now)
            conn.commit()
            return len(rows)

    def purge_finished(self, older_than_seconds: float = 30 * 86400) -> int:
        cutoff = time.time() - older_than_seconds
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM ingest_jobs WHERE state IN ('succeeded','failed','cancelled') AND finished_at < ?", (cutoff,)
            )
            conn.commit()
            return cur.rowcount

    # ---- assets ---------------------------------------------------------

    _ASSET_COLUMNS = (
        "screenshot_id", "kind", "title", "canonical_url", "source_url", "origin", "sha256", "phash", "dhash", "width",
        "height", "aspect", "duration_seconds", "mime_type", "codec", "has_audio", "bitrate", "dominant_color", "lqip",
        "media_path", "thumb_path", "poster_path", "preview_path", "sprite_path", "sprite_grid_json", "hls_path",
        "gallery_json", "faststart", "needs_transcode", "pipeline_json", "status", "dup_of",
    )

    def insert_asset(self, asset_id: str, values: dict[str, Any]) -> None:
        now = time.time()
        cols = [c for c in self._ASSET_COLUMNS if c in values]
        unknown = set(values) - set(self._ASSET_COLUMNS)
        if unknown:
            raise ValueError(f"unknown asset columns: {sorted(unknown)}")
        with self._connect() as conn:
            conn.execute(
                f"INSERT INTO media_assets (id, {', '.join(cols)}, created_at, updated_at)"
                f" VALUES (?, {', '.join('?' for _ in cols)}, ?, ?)",
                (asset_id, *[values[c] for c in cols], now, now),
            )
            conn.commit()

    def update_asset(self, asset_id: str, values: dict[str, Any]) -> None:
        cols = [c for c in self._ASSET_COLUMNS if c in values]
        if not cols:
            return
        with self._connect() as conn:
            conn.execute(
                f"UPDATE media_assets SET {', '.join(f'{c} = ?' for c in cols)}, updated_at = ? WHERE id = ?",
                (*[values[c] for c in cols], time.time(), asset_id),
            )
            conn.commit()

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM media_assets WHERE id = ?", (asset_id,)).fetchone()
            return dict(row) if row else None

    def find_asset(self, *, sha256: str | None = None, canonical_url: str | None = None) -> dict[str, Any] | None:
        with self._connect() as conn:
            if sha256:
                row = conn.execute("SELECT * FROM media_assets WHERE sha256 = ? AND status != 'deleted' ORDER BY created_at LIMIT 1", (sha256,)).fetchone()
                if row:
                    return dict(row)
            if canonical_url:
                row = conn.execute(
                    "SELECT * FROM media_assets WHERE canonical_url = ? AND status != 'deleted' ORDER BY created_at LIMIT 1", (canonical_url,)
                ).fetchone()
                if row:
                    return dict(row)
        return None

    def assets_for_screenshots(self, shot_ids: list[int]) -> dict[int, dict[str, Any]]:
        if not shot_ids:
            return {}
        out: dict[int, dict[str, Any]] = {}
        with self._connect() as conn:
            for i in range(0, len(shot_ids), 500):
                chunk = shot_ids[i : i + 500]
                rows = conn.execute(
                    f"SELECT * FROM media_assets WHERE screenshot_id IN ({','.join('?' for _ in chunk)}) AND status != 'deleted'", chunk
                ).fetchall()
                for r in rows:
                    out[int(r["screenshot_id"])] = dict(r)
        return out

    def phash_index(self, limit: int = 50_000) -> list[tuple[str, str | None]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, phash FROM media_assets WHERE phash IS NOT NULL AND status != 'deleted' ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [(r["id"], r["phash"]) for r in rows]

    def add_dupe(self, asset_id: str, other_id: str, kind: str, distance: int) -> None:
        if asset_id == other_id:
            return
        a, b = sorted((asset_id, other_id))
        with self._connect() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO media_asset_dupes (asset_id, other_id, kind, distance, created_at) VALUES (?,?,?,?,?)",
                (a, b, kind, distance, time.time()),
            )
            conn.commit()

    def dupes_of(self, asset_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT asset_id, other_id, kind, distance FROM media_asset_dupes WHERE asset_id = ? OR other_id = ? ORDER BY distance",
                (asset_id, asset_id),
            ).fetchall()
        return [
            {"assetId": r["other_id"] if r["asset_id"] == asset_id else r["asset_id"], "kind": r["kind"], "distance": r["distance"]}
            for r in rows
        ]
