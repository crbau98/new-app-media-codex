from __future__ import annotations

import asyncio
import logging
import os
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
import threading
import time
from threading import Lock
from typing import Any, Callable

from app.config import Settings
from app.db import Database
from app.performer_identity import normalize_identity_alias

logger = logging.getLogger(__name__)

# Max concurrent source fetches per crawl theme (cap to avoid rate-limit bans)
_CRAWL_PARALLEL_WORKERS = 4
def item_snapshot(item: Any) -> dict[str, Any]:
    return {
        "source_type": item.source_type,
        "theme": item.theme,
        "query": item.query,
        "title": item.title,
        "url": item.url,
        "summary": item.summary,
        "content": item.content,
        "author": item.author,
        "published_at": item.published_at,
        "domain": item.domain,
        "image_url": item.image_url,
        "score": item.score,
        "compounds": item.compounds,
        "mechanisms": item.mechanisms,
        "metadata": item.metadata,
    }


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _run_queue_worker(app_state: Any, stop_event: threading.Event) -> None:
    """Daemon thread: process capture_queue one entry at a time."""
    from app.api.performers import _run_performer_capture
    db = app_state.db
    while not stop_event.is_set():
        with db.connect() as conn:
            row = conn.execute(
                """SELECT cq.id, cq.performer_id, p.username, p.display_name, p.platform
                   FROM capture_queue cq JOIN performers p ON cq.performer_id = p.id
                   WHERE cq.status = 'queued'
                   ORDER BY cq.created_at ASC LIMIT 1"""
            ).fetchone()
        if not row:
            stop_event.wait(2)
            continue
        entry_id = row["id"]
        performer_id = row["performer_id"]
        db.update_queue_entry(entry_id, status="running", started_at=_utcnow())
        try:
            captured = _run_performer_capture(
                app_state,
                performer_id,
                row["username"],
                row["platform"],
                row["display_name"] or None,
            )
            db.update_queue_entry(
                entry_id,
                status="done",
                finished_at=_utcnow(),
                captured_count=captured,
            )
            db.backfill_screenshot_performers()
        except Exception as exc:
            logger.warning("queue-worker: error for performer %s: %s", performer_id, exc)
            db.update_queue_entry(
                entry_id,
                status="failed",
                finished_at=_utcnow(),
                error_msg=str(exc)[:200],
            )


def cache_image_record(session: Any, settings: Settings, image: dict[str, Any]) -> dict[str, Any]:
    from app.sources.base import cache_image

    record = dict(image)
    if settings.stream_only_media:
        return record
    if record.get("local_path"):
        return record
    target = record.get("image_url") or record.get("thumb_url") or ""
    if not target:
        return record
    thumb_path, orig_path = cache_image(session, settings, target)
    record["local_path"] = thumb_path
    record["original_path"] = orig_path
    return record


class ResearchService:
    def __init__(self, settings: Settings, db: Database) -> None:
        self.settings = settings
        self.db = db
        self.scheduler: Any | None = None
        self.lock = Lock()
        self.running = False
        self._progress_callbacks: list[Callable[[dict], Any]] = []
        self._callbacks_lock = Lock()
        self._queue_stop_event = threading.Event()
        self._queue_thread: threading.Thread | None = None
        self._seed_thread: threading.Thread | None = None
        self._dashboard_cache_ttl_seconds = 5.0
        self._dashboard_cache_expires_at = 0.0
        self._dashboard_cache_payload: dict[str, Any] | None = None
        self._dashboard_cache_lock = Lock()
        # source_key -> {successes, failures, last_success, last_failure, total_items, total_duration}
        self._source_metrics: dict[str, dict[str, Any]] = {}

    def add_progress_callback(self, cb: Callable[[dict], Any]) -> None:
        with self._callbacks_lock:
            self._progress_callbacks.append(cb)

    def remove_progress_callback(self, cb: Callable[[dict], Any]) -> None:
        with self._callbacks_lock:
            try:
                self._progress_callbacks.remove(cb)
            except ValueError:
                pass

    def _emit(self, event: dict) -> None:
        with self._callbacks_lock:
            callbacks = list(self._progress_callbacks)
        for cb in callbacks:
            try:
                cb(event)
            except Exception:
                pass

    def invalidate_dashboard_cache(self) -> None:
        with self._dashboard_cache_lock:
            self._dashboard_cache_payload = None
            self._dashboard_cache_expires_at = 0.0

    def _seed_default_performers(self) -> None:
        """Compatibility hook; performers are now discovered from live results.

        Keeping identities out of source avoids publishing a sensitive static
        roster and prevents stale seeds from outranking current source data.
        """
        logger.info("seed: static performer roster disabled; using live discovery")

    def start(self) -> None:
        # Clean up stale WAL/SHM files that cause disk I/O errors on network storage.
        # Only remove when we can acquire an exclusive lock — otherwise another process
        # may be using the DB and deletion would corrupt it.
        db_path = self.db.path
        can_delete_wal = False
        try:
            # Test exclusive lock via sqlite3 URI mode; fails if DB is busy
            import sqlite3
            test_conn = sqlite3.connect(f"file:{db_path}?mode=rwc", uri=True, timeout=1)
            test_conn.execute("PRAGMA locking_mode = EXCLUSIVE")
            test_conn.execute("BEGIN IMMEDIATE")
            test_conn.execute("COMMIT")
            test_conn.close()
            can_delete_wal = True
        except Exception:
            can_delete_wal = False
        for suffix in ["-wal", "-shm"]:
            wal_file = db_path.parent / (db_path.name + suffix)
            if wal_file.exists() and can_delete_wal:
                try:
                    wal_file.unlink()
                    logger.info("startup: removed stale %s", wal_file.name)
                except Exception as exc:
                    logger.warning("startup: could not remove %s: %s", wal_file.name, exc)
        self.db.init()
        try:
            repaired = self.db.repair_moved_repo_paths(self.settings.base_dir)
            if repaired:
                logger.info("startup: repaired %d moved local media paths", repaired)
        except Exception as exc:
            logger.warning("startup: path repair skipped: %s", exc)
        requeued = self.db.requeue_stale_running_entries()
        if requeued:
            logger.info("queue-worker: re-queued %d stale running capture entries", requeued)
        if self.running:
            return
        try:
            if self.scheduler is None:
                from apscheduler.schedulers.background import BackgroundScheduler

                self.scheduler = BackgroundScheduler(timezone="UTC")
            if not self.scheduler.get_job("research-crawl"):
                self.scheduler.add_job(
                    self.run_crawl,
                    "interval",
                    minutes=self.settings.crawl_interval_minutes,
                    next_run_time=(
                        datetime.now(timezone.utc) + timedelta(seconds=15)
                        if self.settings.run_startup_crawl
                        else None
                    ),
                    max_instances=1,
                    coalesce=True,
                    id="research-crawl",
                    replace_existing=True,
                )
            # Screenshot capture job - runs every 12 hours
            if not self.scheduler.get_job("screenshot-capture"):
                self.scheduler.add_job(
                    self._run_screenshot_capture,
                    "interval",
                    hours=12,
                    id="screenshot-capture",
                    replace_existing=True,
                    max_instances=1,
                )
            # Self-ping keepalive to prevent Render cold starts
            if not self.scheduler.get_job("keepalive-ping"):
                self.scheduler.add_job(
                    self._keepalive_ping,
                    "interval",
                    minutes=10,
                    id="keepalive-ping",
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                )
            # WAL checkpoint — keeps the WAL file from growing unbounded (1.4)
            if not self.scheduler.get_job("wal-checkpoint"):
                self.scheduler.add_job(
                    self.db.wal_checkpoint,
                    "interval",
                    hours=6,
                    id="wal-checkpoint",
                    replace_existing=True,
                    max_instances=1,
                    coalesce=True,
                )
            if not self.scheduler.running:
                self.scheduler.start()
        except Exception as exc:
            self.running = False
            logger.warning("service: scheduler startup failed: %s", exc)
            return

        # Start capture queue worker
        self._queue_stop_event.clear()
        self._queue_thread = threading.Thread(
            target=_run_queue_worker,
            args=(self, self._queue_stop_event),
            daemon=True,
            name="capture-queue-worker",
        )
        self._queue_thread.start()
        self.running = True
        self._seed_thread = threading.Thread(
            target=self._seed_default_performers,
            daemon=True,
            name="default-performer-seed",
        )
        self._seed_thread.start()

    def stop(self) -> None:
        self._queue_stop_event.set()
        if self.running and self.scheduler is not None:
            try:
                if self.scheduler.running:
                    self.scheduler.shutdown(wait=False)
            except Exception as exc:
                logger.warning("service: scheduler shutdown failed: %s", exc)
            finally:
                self.running = False

    def _record_source_metric(self, source_key: str, success: bool, items: int, duration: float) -> None:
        now = datetime.now(timezone.utc).isoformat()
        m = self._source_metrics.setdefault(source_key, {
            "successes": 0, "failures": 0, "last_success": "", "last_failure": "",
            "total_items": 0, "total_duration": 0.0, "runs": 0,
        })
        m["runs"] += 1
        m["total_items"] += items
        m["total_duration"] += duration
        if success:
            m["successes"] += 1
            m["last_success"] = now
        else:
            m["failures"] += 1
            m["last_failure"] = now

    def source_health_snapshot(self) -> list[dict[str, Any]]:
        snapshot: list[dict[str, Any]] = []
        for name, m in sorted(self._source_metrics.items()):
            runs = m["runs"]
            success_rate = round(m["successes"] / runs, 2) if runs else 1.0
            avg_items = round(m["total_items"] / runs, 1) if runs else 0.0
            avg_duration = round(m["total_duration"] / runs, 2) if runs else 0.0
            status = "healthy"
            if success_rate < 0.5:
                status = "unhealthy"
            elif success_rate < 0.8:
                status = "degraded"
            snapshot.append({
                "name": name,
                "status": status,
                "last_success": m["last_success"],
                "last_failure": m["last_failure"],
                "success_rate": success_rate,
                "avg_items_per_run": avg_items,
                "avg_duration_seconds": avg_duration,
            })
        return snapshot

    def run_crawl(self) -> dict[str, Any]:
        """Entry-point for sync callers (scheduler / background tasks)."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop is not None:
            # Already inside an event loop (e.g., tests) — use thread-safe helper
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(self._run_crawl_sync)
                return future.result()
        return self._run_crawl_sync()

    def _ensure_archiver_performer(self, item: Any | None) -> int | None:
        """Resolve a scraped creator to a durable performer row.

        Archiver post authors are the strongest identity signal available and
        should be attached during ingestion, not left for a fuzzy backfill.
        """
        if item is None:
            return None
        username = str(getattr(item, "author", "") or "").strip().lstrip("@")
        if not username:
            return None
        existing = self.db.get_performer_by_username(username)
        if existing:
            return int(existing["id"])

        metadata = item.metadata if isinstance(getattr(item, "metadata", None), dict) else {}
        platform = str(metadata.get("service") or "onlyfans").strip().lower() or "onlyfans"
        domain = str(getattr(item, "domain", "") or "").strip()
        profile_url = f"https://{domain}/{platform}/user/{username}" if domain else None
        try:
            performer = self.db.add_performer(
                username=username,
                platform=platform,
                display_name=username,
                profile_url=profile_url,
                avatar_url=(getattr(item, "image_url", "") or None),
                tags=[str(getattr(item, "theme", "") or "male creator")],
                discovered_via=f"{getattr(item, 'source_type', 'archiver')}_api",
            )
            return int(performer["id"])
        except Exception:
            # Another worker or an earlier alias may have inserted it between
            # lookup and insert. Re-read before giving up attribution.
            existing = self.db.get_performer_by_username(username)
            return int(existing["id"]) if existing else None

    def _run_crawl_sync(self) -> dict[str, Any]:
        return asyncio.run(self._run_crawl_async())

    async def _run_crawl_async(self) -> dict[str, Any]:
        from app.sources import (
            build_session,
            collect_boyfriendtv_theme,
            collect_fansly_theme,
            collect_firecrawl_images,
            collect_images,
            collect_instagram_theme,
            collect_justforfans_theme,
            collect_lpsg,
            collect_male_video_archiver,
            collect_reddit,
            collect_spankbang_theme,
            collect_x,
        )

        if not self.lock.acquire(blocking=False):
            return {"status": "busy"}

        run_id = self.db.start_run()
        session: Any | None = None
        notes: dict[str, Any] = {
            "errors": [],
            "collected": {"items": 0, "images": 0, "new_items": 0, "updated_items": 0},
            "sources": {},
        }
        try:
            self.invalidate_dashboard_cache()
            self._emit({"type": "crawl_start"})
            session = build_session(self.settings)
            for theme in self.settings.themes:
                theme_notes = notes["sources"].setdefault(
                    theme.slug,
                    {
                        "reddit": 0,
                        "x": 0,
                        "lpsg": 0,
                        "images": 0,
                        "spankbang": 0,
                        "boyfriendtv": 0,
                        "instagram": 0,
                        "fansly": 0,
                        "justforfans": 0,
                        "male_archiver": 0,
                    },
                )

                # ── Parallel social source collection ────────────────────────
                social_tasks = []
                social_keys = []
                for source_key, collector in (
                    ("reddit", collect_reddit),
                    ("x", collect_x),
                    ("lpsg", collect_lpsg),
                    ("male_archiver", collect_male_video_archiver),
                ):
                    self._emit({"type": "source_start", "source": source_key, "theme": theme.slug})
                    social_tasks.append(
                        asyncio.wait_for(
                            asyncio.to_thread(collector, session, self.settings, theme),
                            timeout=90.0 if source_key == "male_archiver" else 30.0,
                        )
                    )
                    social_keys.append(source_key)

                # Async-native new sources
                for source_key, collector in (
                    ("spankbang", collect_spankbang_theme),
                    ("boyfriendtv", collect_boyfriendtv_theme),
                    ("instagram", collect_instagram_theme),
                    ("fansly", collect_fansly_theme),
                    ("justforfans", collect_justforfans_theme),
                ):
                    self._emit({"type": "source_start", "source": source_key, "theme": theme.slug})
                    social_tasks.append(
                        asyncio.wait_for(
                            collector(self.settings, theme, self.db),
                            timeout=30.0,
                        )
                    )
                    social_keys.append(source_key)

                social_results = await asyncio.gather(*social_tasks, return_exceptions=True)

                for source_key, result in zip(social_keys, social_results):
                    start_time = time.monotonic()
                    if isinstance(result, Exception):
                        notes["errors"].append(f"{theme.slug}:{source_key}:{result}")
                        self._record_source_metric(source_key, success=False, items=0, duration=time.monotonic() - start_time)
                        continue
                    source_items, source_images = result
                    self._record_source_metric(source_key, success=True, items=len(source_items) + len(source_images), duration=time.monotonic() - start_time)
                    item_by_page = {item.url: item for item in source_items}
                    for image in source_images:
                        self.db.insert_image(cache_image_record(session, self.settings, image.__dict__))
                        notes["collected"]["images"] += 1
                        theme_notes["images"] += 1
                        if source_key == "male_archiver" and image.image_url:
                            owner = item_by_page.get(image.page_url)
                            performer_id = self._ensure_archiver_performer(owner) if owner else None
                            source_name = image.source_type.removesuffix("_image")
                            try:
                                self.db.insert_screenshot(
                                    term=(owner.author if owner and owner.author else image.title),
                                    source=source_name,
                                    page_url=image.image_url,
                                    local_path=None,
                                    performer_id=performer_id,
                                    source_url=image.image_url,
                                    thumbnail_url=image.thumb_url or image.image_url,
                                )
                            except Exception as exc:
                                notes["errors"].append(
                                    f"{theme.slug}:{source_name}_image_insert:{exc}"
                                )
                    for item in source_items:
                        record = item.to_record()
                        _, created = self.db.upsert_item(record, run_id)
                        notes["collected"]["new_items" if created else "updated_items"] += 1
                        theme_notes[source_key] += 1
                        if item.image_url:
                            self.db.insert_image(
                                cache_image_record(
                                    session,
                                    self.settings,
                                    {
                                        "source_type": f"{source_key}_image",
                                        "theme": item.theme,
                                        "title": item.title,
                                        "image_url": item.image_url,
                                        "page_url": item.url,
                                        "thumb_url": item.image_url,
                                        "local_path": "",
                                    },
                                ),
                            )
                        if source_key in {"reddit", "male_archiver"}:
                            videos = item.metadata.get("videos") if isinstance(item.metadata, dict) else None
                            performer_id = self._ensure_archiver_performer(item) if source_key == "male_archiver" else None
                            for video in videos or []:
                                video_url = (video or {}).get("source_url")
                                if not video_url:
                                    continue
                                try:
                                    self.db.insert_screenshot(
                                        term=item.author or item.title or source_key,
                                        source=item.source_type or source_key,
                                        # One post can contain many attachments. The
                                        # media URL is the stable unique identity;
                                        # using the post URL collapsed them into one.
                                        page_url=video_url,
                                        local_path=None,
                                        performer_id=performer_id,
                                        source_url=video_url,
                                        thumbnail_url=item.image_url or None,
                                    )
                                except Exception as exc:
                                    notes["errors"].append(
                                        f"{theme.slug}:{source_key}_video_insert:{exc}"
                                    )

                # ── DDG image search ─────────────────────────────────────────
                start_time = time.monotonic()
                try:
                    query_images = await asyncio.wait_for(
                        asyncio.to_thread(collect_images, session, self.settings, theme, theme.label),
                        timeout=30.0,
                    )
                    self._record_source_metric("images", success=True, items=len(query_images), duration=time.monotonic() - start_time)
                except Exception as exc:
                    notes["errors"].append(f"{theme.slug}:collect_images:{exc}")
                    self._record_source_metric("images", success=False, items=0, duration=time.monotonic() - start_time)
                    query_images = []
                for image in query_images:
                    self.db.insert_image(cache_image_record(session, self.settings, image.__dict__))
                    notes["collected"]["images"] += 1
                    theme_notes["images"] += 1

                # ── Firecrawl image scraping ─────────────────────────────────
                start_time = time.monotonic()
                try:
                    fc_images = await asyncio.wait_for(
                        asyncio.to_thread(collect_firecrawl_images, session, self.settings, theme),
                        timeout=30.0,
                    )
                    self._record_source_metric("firecrawl", success=True, items=len(fc_images), duration=time.monotonic() - start_time)
                except Exception as exc:
                    notes["errors"].append(f"{theme.slug}:collect_firecrawl_images:{exc}")
                    self._record_source_metric("firecrawl", success=False, items=0, duration=time.monotonic() - start_time)
                    fc_images = []
                for image in fc_images:
                    self.db.insert_image(cache_image_record(session, self.settings, image.__dict__))
                    notes["collected"]["images"] += 1
                    theme_notes["images"] += 1

            self.db.finish_run(run_id, "completed", notes)
            self.invalidate_dashboard_cache()
            self._emit({"type": "crawl_done", "items_added": notes["collected"]["images"]})
            return {"status": "completed", "run_id": run_id, "notes": notes}
        except Exception as exc:
            notes["errors"].append(str(exc))
            notes["traceback"] = traceback.format_exc(limit=5)
            self.db.finish_run(run_id, "failed", notes)
            self.invalidate_dashboard_cache()
            return {"status": "failed", "run_id": run_id, "notes": notes}
        finally:
            if session is not None:
                session.close()
            self.lock.release()

    @staticmethod
    def _keepalive_ping() -> None:
        """Ping the local healthz endpoint to prevent Render cold starts."""
        try:
            import requests

            port = int(os.environ.get("PORT", 8000))
            requests.get(f"http://127.0.0.1:{port}/healthz", timeout=5)
        except Exception:
            pass

    def _run_screenshot_capture(self) -> None:
        """Run screenshot capture for explicit terms + per-performer targeted capture."""
        from app.sources.screenshot import capture_screenshots
        from app.api.performers import _run_performer_capture
        from copy import copy as _copy
        from types import SimpleNamespace

        # Apply DB-configured vision settings so capture_screenshots uses the right key
        settings = self.settings
        user_settings = self.db.get_all_settings()
        if user_settings.get("vision_api_key"):
            settings = _copy(settings)
            settings.openai_api_key = user_settings["vision_api_key"]
            if user_settings.get("vision_base_url"):
                settings.openai_base_url = user_settings["vision_base_url"]
            if user_settings.get("vision_model"):
                settings.openai_model = user_settings["vision_model"]

        image_dir = Path(settings.image_dir).parent / "screenshots"
        captured = 0

        # Build a quick term→performer_id lookup from the DB once per run
        # Include username, display_name, and twitter_username as aliases
        performer_lookup: dict[str, int] = {}
        with self.db.connect() as conn:
            for row in conn.execute("SELECT id, username, display_name, twitter_username, reddit_username FROM performers").fetchall():
                performer_lookup[normalize_identity_alias(row["username"])] = row["id"]
                if row["display_name"]:
                    performer_lookup[normalize_identity_alias(row["display_name"])] = row["id"]
                if row["twitter_username"]:
                    performer_lookup[normalize_identity_alias(row["twitter_username"])] = row["id"]
                if row["reddit_username"]:
                    performer_lookup[normalize_identity_alias(row["reddit_username"])] = row["id"]

        # ── Phase 1: Term-based capture (TERM_QUERIES + CREATOR_QUERIES) ──────
        for result in capture_screenshots(image_dir, db=self.db, settings=settings):
            if result["ok"]:
                performer_id = performer_lookup.get(normalize_identity_alias(result["term"]))
                self.db.insert_screenshot(
                    term=result["term"],
                    source=result["source"],
                    page_url=result["page_url"],
                    local_path=result.get("local_path"),
                    performer_id=performer_id,
                    source_url=result.get("source_url"),
                    thumbnail_url=result.get("thumbnail_url"),
                )
                captured += 1

        # ── Phase 2: Per-performer capture for stale/unchecked performers ─────
        # Run for performers not checked in the last 3 days (up to 20 per cycle)
        with self.db.connect() as conn:
            stale = conn.execute(
                "SELECT id, username, display_name, platform FROM performers "
                "WHERE status != 'inactive' AND ("
                "   last_checked_at IS NULL OR "
                "   last_checked_at < datetime('now', '-3 days')"
                ") ORDER BY last_checked_at ASC NULLS FIRST LIMIT 20"
            ).fetchall()

        app_state = SimpleNamespace(db=self.db, settings=settings)
        for p in stale:
            try:
                n = _run_performer_capture(
                    app_state, p["id"], p["username"], p["platform"],
                    p["display_name"] if p["display_name"] else None,
                )
                captured += n
            except Exception as exc:
                logger.warning("service: performer capture error for %s: %s", p['username'], exc)

        from app.sources.screenshot import ingest_screenshots_as_items
        ingested = ingest_screenshots_as_items(self.db)
        linked = self.db.backfill_screenshot_performers()
        self.invalidate_dashboard_cache()
        logger.info(
            "service: screenshot capture done: %d new (%d performers refreshed), %d items ingested, %d auto-linked",
            captured, len(stale), ingested, linked,
        )

    def dashboard_payload(self) -> dict[str, Any]:
        now = time.monotonic()
        with self._dashboard_cache_lock:
            if self._dashboard_cache_payload is not None and now < self._dashboard_cache_expires_at:
                return self._dashboard_cache_payload

        last_run = self.db.get_last_run()
        last_completed_run = self.db.get_last_completed_run()
        payload = {
            "app_name": self.settings.app_name,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "interval_minutes": self.settings.crawl_interval_minutes,
            "stats": self.db.get_stats(),
            "last_run": last_run,
            "last_completed_run": last_completed_run,
            "recent_runs": self.db.get_recent_runs(limit=8),
            "review_queue": self.db.get_review_queue(limit=8),
            "items": self.db.get_recent_items(limit=36),
            "images": self.serialize_images(self.db.get_recent_images(limit=24)),
            "hypotheses": self.db.get_recent_hypotheses(limit=8),
            "themes": [{"slug": theme.slug, "label": theme.label} for theme in self.settings.themes],
            "source_types": ["literature", "anecdote", "reddit", "x", "lpsg", "pubmed", "biorxiv", "arxiv", "firecrawl", "spankbang", "boyfriendtv", "instagram", "fansly", "justforfans"],
            "review_status_options": ["new", "reviewing", "shortlisted", "archived"],
            "hypothesis_review_options": ["new", "reviewing", "promoted", "dismissed"],
            "image_source_types": [
                "image_search",
                "firecrawl_image",
                "page_image",
                "reddit_image",
                "x_image",
                "lpsg_image",
                "item_image",
                "spankbang_image",
                "boyfriendtv_image",
                "instagram_image",
                "fansly_image",
                "justforfans_image",
            ],
            "is_running": self.lock.locked(),
        }
        with self._dashboard_cache_lock:
            self._dashboard_cache_payload = payload
            self._dashboard_cache_expires_at = time.monotonic() + self._dashboard_cache_ttl_seconds
        return payload

    def serialize_images(self, images: list[dict[str, Any]]) -> list[dict[str, Any]]:
        serialized: list[dict[str, Any]] = []
        for image in images:
            payload = dict(image)
            image_url = str(payload.get("image_url") or "")
            if image_url.startswith(("http://", "https://")):
                payload["local_url"] = image_url
            else:
                payload["local_url"] = f"/cached-images/{Path(payload['local_path']).name}" if payload.get("local_path") else ""
            serialized.append(payload)
        return serialized
