from __future__ import annotations

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

    # ── Default creator seeds ─────────────────────────────────────────────────

    _DEFAULT_PERFORMERS = [
        # Explicitly mentioned by user — seeded automatically
        {"username": "jakipz",             "platform": "OnlyFans",  "display_name": "Jakipz",
         "tags": ["twink", "latino", "onlyfans"], "bio": "Gay OnlyFans creator @jakipz"},
        {"username": "hoguesdirtylaundry", "platform": "Twitter/X", "display_name": "Hogue",
         "tags": ["hairy", "bear", "twitter"], "bio": "Gay creator on Twitter/X"},
        {"username": "michaelyerger",      "platform": "OnlyFans",  "display_name": "Michael Yerger",
         "tags": ["fitness", "reality_tv", "muscle", "onlyfans"], "bio": "Survivor contestant turned OnlyFans creator"},
        {"username": "sebastiancox",       "platform": "OnlyFans",  "display_name": "Sebastian Cox",
         "tags": ["muscle", "gay", "onlyfans"], "bio": "Gay muscle content creator"},
        # Popular gay male creators
        {"username": "ryanbones",          "platform": "OnlyFans",  "display_name": "Ryan Bones",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "drewvalentino",      "platform": "OnlyFans",  "display_name": "Drew Valentino",
         "tags": ["twink", "gay", "onlyfans"]},
        {"username": "blakemitchell",      "platform": "OnlyFans",  "display_name": "Blake Mitchell",
         "tags": ["twink", "gay", "onlyfans"]},
        {"username": "austinwolf",         "platform": "OnlyFans",  "display_name": "Austin Wolf",
         "tags": ["muscle", "daddy", "onlyfans", "gay"]},
        {"username": "cademaddox",         "platform": "OnlyFans",  "display_name": "Cade Maddox",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "levicharming",       "platform": "OnlyFans",  "display_name": "Levi Charming",
         "tags": ["twink", "gay", "onlyfans"]},
        {"username": "jjknight",           "platform": "OnlyFans",  "display_name": "JJ Knight",
         "tags": ["hung", "muscle", "gay", "onlyfans"]},
        {"username": "colbykeller",        "platform": "OnlyFans",  "display_name": "Colby Keller",
         "tags": ["muscle", "artist", "gay", "onlyfans"]},
        {"username": "alexmecum",          "platform": "OnlyFans",  "display_name": "Alex Mecum",
         "tags": ["muscle", "bear", "gay", "onlyfans"]},
        {"username": "brenteverett",       "platform": "OnlyFans",  "display_name": "Brent Everett",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "pierrefitch",        "platform": "OnlyFans",  "display_name": "Pierre Fitch",
         "tags": ["athletic", "gay", "onlyfans"]},
        {"username": "nickfitt",           "platform": "OnlyFans",  "display_name": "Nick Fitt",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "troyedean",          "platform": "OnlyFans",  "display_name": "Troye Dean",
         "tags": ["twink", "gay", "onlyfans"]},
        {"username": "devinfrancoxx",      "platform": "OnlyFans",  "display_name": "Devin Franco",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "manuelskye",         "platform": "OnlyFans",  "display_name": "Manuel Skye",
         "tags": ["muscle", "hung", "gay", "onlyfans"]},
        {"username": "joshmoorexxx",       "platform": "OnlyFans",  "display_name": "Josh Moore",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "boonerbanks",        "platform": "OnlyFans",  "display_name": "Boomer Banks",
         "tags": ["hung", "latino", "gay", "onlyfans"]},
        {"username": "skyyknox",           "platform": "OnlyFans",  "display_name": "Skyy Knox",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "rafaelalencar",      "platform": "OnlyFans",  "display_name": "Rafael Alencar",
         "tags": ["hung", "muscle", "gay", "onlyfans"]},
        {"username": "adamramzi",          "platform": "OnlyFans",  "display_name": "Adam Ramzi",
         "tags": ["muscle", "hairy", "gay", "onlyfans"]},
        # Fansly creators
        {"username": "jakipz",             "platform": "Fansly",    "display_name": "Jakipz Fansly",
         "tags": ["twink", "latino", "fansly"]},
        {"username": "austinwolf",         "platform": "Fansly",    "display_name": "Austin Wolf Fansly",
         "tags": ["muscle", "daddy", "fansly"]},
        {"username": "scottdemarco",       "platform": "Fansly",    "display_name": "Scott DeMarco",
         "tags": ["muscle", "bear", "hairy", "fansly", "gay"]},
        {"username": "maxcarter",          "platform": "Fansly",    "display_name": "Max Carter",
         "tags": ["muscle", "gay", "fansly"]},
        {"username": "vincenzoortiz",      "platform": "Fansly",    "display_name": "Vincenzo Ortiz",
         "tags": ["twink", "latino", "fansly", "gay"]},
        {"username": "tannermyers",        "platform": "Fansly",    "display_name": "Tanner Myers",
         "tags": ["twink", "athletic", "fansly", "gay"]},
        # Twitter/X creators
        {"username": "colbykeller",        "platform": "Twitter/X", "display_name": "Colby Keller X",
         "tags": ["muscle", "artist", "twitter", "gay"]},
        {"username": "austinwolfnyc",      "platform": "Twitter/X", "display_name": "Austin Wolf X",
         "tags": ["muscle", "daddy", "twitter", "gay"]},
        {"username": "jjknight_official",  "platform": "Twitter/X", "display_name": "JJ Knight X",
         "tags": ["hung", "muscle", "twitter", "gay"]},
        {"username": "devinfrancoxx",      "platform": "Twitter/X", "display_name": "Devin Franco X",
         "tags": ["muscle", "twitter", "gay"]},
        {"username": "manuelskye",         "platform": "Twitter/X", "display_name": "Manuel Skye X",
         "tags": ["muscle", "hung", "twitter", "gay"]},
        {"username": "boonerbanks",        "platform": "Twitter/X", "display_name": "Boomer Banks X",
         "tags": ["hung", "latino", "twitter", "gay"]},
        # Additional well-known performers
        {"username": "johnnyrapid",        "platform": "OnlyFans",  "display_name": "Johnny Rapid",
         "tags": ["twink", "versatile", "gay", "onlyfans"]},
        {"username": "marcusorelias",      "platform": "OnlyFans",  "display_name": "Marcus Orelias",
         "tags": ["muscle", "latino", "gay", "onlyfans"]},
        {"username": "bareback_bastian",   "platform": "OnlyFans",  "display_name": "Bareback Bastian",
         "tags": ["twink", "bareback", "gay", "onlyfans"]},
        {"username": "phenixsaint",        "platform": "OnlyFans",  "display_name": "Phenix Saint",
         "tags": ["muscle", "hairy", "gay", "onlyfans"]},
        {"username": "landonmycles",       "platform": "OnlyFans",  "display_name": "Landon Mycles",
         "tags": ["hung", "muscle", "gay", "onlyfans"]},
        {"username": "vincentocock",       "platform": "OnlyFans",  "display_name": "Vincent O'Cock",
         "tags": ["hung", "gay", "onlyfans"]},
        {"username": "theorbrady",         "platform": "OnlyFans",  "display_name": "Theo Brady",
         "tags": ["twink", "gay", "onlyfans"]},
        {"username": "rickyroman",         "platform": "OnlyFans",  "display_name": "Ricky Roman",
         "tags": ["latino", "muscle", "gay", "onlyfans"]},
        {"username": "graysondlange",      "platform": "OnlyFans",  "display_name": "Grayson Lange",
         "tags": ["muscle", "gay", "onlyfans"]},
        {"username": "jacobblackxxx",      "platform": "OnlyFans",  "display_name": "Jacob Black",
         "tags": ["muscle", "bear", "gay", "onlyfans"]},
        {"username": "tannerofmiami",      "platform": "OnlyFans",  "display_name": "Tanner of Miami",
         "tags": ["muscle", "daddy", "gay", "onlyfans"]},
    ]

    def _seed_default_performers(self) -> None:
        """Pre-populate the DB with a curated set of gay male content creators."""
        seeded = 0
        for p in self._DEFAULT_PERFORMERS:
            try:
                existing = self.db.get_performer_by_username(p["username"])
                if not existing:
                    performer = self.db.add_performer(
                        username=p["username"],
                        platform=p["platform"],
                        display_name=p.get("display_name"),
                        bio=p.get("bio"),
                        tags=p.get("tags"),
                        discovered_via="seed",
                    )
                    self.db.enqueue_capture(performer["id"])
                    seeded += 1
            except Exception as exc:
                logger.warning("seed: error adding %s: %s", p['username'], exc)
        if seeded:
            logger.info("seed: added %d default performers, queued for capture", seeded)

    def start(self) -> None:
        # Clean up stale WAL/SHM files that cause disk I/O errors on network storage
        db_path = self.db.path
        for suffix in ["-wal", "-shm"]:
            wal_file = db_path.parent / (db_path.name + suffix)
            if wal_file.exists():
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

    def run_crawl(self) -> dict[str, Any]:
        from app.sources import (
            build_session,
            collect_firecrawl_images,
            collect_images,
            collect_lpsg,
            collect_reddit,
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
                    },
                )

                # ── Reddit / X / LPSG — images from social sources ───────────
                for source_key, collector in (
                    ("reddit", collect_reddit),
                    ("x", collect_x),
                    ("lpsg", collect_lpsg),
                ):
                    self._emit({"type": "source_start", "source": source_key, "theme": theme.slug})
                    try:
                        source_items, source_images = collector(session, self.settings, theme)
                    except Exception as exc:
                        notes["errors"].append(f"{theme.slug}:{collector.__name__}:{exc}")
                        source_items, source_images = [], []
                    for image in source_images:
                        self.db.insert_image(cache_image_record(session, self.settings, image.__dict__))
                        notes["collected"]["images"] += 1
                        theme_notes["images"] += 1
                    # Still insert items for deduplication tracking (page_url uniqueness),
                    # but they are no longer surfaced in any UI view.
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

                # ── DDG image search ─────────────────────────────────────────
                try:
                    query_images = collect_images(session, self.settings, theme, theme.label)
                except Exception as exc:
                    notes["errors"].append(f"{theme.slug}:collect_images:{exc}")
                    query_images = []
                for image in query_images:
                    self.db.insert_image(cache_image_record(session, self.settings, image.__dict__))
                    notes["collected"]["images"] += 1
                    theme_notes["images"] += 1

                # ── Firecrawl image scraping ─────────────────────────────────
                try:
                    fc_images = collect_firecrawl_images(session, self.settings, theme)
                except Exception as exc:
                    notes["errors"].append(f"{theme.slug}:collect_firecrawl_images:{exc}")
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
                performer_lookup[row["username"].lower()] = row["id"]
                if row["display_name"]:
                    performer_lookup[row["display_name"].lower()] = row["id"]
                if row["twitter_username"]:
                    performer_lookup[row["twitter_username"].lower()] = row["id"]
                if row["reddit_username"]:
                    performer_lookup[row["reddit_username"].lower()] = row["id"]

        # ── Phase 1: Term-based capture (TERM_QUERIES + CREATOR_QUERIES) ──────
        for result in capture_screenshots(image_dir, db=self.db, settings=settings):
            if result["ok"]:
                term_lower = result["term"].lower()
                performer_id = performer_lookup.get(term_lower)
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
            "source_types": ["literature", "anecdote", "reddit", "x", "lpsg", "pubmed", "biorxiv", "arxiv", "firecrawl"],
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
