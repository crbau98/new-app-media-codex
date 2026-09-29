"""Ingestion API (v1): classify URLs, enqueue import jobs, upload files, poll
job status (JSON or SSE), cancel/retry, inspect assets and duplicate clusters.

All mutating and outbound-request endpoints are admin protected.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from app.media_pipeline import classify as classify_mod
from app.media_pipeline import images
from app.media_pipeline.canonical import canonicalize_url
from app.media_pipeline.contract import asset_public
from app.media_pipeline.hashing import DEFAULT_PHASH_THRESHOLD, cluster_hashes
from app.media_pipeline.netsafe import UnsafeUrlError, validate_url
from app.media_pipeline.runtime import IngestRuntime, get_runtime
from app.media_pipeline.sniff import extension_matches, sniff_bytes
from app.security import require_admin

router = APIRouter(prefix="/ingest", tags=["ingest"])

MAX_BATCH_URLS = 25
MAX_UPLOAD_FILES = 24
SNIFF_BYTES = 64 * 1024
COPY_CHUNK = 1024 * 1024
MIN_FREE_BYTES = 300 * 1024 * 1024

_STATUS_FOR_CODE = {
    "not_found": 404, "auth_required": 401, "forbidden": 403, "private_host_blocked": 400, "unsupported_protocol": 400,
    "invalid_url": 400, "url_required": 400, "credentials_not_allowed": 400, "port_not_allowed": 400,
    "timeout": 504, "connect_failed": 502, "dns_failure": 502, "tls_error": 502, "too_many_redirects": 502, "http_error": 502,
}


def _problem(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def runtime_of(request: Request) -> IngestRuntime:
    return get_runtime(request.app)


def _limits(rt: IngestRuntime) -> tuple[int, int]:
    return rt.service.config.image_max_bytes, rt.service.config.video_max_bytes


# ---------------------------------------------------------------------------
# capabilities / classify
# ---------------------------------------------------------------------------


@router.get("/capabilities", operation_id="ingestCapabilities")
async def capabilities(request: Request) -> dict[str, Any]:
    rt = runtime_of(request)
    caps = await asyncio.to_thread(rt.service.capabilities)
    caps["queue"] = await asyncio.to_thread(rt.store.counts)
    caps["batchLimit"] = MAX_BATCH_URLS
    return caps


@router.post("/classify", dependencies=[Depends(require_admin)], operation_id="ingestClassify")
async def classify_url_endpoint(request: Request, body: dict = Body(...)) -> dict[str, Any]:
    url = str(body.get("url") or "").strip()
    if not url:
        raise _problem(422, "url_required", "A url is required.")
    rt = runtime_of(request)
    try:
        result = await asyncio.to_thread(rt.service.classifier, url)
    except classify_mod.ClassifyError as exc:
        raise _problem(_STATUS_FOR_CODE.get(exc.code, 502), exc.code, str(exc)) from exc
    return result.to_dict()


# ---------------------------------------------------------------------------
# jobs
# ---------------------------------------------------------------------------


def _clean_tags(raw: Any) -> list[str]:
    if isinstance(raw, str):
        raw = raw.split(",")
    if not isinstance(raw, list):
        return []
    tags = []
    for t in raw:
        t = str(t).strip().lower()[:40]
        if t and t not in tags:
            tags.append(t)
    return tags[:20]


@router.post("/jobs", status_code=202, dependencies=[Depends(require_admin)], operation_id="ingestEnqueue")
async def enqueue_jobs(request: Request, body: dict = Body(...)) -> JSONResponse:
    urls_raw = body.get("urls") if isinstance(body.get("urls"), list) else [body.get("url")]
    urls = [str(u).strip() for u in urls_raw if u and str(u).strip()]
    if not urls:
        raise _problem(422, "url_required", "Provide url or urls.")
    if len(urls) > MAX_BATCH_URLS:
        raise _problem(422, "batch_too_large", f"At most {MAX_BATCH_URLS} URLs per request.")
    mode = str(body.get("mode") or "auto")
    if mode not in {"auto", "link", "download"}:
        raise _problem(422, "invalid_mode", "mode must be auto, link or download.")
    tags = _clean_tags(body.get("tags"))
    title = str(body.get("title") or "").strip()[:200] or None
    force = bool(body.get("force"))
    idem = request.headers.get("Idempotency-Key")
    if idem:
        try:
            uuid.UUID(idem)
        except ValueError as exc:
            raise _problem(400, "invalid-idempotency-key", "Idempotency-Key must be a uuid.") from exc

    rt = runtime_of(request)
    results: list[dict[str, Any]] = []
    for url in urls:
        try:
            validate_url(url)
        except UnsafeUrlError as exc:
            results.append({"url": url, "rejected": {"code": exc.code, "message": str(exc)}})
            continue
        canonical = canonicalize_url(url)
        payload = {"url": url, "mode": mode, "tags": tags, "title": title, "force": force}
        req_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        key = f"{idem}:{hashlib.sha1(url.encode()).hexdigest()[:12]}" if idem else None  # noqa: S324 - not security relevant
        job, created, conflict = await asyncio.to_thread(
            rt.store.enqueue, "url", payload, idempotency_key=key, request_hash=req_hash, dedupe_key=f"url:{canonical}",
        )
        if conflict:
            raise _problem(409, "idempotency-conflict", "Idempotency-Key was already used with a different request body.")
        results.append({"url": url, "job": job, "created": created})
    if any("job" in r and r["created"] for r in results):
        rt.worker.notify()
    return JSONResponse(
        status_code=202,
        content={"jobs": [r["job"] for r in results if "job" in r], "results": results},
        headers={"Location": "/api/v1/ingest/jobs"},
    )


@router.get("/jobs", dependencies=[Depends(require_admin)], operation_id="ingestListJobs")
async def list_jobs(request: Request, state: str | None = Query(default=None, pattern="^(queued|running|succeeded|failed|cancelled)$"), limit: int = Query(default=30, ge=1, le=100)) -> dict[str, Any]:
    rt = runtime_of(request)
    jobs = await asyncio.to_thread(rt.store.list, state=state, limit=limit)
    return {"jobs": jobs, "counts": await asyncio.to_thread(rt.store.counts)}


@router.get("/jobs/{job_id}", dependencies=[Depends(require_admin)], operation_id="ingestGetJob")
async def get_job(job_id: str, request: Request, events: bool = Query(default=True)) -> dict[str, Any]:
    rt = runtime_of(request)
    job = await asyncio.to_thread(rt.store.get, job_id, with_events=events)
    if job is None:
        raise _problem(404, "not-found", "No such job.")
    return job


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(require_admin)], operation_id="ingestCancelJob")
async def cancel_job(job_id: str, request: Request) -> dict[str, Any]:
    rt = runtime_of(request)
    job = await asyncio.to_thread(rt.store.request_cancel, job_id)
    if job is None:
        raise _problem(404, "not-found", "No such job.")
    return job


@router.post("/jobs/{job_id}/retry", status_code=202, dependencies=[Depends(require_admin)], operation_id="ingestRetryJob")
async def retry_job(job_id: str, request: Request) -> dict[str, Any]:
    rt = runtime_of(request)
    job = await asyncio.to_thread(rt.store.retry, job_id)
    if job is None:
        raise _problem(404, "not-found", "No such job.")
    rt.worker.notify()
    return job


@router.get("/jobs/{job_id}/events", dependencies=[Depends(require_admin)], operation_id="ingestJobEvents")
async def job_events(job_id: str, request: Request, max_seconds: int = Query(default=900, ge=5, le=3600)) -> StreamingResponse:
    """Server-Sent Events: one `job` event per state/progress change, then
    `done`. Clients that cannot use SSE poll GET /jobs/{id} instead."""
    rt = runtime_of(request)
    if await asyncio.to_thread(rt.store.get, job_id) is None:
        raise _problem(404, "not-found", "No such job.")

    async def stream():
        last: str | None = None
        waited = 0.0
        while waited < max_seconds:
            if await request.is_disconnected():
                return
            job = await asyncio.to_thread(rt.store.get, job_id, with_events=True)
            if job is None:
                return
            snapshot = json.dumps(job, separators=(",", ":"), sort_keys=True)
            if snapshot != last:
                last = snapshot
                yield f"event: job\ndata: {snapshot}\n\n"
            else:
                yield ": keepalive\n\n"
            if job["terminal"]:
                yield f"event: done\ndata: {json.dumps({'state': job['state']})}\n\n"
                return
            await asyncio.sleep(1.0)
            waited += 1.0

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# upload
# ---------------------------------------------------------------------------


async def _stream_upload(rt: IngestRuntime, upload: UploadFile) -> dict[str, Any]:
    """Copy one upload to the incoming dir, enforcing size limits and magic-byte
    validation. Returns the job file descriptor or raises HTTPException."""
    image_max, video_max = _limits(rt)
    incoming = rt.service.config.incoming_dir
    incoming.mkdir(parents=True, exist_ok=True)
    name = upload.filename or "upload"
    tmp = incoming / f"{uuid.uuid4().hex}.part"
    sha = hashlib.sha256()
    total = 0
    sniffed = None
    try:
        with open(tmp, "wb") as out:
            while True:
                chunk = await upload.read(COPY_CHUNK)
                if not chunk:
                    break
                if sniffed is None:
                    sniffed = sniff_bytes(chunk[:SNIFF_BYTES])
                    if not sniffed.is_media:
                        raise _problem(415, "unsupported_type", f"{name}: not a supported image or video (detected {sniffed.kind}).")
                    if not extension_matches(sniffed.mime, name):
                        raise _problem(415, "extension_mismatch", f"{name}: file contents are {sniffed.mime}, which does not match the file extension.")
                    if sniffed.detail == "heic" and not images.heif_supported():
                        raise _problem(415, "heic_unsupported", f"{name}: HEIC images are not supported on this server.")
                limit = image_max if sniffed.kind == "image" else video_max
                total += len(chunk)
                if total > limit:
                    raise _problem(413, "file_too_large", f"{name}: exceeds the {limit // (1024 * 1024)} MB limit for {sniffed.kind} files.")
                if total % (16 * COPY_CHUNK) < COPY_CHUNK:
                    free = shutil.disk_usage(incoming).free
                    if free < MIN_FREE_BYTES:
                        raise _problem(507, "insufficient_storage", "The server is low on disk space.")
                sha.update(chunk)
                out.write(chunk)
        if total == 0 or sniffed is None:
            raise _problem(400, "empty_file", f"{name}: the file is empty.")
        final = incoming / f"{uuid.uuid4().hex}{sniffed.ext or ''}"
        os.replace(tmp, final)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return {"path": str(final), "filename": name[:200], "sha256": sha.hexdigest(), "kind": sniffed.kind, "mime": sniffed.mime, "size": total}


@router.post("/upload", status_code=202, dependencies=[Depends(require_admin)], operation_id="ingestUpload")
async def upload_files(
    request: Request,
    files: list[UploadFile] = File(...),
    title: str = Form(default=""),
    tags: str = Form(default=""),
    group: bool = Form(default=False),
    force: bool = Form(default=False),
) -> JSONResponse:
    if not files:
        raise _problem(400, "no_files", "No files were uploaded.")
    if len(files) > MAX_UPLOAD_FILES:
        raise _problem(422, "too_many_files", f"At most {MAX_UPLOAD_FILES} files per upload.")
    rt = runtime_of(request)
    image_max, video_max = _limits(rt)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > (video_max + image_max * MAX_UPLOAD_FILES + 1_000_000):
        raise _problem(413, "file_too_large", "The upload is larger than the configured limit.")

    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    for upload in files:
        try:
            desc = await _stream_upload(rt, upload)
        except HTTPException as exc:
            d = exc.detail if isinstance(exc.detail, dict) else {"code": "rejected", "message": str(exc.detail)}
            rejected.append({"filename": upload.filename, **d, "status": exc.status_code})
            continue
        if not force:
            existing = await asyncio.to_thread(rt.store.find_asset, sha256=desc["sha256"])
            if existing:
                Path(desc["path"]).unlink(missing_ok=True)
                duplicates.append({"filename": desc["filename"], "asset": asset_public(existing, rt.service.config.public_prefix)})
                continue
        accepted.append(desc)

    jobs: list[dict[str, Any]] = []
    tag_list = _clean_tags(tags)
    label = title.strip()[:200] or None
    batches: list[list[dict[str, Any]]]
    if group and len(accepted) > 1 and all(a["kind"] == "image" for a in accepted):
        batches = [accepted]
    else:
        batches = [[a] for a in accepted]
    idem = request.headers.get("Idempotency-Key")
    for batch in batches:
        payload = {"files": batch, "title": label, "tags": tag_list, "force": force}
        dedupe = "upload:" + hashlib.sha256("|".join(sorted(f["sha256"] for f in batch)).encode()).hexdigest()[:32]
        key = f"{idem}:{dedupe}" if idem else None
        job, created, _conflict = await asyncio.to_thread(rt.store.enqueue, "upload", payload, idempotency_key=key, dedupe_key=dedupe)
        if not created:
            for f in batch:  # the earlier identical job owns its own copy
                Path(f["path"]).unlink(missing_ok=True)
        jobs.append(job)
    if jobs:
        rt.worker.notify()
    status = 202 if jobs else (200 if duplicates else 400)
    return JSONResponse(status_code=status, content={"jobs": jobs, "rejected": rejected, "duplicates": duplicates})


# ---------------------------------------------------------------------------
# assets + dedupe
# ---------------------------------------------------------------------------


@router.get("/assets/{asset_id}", operation_id="ingestGetAsset")
async def get_asset(asset_id: str, request: Request) -> dict[str, Any]:
    rt = runtime_of(request)
    asset = await asyncio.to_thread(rt.store.get_asset, asset_id)
    if asset is None:
        raise _problem(404, "not-found", "No such asset.")
    body = asset_public(asset, rt.service.config.public_prefix)
    body["duplicates"] = await asyncio.to_thread(rt.store.dupes_of, asset_id)
    return body


@router.get("/dedupe/clusters", dependencies=[Depends(require_admin)], operation_id="ingestDuplicateClusters")
async def duplicate_clusters(request: Request, threshold: int = Query(default=DEFAULT_PHASH_THRESHOLD, ge=0, le=16)) -> dict[str, Any]:
    """Near-duplicate clusters by perceptual-hash hamming distance. Read-only:
    nothing is merged or deleted."""
    rt = runtime_of(request)
    index = await asyncio.to_thread(rt.store.phash_index, 20_000)
    clusters = await asyncio.to_thread(cluster_hashes, index, threshold)
    return {"threshold": threshold, "clusters": [{"assetIds": c, "size": len(c)} for c in clusters], "scanned": len(index)}
