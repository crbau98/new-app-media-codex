"""Creator index API (mounted under /api/v1).

Public, CDN-friendly reads:  GET /creators/index, GET /creators/index/stats
Public hidden-key list:      GET /creators/index/hidden  (platform:handle keys the directory must not show)
Admin-only writes:           POST /creators/index/crawl, POST /creators/index/observe

Feed submission, takedown and their admin endpoints live in ``submissions_api.py``.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.creator_index.observe import ObserveBody, to_observation
from app.creator_index.repository import DEFAULT_LIMIT, MAX_LIMIT, SORTS, InvalidCursor
from app.creator_index.runtime import CreatorIndexRuntime, get_runtime
from app.security import require_admin

router = APIRouter(prefix="/creators/index", tags=["creator-index"])

PUBLIC_CACHE = {"Cache-Control": "public, max-age=60, s-maxage=300"}


def _problem(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def runtime_of(request: Request) -> CreatorIndexRuntime:
    return get_runtime(request.app)


@router.get("", operation_id="creatorIndexList")
async def list_index(
    request: Request,
    cursor: str | None = Query(default=None, max_length=600),
    limit: int = Query(default=DEFAULT_LIMIT),
    tag: str | None = Query(default=None, max_length=60),
    q: str | None = Query(default=None, max_length=80),
    sort: str = Query(default="smart"),
    platform: str | None = Query(default=None, max_length=20),
) -> JSONResponse:
    sort = (sort or "smart").lower()
    if sort not in SORTS:
        raise _problem(400, "invalid_sort", "sort must be smart, newest, popular or count.")
    rt = runtime_of(request)
    try:
        body = await asyncio.to_thread(
            rt.repo.list, cursor=cursor or None, limit=max(1, min(MAX_LIMIT, limit)), tag=tag or None,
            q=q or None, sort=sort, platform=platform or None,
        )
    except InvalidCursor as exc:
        raise _problem(400, "invalid_cursor", str(exc)) from exc
    return JSONResponse(body, headers=PUBLIC_CACHE)


@router.get("/stats", operation_id="creatorIndexStats")
async def index_stats(request: Request) -> JSONResponse:
    rt = runtime_of(request)
    stats = await asyncio.to_thread(rt.repo.stats)
    stats["crawlRunning"] = rt.crawler.running
    return JSONResponse(stats, headers=PUBLIC_CACHE)


@router.get("/hidden", operation_id="creatorIndexHidden")
async def hidden_keys(request: Request) -> JSONResponse:
    """Keys (``platform label lower-cased : alphanumeric handle``, i.e. the edge's creator dedupe key) of hidden /
    suppressed creators, so live-lane results can be filtered the same way index reads are. No reasons, contacts
    or timestamps are exposed."""
    rt = runtime_of(request)
    keys = await asyncio.to_thread(rt.repo.hidden_keys)
    return JSONResponse({"keys": keys}, headers={"Cache-Control": "public, max-age=30, s-maxage=60"})


@router.post("/crawl", status_code=202, dependencies=[Depends(require_admin)], operation_id="creatorIndexCrawl")
async def crawl_now(
    request: Request,
    wait: bool = Query(default=False),
    source: str | None = Query(default=None, max_length=20),
) -> JSONResponse:
    rt = runtime_of(request)
    if source and source not in {"all", "redgifs", "bluesky", "mastodon", "lemmy", "peertube", "feeds"}:
        raise _problem(422, "invalid_source", "Unknown source.")
    if rt.crawler.running:
        return JSONResponse({"started": False, "running": True}, status_code=202)
    if wait:
        report = await rt.crawler.run_once(only=source)
        return JSONResponse({
            "started": True, "state": report.state, "pages": report.pages,
            "creatorsUpserted": report.creators, "errors": report.errors[:20],
        })
    rt.task = asyncio.create_task(rt.crawler.run_once(only=source))
    return JSONResponse({"started": True, "running": True}, status_code=202)


@router.post("/observe", dependencies=[Depends(require_admin)], operation_id="creatorIndexObserve")
async def observe(request: Request, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        body = ObserveBody.model_validate(payload)
    except ValidationError as exc:
        errors = [{"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()[:10]]
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Invalid payload.", "errors": errors}) from exc
    rt = runtime_of(request)
    observations = [o for o in (to_observation(c) for c in body.creators) if o is not None]
    written = await asyncio.to_thread(rt.repo.upsert, observations) if observations else 0
    return {"received": len(body.creators), "accepted": written, "rejected": len(body.creators) - len(observations)}
