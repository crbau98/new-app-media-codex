from __future__ import annotations

import json
import logging
from collections import defaultdict
import time
from threading import Lock

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stats", tags=["stats"])

# ---------------------------------------------------------------------------
# Shared filter clause to exclude visual/community content
# Optimization #1: Extract repeated WHERE clause into a constant
# ---------------------------------------------------------------------------
_CONTENT_FILTER = """
    theme != 'community_visuals'
    AND source_type NOT LIKE '%_visual%'
"""

# ---------------------------------------------------------------------------
# Cache infrastructure
# ---------------------------------------------------------------------------


def _stats_cache_bucket(app_state):
    cache = getattr(app_state, "_stats_cache", None)
    if cache is None:
        cache = {}
        app_state._stats_cache = cache
    lock = getattr(app_state, "_stats_cache_lock", None)
    if lock is None:
        lock = Lock()
        app_state._stats_cache_lock = lock
    return cache, lock


def _get_cached_stats_payload(app_state, key: str, ttl_seconds: float, builder):
    cache, lock = _stats_cache_bucket(app_state)
    now = time.monotonic()
    db = getattr(app_state, "db", None)
    generation = (
        db.snapshot_generation()
        if db and hasattr(db, "snapshot_generation")
        else 0
    )
    with lock:
        entry = cache.get(key)
        if entry and now < entry["expires_at"] and entry.get("generation") == generation:
            return entry["payload"]

    # Optimization #2: Build payload outside lock to avoid blocking other endpoints
    try:
        payload = builder()
    except Exception:
        logger.exception("stats builder failed for key=%s", key)
        # Optimization #3: Return stale data on builder failure instead of crashing
        with lock:
            entry = cache.get(key)
            if entry:
                return entry["payload"]
        raise

    with lock:
        cache[key] = {
            "payload": payload,
            "expires_at": time.monotonic() + ttl_seconds,
            "generation": generation,
        }
    return payload


# ---------------------------------------------------------------------------
# /trends
# ---------------------------------------------------------------------------


@router.get("/trends")
def trends(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
) -> JSONResponse:
    db = request.app.state.db

    # Optimization #4: Validate days parameter with safe int cast
    safe_days = max(1, min(int(days), 365))

    def build():
        with db.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT DATE(first_seen_at) AS date,
                       source_type,
                       COUNT(*)            AS count
                FROM   items
                WHERE  first_seen_at >= DATE('now', '-{safe_days} days')
                       AND {_CONTENT_FILTER}
                GROUP  BY date, source_type
                ORDER  BY date ASC
                """,
            ).fetchall()

        # Optimization #5: Single-pass dict building instead of
        # three separate loops (date_set, raw list, lookup dict)
        dates: dict[str, None] = {}
        source_types: set[str] = set()
        lookup: dict[tuple[str, str], int] = {}

        for row in rows:
            d, st, cnt = row["date"], row["source_type"], row["count"]
            dates[d] = None
            source_types.add(st)
            lookup[(d, st)] = cnt

        dates_sorted = list(dates.keys())

        series: dict[str, list[int]] = {}
        for st in sorted(source_types):
            series[st] = [lookup.get((d, st), 0) for d in dates_sorted]

        return {"dates": dates_sorted, "series": series}

    return JSONResponse(
        _get_cached_stats_payload(request.app.state, f"trends:{safe_days}", 30.0, build)
    )


# ---------------------------------------------------------------------------
# /insights â Optimization #6: consolidate 3 separate COUNT queries into one
# ---------------------------------------------------------------------------


@router.get("/insights")
def insights(request: Request) -> JSONResponse:
    db = request.app.state.db

    def build():
        with db.connect() as conn:
            # ------- source breakdown -------
            source_rows = conn.execute(
                f"""
                SELECT source_type, COUNT(*) AS count
                FROM   items
                WHERE  {_CONTENT_FILTER}
                GROUP  BY source_type
                ORDER  BY count DESC
                """,
            ).fetchall()

            total_items = sum(r["count"] for r in source_rows) or 1

            source_breakdown = [
                {
                    "source": r["source_type"],
                    "count": r["count"],
                    "percentage": round(r["count"] * 100 / total_items, 1),
                }
                for r in source_rows
            ]

            # ------- top themes -------
            theme_rows = conn.execute(
                f"""
                SELECT theme, COUNT(*) AS count
                FROM   items
                WHERE  {_CONTENT_FILTER}
                GROUP  BY theme
                ORDER  BY count DESC
                LIMIT  10
                """,
            ).fetchall()
            top_themes = [{"theme": r["theme"], "count": r["count"]} for r in theme_rows]

            # ------- review funnel -------
            status_rows = conn.execute(
                f"""
                SELECT review_status, COUNT(*) AS count
                FROM   items
                WHERE  {_CONTENT_FILTER}
                GROUP  BY review_status
                """,
            ).fetchall()
            status_map: dict[str, int] = {
                r["review_status"]: r["count"] for r in status_rows
            }

            review_funnel = {
                "total": total_items,
                "new": status_map.get("new", 0),
                "reviewing": status_map.get("reviewing", 0),
                "shortlisted": status_map.get("shortlisted", 0),
                "archived": status_map.get("archived", 0),
            }

            # Optimization #6: single query for all growth period counts
            growth_row = conn.execute(
                f"""
                SELECT
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-7 days')
                             THEN 1 ELSE 0 END) AS items_7d,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-30 days')
                             THEN 1 ELSE 0 END) AS items_30d,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-14 days')
                              AND first_seen_at <  DATE('now', '-7 days')
                             THEN 1 ELSE 0 END) AS items_prev_7d
                FROM items
                WHERE {_CONTENT_FILTER}
                """,
            ).fetchone()

            items_7d = growth_row["items_7d"] or 0
            items_30d = growth_row["items_30d"] or 0
            items_prev_7d = growth_row["items_prev_7d"] or 0

            growth_rate = (
                round((items_7d - items_prev_7d) / items_prev_7d * 100, 1)
                if items_prev_7d > 0
                else 0.0
            )
            growth = {
                "items_last_7d": items_7d,
                "items_last_30d": items_30d,
                "growth_rate": growth_rate,
            }

            # ------- top compounds -------
            # Optimization #7: add IS NOT NULL check & LIMIT to reduce JSON parsing
            compound_rows = conn.execute(
                f"""
                SELECT compounds_json
                FROM   items
                WHERE  compounds_json != '[]'
                       AND compounds_json IS NOT NULL
                       AND {_CONTENT_FILTER}
                LIMIT  5000
                """,
            ).fetchall()

            compound_counts: dict[str, int] = defaultdict(int)
            for row in compound_rows:
                try:
                    for c in json.loads(row["compounds_json"]):
                        compound_counts[c] += 1
                except (json.JSONDecodeError, TypeError):
                    pass

            top_compounds = sorted(
                [{"name": k, "count": v} for k, v in compound_counts.items()],
                key=lambda x: x["count"],
                reverse=True,
            )[:10]

            return {
                "source_breakdown": source_breakdown,
                "top_themes": top_themes,
                "review_funnel": review_funnel,
                "growth": growth,
                "top_compounds": top_compounds,
            }

    # Optimization #8: increase insights cache TTL from 30s to 60s (expensive query)
    return JSONResponse(
        _get_cached_stats_payload(request.app.state, "insights", 60.0, build)
    )


# ---------------------------------------------------------------------------
# /histogram â Optimization #9: single SQL with CASE/WHEN instead of 6 queries
# ---------------------------------------------------------------------------

# Optimization #10: define bucket config as module-level constant
_HISTOGRAM_BUCKETS = [
    (1.0, 2.0, "1\u20132"),
    (2.0, 3.0, "2\u20133"),
    (3.0, 4.0, "3\u20134"),
    (4.0, 5.0, "4\u20135"),
    (5.0, 6.0, "5\u20136"),
    (6.0, 999.0, "6+"),
]

# Pre-build the SQL once at import time
_HISTOGRAM_SQL = "SELECT " + ", ".join(
    f"SUM(CASE WHEN score >= {lo} AND score < {hi} THEN 1 ELSE 0 END) AS b{i}"
    for i, (lo, hi, _label) in enumerate(_HISTOGRAM_BUCKETS)
) + " FROM items"


@router.get("/histogram")
def score_histogram(request: Request) -> JSONResponse:
    db = request.app.state.db

    def build():
        with db.connect() as conn:
            row = conn.execute(_HISTOGRAM_SQL).fetchone()

        # Optimization #9: map single-row result back to labeled buckets
        buckets = []
        for i, (_lo, _hi, label) in enumerate(_HISTOGRAM_BUCKETS):
            buckets.append({"range": label, "count": row[i] or 0})
        return {"buckets": buckets}

    return JSONResponse(
        _get_cached_stats_payload(request.app.state, "histogram", 60.0, build)
    )


# ---------------------------------------------------------------------------
# /source-health
# ---------------------------------------------------------------------------


# Optimization #11: extract status logic into pure function for testability
def _compute_source_status(total: int, last_7: int, last_30: int) -> str:
    if total < 5:
        return "new"
    if last_7 > 0:
        return "healthy"
    if last_30 > 0:
        return "stale"
    return "inactive"


def _compute_trend(last_7: int, prev_7: int) -> str:
    if prev_7 > 0:
        return "up" if last_7 > prev_7 else ("down" if last_7 < prev_7 else "flat")
    return "up" if last_7 > 0 else "flat"


@router.get("/source-health")
def source_health(request: Request) -> JSONResponse:
    db = request.app.state.db

    def build():
        with db.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT source_type,
                       COUNT(*)                     AS total_items,
                       MAX(first_seen_at)            AS last_item_at,
                       SUM(CASE WHEN first_seen_at >= DATE('now', '-7 days')
                                THEN 1 ELSE 0 END)  AS items_last_7d,
                       SUM(CASE WHEN first_seen_at >= DATE('now', '-30 days')
                                THEN 1 ELSE 0 END)  AS items_last_30d,
                       SUM(CASE WHEN first_seen_at >= DATE('now', '-14 days')
                                 AND first_seen_at <  DATE('now', '-7 days')
                                THEN 1 ELSE 0 END)  AS items_prev_7d
                FROM   items
                WHERE  {_CONTENT_FILTER}
                GROUP  BY source_type
                ORDER  BY total_items DESC
                """,
            ).fetchall()

        sources = []
        for r in rows:
            total = r["total_items"]
            last_7 = r["items_last_7d"]
            last_30 = r["items_last_30d"]
            prev_7 = r["items_prev_7d"]

            sources.append(
                {
                    "name": r["source_type"],
                    "total_items": total,
                    "last_item_at": r["last_item_at"],
                    "items_last_7d": last_7,
                    "items_last_30d": last_30,
                    "trend": _compute_trend(last_7, prev_7),
                    "status": _compute_source_status(total, last_7, last_30),
                }
            )
        return {"sources": sources}

    # Optimization #12: bump source-health TTL to 45s
    return JSONResponse(
        _get_cached_stats_payload(request.app.state, "source-health", 45.0, build)
    )
