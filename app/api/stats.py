from __future__ import annotations

import json
from collections import defaultdict
import time
from threading import Lock

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/stats", tags=["stats"])


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
    generation = db.snapshot_generation() if db and hasattr(db, "snapshot_generation") else 0
    with lock:
        entry = cache.get(key)
        if entry and now < entry["expires_at"] and entry.get("generation") == generation:
            return entry["payload"]

    payload = builder()
    with lock:
        cache[key] = {
            "payload": payload,
            "expires_at": time.monotonic() + ttl_seconds,
            "generation": generation,
        }
    return payload


@router.get("/trends")
def trends(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
) -> JSONResponse:
    """
    Returns daily item counts for the last N days, grouped by source_type.

    Response shape:
      {
        "dates": ["2026-02-10", ...],          # sorted ASC
        "series": { "reddit": [3, 0, 5, ...], ... }  # count per date per source_type
      }
    """
    db = request.app.state.db

    def build():
        with db.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    DATE(first_seen_at) AS date,
                    source_type,
                    COUNT(*) AS count
                FROM items
                WHERE
                    first_seen_at >= DATE('now', '-{int(days)} days')
                    AND theme != 'community_visuals'
                    AND source_type NOT LIKE '%_visual%'
                GROUP BY date, source_type
                ORDER BY date ASC
                """
            ).fetchall()

        date_set: set[str] = set()
        source_types: set[str] = set()
        raw: list[dict] = []
        for row in rows:
            date_set.add(row["date"])
            source_types.add(row["source_type"])
            raw.append({"date": row["date"], "source_type": row["source_type"], "count": row["count"]})

        dates_sorted = sorted(date_set)

        lookup: dict[tuple[str, str], int] = {}
        for entry in raw:
            lookup[(entry["date"], entry["source_type"])] = entry["count"]

        series: dict[str, list[int]] = {}
        for st in sorted(source_types):
            series[st] = [lookup.get((d, st), 0) for d in dates_sorted]

        return {"dates": dates_sorted, "series": series}

    return JSONResponse(_get_cached_stats_payload(request.app.state, f"trends:{int(days)}", 90.0, build))


@router.get("/insights")
def insights(request: Request) -> JSONResponse:
    """Aggregated research insights: source breakdown, themes, review funnel, growth, top compounds."""
    db = request.app.state.db
    def build():
        with db.connect() as conn:
            source_rows = conn.execute(
                """
                SELECT source_type, COUNT(*) AS count
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY source_type
                ORDER BY count DESC
                """
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
            theme_rows = conn.execute(
                """
                SELECT theme, COUNT(*) AS count
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY theme
                ORDER BY count DESC
                LIMIT 10
                """
            ).fetchall()
            top_themes = [{"theme": r["theme"], "count": r["count"]} for r in theme_rows]
            status_rows = conn.execute(
                """
                SELECT review_status, COUNT(*) AS count
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY review_status
                """
            ).fetchall()
            status_map: dict[str, int] = {r["review_status"]: r["count"] for r in status_rows}
            review_funnel = {
                "total": total_items,
                "new": status_map.get("new", 0),
                "reviewing": status_map.get("reviewing", 0),
                "shortlisted": status_map.get("shortlisted", 0),
                "archived": status_map.get("archived", 0),
            }
            items_7d = conn.execute(
                """
                SELECT COUNT(*) FROM items
                WHERE first_seen_at >= DATE('now', '-7 days')
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
            ).fetchone()[0]
            items_30d = conn.execute(
                """
                SELECT COUNT(*) FROM items
                WHERE first_seen_at >= DATE('now', '-30 days')
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
            ).fetchone()[0]
            items_prev_7d = conn.execute(
                """
                SELECT COUNT(*) FROM items
                WHERE first_seen_at >= DATE('now', '-14 days')
                  AND first_seen_at < DATE('now', '-7 days')
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
            ).fetchone()[0]
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
            compound_rows = conn.execute(
                """
                SELECT compounds_json FROM items
                WHERE compounds_json != '[]'
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
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

    return JSONResponse(_get_cached_stats_payload(request.app.state, "insights", 90.0, build))


@router.get("/histogram")
def score_histogram(request: Request) -> JSONResponse:
    # scores range ~1.0â7.0 â single query with CASE/WHEN replaces 6 separate queries
    db = request.app.state.db

    def build():
        with db.connect() as conn:
            row = conn.execute(
                """
                SELECT
                    SUM(CASE WHEN score >= 1.0 AND score < 2.0 THEN 1 ELSE 0 END) AS b1,
                    SUM(CASE WHEN score >= 2.0 AND score < 3.0 THEN 1 ELSE 0 END) AS b2,
                    SUM(CASE WHEN score >= 3.0 AND score < 4.0 THEN 1 ELSE 0 END) AS b3,
                    SUM(CASE WHEN score >= 4.0 AND score < 5.0 THEN 1 ELSE 0 END) AS b4,
                    SUM(CASE WHEN score >= 5.0 AND score < 6.0 THEN 1 ELSE 0 END) AS b5,
                    SUM(CASE WHEN score >= 6.0 THEN 1 ELSE 0 END) AS b6
                FROM items
                """
            ).fetchone()
            labels = ["1â2", "2â3", "3â4", "4â5", "5â6", "6+"]
            buckets = [
                {"range": labels[i], "count": row[i] or 0}
                for i in range(6)
            ]
        return {"buckets": buckets}

    return JSONResponse(_get_cached_stats_payload(request.app.state, "histogram", 120.0, build))


@router.get("/source-health")
def source_health(request: Request) -> JSONResponse:
    """Per-source health status: item counts, recency, trend, and status."""
    db = request.app.state.db
    def build():
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    source_type,
                    COUNT(*) AS total_items,
                    MAX(first_seen_at) AS last_item_at,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-7 days') THEN 1 ELSE 0 END) AS items_last_7d,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-30 days') THEN 1 ELSE 0 END) AS items_last_30d,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-14 days')
                              AND first_seen_at < DATE('now', '-7 days') THEN 1 ELSE 0 END) AS items_prev_7d
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY source_type
                ORDER BY total_items DESC
                """
            ).fetchall()

        sources = []
        for r in rows:
            total = r["total_items"]
            last_7 = r["items_last_7d"]
            last_30 = r["items_last_30d"]
            prev_7 = r["items_prev_7d"]
            if prev_7 > 0:
                trend = "up" if last_7 > prev_7 else ("down" if last_7 < prev_7 else "flat")
            else:
                trend = "up" if last_7 > 0 else "flat"
            if total < 5:
                status = "new"
            elif last_7 > 0:
                status = "healthy"
            elif last_30 > 0:
                status = "stale"
            else:
                status = "inactive"
            sources.append(
                {
                    "name": r["source_type"],
                    "total_items": total,
                    "last_item_at": r["last_item_at"],
                    "items_last_7d": last_7,
                    "items_last_30d": last_30,
                    "trend": trend,
                    "status": status,
                }
            )

        return {"sources": sources}

    return JSONResponse(_get_cached_stats_payload(request.app.state, "source-health", 90.0, build))
from __future__ import annotations

import json
from collections import defaultdict
import time
from threading import Lock

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/stats", tags=["stats"])


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
    generation = db.snapshot_generation() if db and hasattr(db, "snapshot_generation") else 0
    with lock:
        entry = cache.get(key)
        if entry and now < entry["expires_at"] and entry.get("generation") == generation:
            return entry["payload"]

    payload = builder()
    with lock:
        cache[key] = {
            "payload": payload,
            "expires_at": time.monotonic() + ttl_seconds,
            "generation": generation,
        }
    return payload


@router.get("/trends")
def trends(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
) -> JSONResponse:
    """
    Returns daily item counts for the last N days, grouped by source_type.

    Response shape:
      {
        "dates": ["2026-02-10", ...],          # sorted ASC
        "series": { "reddit": [3, 0, 5, ...], ... }  # count per date per source_type
      }
    """
    db = request.app.state.db

    def build():
        with db.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    DATE(first_seen_at) AS date,
                    source_type,
                    COUNT(*) AS count
                FROM items
                WHERE
                    first_seen_at >= DATE('now', '-{int(days)} days')
                    AND theme != 'community_visuals'
                    AND source_type NOT LIKE '%_visual%'
                GROUP BY date, source_type
                ORDER BY date ASC
                """
            ).fetchall()

        date_set: set[str] = set()
        source_types: set[str] = set()
        raw: list[dict] = []
        for row in rows:
            date_set.add(row["date"])
            source_types.add(row["source_type"])
            raw.append({"date": row["date"], "source_type": row["source_type"], "count": row["count"]})

        dates_sorted = sorted(date_set)

        lookup: dict[tuple[str, str], int] = {}
        for entry in raw:
            lookup[(entry["date"], entry["source_type"])] = entry["count"]

        series: dict[str, list[int]] = {}
        for st in sorted(source_types):
            series[st] = [lookup.get((d, st), 0) for d in dates_sorted]

        return {"dates": dates_sorted, "series": series}

    return JSONResponse(_get_cached_stats_payload(request.app.state, f"trends:{int(days)}", 30.0, build))


@router.get("/insights")
def insights(request: Request) -> JSONResponse:
    """Aggregated research insights: source breakdown, themes, review funnel, growth, top compounds."""
    db = request.app.state.db
    def build():
        with db.connect() as conn:
            source_rows = conn.execute(
                """
                SELECT source_type, COUNT(*) AS count
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY source_type
                ORDER BY count DESC
                """
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
            theme_rows = conn.execute(
                """
                SELECT theme, COUNT(*) AS count
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY theme
                ORDER BY count DESC
                LIMIT 10
                """
            ).fetchall()
            top_themes = [{"theme": r["theme"], "count": r["count"]} for r in theme_rows]
            status_rows = conn.execute(
                """
                SELECT review_status, COUNT(*) AS count
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY review_status
                """
            ).fetchall()
            status_map: dict[str, int] = {r["review_status"]: r["count"] for r in status_rows}
            review_funnel = {
                "total": total_items,
                "new": status_map.get("new", 0),
                "reviewing": status_map.get("reviewing", 0),
                "shortlisted": status_map.get("shortlisted", 0),
                "archived": status_map.get("archived", 0),
            }
            items_7d = conn.execute(
                """
                SELECT COUNT(*) FROM items
                WHERE first_seen_at >= DATE('now', '-7 days')
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
            ).fetchone()[0]
            items_30d = conn.execute(
                """
                SELECT COUNT(*) FROM items
                WHERE first_seen_at >= DATE('now', '-30 days')
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
            ).fetchone()[0]
            items_prev_7d = conn.execute(
                """
                SELECT COUNT(*) FROM items
                WHERE first_seen_at >= DATE('now', '-14 days')
                  AND first_seen_at < DATE('now', '-7 days')
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
            ).fetchone()[0]
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
            compound_rows = conn.execute(
                """
                SELECT compounds_json FROM items
                WHERE compounds_json != '[]'
                  AND theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                """
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

    return JSONResponse(_get_cached_stats_payload(request.app.state, "insights", 30.0, build))


@router.get("/histogram")
def score_histogram(request: Request) -> JSONResponse:
    # scores range ~1.0–7.0 (score_item base=1.0, max compounds+mechanisms bonus ~5.9)
    db = request.app.state.db
    BUCKETS = [
        (1.0, 2.0, "1–2"),
        (2.0, 3.0, "2–3"),
        (3.0, 4.0, "3–4"),
        (4.0, 5.0, "4–5"),
        (5.0, 6.0, "5–6"),
        (6.0, 999.0, "6+"),
    ]
    def build():
        with db.connect() as conn:
            buckets = []
            for low, high, label in BUCKETS:
                count = conn.execute(
                    "SELECT COUNT(*) FROM items WHERE score >= ? AND score < ?", (low, high)
                ).fetchone()[0]
                buckets.append({"range": label, "count": count})
        return {"buckets": buckets}

    return JSONResponse(_get_cached_stats_payload(request.app.state, "histogram", 60.0, build))


@router.get("/source-health")
def source_health(request: Request) -> JSONResponse:
    """Per-source health status: item counts, recency, trend, and status."""
    db = request.app.state.db
    def build():
        with db.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    source_type,
                    COUNT(*) AS total_items,
                    MAX(first_seen_at) AS last_item_at,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-7 days') THEN 1 ELSE 0 END) AS items_last_7d,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-30 days') THEN 1 ELSE 0 END) AS items_last_30d,
                    SUM(CASE WHEN first_seen_at >= DATE('now', '-14 days')
                              AND first_seen_at < DATE('now', '-7 days') THEN 1 ELSE 0 END) AS items_prev_7d
                FROM items
                WHERE theme != 'community_visuals' AND source_type NOT LIKE '%_visual%'
                GROUP BY source_type
                ORDER BY total_items DESC
                """
            ).fetchall()

        sources = []
        for r in rows:
            total = r["total_items"]
            last_7 = r["items_last_7d"]
            last_30 = r["items_last_30d"]
            prev_7 = r["items_prev_7d"]
            if prev_7 > 0:
                trend = "up" if last_7 > prev_7 else ("down" if last_7 < prev_7 else "flat")
            else:
                trend = "up" if last_7 > 0 else "flat"
            if total < 5:
                status = "new"
            elif last_7 > 0:
                status = "healthy"
            elif last_30 > 0:
                status = "stale"
            else:
                status = "inactive"
            sources.append(
                {
                    "name": r["source_type"],
                    "total_items": total,
                    "last_item_at": r["last_item_at"],
                    "items_last_7d": last_7,
                    "items_last_30d": last_30,
                    "trend": trend,
                    "status": status,
                }
            )

        return {"sources": sources}

    return JSONResponse(_get_cached_stats_payload(request.app.state, "source-health", 30.0, build))
