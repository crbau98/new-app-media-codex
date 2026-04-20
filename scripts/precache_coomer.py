#!/usr/bin/env python3
"""Pre-cache coomer videos onto the Render server from a residential network.

Why this exists
---------------
The Render server sits on a datacenter IP that cannot reach coomer's `n*.coomer.st`
video shards (connection reset / 504). Images work via `img.coomer.st/thumbnail/*`
but videos have no datacenter-reachable mirror. However, a residential ISP (your
home internet) CAN reach coomer.

This script, run from your laptop/desktop on a residential connection:

  1. Asks the Render server which coomer videos are missing from its disk cache.
  2. Downloads each one with yt-dlp (works from residential IPs).
  3. Uploads the file to the Render server's /upload-cached-video endpoint.

After that, every visitor to the app gets instant playback from Render's disk
cache. The cache is a 5 GB rolling LRU so it holds roughly the most recent
~300 videos (depending on size).

Requirements (on your laptop)
-----------------------------
  - Python 3.9+
  - yt-dlp            (`pip install "yt-dlp>=2026.3.0"`)
  - requests          (`pip install "requests>=2.32"`)

Environment / flags
-------------------
  --server   URL of the Render API, default https://codex-research-radar.onrender.com
  --token    Admin token (matches ADMIN_TOKEN env var on the server)
  --limit N  Only process the first N missing videos (for testing)
  --concurrency N   Parallel downloads (default 3; don't go too high — coomer
                    rate-limits a single IP)
  --dry-run  Print what would be done without downloading anything
  --keep-local   Do not delete local temp files after upload
  --temp-dir PATH  Where to download before uploading (default: system tmp)

Exit codes: 0 on success (any items skipped/failed still counted non-fatal),
1 only on unrecoverable errors (bad auth, server unreachable).
"""
from __future__ import annotations

import argparse
import concurrent.futures
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse


def _require(mod: str) -> None:
    try:
        __import__(mod)
    except ImportError:
        sys.stderr.write(
            f"Missing dependency '{mod}'. Install with: pip install {mod}\n"
        )
        sys.exit(1)


_require("requests")
import requests  # noqa: E402


# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------

DEFAULT_SERVER = os.getenv("CODEX_SERVER", "https://codex-research-radar.onrender.com")
DEFAULT_TOKEN = os.getenv("ADMIN_TOKEN", "")
DEFAULT_CONCURRENCY = int(os.getenv("PRECACHE_CONCURRENCY", "3"))
# Stay well below the server's UPLOAD_VIDEO_MAX_MB (default 500 MB). If you
# know some of your videos are larger, raise this on both ends.
MAX_FILE_BYTES = int(os.getenv("PRECACHE_MAX_FILE_MB", "500")) * 1024 * 1024


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _log(msg: str) -> None:
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def _human(bytes_: int) -> str:
    size = float(bytes_)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def _fetch_missing(server: str, token: str, source: str, limit: int) -> list[dict[str, Any]]:
    url = f"{server.rstrip('/')}/api/screenshots/cache-status"
    params = {"source": source, "missing_only": "true", "limit": max(limit, 1), "offset": 0}
    r = requests.get(url, params=params, timeout=60)
    if r.status_code >= 400:
        _log(f"cache-status failed: HTTP {r.status_code} {r.text[:200]}")
        sys.exit(1)
    data = r.json()
    total = data.get("total", 0)
    cached = data.get("cached", 0)
    missing = data.get("missing", 0)
    coverage = data.get("coverage_pct", 0.0)
    items = data.get("items", []) or []
    _log(
        f"Server reports: total={total}  cached={cached}  missing={missing}  coverage={coverage}%"
    )
    if limit:
        items = items[:limit]
    return items


_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Safari/605.1.15"
)


def _coomer_referer(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        host = ""
    # coomer/kemono DDoS-Guard expects the front-domain Referer, not the
    # n*.coomer.st mirror hostname.
    if host.endswith("coomer.st") or host.endswith("coomer.su"):
        return "https://coomer.st/"
    if any(host.endswith(s) for s in ("kemono.su", "kemono.party", "kemono.cr")):
        return f"https://{host.split('.', 1)[-1] if '.' in host else host}/"
    return f"{urlparse(url).scheme}://{urlparse(url).netloc}/"


def _build_session() -> "requests.Session":
    """A requests.Session pre-warmed with DDoS-Guard cookies on coomer/kemono.

    Coomer's file shards (n*.coomer.st) sit behind DDoS-Guard, which sets a
    chain of `__ddg*` cookies on the root domain before allowing media
    downloads. Hitting `https://coomer.st/` once at session start populates
    them; subsequent GETs to any shard reuse the cookie jar.
    """
    s = requests.Session()
    s.headers.update({
        "User-Agent": _UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "*/*",
    })
    for warmup in ("https://coomer.st/", "https://kemono.cr/"):
        try:
            s.get(warmup, timeout=15, allow_redirects=True)
        except requests.RequestException:
            pass
    return s


def _download_via_requests(
    session: "requests.Session", source_url: str, shot_id: int, temp_dir: Path,
) -> tuple[Path | None, str]:
    """Stream a direct media URL with cookies + real browser headers.

    This is the primary download path for coomer because the URLs are direct
    files, not post pages. yt-dlp's generic extractor fails here because it
    first HEADs the URL with no cookies, gets DDoS-Guard's 302 challenge, and
    bails with 'unable to download video'.
    """
    target = temp_dir / f"{shot_id}.mp4"
    headers = {
        "User-Agent": _UA,
        "Referer": _coomer_referer(source_url),
        "Accept": "video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5",
        "Accept-Encoding": "identity",  # avoid gzip on binary streams
        "Range": "bytes=0-",
    }
    try:
        with session.get(source_url, stream=True, timeout=(15, 300), headers=headers, allow_redirects=True) as r:
            if r.status_code >= 400:
                return None, f"HTTP {r.status_code}"
            ct = (r.headers.get("content-type") or "").lower()
            if ct.startswith("text/html"):
                return None, "got HTML (DDoS-Guard challenge or 404 page)"
            if not ct.startswith(("video/", "application/octet-stream", "binary/")):
                return None, f"unexpected content-type {ct!r}"
            total = 0
            with open(target, "wb") as out:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        target.unlink(missing_ok=True)
                        return None, f"file exceeds {_human(MAX_FILE_BYTES)} limit"
                    out.write(chunk)
            if total == 0:
                target.unlink(missing_ok=True)
                return None, "empty response"
            return target, ""
    except requests.RequestException as exc:
        return None, f"requests: {exc}"


def _download_via_ytdlp(source_url: str, shot_id: int, temp_dir: Path) -> tuple[Path | None, str]:
    """yt-dlp fallback for sources whose `source_url` is not a direct file."""
    try:
        from yt_dlp import YoutubeDL  # type: ignore
    except ImportError:
        return None, "yt_dlp not installed (pip install yt-dlp)"

    out_template = str(temp_dir / f"{shot_id}.%(ext)s")
    ydl_opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "outtmpl": out_template,
        "merge_output_format": "mp4",
        "socket_timeout": 60,
        "retries": 3,
        "fragment_retries": 3,
        "concurrent_fragment_downloads": 4,
        "postprocessors": [],
        "http_headers": {
            "User-Agent": _UA,
            "Referer": _coomer_referer(source_url),
        },
    }
    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.download([source_url])
    except Exception as exc:  # noqa: BLE001
        return None, f"yt-dlp: {exc}"

    for ext in ("mp4", "mkv", "webm", "mov"):
        candidate = temp_dir / f"{shot_id}.{ext}"
        if candidate.exists() and candidate.stat().st_size > 0:
            return candidate, ""
    return None, "yt-dlp produced no file"


def _upload(server: str, token: str, shot_id: int, path: Path, overwrite: bool = False) -> tuple[bool, str]:
    url = f"{server.rstrip('/')}/api/screenshots/{shot_id}/upload-cached-video"
    try:
        with open(path, "rb") as f:
            r = requests.post(
                url,
                headers={"x-admin-token": token} if token else {},
                data={"overwrite": "true" if overwrite else "false"},
                files={"file": (f"{shot_id}.mp4", f, "video/mp4")},
                timeout=(10, 300),
            )
    except requests.RequestException as exc:
        return False, f"requests: {exc}"

    if r.status_code >= 400:
        return False, f"HTTP {r.status_code} {r.text[:200]}"
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if data.get("already_cached"):
        return True, f"already cached ({_human(int(data.get('size_bytes', 0)))})"
    return True, f"ok ({_human(int(data.get('size_bytes', 0)))})"


# --------------------------------------------------------------------------
# Per-item worker
# --------------------------------------------------------------------------


def _process(
    item: dict[str, Any],
    server: str,
    token: str,
    temp_dir: Path,
    keep_local: bool,
    dry_run: bool,
    session: "requests.Session",
) -> tuple[int, bool, str]:
    shot_id = int(item["id"])
    source_url = str(item.get("source_url") or "")
    page_url = str(item.get("page_url") or "")
    if not source_url:
        return shot_id, False, "no source_url"

    if dry_run:
        return shot_id, True, f"dry-run ({source_url[:80]})"

    bare = source_url.lower().split("?")[0]
    is_direct_media = bare.endswith((".mp4", ".webm", ".mov", ".mkv"))

    reason = "not attempted"
    local_path: Path | None = None

    # Primary: streaming GET with the pre-warmed DDoS-Guard cookie jar. Works
    # for coomer/kemono direct-media URLs which are 99% of source_url values.
    if is_direct_media:
        local_path, reason = _download_via_requests(session, source_url, shot_id, temp_dir)

    # Fallback 1: yt-dlp on the direct URL (retries with its own logic).
    if local_path is None:
        lp, reason2 = _download_via_ytdlp(source_url, shot_id, temp_dir)
        if lp is not None:
            local_path = lp
        else:
            reason = f"{reason}; {reason2}"

    # Fallback 2: yt-dlp on the post page URL (sometimes extracts a different
    # CDN variant than the stored source_url).
    if local_path is None and page_url and page_url != source_url:
        lp, reason3 = _download_via_ytdlp(page_url, shot_id, temp_dir)
        if lp is not None:
            local_path = lp
        else:
            reason = f"{reason}; page: {reason3}"

    # Fallback 3: GET page_url too in case it's itself a direct file (some rows
    # store the file URL only in page_url).
    if (
        local_path is None
        and page_url
        and page_url.lower().split("?")[0].endswith((".mp4", ".webm", ".mov", ".mkv"))
        and page_url != source_url
    ):
        lp, reason4 = _download_via_requests(session, page_url, shot_id, temp_dir)
        if lp is not None:
            local_path = lp
        else:
            reason = f"{reason}; page-req: {reason4}"

    if local_path is None or not local_path.exists():
        return shot_id, False, f"download failed: {reason}"

    size = local_path.stat().st_size
    if size > MAX_FILE_BYTES:
        if not keep_local:
            local_path.unlink(missing_ok=True)
        return shot_id, False, f"file too large ({_human(size)} > {_human(MAX_FILE_BYTES)})"

    ok, upload_msg = _upload(server, token, shot_id, local_path)
    if not keep_local:
        local_path.unlink(missing_ok=True)
    return shot_id, ok, upload_msg


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def main(argv: Iterable[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Pre-cache coomer videos onto the Render server from a residential IP.",
    )
    parser.add_argument("--server", default=DEFAULT_SERVER, help="API origin (default: %(default)s)")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="Admin token (matches server ADMIN_TOKEN)")
    parser.add_argument("--source", default="coomer", help="Screenshot source to cache (default: coomer)")
    parser.add_argument("--limit", type=int, default=0, help="Process at most N missing videos (0 = all)")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--temp-dir", default="", help="Temp download directory (default: system tmp)")
    parser.add_argument("--keep-local", action="store_true", help="Do not delete local files after upload")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(list(argv))

    if not args.token:
        sys.stderr.write(
            "ERROR: provide --token or set ADMIN_TOKEN env var "
            "(must match the server's ADMIN_TOKEN)\n",
        )
        return 1

    # Quick preflight: confirm server is up and auth works via proxy-status.
    try:
        r = requests.get(
            f"{args.server.rstrip('/')}/api/screenshots/proxy-status", timeout=20,
        )
        if r.status_code >= 500:
            _log(f"server health check returned {r.status_code}; continuing anyway")
    except Exception as exc:  # noqa: BLE001
        _log(f"server unreachable: {exc}")
        return 1

    # Check yt-dlp binary availability for UX; import check done on-demand in worker.
    try:
        subprocess.run(["yt-dlp", "--version"], capture_output=True, check=False, timeout=5)
    except FileNotFoundError:
        _log(
            "note: the yt-dlp CLI is not on PATH, but the Python package may be — that's fine. "
            "If downloads fail with 'yt_dlp not installed', run: pip install yt-dlp",
        )

    temp_dir = Path(args.temp_dir) if args.temp_dir else Path(tempfile.mkdtemp(prefix="codex_precache_"))
    temp_dir.mkdir(parents=True, exist_ok=True)
    _log(f"temp dir: {temp_dir}")
    _log(f"server:   {args.server}")
    _log(f"source:   {args.source}")
    _log(f"concurrency: {args.concurrency}")
    if args.dry_run:
        _log("DRY RUN — nothing will be downloaded or uploaded")

    # Pull a big batch — the server returns up to 5000 missing items per call.
    # If the user set --limit, respect it.
    batch_limit = args.limit if args.limit > 0 else 5000
    items = _fetch_missing(args.server, args.token, args.source, batch_limit)
    if not items:
        _log("nothing missing — every video of this source is already cached")
        return 0

    _log(f"queued {len(items)} videos for pre-cache")

    successes = 0
    failures = 0
    skipped = 0
    start = time.monotonic()

    # Pre-warm a shared cookie jar so every request has DDoS-Guard cookies set.
    session = _build_session() if not args.dry_run else requests.Session()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as ex:
        futures = {
            ex.submit(
                _process,
                item,
                args.server,
                args.token,
                temp_dir,
                args.keep_local,
                args.dry_run,
                session,
            ): item
            for item in items
        }
        for i, fut in enumerate(concurrent.futures.as_completed(futures), start=1):
            item = futures[fut]
            shot_id = int(item.get("id", 0))
            try:
                _id, ok, msg = fut.result()
            except Exception as exc:  # noqa: BLE001
                _id, ok, msg = shot_id, False, f"exception: {exc}"
            if args.dry_run:
                skipped += 1
                _log(f"[{i}/{len(items)}] shot {_id}: {msg}")
            elif ok:
                successes += 1
                _log(f"[{i}/{len(items)}] shot {_id}: {msg}")
            else:
                failures += 1
                _log(f"[{i}/{len(items)}] shot {_id}: FAILED {msg}")

    elapsed = time.monotonic() - start
    _log(
        f"done in {elapsed:.0f}s: {successes} ok, {failures} failed, {skipped} dry-run",
    )

    if not args.keep_local and not args.temp_dir:
        # We made the temp dir ourselves — clean up.
        shutil.rmtree(temp_dir, ignore_errors=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
