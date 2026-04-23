from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import logging
import logging.config
import os
import shutil
from pathlib import Path
import re
import sqlite3
import subprocess
from typing import AsyncIterator
import time
import uuid

os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "__all__")

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from app.middleware.safe_gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import Database, check_disk_space
from app.service import ResearchService
from app.logging_config import configure_logging

configure_logging()

# ── Sentry (optional) ─────────────────────────────────────────────────────────
_SENTRY_DSN = os.environ.get("SENTRY_DSN")
if _SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        integrations=[FastApiIntegration()],
        traces_sample_rate=0.1,
    )

BASE_DIR = Path(__file__).resolve().parent
db = Database(
    settings.database_path,
    timeout_seconds=settings.sqlite_timeout_seconds,
    busy_timeout_ms=settings.sqlite_busy_timeout_ms,
)
service = ResearchService(settings, db)
_COMMIT_HASH = "dev"


class CacheControlStaticFiles(StaticFiles):
    def __init__(self, *args, cache_control: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.cache_control = cache_control

    def file_response(self, full_path, stat_result, scope, status_code=200):
        response = super().file_response(full_path, stat_result, scope, status_code)
        if self.cache_control:
            response.headers.setdefault("Cache-Control", self.cache_control)
        return response


def _load_telegram_client():
    from app.sources.telegram import get_client

    return get_client(settings)


_main_logger = logging.getLogger("app.main")


async def _start_telegram_client(app: FastAPI) -> None:
    try:
        await asyncio.sleep(0)
        telegram_client = await asyncio.to_thread(_load_telegram_client)
        await asyncio.wait_for(telegram_client.start(), timeout=15)
        app.state.telegram_client = telegram_client
        _main_logger.info("telegram: Pyrogram client started")
    except Exception as e:
        app.state.telegram_client = None
        _main_logger.warning("telegram: could not start Pyrogram client: %s", e)


def _purge_directory_contents(directory: Path) -> None:
    if not directory.exists():
        return
    for child in directory.iterdir():
        if child.name == ".gitkeep":
            continue
        try:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.db = db
    app.state.settings = settings
    app.state.service = service

    # Wire up notification broadcast so sync DB methods can push via WebSocket
    from app.api.notifications import notification_manager

    _main_loop = asyncio.get_running_loop()

    def _notify_callback(user_id: str, payload: dict) -> None:
        try:
            asyncio.run_coroutine_threadsafe(
                notification_manager.send_to_user(user_id, payload),
                _main_loop,
            )
        except Exception:
            pass

    db.set_notification_callback(_notify_callback)

    posters_dir = Path(os.getenv("POSTERS_DIR") or (Path(os.getenv("DATABASE_PATH", "/app/data/research.db")).expanduser().parent / "posters"))
    posters_dir.mkdir(parents=True, exist_ok=True)
    global _COMMIT_HASH
    _COMMIT_HASH = _resolve_commit_hash()
    if settings.stream_only_media:
        _purge_directory_contents(settings.image_dir)
        _purge_directory_contents(_screenshots_dir)
        _purge_directory_contents(_previews_dir)
    app.state.http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10, read=120, write=10, pool=10),
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        follow_redirects=True,
        cookies=httpx.Cookies(),  # Persist cookies across requests (DDoS-Guard)
    )

    # Warm up DDoS-Guard cookies for proxied sources so the first real media request
    # already has valid session cookies (avoids initial 403/redirect loop).
    async def _warmup_cookies():
        _warmup_targets = ["https://coomer.st/", "https://kemono.su/"]
        for _url in _warmup_targets:
            try:
                async with app.state.http_client.stream(
                    "GET", _url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                    timeout=8.0,
                ):
                    pass  # just need cookies — don't read body
            except Exception:
                pass

    asyncio.create_task(_warmup_cookies())

    # 4.4: Load poster disk cache in background so startup latency is not blocked
    async def _bg_poster_cache():
        try:
            from app.api.screenshots import _load_poster_disk_cache
            await asyncio.to_thread(_load_poster_disk_cache)
        except Exception:
            pass

    asyncio.create_task(_bg_poster_cache())

    service_start_task = asyncio.create_task(asyncio.to_thread(service.start))
    telegram_start_task: asyncio.Task[None] | None = None
    app.state.telegram_client = None
    if settings.telegram_api_id and settings.telegram_session:
        telegram_start_task = asyncio.create_task(_start_telegram_client(app))

    try:
        yield
    finally:
        if not service_start_task.done():
            service_start_task.cancel()
            try:
                await service_start_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        service.stop()
        if telegram_start_task and not telegram_start_task.done():
            telegram_start_task.cancel()
            try:
                await telegram_start_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
        telegram_client = getattr(app.state, "telegram_client", None)
        if telegram_client:
            try:
                await telegram_client.stop()
                _main_logger.info("telegram: Pyrogram client stopped")
            except Exception:
                pass
        http_client = getattr(app.state, "http_client", None)
        if http_client:
            await http_client.aclose()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=4)


# ── Token-bucket rate limiter (5.2) ──────────────────────────────────────────
import collections
import threading as _threading

_RL_LOCK = _threading.Lock()
_RL_BUCKETS: dict[str, dict] = {}  # ip → {tokens, last_refill}
_RL_CAPACITY = 60        # max tokens per bucket
_RL_REFILL_RATE = 30     # tokens refilled per second
_RL_COST = 1             # default cost per request

# Paths exempt from rate limiting (health checks, static files)
_RL_EXEMPT_PREFIXES = ("/static/", "/cached-", "/healthz", "/ws/")


def _check_rate_limit(ip: str, cost: int = 1) -> bool:
    """Return True if the request should be allowed, False if rate limited."""
    now = time.monotonic()
    with _RL_LOCK:
        bucket = _RL_BUCKETS.get(ip)
        if bucket is None:
            _RL_BUCKETS[ip] = {"tokens": _RL_CAPACITY - cost, "last_refill": now}
            # Evict oldest bucket when we exceed 8192 entries
            if len(_RL_BUCKETS) > 8192:
                oldest = min(_RL_BUCKETS, key=lambda k: _RL_BUCKETS[k]["last_refill"])
                del _RL_BUCKETS[oldest]
            return True
        elapsed = now - bucket["last_refill"]
        bucket["tokens"] = min(_RL_CAPACITY, bucket["tokens"] + elapsed * _RL_REFILL_RATE)
        bucket["last_refill"] = now
        if bucket["tokens"] >= cost:
            bucket["tokens"] -= cost
            return True
        return False


@app.exception_handler(sqlite3.OperationalError)
async def sqlite_operational_error_handler(request: Request, exc: sqlite3.OperationalError):
    return JSONResponse(
        status_code=503,
        content={"error": "database_unavailable", "detail": str(exc)},
    )


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start = time.perf_counter()
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    _main_logger.info(
        "request %s %s %s %.2fms",
        request_id,
        request.method,
        request.url.path,
        duration_ms,
    )
    return response


@app.middleware("http")
async def apply_response_headers(request: Request, call_next):
    response = await call_next(request)
    request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
    response.headers.setdefault("X-Request-ID", request_id)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), fullscreen=(self)",
    )
    if request.url.path.startswith("/api/") or request.url.path == "/healthz":
        _cacheable = {"/api/version", "/api/app-shell-summary", "/api/screenshots/terms", "/api/screenshots/sources"}
        if request.url.path in _cacheable:
            response.headers.setdefault("Cache-Control", "public, max-age=10, stale-while-revalidate=30")
        else:
            response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    if any(path.startswith(p) for p in _RL_EXEMPT_PREFIXES):
        return await call_next(request)
    ip = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown")
    ip = ip.split(",")[0].strip()
    if not _check_rate_limit(ip, _RL_COST):
        return JSONResponse(
            status_code=429,
            content={"error": "rate_limited", "detail": "Too many requests — please slow down."},
            headers={"Retry-After": "2"},
        )
    return await call_next(request)


def _parse_cors_allow_origins() -> list[str]:
    raw = (os.environ.get("CORS_ALLOW_ORIGINS") or "").strip()
    if not raw:
        return []
    return [x.strip() for x in raw.split(",") if x.strip()]


_cors_origins = _parse_cors_allow_origins()
if _cors_origins:
    # Added after other middleware so this runs outermost (handles OPTIONS / CORS headers first).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.mount(
    "/static",
    CacheControlStaticFiles(directory=str(BASE_DIR / "static"), cache_control="public, max-age=3600"),
    name="static",
)
app.mount(
    "/cached-images",
    CacheControlStaticFiles(
        directory=str(settings.image_dir),
        cache_control="public, max-age=86400, stale-while-revalidate=3600",
    ),
    name="cached-images",
)

_screenshots_dir = Path(settings.image_dir).parent / "screenshots"
_screenshots_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/cached-screenshots",
    CacheControlStaticFiles(
        directory=str(_screenshots_dir),
        cache_control="public, max-age=86400, stale-while-revalidate=3600",
    ),
    name="cached-screenshots",
)

_previews_dir = Path(settings.image_dir).parent / "previews"
_previews_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/cached-previews",
    CacheControlStaticFiles(
        directory=str(_previews_dir),
        cache_control="public, max-age=604800, stale-while-revalidate=86400",
    ),
    name="cached-previews",
)

_FRONTEND_DIST = BASE_DIR / "static" / "dist"
_FRONTEND_INDEX_CACHE: str | None = None
_FRONTEND_INDEX_CACHE_MTIME_NS = 0
_TEMPLATES = None
_APP_SHELL_SUMMARY_CACHE: dict | None = None
_APP_SHELL_SUMMARY_CACHE_EXPIRES_AT = 0.0


def _get_frontend_index_html() -> str | None:
    global _FRONTEND_INDEX_CACHE, _FRONTEND_INDEX_CACHE_MTIME_NS
    dist_index = _FRONTEND_DIST / "index.html"
    if not dist_index.exists():
        return None
    mtime_ns = dist_index.stat().st_mtime_ns
    if _FRONTEND_INDEX_CACHE is None or _FRONTEND_INDEX_CACHE_MTIME_NS != mtime_ns:
        html = dist_index.read_text(encoding="utf-8")
        html = re.sub(
            r'\n\s*<link rel="modulepreload" crossorigin href="/assets/vendor-recharts-[^"]+">',
            "",
            html,
        )
        html = re.sub(
            r'\n\s*<link rel="modulepreload" crossorigin href="/assets/vendor-d3-[^"]+">',
            "",
            html,
        )
        # Preconnect hints for CDNs that the browser accesses directly.
        # NOTE: coomer.st is intentionally excluded — all coomer media is routed
        # through the server-side proxy, so the browser never connects directly.
        _preconnect_hints = (
            '<link rel="preconnect" href="https://thumbs44.redgifs.com" crossorigin>\n'
            '    <link rel="dns-prefetch" href="https://thumbs44.redgifs.com">\n'
            "    "
        )
        html = html.replace("</head>", _preconnect_hints + "</head>", 1)
        _FRONTEND_INDEX_CACHE = html
        _FRONTEND_INDEX_CACHE_MTIME_NS = mtime_ns
    return _FRONTEND_INDEX_CACHE


def _get_templates():
    global _TEMPLATES
    if _TEMPLATES is None:
        from fastapi.templating import Jinja2Templates

        _TEMPLATES = Jinja2Templates(directory=str(BASE_DIR / "templates"))
    return _TEMPLATES


def _get_app_shell_summary() -> dict:
    global _APP_SHELL_SUMMARY_CACHE, _APP_SHELL_SUMMARY_CACHE_EXPIRES_AT
    now = time.monotonic()
    if _APP_SHELL_SUMMARY_CACHE is not None and now < _APP_SHELL_SUMMARY_CACHE_EXPIRES_AT:
        return _APP_SHELL_SUMMARY_CACHE

    stats = db.get_stats()
    # Pre-warm media-stats and performer-stats so the frontend never shows stale "0" counts
    try:
        media_stats = db.get_screenshot_media_stats()
    except Exception:
        media_stats = None
    try:
        performer_stats = db.get_performer_stats()
    except Exception:
        performer_stats = None
    payload = {
        "app_name": settings.app_name,
        "last_run": db.get_last_run(),
        "stats": {"totals": stats.get("totals", {})},
        "is_running": service.lock.locked(),
        "media_stats": media_stats,
        "performer_stats": performer_stats,
    }
    _APP_SHELL_SUMMARY_CACHE = payload
    _APP_SHELL_SUMMARY_CACHE_EXPIRES_AT = now + 60.0
    return payload

# Mount compiled frontend assets directory
if (_FRONTEND_DIST / "assets").exists():
    app.mount(
        "/assets",
        CacheControlStaticFiles(
            directory=str(_FRONTEND_DIST / "assets"),
            cache_control="public, max-age=31536000, immutable",
        ),
        name="frontend-assets",
    )
@app.get("/", response_class=HTMLResponse)
@app.head("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    dist_index_html = _get_frontend_index_html()
    if dist_index_html is not None:
        # Embed only lightweight status data so the app shell paints quickly.
        try:
            running = getattr(request.app.state, "screenshot_running", False)
            progress = getattr(request.app.state, "screenshot_progress", None)
            # Use pre-warmed summary so stats are available on first paint
            summary = _get_app_shell_summary()
            initial_data = json.dumps(
                {
                    "status": {"running": running, **(progress or {})},
                    "media_stats": summary.get("media_stats"),
                    "performer_stats": summary.get("performer_stats"),
                },
                separators=(",", ":"),
            )
            inject_script = f"<script>window.__INITIAL_DATA__={initial_data}</script>"
            dist_index_html = dist_index_html.replace("</head>", inject_script + "</head>")
        except Exception:
            pass  # Serve HTML without embedded data on any error
        return HTMLResponse(dist_index_html, headers={"Cache-Control": "no-cache"})
    # Fallback: legacy Jinja2 template
    return _get_templates().TemplateResponse(
        request=request,
        name="index.html",
        context={"payload": service.dashboard_payload()},
    )


@app.get("/api/dashboard")
def dashboard() -> JSONResponse:
    return JSONResponse(service.dashboard_payload())


@app.get("/api/app-shell-summary")
def app_shell_summary() -> JSONResponse:
    return JSONResponse(_get_app_shell_summary())


@app.get("/api/compounds/{name}")
def compound_detail(name: str, request: Request) -> JSONResponse:
    import requests
    from app.sources.pubchem import lookup_compound

    db = request.app.state.db
    cached = db.get_compound_cache(name)
    if cached:
        return JSONResponse(cached)

    session = requests.Session()
    data = lookup_compound(session, name)
    if data:
        try:
            db.set_compound_cache(name, data)
        except Exception:
            pass
    return JSONResponse(data)


@app.get("/healthz")
@app.head("/healthz")
def healthz() -> JSONResponse:
    db_ok = db.ping()
    try:
        disk = check_disk_space(settings.database_path.parent)
    except Exception:
        disk = None
    if not db_ok:
        status = "starting"
    elif disk and disk["low_space"]:
        status = "low_disk"
    else:
        status = "ok"
    return JSONResponse(
        {
            "status": status,
            "running": service.lock.locked(),
            "db_ok": db_ok,
            "scheduler_running": service.running,
            "disk": disk,
        },
        status_code=200,
    )


def _resolve_commit_hash() -> str:
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "--short", "HEAD"],
                cwd=BASE_DIR.parent,
                stderr=subprocess.DEVNULL,
            )
            .decode("utf-8")
            .strip()
            or "dev"
        )
    except Exception:
        return "dev"


@app.get("/api/version")
def api_version() -> JSONResponse:
    return JSONResponse({"version": "1.0", "commit": _COMMIT_HASH})


from app.api.crawl import router as crawl_router
app.include_router(crawl_router)

from app.api.health import router as health_router
app.include_router(health_router)

from app.api.hypotheses_stream import router as hyp_stream_router
app.include_router(hyp_stream_router)

from app.api.items import router as items_router, browse_router as items_browse_router, tags_router
app.include_router(items_router)
app.include_router(items_browse_router)
app.include_router(tags_router)

from app.api.images import router as images_router, browse_router as images_browse_router
app.include_router(images_router)
app.include_router(images_browse_router)

from app.api.hypotheses import router as hypotheses_router, browse_router as hypotheses_browse_router
app.include_router(hypotheses_router)
app.include_router(hypotheses_browse_router)

from app.api.runs import router as runs_router
app.include_router(runs_router)

from app.api.screenshots import router as screenshots_router
app.include_router(screenshots_router)

from app.api.activity import router as activity_router
app.include_router(activity_router)

from app.api.search import router as search_router
app.include_router(search_router)

from app.api.stats import router as stats_router
app.include_router(stats_router)

from app.api.export import router as export_router
app.include_router(export_router)

from app.api.themes import router as themes_router
app.include_router(themes_router)

from app.api.telegram import router as telegram_router
app.include_router(telegram_router)

from app.api.settings_api import router as settings_router
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])

from app.api.collections import router as collections_router
app.include_router(collections_router)

from app.api.recommendations import router as recommendations_router
app.include_router(recommendations_router)

from app.api.performers import router as performers_router
app.include_router(performers_router)

# Convenience alias so /api/capture-queue also works (without /performers/ prefix)
@app.get("/api/capture-queue", include_in_schema=False)
def capture_queue_alias(request: Request):
    return {"queue": request.app.state.db.get_capture_queue()}

from app.api.playlists import router as playlists_router
app.include_router(playlists_router)

from app.api.feed import router as feed_router
app.include_router(feed_router)

from app.api.engagement import router as engagement_router
app.include_router(engagement_router)

from app.api.notifications import router as notifications_router
app.include_router(notifications_router)

from app.api.analytics import router as analytics_router
app.include_router(analytics_router)

from app.api.assistant import router as assistant_router
app.include_router(assistant_router)

# SPA fallback — must be the last route
@app.get("/{full_path:path}", response_class=HTMLResponse)
def spa_fallback(full_path: str) -> HTMLResponse:
    dist_index_html = _get_frontend_index_html()
    if dist_index_html is not None:
        return HTMLResponse(dist_index_html, headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=404, detail="Not found")


@app.head("/{full_path:path}", response_class=HTMLResponse)
def spa_fallback_head(full_path: str) -> HTMLResponse:
    dist_index_html = _get_frontend_index_html()
    if dist_index_html is not None:
        return HTMLResponse(dist_index_html, headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=404, detail="Not found")
