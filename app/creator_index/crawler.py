"""Crawl orchestration: single-flight, time/page budgeted, resumable.

Each run walks the sources in a fixed order. Every source has an ordered list
of "units" (a Redgifs tag/order/page, a Bluesky query, ...) and a cursor
persisted in ``creator_crawl_state`` after every unit, so a run (or a crashed
process) resumes exactly where the previous one stopped and wraps around once a
source is exhausted. A failing unit is recorded and skipped; an open circuit
breaker ends that source for the run without advancing its cursor.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from app.creator_index.fetcher import Fetcher, GuardedFetcher, SafeFetcher, SourceError
from app.creator_index.repository import CreatorIndexRepository, CreatorObservation
from app.creator_index.sources import (
    BlueskySource, LemmySource, MastodonSource, PeerTubeSource, RedgifsSource, UnitResult,
)

logger = logging.getLogger("app.creator_index")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    return default if raw is None else raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class CrawlConfig:
    enabled: bool = True
    interval_minutes: int = 45
    max_pages: int = 40          # provider requests per run (hard cap)
    max_seconds: float = 240.0   # wall-clock per run (hard cap)
    catalog_share: float = 0.2   # fraction of pages reserved for seed-queue catalog refreshes
    per_source_share: float = 0.1  # cap per federated source (fraction of max_pages, min 1)
    jitter_seconds: int = 120

    @classmethod
    def from_env(cls) -> "CrawlConfig":
        return cls(
            enabled=_env_flag("CREATOR_INDEX_ENABLED", True),
            interval_minutes=max(5, _env_int("CREATOR_INDEX_INTERVAL_MINUTES", 45)),
            max_pages=max(1, _env_int("CREATOR_INDEX_MAX_PAGES", 40)),
            max_seconds=float(max(10, _env_int("CREATOR_INDEX_MAX_SECONDS", 240))),
        )


@dataclass
class RunReport:
    run_id: int | None = None
    state: str = "ok"
    pages: int = 0
    creators: int = 0
    errors: list[str] = field(default_factory=list)
    lanes: list[str] = field(default_factory=list)
    skipped: bool = False


class Budget:
    def __init__(self, max_pages: int, max_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.max_pages = max_pages
        self.deadline = clock() + max_seconds
        self.pages = 0
        self._clock = clock

    def left(self) -> int:
        return max(0, self.max_pages - self.pages)

    def exhausted(self) -> bool:
        return self.pages >= self.max_pages or self._clock() >= self.deadline


class CreatorCrawler:
    def __init__(
        self,
        repo: CreatorIndexRepository,
        *,
        fetcher: Fetcher | None = None,
        config: CrawlConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.repo = repo
        self.config = config or CrawlConfig()
        self.fetcher: Fetcher = fetcher or GuardedFetcher(SafeFetcher())
        self._clock = clock
        self._lock = asyncio.Lock()
        self.last_report: RunReport | None = None

    @property
    def running(self) -> bool:
        return self._lock.locked()

    def _sources(self) -> list[Any]:
        return [
            RedgifsSource(self.fetcher), BlueskySource(self.fetcher), MastodonSource(self.fetcher),
            LemmySource(self.fetcher), PeerTubeSource(self.fetcher),
        ]

    async def run_once(self, *, only: str | None = None) -> RunReport:
        """One budgeted run. Single-flight: a concurrent call returns immediately (skipped)."""
        if self._lock.locked():
            return RunReport(state="skipped", skipped=True)
        async with self._lock:
            report = RunReport()
            report.run_id = await asyncio.to_thread(self.repo.start_run, only or "all")
            budget = Budget(self.config.max_pages, self.config.max_seconds, self._clock)
            try:
                await self._run(report, budget, only)
            except asyncio.CancelledError:
                report.state = "cancelled"
                await asyncio.shield(self._finish(report))
                raise
            except Exception as exc:  # never let a crawl crash the scheduler
                logger.exception("creator index crawl failed")
                report.state = "error"
                report.errors.append(f"run: {type(exc).__name__}: {exc}"[:200])
            await self._finish(report)
            self.last_report = report
            return report

    async def _finish(self, report: RunReport) -> None:
        if report.state == "ok" and report.errors:
            report.state = "partial"
        if report.run_id:
            await asyncio.to_thread(
                self.repo.finish_run, report.run_id, state=report.state, pages=report.pages,
                creators=report.creators, lane=",".join(report.lanes[:6]), errors=report.errors,
            )

    async def _run(self, report: RunReport, budget: Budget, only: str | None) -> None:
        sources = [s for s in self._sources() if only in (None, "all", s.name)]
        cap = max(1, int(self.config.max_pages * self.config.per_source_share))
        for source in sources:
            if budget.exhausted():
                break
            if source.name == "redgifs":
                catalog_pages = int(self.config.max_pages * self.config.catalog_share)
                lane_cap = max(1, self.config.max_pages - catalog_pages - 4 * cap)
                await self._crawl_source(source, report, budget, lane_cap)
                await self._crawl_catalogs(source, report, budget, catalog_pages)
            else:
                await self._crawl_source(source, report, budget, cap)

    async def _crawl_source(self, source: Any, report: RunReport, budget: Budget, cap: int) -> None:
        key = f"cursor:{source.name}"
        units = source.units
        if not units:
            return
        cursor = int(await asyncio.to_thread(self.repo.get_state, key, 0) or 0) % len(units)
        spent = 0
        first = cursor
        while spent < cap and not budget.exhausted():
            unit = units[cursor % len(units)]
            label = f"{source.name}:{getattr(unit, 'tag', None) or getattr(unit, 'query', None) or unit}"
            try:
                result: UnitResult = await source.crawl_unit(unit)
            except SourceError as exc:
                report.errors.append(f"{label}: {exc.code}")
                spent += 1
                budget.pages += 1
                if exc.code == "circuit_open" or exc.code == "auth_failed":
                    break  # host is unhealthy: stop this source, keep the cursor where it is
                cursor = (cursor + 1) % len(units)
                await asyncio.to_thread(self.repo.set_state, key, cursor)
                continue
            spent += result.pages
            budget.pages += result.pages
            report.pages += result.pages
            await self._store(source.name, result, report)
            report.lanes.append(label)
            cursor = (cursor + 1) % len(units)
            await asyncio.to_thread(self.repo.set_state, key, cursor)
            if cursor == first and spent >= len(units):
                break  # one full lap

    async def _store(self, platform: str, result: UnitResult, report: RunReport) -> None:
        if not result.observations:
            return
        obs: list[CreatorObservation] = result.observations
        known = await asyncio.to_thread(self.repo.known_handles, platform, [o.handle for o in obs])
        report.creators += await asyncio.to_thread(self.repo.upsert, obs)
        if platform == "redgifs":
            # Snowball: newly discovered creators (via tag co-occurrence) get their catalogs crawled.
            fresh = [o for o in obs if o.handle not in known]
            for o in fresh:
                await asyncio.to_thread(
                    self.repo.enqueue_seeds, platform, [o.handle],
                    reason=(sorted(o.tags, key=lambda t: -o.tags[t])[:1] or ["lane"])[0],
                    priority=o.media_count,
                )

    async def _crawl_catalogs(self, source: RedgifsSource, report: RunReport, budget: Budget, pages: int) -> None:
        if pages <= 0:
            return
        seeds = await asyncio.to_thread(self.repo.next_seeds, "redgifs", pages)
        for handle in seeds:
            if budget.exhausted():
                break
            try:
                result = await source.crawl_catalog(handle)
            except SourceError as exc:
                report.errors.append(f"redgifs:catalog:{exc.code}")
                budget.pages += 1
                if exc.code in {"circuit_open", "auth_failed"}:
                    break
                continue
            budget.pages += result.pages
            report.pages += result.pages
            if result.observations:
                report.creators += await asyncio.to_thread(self.repo.upsert, result.observations)
            await asyncio.to_thread(self.repo.mark_seed_crawled, "redgifs", handle)
            report.lanes.append(f"redgifs:catalog:{handle}")
