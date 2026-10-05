"""Crawl orchestration: single-flight, time/page budgeted, resumable, adaptive.

Each run walks the sources in a fixed order. Every source has an ordered list
of "units" (a Redgifs tag/order/page, a Bluesky query, ...) and a cursor
persisted in ``creator_crawl_state`` after every unit, so a run (or a crashed
process) resumes exactly where the previous one stopped and wraps around once a
source is exhausted. A failing unit is recorded and skipped; an open circuit
breaker ends that source for the run without advancing its cursor.

Adaptive weighting: every unit belongs to a *lane* (``source.lane_key(unit)``). Per run the crawler
records each lane's yield (new creators per request) in ``creator_lane_stats`` and in
``creator_crawl_runs.yield_json``; lanes that found nothing new for N runs in a row are skipped for an
exponentially growing time (see ``adaptive.py``), so budget flows to lanes that still discover creators.

Approved submitted feeds are crawled first, under their own small request cap (``FEED_MAX_PER_RUN`` feeds,
at most two requests each) so a long provider crawl can never starve them.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from app.creator_index import lanes as L
from app.creator_index.adaptive import AdaptiveStore
from app.creator_index.config import env_flag, env_float, env_int
from app.creator_index.feeds import FeedConfig, FeedService
from app.creator_index.fetcher import Fetcher, GuardedFetcher, SafeFetcher, SourceError
from app.creator_index.hygiene import clean_tag, has_excluded_marker, has_male_token, safety_marker
from app.creator_index.repository import CreatorIndexRepository, CreatorObservation, curation_score
from app.creator_index.sources import (
    BlueskySource, LemmySource, MastodonSource, PeerTubeSource, RedgifsSource, UnitResult,
)

logger = logging.getLogger("app.creator_index")

SOURCE_NAMES = ("redgifs", "bluesky", "mastodon", "lemmy", "peertube", "feeds")


@dataclass
class CrawlConfig:
    enabled: bool = True
    interval_minutes: int = 45
    max_pages: int = 40          # provider requests per run (hard cap)
    max_seconds: float = 240.0   # wall-clock per run (hard cap)
    catalog_share: float = 0.2   # fraction of pages reserved for seed-queue catalog refreshes
    per_source_share: float = 0.1  # cap per federated source (fraction of max_pages, min 1)
    jitter_seconds: int = 120
    # adaptive lanes: zero-yield for `after` runs in a row => skip base * 2^(zero_runs - after) hours (<= max)
    lane_backoff_after: int = 3
    lane_backoff_base_hours: float = 3.0
    lane_backoff_max_hours: float = 168.0
    # related-tag snowballing (Redgifs): promote tags frequent on high-engagement creators into lanes
    tag_snowball_min_items: int = 8
    tag_snowball_min_score: int = 45
    tag_snowball_max_lanes: int = 30
    tag_snowball_per_run: int = 4
    # provider niche listing probe
    max_niches: int = 24
    niche_refresh_hours: float = 24.0
    niche_retry_days: float = 7.0
    # Lemmy: community crawls per run
    lemmy_max_communities: int = 6

    @classmethod
    def from_env(cls) -> "CrawlConfig":
        return cls(
            enabled=env_flag("CREATOR_INDEX_ENABLED", True),
            interval_minutes=max(5, env_int("CREATOR_INDEX_INTERVAL_MINUTES", 45)),
            max_pages=max(1, env_int("CREATOR_INDEX_MAX_PAGES", 40)),
            max_seconds=float(max(10, env_int("CREATOR_INDEX_MAX_SECONDS", 240))),
            lane_backoff_after=env_int("LANE_BACKOFF_AFTER", 3, minimum=1),
            lane_backoff_base_hours=env_float("LANE_BACKOFF_BASE_HOURS", 3.0, minimum=0.1),
            lane_backoff_max_hours=env_float("LANE_BACKOFF_MAX_HOURS", 168.0, minimum=1.0),
            tag_snowball_min_items=env_int("TAG_SNOWBALL_MIN_ITEMS", 8, minimum=1),
            tag_snowball_min_score=env_int("TAG_SNOWBALL_MIN_SCORE", 45, minimum=0, maximum=100),
            tag_snowball_max_lanes=env_int("TAG_SNOWBALL_MAX_LANES", 30, minimum=0, maximum=200),
            tag_snowball_per_run=env_int("TAG_SNOWBALL_PER_RUN", 4, minimum=0, maximum=20),
            max_niches=env_int("REDGIFS_MAX_NICHES", 24, minimum=0, maximum=100),
            niche_refresh_hours=env_float("REDGIFS_NICHE_REFRESH_HOURS", 24.0, minimum=1.0),
            niche_retry_days=env_float("REDGIFS_NICHE_RETRY_DAYS", 7.0, minimum=0.5),
            lemmy_max_communities=env_int("LEMMY_MAX_COMMUNITIES", 6, minimum=0, maximum=50),
        )


@dataclass
class RunReport:
    run_id: int | None = None
    state: str = "ok"
    pages: int = 0
    creators: int = 0
    new_creators: int = 0
    errors: list[str] = field(default_factory=list)
    lanes: list[str] = field(default_factory=list)
    skipped: bool = False
    #: per source: {"requests": n, "new": n, "upserted": n} (new creators per request = the lane yield)
    yields: dict[str, dict[str, int]] = field(default_factory=dict)
    #: lanes that entered back-off this run
    backoffs: list[str] = field(default_factory=list)
    #: tags promoted into Redgifs lanes this run
    promoted: list[str] = field(default_factory=list)

    def yield_of(self, source: str) -> dict[str, int]:
        return self.yields.setdefault(source, {"requests": 0, "new": 0, "upserted": 0})


class Budget:
    def __init__(self, max_pages: int, max_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.max_pages = max_pages
        self.deadline = clock() + max_seconds
        self.pages = 0
        self._clock = clock

    def left(self) -> int:
        return max(0, self.max_pages - self.pages)

    def time_up(self) -> bool:
        return self._clock() >= self.deadline

    def exhausted(self) -> bool:
        return self.pages >= self.max_pages or self.time_up()


class CreatorCrawler:
    def __init__(
        self,
        repo: CreatorIndexRepository,
        *,
        fetcher: Fetcher | None = None,
        config: CrawlConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ):
        self.repo = repo
        self.config = config or CrawlConfig()
        self.fetcher: Fetcher = fetcher or GuardedFetcher(SafeFetcher())
        self._clock = clock
        self._wall = wall_clock
        self._lock = asyncio.Lock()
        self.last_report: RunReport | None = None
        self.adaptive = AdaptiveStore(repo.connect)
        #: submitted-feed service; shares this crawler's (replaceable) fetcher, breaker and rate limits
        self.feeds = FeedService(repo, lambda: self.fetcher, config=FeedConfig.from_env(), clock=wall_clock)

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
                new_creators=report.new_creators, requests=report.pages, yields=report.yields,
            )

    async def _run(self, report: RunReport, budget: Budget, only: str | None) -> None:
        if only in (None, "all", "feeds"):
            await self._crawl_feeds(report, budget)
        sources = [s for s in self._sources() if only in (None, "all", s.name)]
        cap = max(1, int(self.config.max_pages * self.config.per_source_share))
        for source in sources:
            if budget.exhausted():
                break
            await self._prepare(source, report, budget)
            if source.name == "redgifs":
                catalog_pages = int(self.config.max_pages * self.config.catalog_share)
                lane_cap = max(1, self.config.max_pages - catalog_pages - 4 * cap)
                await self._crawl_source(source, report, budget, lane_cap)
                await self._crawl_catalogs(source, report, budget, catalog_pages)
                await self._promote_tags(source, report)
            else:
                await self._crawl_source(source, report, budget, cap)
                if hasattr(source, "crawl_catalog"):
                    await self._crawl_catalogs(source, report, budget, cap // 2)

    # ── feeds ────────────────────────────────────────────────────────────────

    async def _crawl_feeds(self, report: RunReport, budget: Budget) -> None:
        feed_deadline = self._clock() + self.config.max_seconds * 0.3   # feeds may use at most ~30% of the run's time
        try:
            outcome = await self.feeds.crawl_due(lambda: budget.time_up() or self._clock() >= feed_deadline)
        except Exception as exc:  # a broken feed must not take the provider crawl down
            logger.warning("feed crawl failed: %s", exc)
            report.errors.append(f"feeds: {type(exc).__name__}"[:120])
            return
        if outcome.fetched:
            y = report.yield_of("feeds")
            y["requests"] += outcome.requests
            y["new"] += outcome.new
            y["upserted"] += outcome.upserted
            report.pages += outcome.requests
            report.creators += outcome.upserted
            report.new_creators += outcome.new
            report.lanes.append(f"feeds:{outcome.fetched}")
        report.errors.extend(outcome.errors)

    # ── sources ──────────────────────────────────────────────────────────────

    async def _prepare(self, source: Any, report: RunReport, budget: Budget) -> None:
        """Let a source append runtime lanes (promoted tags, discovered niches / communities)."""
        prepare = getattr(source, "prepare", None)
        if prepare is None:
            return
        try:
            spent = int(await prepare(self.repo, self.adaptive, self.config) or 0)
        except SourceError as exc:
            report.errors.append(f"{source.name}:prepare:{exc.code}")
            spent = 1
        except Exception as exc:  # never fatal
            logger.warning("%s prepare failed: %s", source.name, exc)
            report.errors.append(f"{source.name}:prepare:{type(exc).__name__}")
            spent = 0
        if spent:
            budget.pages += spent
            report.pages += spent
            report.yield_of(source.name)["requests"] += spent

    async def _crawl_source(self, source: Any, report: RunReport, budget: Budget, cap: int) -> None:
        key = f"cursor:{source.name}"
        units = source.units
        if not units:
            return
        cursor = int(await asyncio.to_thread(self.repo.get_state, key, 0) or 0) % len(units)
        spent = 0
        first = cursor
        skipped = 0
        backed = await asyncio.to_thread(self.adaptive.backed_off, source.name, self._wall())
        lane_runs: dict[str, list[int]] = {}   # lane -> [requests, new]
        failed_only: set[str] = set()          # lanes whose only attempts this run errored (not "low yield")
        yields = report.yield_of(source.name)
        while spent < cap and not budget.exhausted():
            unit = units[cursor % len(units)]
            lane = source.lane_key(unit) if hasattr(source, "lane_key") else f"{source.name}:{unit}"
            if lane in backed or not getattr(source, "should_run", lambda _u: True)(unit):
                cursor = (cursor + 1) % len(units)
                skipped += 1
                if skipped >= len(units) or (cursor == first and spent + skipped >= len(units)):
                    break  # a full lap (or every lane backed off): nothing more to do until a back-off expires
                continue
            label = f"{source.name}:{getattr(unit, 'tag', None) or getattr(unit, 'query', None) or unit}"
            try:
                if getattr(source, "paged", False):
                    result: UnitResult = await source.crawl_unit(unit, max_pages=max(1, min(cap - spent, budget.left())))
                else:
                    result = await source.crawl_unit(unit)
            except SourceError as exc:
                report.errors.append(f"{label}: {exc.code}")
                spent += 1
                budget.pages += 1
                acc = lane_runs.setdefault(lane, [0, 0])
                if exc.code != "circuit_open":  # a rejected-locally call is not a request
                    yields["requests"] += 1
                    acc[0] += 1
                if acc[1] == 0 and acc[0] <= 1:
                    failed_only.add(lane)
                if exc.code == "circuit_open" or exc.code == "auth_failed":
                    break  # host is unhealthy: stop this source, keep the cursor where it is
                cursor = (cursor + 1) % len(units)
                await asyncio.to_thread(self.repo.set_state, key, cursor)
                continue
            spent += result.pages
            budget.pages += result.pages
            report.pages += result.pages
            new, written = await self._store(source.name, result, report)
            acc = lane_runs.setdefault(lane, [0, 0])
            acc[0] += result.pages
            acc[1] += new
            failed_only.discard(lane)
            yields["requests"] += result.pages
            yields["new"] += new
            yields["upserted"] += written
            report.lanes.append(label)
            cursor = (cursor + 1) % len(units)
            await asyncio.to_thread(self.repo.set_state, key, cursor)
            if cursor == first and spent + skipped >= len(units):
                break  # one full lap
        if skipped:
            await asyncio.to_thread(self.repo.set_state, key, cursor)
        await self._flush_lanes(source.name, lane_runs, failed_only, report)

    async def _flush_lanes(self, source: str, lane_runs: dict[str, list[int]], failed_only: set[str], report: RunReport) -> None:
        results = {lane: (req, new) for lane, (req, new) in lane_runs.items() if lane not in failed_only}
        if not results:
            return
        cfg = self.config
        entered = await asyncio.to_thread(
            self.adaptive.record_lane_runs, source, results, now=self._wall(), after=cfg.lane_backoff_after,
            base_hours=cfg.lane_backoff_base_hours, max_hours=cfg.lane_backoff_max_hours,
        )
        report.backoffs.extend(sorted(entered))

    async def _store(self, platform: str, result: UnitResult, report: RunReport) -> tuple[int, int]:
        """Persist a unit's observations and discoveries; returns ``(new creators, creators written)``."""
        for d in result.discoveries:
            await asyncio.to_thread(
                self.adaptive.upsert_lane, platform, d["lane"], d["kind"], d["payload"], score=d.get("score", 0),
                now=self._wall(),
            )
        if not result.observations:
            return 0, 0
        obs: list[CreatorObservation] = result.observations
        outcome = await asyncio.to_thread(self.repo.upsert_detailed, obs)
        report.creators += outcome.written
        report.new_creators += len(outcome.new)
        by_handle = {o.handle: o for o in obs}
        if platform == "redgifs":
            # Snowball: newly discovered creators (via tag co-occurrence) get their catalogs crawled.
            for handle in outcome.new:
                o = by_handle.get(handle)
                await asyncio.to_thread(
                    self.repo.enqueue_seeds, platform, [handle],
                    reason=(sorted(o.tags, key=lambda t: -o.tags[t])[:1] or ["lane"])[0] if o else "lane",
                    priority=o.media_count if o else 0,
                )
            await self._count_related_tags(obs)
        elif platform == "bluesky":
            # discovered adult-labelled actors get their author feed sampled (engagement, recency, link-outs)
            for handle in outcome.new:
                o = by_handle.get(handle)
                await asyncio.to_thread(
                    self.repo.enqueue_seeds, platform, [handle], reason="discovered",
                    priority=(o.followers or 0) if o else 0,
                )
        return len(outcome.new), outcome.written

    # ── related-tag snowballing ──────────────────────────────────────────────

    def _static_tags(self, source: Any | None = None) -> set[str]:
        tags = {lane.tag.lower() for lane in L.REDGIFS_LANES}
        for unit in getattr(source, "units", []) or []:
            tag = getattr(unit, "tag", None)
            if tag:
                tags.add(str(tag).lower())
        return tags

    @staticmethod
    def _eligible_tag(tag: str) -> bool:
        return len(tag) >= 3 and has_male_token(tag) and not has_excluded_marker([tag]) and not safety_marker(tag)

    async def _count_related_tags(self, obs: list[CreatorObservation]) -> None:
        counts: dict[str, int] = {}
        for o in obs:
            if curation_score(o.view_count, o.like_count, o.media_count, o.last_seen_at) < self.config.tag_snowball_min_score:
                continue  # only tags seen on high-engagement creators
            for tag, n in o.tags.items():
                label = clean_tag(tag)
                if label and self._eligible_tag(label):
                    counts[label] = counts.get(label, 0) + max(1, n)
        if counts:
            await asyncio.to_thread(self.adaptive.bump_tags, "redgifs", counts, now=self._wall())

    async def _promote_tags(self, source: Any, report: RunReport) -> None:
        """Turn the most frequent not-yet-covered related tags into new Redgifs lanes (capped, persisted)."""
        cfg = self.config
        room = cfg.tag_snowball_max_lanes - await asyncio.to_thread(self.adaptive.count_lanes, "redgifs", "tag")
        limit = min(room, cfg.tag_snowball_per_run)
        if limit <= 0:
            return
        known = self._static_tags(source)
        candidates = await asyncio.to_thread(
            self.adaptive.tag_candidates, "redgifs", min_items=cfg.tag_snowball_min_items, limit=60
        )
        promoted = 0
        for tag, items in candidates:
            if promoted >= limit:
                break
            if tag.lower() not in known and self._eligible_tag(tag):
                await asyncio.to_thread(
                    self.adaptive.upsert_lane, "redgifs", f"tag:{tag.lower()}", "tag", {"tag": tag.title()},
                    score=items, now=self._wall(),
                )
                report.promoted.append(tag)
                promoted += 1
            await asyncio.to_thread(self.adaptive.mark_promoted, "redgifs", tag, now=self._wall())

    # ── catalogs ─────────────────────────────────────────────────────────────

    async def _crawl_catalogs(self, source: Any, report: RunReport, budget: Budget, pages: int) -> None:
        if pages <= 0:
            return
        platform = source.name
        seeds = await asyncio.to_thread(self.repo.next_seeds, platform, pages)
        yields = report.yield_of(platform)
        for handle in seeds:
            if budget.exhausted():
                break
            try:
                result = await source.crawl_catalog(handle)
            except SourceError as exc:
                report.errors.append(f"{platform}:catalog:{exc.code}")
                budget.pages += 1
                yields["requests"] += 1
                if exc.code in {"circuit_open", "auth_failed"}:
                    break
                continue
            budget.pages += result.pages
            report.pages += result.pages
            yields["requests"] += result.pages
            if result.observations:
                written = await asyncio.to_thread(self.repo.upsert_detailed, result.observations)
                report.creators += written.written
                report.new_creators += len(written.new)
                yields["new"] += len(written.new)
                yields["upserted"] += written.written
            await asyncio.to_thread(self.repo.mark_seed_crawled, platform, handle)
            report.lanes.append(f"{platform}:catalog:{handle}")
