"""Creator-submitted feeds, takedown requests and their admin endpoints (mounted under /api/v1).

Public (no token; strict validation, body cap, honeypot, per-client + global rate limits)::

    POST /creators/feeds/submit   {url | handle+kind, kind?, name?, email?, website(honeypot)}
    POST /creators/takedown       {platform+handle | url, reason, email, website(honeypot)}

Admin (``X-Admin-Token``; never exposed through the edge gateway)::

    GET  /creators/admin/feeds?status=pending|approved|rejected|paused
    POST /creators/admin/feeds/{id}/approve|reject|pause   {reason?, fetchNow?}
    POST /creators/admin/feeds/{id}/fetch                  force-fetch (dry-run preview unless approved)
    GET  /creators/admin/takedowns?status=hidden|restored|suppressed
    POST /creators/admin/takedowns/{id}/restore|suppress   {note?}
    GET  /creators/admin/suppressions
    POST /creators/admin/suppress   {platform+handle | url, reason}   permanent suppression
    POST /creators/admin/hidden     {platform, handle, hidden}        set_hidden
    GET  /creators/admin/lanes?source=&backedOff=      adaptive lane yield / back-off
    POST /creators/admin/lanes/reset {lane}
    GET  /creators/admin/tags          related-tag frequency table (snowballing)
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.creator_index import abuse
from app.creator_index.feeds import FEED_KINDS, STATUSES, FeedError, RateLimited, admin_view
from app.creator_index.moderation import ModerationError, build_target
from app.creator_index.repository import now_iso
from app.creator_index.runtime import CreatorIndexRuntime, get_runtime
from app.security import require_admin

MAX_BODY_BYTES = 8 * 1024
NO_STORE = {"Cache-Control": "no-store"}

router = APIRouter(prefix="/creators", tags=["creator-submissions"])
admin = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


def _problem(status: int, code: str, message: str, headers: dict[str, str] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message}, headers=headers)


def runtime_of(request: Request) -> CreatorIndexRuntime:
    return get_runtime(request.app)


async def read_json_object(request: Request, limit: int = MAX_BODY_BYTES) -> dict[str, Any]:
    """Body-size-capped JSON object reader (works for chunked bodies without Content-Length too)."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise _problem(413, "payload_too_large", f"The request body may be at most {limit} bytes.")
    if "json" not in (request.headers.get("content-type") or "").lower():
        raise _problem(415, "unsupported_media_type", "Send application/json.")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise _problem(413, "payload_too_large", f"The request body may be at most {limit} bytes.")
        chunks.append(chunk)
    try:
        data = json.loads(b"".join(chunks).decode("utf-8") or "null")
    except (ValueError, UnicodeDecodeError) as exc:
        raise _problem(400, "invalid_json", "The request body is not valid JSON.") from exc
    if not isinstance(data, dict):
        raise _problem(422, "validation_error", "The request body must be a JSON object.")
    return data


def _validate(model: type[BaseModel], data: dict[str, Any]) -> Any:
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        errors = [{"field": ".".join(str(p) for p in e["loc"]), "message": e["msg"]} for e in exc.errors()[:10]]
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Invalid payload.", "errors": errors}) from exc


def _rate_limited(exc: RateLimited) -> HTTPException:
    return _problem(429, "rate_limited", "Too many requests; please try again later.",
                    {"Retry-After": str(max(1, int(exc.retry_after)))})


# ── public: feed submission ──────────────────────────────────────────────────


class FeedSubmitBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    url: str | None = Field(default=None, max_length=600)
    handle: str | None = Field(default=None, max_length=120)
    kind: Literal["rss", "atom", "jsonfeed", "peertube-channel", "bluesky", "mastodon"] | None = None
    name: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=254)
    #: honeypot: real people never see or fill this field
    website: str | None = Field(default=None, max_length=500)


class TakedownBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    platform: str | None = Field(default=None, max_length=20)
    handle: str | None = Field(default=None, max_length=120)
    url: str | None = Field(default=None, max_length=500)
    reason: str = Field(min_length=3, max_length=500)
    email: str = Field(min_length=5, max_length=254)
    website: str | None = Field(default=None, max_length=500)  # honeypot


@router.post("/feeds/submit", operation_id="creatorFeedSubmit")
async def submit_feed(request: Request) -> JSONResponse:
    rt = runtime_of(request)
    body: FeedSubmitBody = _validate(FeedSubmitBody, await read_json_object(request))
    if body.website:  # bot: pretend it worked, store and fetch nothing
        return JSONResponse({"accepted": True, "status": "pending", "duplicate": False}, status_code=202, headers=NO_STORE)
    feeds = rt.feeds
    ip_hash = abuse.hash_value(abuse.client_ip(request), await asyncio.to_thread(lambda: feeds.salt))
    try:
        status, payload = await feeds.submit(
            url=body.url, handle=body.handle, kind=body.kind, name=body.name, email=body.email,
            client_key=ip_hash, ip_hash=ip_hash,
        )
    except RateLimited as exc:
        raise _rate_limited(exc) from exc
    except FeedError as exc:
        raise _problem(503 if exc.code == "queue_full" else 422, exc.code, exc.message) from exc
    return JSONResponse(payload, status_code=status, headers=NO_STORE)


# ── public: takedown ─────────────────────────────────────────────────────────


@router.post("/takedown", operation_id="creatorTakedown")
async def request_takedown(request: Request) -> JSONResponse:
    rt = runtime_of(request)
    body: TakedownBody = _validate(TakedownBody, await read_json_object(request))
    if body.website:
        return JSONResponse({"accepted": True, "status": "hidden"}, status_code=202, headers=NO_STORE)
    mod = rt.moderation
    salt = await asyncio.to_thread(lambda: rt.feeds.salt)
    ip_hash = abuse.hash_value(abuse.client_ip(request), salt)
    try:
        mod.check_rate(ip_hash)
    except RateLimited as exc:
        raise _rate_limited(exc) from exc
    email = abuse.normalize_email(body.email)
    if not email:
        raise _problem(422, "invalid_email", "A valid contact e-mail is required.")
    email_hash = abuse.hash_value(email, salt)
    try:
        target = build_target(body.platform, body.handle, body.url)
    except ModerationError as exc:
        raise _problem(422, exc.code, exc.message) from exc
    day_ago = now_iso(time.time() - 86400)
    if await asyncio.to_thread(mod.count_recent_by_email, email_hash, day_ago) >= mod.max_per_email_day:
        raise _problem(429, "rate_limited", "Too many requests from this contact today.", {"Retry-After": "3600"})
    outcome = await asyncio.to_thread(
        mod.record_takedown, target, reason=body.reason, email_hash=email_hash, ip_hash=ip_hash,
    )
    return JSONResponse(
        {
            "id": outcome.request_id, "status": outcome.status, "matchedCreators": outcome.matched_creators,
            "matchedItems": outcome.matched_items,
            "message": "The matching creator or item is hidden now. An operator will review the request.",
        },
        status_code=201, headers=NO_STORE,
    )


# ── admin: feeds ─────────────────────────────────────────────────────────────


class ReasonBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reason: str = Field(default="", max_length=300)
    fetchNow: bool = False


class NoteBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    note: str = Field(default="", max_length=500)


class SuppressBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    platform: str | None = Field(default=None, max_length=20)
    handle: str | None = Field(default=None, max_length=120)
    url: str | None = Field(default=None, max_length=500)
    reason: str = Field(default="operator removal", max_length=500)


class HiddenBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    platform: str = Field(min_length=2, max_length=20)
    handle: str = Field(min_length=1, max_length=120)
    hidden: bool


@admin.get("/feeds", operation_id="creatorFeedsAdminList")
async def admin_list_feeds(
    request: Request,
    status: str | None = Query(default="pending", max_length=12),
    limit: int = Query(default=50, ge=1, le=200),
    before_id: int | None = Query(default=None, alias="beforeId", ge=1),
) -> dict[str, Any]:
    if status and status not in {*STATUSES, "all"}:
        raise _problem(422, "invalid_status", "status must be pending, approved, rejected, paused or all.")
    feeds = runtime_of(request).feeds
    rows = await asyncio.to_thread(feeds.list, status=None if status in (None, "all") else status, limit=limit, before_id=before_id)
    counts = {s: await asyncio.to_thread(feeds.count, s) for s in STATUSES}
    return {"feeds": rows, "nextBeforeId": rows[-1]["id"] if len(rows) == limit else None, "counts": counts,
            "kinds": list(FEED_KINDS)}


async def _feed_action(request: Request, feed_id: int, status: str, payload: dict[str, Any]) -> dict[str, Any]:
    body: ReasonBody = _validate(ReasonBody, payload)
    feeds = runtime_of(request).feeds
    result = await asyncio.to_thread(feeds.set_status, feed_id, status, body.reason)
    if result == "not_found":
        raise _problem(404, "not_found", "No such feed.")
    if result == "suppressed":
        raise _problem(409, "suppressed", "A takedown blocks this feed; restore the takedown first.")
    fetched = None
    if status == "approved" and body.fetchNow:
        row = await asyncio.to_thread(feeds.get, feed_id)
        fetched = await feeds.fetch_feed(row) if row else None
    row = await asyncio.to_thread(feeds.get, feed_id)
    out: dict[str, Any] = {"feed": _public_admin(row)}
    if fetched is not None:
        out["fetch"] = fetched
    return out


def _public_admin(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """Admin shape of a feed row (never includes the contact / IP digests)."""
    return admin_view(row) if row else None  # type: ignore[arg-type]


@admin.post("/feeds/{feed_id}/approve", operation_id="creatorFeedApprove")
async def admin_approve(request: Request, feed_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    return await _feed_action(request, feed_id, "approved", payload)


@admin.post("/feeds/{feed_id}/reject", operation_id="creatorFeedReject")
async def admin_reject(request: Request, feed_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    return await _feed_action(request, feed_id, "rejected", payload)


@admin.post("/feeds/{feed_id}/pause", operation_id="creatorFeedPause")
async def admin_pause(request: Request, feed_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    return await _feed_action(request, feed_id, "paused", payload)


@admin.post("/feeds/{feed_id}/fetch", operation_id="creatorFeedForceFetch")
async def admin_fetch(request: Request, feed_id: int) -> dict[str, Any]:
    """Force-fetch now. Approved feeds are ingested; any other status is a dry-run preview (nothing is indexed)."""
    feeds = runtime_of(request).feeds
    row = await asyncio.to_thread(feeds.get, feed_id)
    if row is None:
        raise _problem(404, "not_found", "No such feed.")
    outcome = await feeds.fetch_feed(row, ingest=row["status"] == "approved")
    return {"fetch": outcome, "ingested": row["status"] == "approved" and outcome["ok"],
            "feed": _public_admin(await asyncio.to_thread(feeds.get, feed_id))}


# ── admin: takedowns / suppressions ──────────────────────────────────────────


@admin.get("/takedowns", operation_id="creatorTakedownsAdminList")
async def admin_list_takedowns(
    request: Request, status: str | None = Query(default=None, max_length=12),
    limit: int = Query(default=50, ge=1, le=200), before_id: int | None = Query(default=None, alias="beforeId", ge=1),
) -> dict[str, Any]:
    mod = runtime_of(request).moderation
    rows = await asyncio.to_thread(mod.list_requests, status=status, limit=limit, before_id=before_id)
    return {"requests": rows, "nextBeforeId": rows[-1]["id"] if len(rows) == limit else None}


@admin.post("/takedowns/{request_id}/restore", operation_id="creatorTakedownRestore")
async def admin_restore(request: Request, request_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    body: NoteBody = _validate(NoteBody, payload)
    outcome = await asyncio.to_thread(runtime_of(request).moderation.restore, request_id, body.note)
    if outcome == "not_found":
        raise _problem(404, "not_found", "No such request.")
    if outcome == "permanent":
        raise _problem(409, "permanently_suppressed", "This removal is permanent and cannot be restored.")
    return {"restored": True, "id": request_id}


@admin.post("/takedowns/{request_id}/suppress", operation_id="creatorTakedownSuppress")
async def admin_make_permanent(request: Request, request_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    body: NoteBody = _validate(NoteBody, payload)
    if not await asyncio.to_thread(runtime_of(request).moderation.make_permanent, request_id, body.note):
        raise _problem(404, "not_found", "No such request.")
    return {"suppressed": True, "id": request_id}


@admin.get("/suppressions", operation_id="creatorSuppressionsList")
async def admin_list_suppressions(request: Request, limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    return {"suppressions": await asyncio.to_thread(runtime_of(request).moderation.list_suppressions, limit=limit)}


@admin.post("/suppress", status_code=201, operation_id="creatorSuppress")
async def admin_suppress(request: Request, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    body: SuppressBody = _validate(SuppressBody, payload)
    try:
        target = build_target(body.platform, body.handle, body.url)
    except ModerationError as exc:
        raise _problem(422, exc.code, exc.message) from exc
    outcome = await asyncio.to_thread(
        runtime_of(request).moderation.record_takedown, target, reason=body.reason, source="admin", permanent=True,
    )
    return {"id": outcome.request_id, "status": outcome.status, "matchedCreators": outcome.matched_creators,
            "matchedItems": outcome.matched_items}


@admin.post("/hidden", operation_id="creatorSetHidden")
async def admin_set_hidden(request: Request, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    body: HiddenBody = _validate(HiddenBody, payload)
    result = await asyncio.to_thread(runtime_of(request).moderation.set_hidden, body.platform, body.handle, body.hidden)
    if result == "not_found":
        raise _problem(404, "not_found", "No such creator in the index.")
    if result == "suppressed":
        raise _problem(409, "suppressed", "This creator is on the suppression list; restore the takedown instead.")
    return {"updated": True, "hidden": body.hidden}


# ── admin: adaptive crawl state ──────────────────────────────────────────────


@admin.get("/lanes", operation_id="creatorLaneStats")
async def admin_lanes(
    request: Request, source: str | None = Query(default=None, max_length=20),
    backed_off: bool = Query(default=False, alias="backedOff"), limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    adaptive = runtime_of(request).crawler.adaptive
    rows = await asyncio.to_thread(adaptive.lane_stats, source=source, limit=limit, only_backed_off=backed_off)
    return {"lanes": rows}


@admin.post("/lanes/reset", operation_id="creatorLaneReset")
async def admin_lane_reset(request: Request, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    lane = str(payload.get("lane") or "")[:200]
    if not lane or not await asyncio.to_thread(runtime_of(request).crawler.adaptive.reset_lane, lane):
        raise _problem(404, "not_found", "No such lane.")
    return {"reset": True, "lane": lane}


@admin.get("/tags", operation_id="creatorTagFrequencies")
async def admin_tags(request: Request, limit: int = Query(default=50, ge=1, le=500)) -> dict[str, Any]:
    adaptive = runtime_of(request).crawler.adaptive
    return {
        "tags": await asyncio.to_thread(adaptive.tag_frequencies, "redgifs", limit),
        "promotedLanes": await asyncio.to_thread(adaptive.discovered_lanes, "redgifs", "tag", 100),
        "niches": await asyncio.to_thread(adaptive.discovered_lanes, "redgifs", "niche", 100),
        "communities": await asyncio.to_thread(adaptive.discovered_lanes, "lemmy", "community", 100),
    }


router.include_router(admin)
