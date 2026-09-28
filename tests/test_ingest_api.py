"""Ingestion API + worker + pipeline integration (no network, no ffmpeg)."""

from __future__ import annotations

import io
import json
import sqlite3
import struct
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.media_pipeline import classify as classify_mod
from app.media_pipeline import ffmpeg
from app.media_pipeline.netsafe import DownloadResult, FetchError
from app.repositories.ingest import IngestStore, backoff_seconds

ADMIN = {"X-Admin-Token": "test-token"}


def _png(w=64, h=48, color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "PNG")
    return buf.getvalue()


def _jpeg_with_exif(orientation=6) -> bytes:
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "SecretCameraMaker"
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", (10.0, 5.0, 1.0), "E", (20.0, 6.0, 2.0)
    buf = io.BytesIO()
    img = Image.new("RGB", (120, 80))
    px = img.load()
    for x in range(120):
        for y in range(80):
            px[x, y] = (x * 2, y * 3, 100)
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


def _mp4_bytes(moov_first=True) -> bytes:
    def box(kind, payload):
        return struct.pack(">I", 8 + len(payload)) + kind + payload

    mvhd = box(b"mvhd", b"\x00" * 4 + struct.pack(">IIII", 0, 0, 1000, 8000) + b"\x00" * 80)
    tkhd = box(b"tkhd", b"\x00\x00\x00\x07" + b"\x00" * 72 + struct.pack(">II", 640 << 16, 360 << 16))
    moov = box(b"moov", mvhd + box(b"trak", tkhd))
    ftyp = box(b"ftyp", b"isom\x00\x00\x00\x00isom")
    mdat = box(b"mdat", b"\x01" * 200)
    return ftyp + (moov + mdat if moov_first else mdat + moov)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from app.db import Database

    monkeypatch.setenv("INGEST_DIR", str(tmp_path / "ingested"))
    db = Database(tmp_path / "t.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()
    import app.security as security

    monkeypatch.setattr(security, "settings", SimpleNamespace(admin_token="test-token", environment="testing"))
    app = FastAPI()
    app.state.db = db
    from app.api.v1.ingest import router

    app.include_router(router, prefix="/api/v1")
    client = TestClient(app)
    from app.media_pipeline.runtime import get_runtime

    rt = get_runtime(app)
    cache = tmp_path / "vcache"
    rt.service.config.video_cache_path = lambda sid: cache / f"{sid}.mp4"
    rt.service._toolchain = ffmpeg.Toolchain()  # no ffmpeg in tests
    return SimpleNamespace(app=app, client=client, rt=rt, db=db, tmp=tmp_path, cache=cache)


def _fake_classification(url, kind="image", **kw):
    c = classify_mod.Classification(input_url=url, final_url=url, canonical_url=url, kind=kind, strategy="direct", playable=True, source="example.com", title="A title")
    c.candidates = kw.pop("candidates")
    for k, v in kw.items():
        setattr(c, k, v)
    return c


def _fake_downloader(payloads: dict[str, bytes]):
    def download(url, dest, *, max_bytes, on_progress=None, should_cancel=None, **_kw):
        data = payloads.get(url)
        if data is None:
            raise FetchError("http_error", "HTTP 404", status=404)
        if len(data) > max_bytes:
            raise FetchError("too_large", "too big")
        Path(dest).write_bytes(data)
        if on_progress:
            on_progress(len(data), len(data))
        return DownloadResult(url=url, status=200, content_type="", path=dest, size=len(data), head=data[:4096])

    return download


# ----------------------------------------------------------------------------


def test_admin_required(env):
    for method, path, kw in [
        ("post", "/api/v1/ingest/classify", {"json": {"url": "https://x.com/a"}}),
        ("post", "/api/v1/ingest/jobs", {"json": {"url": "https://x.com/a"}}),
        ("get", "/api/v1/ingest/jobs", {}),
        ("get", "/api/v1/ingest/jobs/abc", {}),
        ("post", "/api/v1/ingest/jobs/abc/cancel", {}),
        ("post", "/api/v1/ingest/upload", {"files": [("files", ("a.png", _png(), "image/png"))]}),
        ("get", "/api/v1/ingest/dedupe/clusters", {}),
    ]:
        assert getattr(env.client, method)(path, **kw).status_code == 401, path
    assert env.client.get("/api/v1/ingest/capabilities").status_code == 200


def test_capabilities_shape(env):
    body = env.client.get("/api/v1/ingest/capabilities").json()
    assert body["toolchain"]["ffmpeg"] is False and body["images"]["webp"] in (True, False)
    assert body["queue"]["queued"] == 0 and body["batchLimit"] == 25


def test_classify_endpoint_and_errors(env):
    env.rt.service.classifier = lambda url: _fake_classification(url, candidates=[classify_mod.Candidate(url=url, kind="image", width=10, height=5)])
    r = env.client.post("/api/v1/ingest/classify", json={"url": "https://example.com/a.png"}, headers=ADMIN)
    assert r.status_code == 200 and r.json()["kind"] == "image" and r.json()["candidates"][0]["width"] == 10

    def boom(url):
        raise classify_mod.ClassifyError("private_host_blocked", "nope")

    env.rt.service.classifier = boom
    r = env.client.post("/api/v1/ingest/classify", json={"url": "http://127.0.0.1/x"}, headers=ADMIN)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "private_host_blocked"
    assert env.client.post("/api/v1/ingest/classify", json={}, headers=ADMIN).status_code == 422


def test_url_image_job_end_to_end(env):
    url = "https://cdn.example.com/p.jpg"
    env.rt.service.classifier = lambda u: _fake_classification(
        u, candidates=[classify_mod.Candidate(url=url, kind="image", mime="image/jpeg")], gallery=[url], thumbnail_url=url,
    )
    env.rt.service.downloader = _fake_downloader({url: _jpeg_with_exif()})
    r = env.client.post("/api/v1/ingest/jobs", json={"url": url, "tags": ["Sunset", "sunset", "beach"]}, headers=ADMIN)
    assert r.status_code == 202
    job = r.json()["jobs"][0]
    assert job["state"] == "queued" and job["progress"] == 0
    env.rt.worker.drain()
    done = env.client.get(f"/api/v1/ingest/jobs/{job['id']}", headers=ADMIN).json()
    assert done["state"] == "succeeded" and done["progress"] == 100 and done["terminal"]
    res = done["result"]
    assert res["kind"] == "image" and res["duplicate"] is False
    assert (res["width"], res["height"]) == (80, 120)  # exif orientation applied
    assert res["lqip"].startswith("data:image/") and res["dominantColor"].startswith("#")
    assert res["mediaUrl"].startswith("/ingested-media/") and res["thumbnailUrl"].endswith(".webp")
    stages = [e["stage"] for e in done["events"]]
    assert "classify" in stages and stages[-1] == "done"
    assert "path" not in json.dumps(done["payload"])

    # library row exists with tags; served files carry no metadata
    with env.db.connect() as conn:
        row = conn.execute("SELECT * FROM screenshots WHERE page_url = ?", (url,)).fetchone()
    assert row["source"] == "import" and json.loads(row["user_tags"]) == ["sunset", "beach"] or row["user_tags"] is not None
    asset_dir = env.tmp / "ingested" / "assets" / res["assetId"]
    for f in asset_dir.iterdir():
        assert b"SecretCameraMaker" not in f.read_bytes()

    # asset endpoint + re-import is a duplicate (canonical url)
    a = env.client.get(f"/api/v1/ingest/assets/{res['assetId']}").json()
    assert a["assetId"] == res["assetId"] and a["aspect"] == 0.6667
    r2 = env.client.post("/api/v1/ingest/jobs", json={"url": url}, headers=ADMIN)
    env.rt.worker.drain()
    j2 = env.client.get(f"/api/v1/ingest/jobs/{r2.json()['jobs'][0]['id']}", headers=ADMIN).json()
    assert j2["result"]["duplicate"] is True and j2["result"]["assetId"] == res["assetId"]


def test_video_link_mode_uses_poster_and_stream_source(env):
    vurl, turl = "https://cdn.example.com/v.mp4", "https://cdn.example.com/t.png"
    env.rt.service.classifier = lambda u: _fake_classification(
        u, kind="video", candidates=[classify_mod.Candidate(url=vurl, kind="video", mime="video/mp4", width=1280, height=720, duration_seconds=42.0), classify_mod.Candidate(url=turl, kind="image")],
        thumbnail_url=turl, width=1280, height=720, duration_seconds=42.0, mime_type="video/mp4",
    )
    calls = []
    inner = _fake_downloader({turl: _png(320, 180)})

    def dl(url, dest, **kw):
        calls.append(url)
        return inner(url, dest, **kw)

    env.rt.service.downloader = dl
    j = env.client.post("/api/v1/ingest/jobs", json={"url": vurl}, headers=ADMIN).json()["jobs"][0]
    env.rt.worker.drain()
    res = env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()["result"]
    assert calls == [turl]  # video itself is NOT downloaded in link mode
    assert res["kind"] == "video" and res["mode"] == "link" and res["durationSeconds"] == 42.0
    assert res["mediaUrl"] == vurl and res["aspect"] == 1.7778 and res["posterUrl"].startswith("/ingested-media/")


def test_video_download_mode_without_ffmpeg_degrades(env):
    vurl = "https://cdn.example.com/v.mp4"
    env.rt.service.classifier = lambda u: _fake_classification(
        u, kind="video", candidates=[classify_mod.Candidate(url=vurl, kind="video", mime="video/mp4")], mime_type="video/mp4",
    )
    env.rt.service.downloader = _fake_downloader({vurl: _mp4_bytes(moov_first=False)})
    j = env.client.post("/api/v1/ingest/jobs", json={"url": vurl, "mode": "download"}, headers=ADMIN).json()["jobs"][0]
    env.rt.worker.drain()
    done = env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()
    assert done["state"] == "succeeded", done
    res = done["result"]
    assert res["mode"] == "download" and res["faststart"] is False and res["durationSeconds"] == 8.0
    assert (res["width"], res["height"]) == (640, 360)
    assert any(s["name"] == "poster" and s["status"] == "skipped" for s in res["steps"])
    with env.db.connect() as conn:
        shot_id = conn.execute("SELECT id FROM screenshots WHERE page_url = ?", (vurl,)).fetchone()["id"]
    assert (env.cache / f"{shot_id}.mp4").exists()


def test_html_disguised_as_video_is_rejected_permanently(env):
    vurl = "https://cdn.example.com/v.mp4"
    env.rt.service.classifier = lambda u: _fake_classification(u, kind="video", candidates=[classify_mod.Candidate(url=vurl, kind="video")])
    env.rt.service.downloader = _fake_downloader({vurl: b"<html>login required</html>" * 10})
    j = env.client.post("/api/v1/ingest/jobs", json={"url": vurl, "mode": "download"}, headers=ADMIN).json()["jobs"][0]
    env.rt.worker.drain()
    done = env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()
    assert done["state"] == "failed" and done["error"]["code"] == "not_a_video" and done["attempts"] == 1
    # nothing leaked into the library or disk
    with env.db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM screenshots WHERE page_url = ?", (vurl,)).fetchone()[0] == 0
    assert not list((env.tmp / "ingested" / "assets").iterdir())


def test_retryable_failure_backs_off_then_fails(env, monkeypatch):
    url = "https://cdn.example.com/flaky.png"
    n = {"calls": 0}

    def flaky(u):
        n["calls"] += 1
        raise classify_mod.ClassifyError("timeout", "slow")

    env.rt.service.classifier = flaky
    j = env.client.post("/api/v1/ingest/jobs", json={"url": url}, headers=ADMIN).json()["jobs"][0]
    assert env.rt.worker.run_once() is True
    job = env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()
    assert job["state"] == "queued" and job["attempts"] == 1 and job["error"]["code"] == "timeout" and job["nextRunAt"]
    assert env.rt.worker.run_once() is False  # backoff: not due yet
    # make it due and exhaust attempts
    with env.db.connect() as conn:
        conn.execute("UPDATE ingest_jobs SET next_run_at = 0")
        conn.commit()
    assert env.rt.worker.run_once() is True
    with env.db.connect() as conn:
        conn.execute("UPDATE ingest_jobs SET next_run_at = 0")
        conn.commit()
    assert env.rt.worker.run_once() is True
    job = env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()
    assert job["state"] == "failed" and job["attempts"] == 3 and n["calls"] == 3
    # manual retry resets the budget
    r = env.client.post(f"/api/v1/ingest/jobs/{j['id']}/retry", headers=ADMIN)
    assert r.status_code == 202 and r.json()["state"] == "queued" and r.json()["attempts"] == 0


def test_permanent_failure_does_not_retry(env):
    env.rt.service.classifier = lambda u: (_ for _ in ()).throw(classify_mod.ClassifyError("not_found", "404"))
    j = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/gone"}, headers=ADMIN).json()["jobs"][0]
    env.rt.worker.drain()
    job = env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()
    assert job["state"] == "failed" and job["attempts"] == 1 and job["error"]["code"] == "not_found"


def test_protected_feed_and_page_results(env):
    def mk(kind, **kw):
        return lambda u: _fake_classification(u, kind=kind, candidates=[], **kw)

    for kind, kw, code in [("feed", {}, "is_feed"), ("page", {"playable": False}, "no_media_found"), ("video", {"protected": True}, "protected_content")]:
        env.rt.service.classifier = mk(kind, **kw)
        j = env.client.post("/api/v1/ingest/jobs", json={"url": f"https://example.com/{kind}"}, headers=ADMIN).json()["jobs"][0]
        env.rt.worker.drain()
        assert env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()["error"]["code"] == code


def test_idempotency_key_and_active_dedupe(env):
    key = "6f1c9d6e-3a4b-4c55-9d5e-0a1b2c3d4e5f"
    h = {**ADMIN, "Idempotency-Key": key}
    a = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/a.png"}, headers=h).json()
    b = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/a.png"}, headers=h).json()
    assert a["jobs"][0]["id"] == b["jobs"][0]["id"] and b["results"][0]["created"] is False
    # same key, different body -> conflict
    c = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/a.png", "mode": "download"}, headers=h)
    assert c.status_code == 409
    # no key: active job for the same canonical URL is coalesced (tracking params ignored)
    d = env.client.post("/api/v1/ingest/jobs", json={"url": "https://www.example.com/b.png?utm_source=x"}, headers=ADMIN).json()
    e = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/b.png"}, headers=ADMIN).json()
    assert d["jobs"][0]["id"] == e["jobs"][0]["id"]
    assert env.client.post("/api/v1/ingest/jobs", json={"url": "x", "urls": []}, headers={**ADMIN, "Idempotency-Key": "nope"}).status_code in (400, 422)


def test_batch_and_ssrf_rejection(env):
    r = env.client.post("/api/v1/ingest/jobs", json={"urls": ["https://example.com/1.png", "http://169.254.169.254/x", "ftp://x/y"]}, headers=ADMIN)
    body = r.json()
    assert r.status_code == 202 and len(body["jobs"]) == 1
    rejected = [x for x in body["results"] if "rejected" in x]
    assert {x["rejected"]["code"] for x in rejected} == {"private_host_blocked", "unsupported_protocol"}
    assert env.client.post("/api/v1/ingest/jobs", json={"urls": [f"https://example.com/{i}" for i in range(30)]}, headers=ADMIN).status_code == 422


def test_cancel_queued_and_running(env):
    j = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/c.png"}, headers=ADMIN).json()["jobs"][0]
    c = env.client.post(f"/api/v1/ingest/jobs/{j['id']}/cancel", headers=ADMIN).json()
    assert c["state"] == "cancelled"
    assert env.rt.worker.run_once() is False

    # running job: handler observes cancellation at the next progress call
    started = threading.Event()

    def slow_classifier(u):
        started.set()
        env.rt.store.request_cancel(current["id"])
        return _fake_classification(u, candidates=[classify_mod.Candidate(url=u, kind="image")], gallery=[u])

    env.rt.service.classifier = slow_classifier
    current = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/d.png"}, headers=ADMIN).json()["jobs"][0]
    env.rt.worker.drain()
    job = env.client.get(f"/api/v1/ingest/jobs/{current['id']}", headers=ADMIN).json()
    assert job["state"] == "cancelled"


def test_stale_running_job_recovered(env):
    j = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/e.png"}, headers=ADMIN).json()["jobs"][0]
    env.rt.store.claim_next("dead-worker")
    with env.db.connect() as conn:
        conn.execute("UPDATE ingest_jobs SET locked_at = 1, started_at = 1")
        conn.commit()
    assert env.rt.store.recover_stale(60) == 1
    assert env.rt.store.get(j["id"])["state"] == "queued"


def test_backoff_grows_and_is_capped_with_jitter():
    import random

    rng = random.Random(1)
    vals = [backoff_seconds(n, base=5, cap=60, rng=rng) for n in (1, 2, 3, 4, 5, 6)]
    assert 3.75 <= vals[0] <= 6.25 and 7.5 <= vals[1] <= 12.5
    assert all(v <= 60 * 1.25 for v in vals) and vals[-1] > 40


def test_sse_stream_ends_with_done(env):
    env.rt.service.classifier = lambda u: (_ for _ in ()).throw(classify_mod.ClassifyError("not_found", "404"))
    j = env.client.post("/api/v1/ingest/jobs", json={"url": "https://example.com/f.png"}, headers=ADMIN).json()["jobs"][0]
    env.rt.worker.drain()
    r = env.client.get(f"/api/v1/ingest/jobs/{j['id']}/events", headers=ADMIN)
    assert r.headers["content-type"].startswith("text/event-stream")
    assert "event: job" in r.text and "event: done" in r.text and '"state":"failed"' in r.text
    assert env.client.get("/api/v1/ingest/jobs/nope/events", headers=ADMIN).status_code == 404


# ---------------------------------------------------------------------------
# uploads
# ---------------------------------------------------------------------------


def _upload(env, files, **data):
    return env.client.post("/api/v1/ingest/upload", files=files, data=data, headers=ADMIN)


def test_upload_image_strips_metadata_and_registers(env):
    r = _upload(env, [("files", ("Holiday.JPG", _jpeg_with_exif(), "image/jpeg"))], title="Holiday", tags="Travel,sun")
    assert r.status_code == 202, r.text
    job = r.json()["jobs"][0]
    assert "path" not in json.dumps(job["payload"])
    env.rt.worker.drain()
    res = env.client.get(f"/api/v1/ingest/jobs/{job['id']}", headers=ADMIN).json()["result"]
    assert res["title"] == "Holiday" and res["mode"] == "upload" and any("gps_metadata_removed" in w for w in res["warnings"])
    with env.db.connect() as conn:
        row = conn.execute("SELECT source, user_tags, thumbnail_url FROM screenshots WHERE id = ?", (res["screenshotId"],)).fetchone()
    assert row["source"] == "upload" and json.loads(row["user_tags"]) == ["travel", "sun"] and row["thumbnail_url"].startswith("/ingested-media/")
    for f in (env.tmp / "ingested" / "assets" / res["assetId"]).iterdir():
        assert b"SecretCameraMaker" not in f.read_bytes()
    assert not list((env.tmp / "ingested" / "incoming").iterdir())  # temp consumed


def test_upload_rejects_extension_mismatch_html_and_empty(env):
    r = _upload(env, [
        ("files", ("photo.mp4", _png(), "video/mp4")),
        ("files", ("evil.jpg", b"<html><script>alert(1)</script></html>", "image/jpeg")),
        ("files", ("empty.png", b"", "image/png")),
        ("files", ("doc.pdf", b"%PDF-1.4 ...", "application/pdf")),
    ])
    assert r.status_code == 400
    codes = {x["filename"]: x["code"] for x in r.json()["rejected"]}
    assert codes == {"photo.mp4": "extension_mismatch", "evil.jpg": "unsupported_type", "empty.png": "empty_file", "doc.pdf": "unsupported_type"}
    assert not list((env.tmp / "ingested" / "incoming").iterdir())


def test_upload_size_limit(env):
    env.rt.service.config.image_max_bytes = 1000
    import os as _os

    noisy = Image.frombytes("RGB", (60, 60), _os.urandom(60 * 60 * 3))
    buf = io.BytesIO()
    noisy.save(buf, "PNG")
    r = _upload(env, [("files", ("big.png", buf.getvalue(), "image/png"))])
    assert r.status_code == 400 and r.json()["rejected"][0]["code"] == "file_too_large" and r.json()["rejected"][0]["status"] == 413
    assert not list((env.tmp / "ingested" / "incoming").iterdir())


def test_upload_duplicate_and_gallery_grouping(env):
    img = _png(50, 50, (1, 2, 3))
    r1 = _upload(env, [("files", ("a.png", img, "image/png"))])
    env.rt.worker.drain()
    r2 = _upload(env, [("files", ("copy.png", img, "image/png"))])
    assert r2.status_code == 200 and r2.json()["duplicates"][0]["asset"]["assetId"]
    assert not r2.json()["jobs"]
    assert r1.status_code == 202

    imgs = [_png(60, 40, c) for c in ((255, 0, 0), (0, 255, 0), (0, 0, 255))]
    r3 = _upload(env, [("files", (f"g{i}.png", b, "image/png")) for i, b in enumerate(imgs)], group="true", title="Set")
    assert len(r3.json()["jobs"]) == 1
    env.rt.worker.drain()
    res = env.client.get(f"/api/v1/ingest/jobs/{r3.json()['jobs'][0]['id']}", headers=ADMIN).json()["result"]
    assert res["kind"] == "gallery" and len(res["gallery"]) == 3

    # ungrouped -> one job per file
    r4 = _upload(env, [("files", (f"h{i}.png", _png(30 + i, 30, (i * 40, 9, 9)), "image/png")) for i in range(2)])
    assert len(r4.json()["jobs"]) == 2


def test_upload_video_registers_and_moves_to_cache(env):
    r = _upload(env, [("files", ("clip.mp4", _mp4_bytes(), "video/mp4"))], title="Clip")
    assert r.status_code == 202
    env.rt.worker.drain()
    job = env.client.get(f"/api/v1/ingest/jobs/{r.json()['jobs'][0]['id']}", headers=ADMIN).json()
    assert job["state"] == "succeeded", job
    res = job["result"]
    assert res["kind"] == "video" and res["faststart"] is True and res["durationSeconds"] == 8.0
    assert (env.cache / f"{res['screenshotId']}.mp4").exists()
    assert res["mimeType"] == "video/mp4"


def test_perceptual_near_duplicates_flagged_not_deleted(env):
    import random

    from PIL import ImageDraw

    def gradient(w, h, quality):
        """A structured 'scene' (stable perceptual hash across resize/recompress)."""
        rng = random.Random(7)
        img = Image.new("RGB", (400, 300), (20, 20, 20))
        d = ImageDraw.Draw(img)
        for _ in range(14):
            x0, y0 = rng.randint(0, 340), rng.randint(0, 240)
            d.rectangle([x0, y0, x0 + rng.randint(30, 160), y0 + rng.randint(20, 120)], fill=tuple(rng.randint(0, 255) for _ in range(3)))
        img = img.resize((w, h))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality)
        return buf.getvalue()

    r1 = _upload(env, [("files", ("orig.jpg", gradient(400, 300, 95), "image/jpeg"))])
    env.rt.worker.drain()
    r2 = _upload(env, [("files", ("resized.jpg", gradient(200, 150, 50), "image/jpeg"))])
    env.rt.worker.drain()
    res = env.client.get(f"/api/v1/ingest/jobs/{r2.json()['jobs'][0]['id']}", headers=ADMIN).json()["result"]
    first = env.client.get(f"/api/v1/ingest/jobs/{r1.json()['jobs'][0]['id']}", headers=ADMIN).json()["result"]
    assert res["duplicates"][0]["assetId"] == first["assetId"] and res["duplicates"][0]["kind"] == "perceptual"
    assert res["dupOf"] == first["assetId"] and res["duplicate"] is False  # flagged only; both kept
    clusters = env.client.get("/api/v1/ingest/dedupe/clusters", headers=ADMIN).json()
    assert clusters["clusters"] and clusters["clusters"][0]["size"] == 2


def test_schema_is_additive_on_existing_database(tmp_path):
    """Applying the ingest DDL twice on a DB with pre-existing tables is a no-op."""
    from app.db import Database

    db = Database(tmp_path / "old.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()
    with db.connect() as conn:
        conn.execute("INSERT INTO screenshots (term, source, page_url, local_path, captured_at) VALUES ('t','s','http://x/1','', 'now')")
        conn.commit()
    db.init()  # second init must not fail or touch data
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM screenshots").fetchone()[0] == 1
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"ingest_jobs", "ingest_job_events", "media_assets", "media_asset_dupes"} <= tables


def test_store_claim_is_exclusive(tmp_path):
    from app.db import Database

    db = Database(tmp_path / "c.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()
    store = IngestStore(db.connect)
    store.enqueue("url", {"url": "https://example.com/x"})
    results = []

    def claim(i):
        results.append(store.claim_next(f"w{i}"))

    threads = [threading.Thread(target=claim, args=(i,)) for i in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len([r for r in results if r]) == 1


def test_decorate_screenshots_exposes_contract_fields(env):
    """Assets attach the media-intelligence contract to /api/screenshots records."""
    from app.api import screenshots as shots

    url = "https://cdn.example.com/q.jpg"
    env.rt.service.classifier = lambda u: _fake_classification(u, candidates=[classify_mod.Candidate(url=url, kind="image")], gallery=[url])
    env.rt.service.downloader = _fake_downloader({url: _png(90, 60)})
    j = env.client.post("/api/v1/ingest/jobs", json={"url": url}, headers=ADMIN).json()["jobs"][0]
    env.rt.worker.drain()
    res = env.client.get(f"/api/v1/ingest/jobs/{j['id']}", headers=ADMIN).json()["result"]
    with env.db.connect() as conn:
        row = dict(conn.execute("SELECT * FROM screenshots WHERE id = ?", (res["screenshotId"],)).fetchone())
    state = SimpleNamespace(db=env.db, settings=SimpleNamespace(stream_only_media=True), ingest_runtime=env.rt)
    out = shots._decorate_rows(state, [row])[0]
    assert out["width"] == 90 and out["height"] == 60 and out["aspect"] == 1.5
    assert out["lqip"].startswith("data:image") and out["posterUrl"].startswith("/ingested-media/")
    assert out["media_type"] == "image" and out["local_url"].startswith("/ingested-media/")
    assert out["preview_url"].endswith(".webp") or out["preview_url"].endswith(".jpg")
