from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import os
from pathlib import Path
import re
from typing import AsyncIterator
import time
import uuid

os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "__all__")

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import Database
from app.service import ResearchService


BASE_DIR = Path(__file__).resolve().parent
db = Database(
    settings.database_path,
    timeout_seconds=settings.sqlite_timeout_seconds,
    busy_timeout_ms=settings.sqlite_busy_timeout_ms,
)
service = ResearchService(settings, db)


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


async def _start_telegram_client(app: FastAPI) -> None:
    try:
        await asyncio.sleep(0)
        telegram_client = await asyncio.to_thread(_load_telegram_client)
        await asyncio.wait_for(telegram_client.start(), timeout=15)
        app.state.telegram_client = telegram_client
        print("[telegram] Pyrogram client started")
    except Exception as e:
        app.state.telegram_client = None
        print(f"[telegram] WARNING: Could not start Pyrogram client: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.db = db
    app.state.settings = settings
    app.state.service = service
    repaired_paths = db.repair_moved_repo_paths(settings.base_dir)
    if repaired_paths:
        print(f"[startup] repaired {repaired_paths} moved local media paths")

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
                print("[telegram] Pyrogram client stopped")
            except Exception:
                pass


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)


_STATIC_PREFIXES = ("/assets/", "/cached-images/", "/cached-screenshots/", "/cached-previews/", "/static/")


@app.middleware("http")
async def apply_response_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    # Skip expensive header work for static assets (they already have Cache-Control)
    if any(path.startswith(p) for p in _STATIC_PREFIXES):
        return response
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    response.headers.setdefault("X-Request-ID", request_id)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), fullscreen=(self)",
    )
    if path.startswith("/api/") or path == "/healthz":
        response.headers.setdefault("Cache-Control", "no-store")
    return response


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
    payload = {
        "app_name": settings.app_name,
        "last_run": db.get_last_run(),
        "stats": {"totals": stats.get("totals", {})},
        "is_running": service.lock.locked(),
    }
    _APP_SHELL_SUMMARY_CACHE = payload
    _APP_SHELL_SUMMARY_CACHE_EXPIRES_AT = now + 30.0
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
    status = "ok" if db_ok else "degraded"
    return JSONResponse(
        {
            "status": status,
            "running": service.lock.locked(),
            "db_ok": db_ok,
            "scheduler_running": service.running,
        },
        status_code=200 if db_ok else 503,
    )


from app.api.crawl import router as crawl_router
app.include_router(crawl_router)

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

from app.api.playlists import router as playlists_router
app.include_router(playlists_router)

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
