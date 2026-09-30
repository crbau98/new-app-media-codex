"""Lazy runtime (repository + crawler) bound to a FastAPI app, plus the
APScheduler wiring started from the app lifespan."""

from __future__ import annotations

import asyncio
import logging
import os
import random
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from app.creator_index.crawler import CrawlConfig, CreatorCrawler
from app.creator_index.repository import CreatorIndexRepository
from app.creator_index.schema import ensure_creator_index_schema

logger = logging.getLogger("app.creator_index")
_LOCK = threading.Lock()
JOB_ID = "creator-index-crawl"


@dataclass
class CreatorIndexRuntime:
    repo: CreatorIndexRepository
    crawler: CreatorCrawler
    scheduler: Any | None = None
    task: asyncio.Task | None = None


def get_runtime(app: Any) -> CreatorIndexRuntime:
    rt = getattr(app.state, "creator_index", None)
    if rt is not None:
        return rt
    with _LOCK:
        rt = getattr(app.state, "creator_index", None)
        if rt is not None:
            return rt
        db = app.state.db
        with db.connect() as conn:
            ensure_creator_index_schema(conn)
        repo = CreatorIndexRepository(db.connect)
        rt = CreatorIndexRuntime(repo=repo, crawler=CreatorCrawler(repo, config=CrawlConfig.from_env()))
        app.state.creator_index = rt
        return rt


def scheduling_enabled(config: CrawlConfig) -> bool:
    return config.enabled and os.environ.get("ENVIRONMENT", "").strip().lower() != "testing"


def start_creator_index(app: Any) -> CreatorIndexRuntime:
    """Register the periodic crawl. Never raises; disabled under tests / when turned off."""
    rt = get_runtime(app)
    if not scheduling_enabled(rt.crawler.config):
        logger.info("creator index crawler disabled")
        return rt
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler

        rt.repo.abandon_stale_runs()
        scheduler = AsyncIOScheduler(timezone="UTC")
        cfg = rt.crawler.config
        scheduler.add_job(
            rt.crawler.run_once,
            "interval",
            minutes=cfg.interval_minutes,
            jitter=cfg.jitter_seconds,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=60 + random.randint(0, 60)),
            max_instances=1,
            coalesce=True,
            id=JOB_ID,
            replace_existing=True,
        )
        scheduler.start()
        rt.scheduler = scheduler
        logger.info("creator index crawler scheduled every %d min", cfg.interval_minutes)
    except Exception as exc:  # the crawler must never block app boot
        logger.warning("creator index crawler failed to start: %s", exc)
    return rt


def stop_creator_index(app: Any) -> None:
    rt = getattr(app.state, "creator_index", None)
    if rt is None:
        return
    try:
        if rt.scheduler is not None:
            rt.scheduler.shutdown(wait=False)
        if rt.task is not None and not rt.task.done():
            rt.task.cancel()
    except Exception:  # pragma: no cover - best effort
        pass
