"""Ingestion orchestration: URL jobs and upload jobs.

Handlers run inside ``IngestWorker`` threads. They classify / download /
normalise / register and never touch the event loop. Everything optional
(ffmpeg, HEIC, AVIF) degrades to a warning in the job result.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from app.media_pipeline import classify as classify_mod
from app.media_pipeline import ffmpeg, images, video
from app.media_pipeline.contract import PUBLIC_PREFIX, asset_public
from app.media_pipeline.hashing import DEFAULT_PHASH_THRESHOLD, find_near_duplicates, sha256_file
from app.media_pipeline.netsafe import FetchError, UnsafeUrlError, safe_download
from app.media_pipeline.sniff import extension_matches, sniff_bytes
from app.repositories.ingest import IngestStore
from app.workers.ingest import JobContext, PermanentJobError, RetryableJobError

logger = logging.getLogger(__name__)

MAX_GALLERY_IMAGES = 24
PERMANENT_CLASSIFY_CODES = {
    "not_found", "auth_required", "forbidden", "private_host_blocked", "unsupported_protocol", "invalid_url",
    "url_required", "credentials_not_allowed", "port_not_allowed",
}
PERMANENT_FETCH_CODES = {"too_large", "empty_response", "cancelled"}


def resolve_ingest_root() -> Path:
    explicit = os.getenv("INGEST_DIR")
    if explicit:
        return Path(explicit).expanduser()
    for var, parent in (("APP_DATA_DIR", False), ("DATABASE_PATH", True), ("IMAGE_DIR", True)):
        value = os.getenv(var)
        if value:
            base = Path(value).expanduser()
            return (base.parent if parent else base) / "ingested"
    return Path(__file__).resolve().parents[2] / "data" / "ingested"


@dataclass
class IngestConfig:
    root: Path = field(default_factory=resolve_ingest_root)
    public_prefix: str = PUBLIC_PREFIX
    image_max_bytes: int = field(default_factory=lambda: int(float(os.getenv("INGEST_IMAGE_MAX_MB", "40")) * 1024 * 1024))
    video_max_bytes: int = field(default_factory=lambda: int(float(os.getenv("INGEST_VIDEO_MAX_MB", "1500")) * 1024 * 1024))
    download_videos_default: bool = field(default_factory=lambda: os.getenv("INGEST_DOWNLOAD_VIDEOS", "").lower() in {"1", "true", "yes"})
    normalize_videos: bool = field(default_factory=lambda: os.getenv("INGEST_NORMALIZE_VIDEO", "1").lower() in {"1", "true", "yes"})
    hls_ladder: bool = field(default_factory=lambda: os.getenv("MEDIA_HLS_LADDER", "").lower() in {"1", "true", "yes"})
    video_cache_path: Callable[[int], Path] | None = None
    evict_video_cache: Callable[[], None] | None = None

    @property
    def assets_dir(self) -> Path:
        return self.root / "assets"

    @property
    def incoming_dir(self) -> Path:
        return self.root / "incoming"

    def ensure(self) -> None:
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.incoming_dir.mkdir(parents=True, exist_ok=True)


class IngestService:
    def __init__(
        self,
        db: Any,
        store: IngestStore,
        config: IngestConfig | None = None,
        *,
        classifier: Callable[..., classify_mod.Classification] = classify_mod.classify_url,
        downloader: Callable[..., Any] = safe_download,
        toolchain: ffmpeg.Toolchain | None = None,
        runner: Callable[..., ffmpeg.RunResult] = ffmpeg.run,
    ):
        self.db = db
        self.store = store
        self.config = config or IngestConfig()
        self.classifier = classifier
        self.downloader = downloader
        self._toolchain = toolchain
        self.runner = runner

    @property
    def tc(self) -> ffmpeg.Toolchain:
        return self._toolchain or ffmpeg.toolchain()

    def handlers(self) -> dict[str, Callable[[JobContext], dict[str, Any]]]:
        return {"url": self.run_url_job, "upload": self.run_upload_job}

    def capabilities(self) -> dict[str, Any]:
        from app.media_pipeline import ytdlp_adapter

        return {
            "toolchain": self.tc.describe(),
            "images": {"webp": images.webp_supported(), "avif": images.avif_supported(), "heic": images.heif_supported()},
            "ytdlp": ytdlp_adapter.ytdlp_available(),
            "limits": {"imageMaxBytes": self.config.image_max_bytes, "videoMaxBytes": self.config.video_max_bytes},
            "downloadVideosDefault": self.config.download_videos_default,
            "hlsLadder": self.config.hls_ladder,
        }

    # ------------------------------------------------------------------
    # screenshots registry helpers
    # ------------------------------------------------------------------

    def _register_screenshot(self, *, term: str, source: str, page_url: str, source_url: str | None, thumbnail_url: str | None, tags: list[str] | None) -> tuple[int, bool]:
        inserted = self.db.insert_screenshot(term=term or "import", source=source, page_url=page_url, source_url=source_url, thumbnail_url=thumbnail_url)
        with self.db.connect() as conn:
            row = conn.execute("SELECT id FROM screenshots WHERE page_url = ?", (page_url,)).fetchone()
            if row is None:
                raise PermanentJobError("register_failed", "could not create the library record")
            shot_id = int(row["id"])
            if tags and inserted:
                conn.execute("UPDATE screenshots SET user_tags = ? WHERE id = ?", (json.dumps(tags[:20]), shot_id))
                conn.commit()
        return shot_id, inserted

    def _flag_duplicates(self, asset_id: str, sha: str | None, phash: str | None) -> list[dict[str, Any]]:
        found: dict[str, dict[str, Any]] = {}
        if sha:
            other = self.store.find_asset(sha256=sha)
            if other and other["id"] != asset_id:
                found[other["id"]] = {"assetId": other["id"], "kind": "exact", "distance": 0}
        if phash:
            index = [(i, h) for i, h in self.store.phash_index() if i != asset_id]
            for other_id, dist in find_near_duplicates(phash, index, DEFAULT_PHASH_THRESHOLD):
                found.setdefault(str(other_id), {"assetId": str(other_id), "kind": "perceptual", "distance": dist})
        dupes = sorted(found.values(), key=lambda d: d["distance"])
        for d in dupes:
            self.store.add_dupe(asset_id, d["assetId"], d["kind"], d["distance"])
        if dupes:
            self.store.update_asset(asset_id, {"dup_of": dupes[0]["assetId"]})
        return dupes

    def _asset_result(self, asset_id: str, *, duplicate: bool = False, dupes: list[dict[str, Any]] | None = None, warnings: list[str] | None = None, steps: list[dict[str, Any]] | None = None, mode: str | None = None) -> dict[str, Any]:
        asset = self.store.get_asset(asset_id) or {"id": asset_id}
        out = asset_public(asset, self.config.public_prefix)
        out["duplicate"] = duplicate
        if dupes:
            out["duplicates"] = dupes
        if warnings:
            out["warnings"] = list(dict.fromkeys(warnings))
        if steps:
            out["steps"] = steps
        if mode:
            out["mode"] = mode
        return out

    # ------------------------------------------------------------------
    # URL jobs
    # ------------------------------------------------------------------

    def run_url_job(self, ctx: JobContext) -> dict[str, Any]:
        payload = ctx.payload
        url = str(payload.get("url") or "")
        mode = str(payload.get("mode") or "auto")
        force = bool(payload.get("force"))
        tags = [str(t) for t in (payload.get("tags") or []) if str(t).strip()]
        self.config.ensure()

        ctx.progress("classify", 3, "Classifying URL")
        try:
            cls = self.classifier(url)
        except classify_mod.ClassifyError as exc:
            if exc.code in PERMANENT_CLASSIFY_CODES:
                raise PermanentJobError(exc.code, str(exc)) from exc
            raise RetryableJobError(exc.code, str(exc)) from exc
        ctx.progress("classify", 15, f"Detected {cls.kind} via {cls.strategy}")

        if cls.protected:
            raise PermanentJobError("protected_content", "This stream is DRM-protected or requires authentication and cannot be imported.")
        if cls.kind == "feed":
            raise PermanentJobError("is_feed", "This URL is a feed. Import individual items from it instead.")
        if not cls.playable or cls.kind in {"page", "unsupported"}:
            raise PermanentJobError("no_media_found", "No importable image or video was found at this URL.")

        existing = self.store.find_asset(canonical_url=cls.canonical_url)
        if existing and not force:
            ctx.progress("dedupe", 100, "Already in your library")
            return self._asset_result(existing["id"], duplicate=True, mode="existing")

        asset_id = uuid.uuid4().hex[:16]
        adir = self.config.assets_dir / asset_id
        adir.mkdir(parents=True, exist_ok=True)
        try:
            if cls.kind in {"image", "gallery"}:
                return self._import_images_from_url(ctx, cls, asset_id, adir, tags, force)
            return self._import_video_from_url(ctx, cls, asset_id, adir, tags, mode, force)
        except BaseException:
            shutil.rmtree(adir, ignore_errors=True)
            raise

    def _download(self, ctx: JobContext, url: str, dest: Path, max_bytes: int, stage: str, lo: int, hi: int) -> Any:
        last = {"pct": -1}

        def on_progress(done: int, total: int | None) -> None:
            if total:
                pct = lo + int((hi - lo) * done / total)
                if pct != last["pct"] and pct % 5 == 0:
                    last["pct"] = pct
                    ctx.store.progress(ctx.id, stage, pct)

        try:
            return self.downloader(
                url, str(dest), max_bytes=max_bytes, on_progress=on_progress, should_cancel=ctx.cancelled,
            )
        except UnsafeUrlError as exc:
            raise PermanentJobError(exc.code, str(exc)) from exc
        except FetchError as exc:
            if exc.code == "cancelled":
                from app.workers.ingest import JobCancelled

                raise JobCancelled() from exc
            if exc.code in PERMANENT_FETCH_CODES or (exc.status and 400 <= exc.status < 500 and exc.status != 429):
                raise PermanentJobError(exc.code, str(exc)) from exc
            raise RetryableJobError(exc.code, str(exc)) from exc

    def _import_images_from_url(self, ctx: JobContext, cls: classify_mod.Classification, asset_id: str, adir: Path, tags: list[str], force: bool) -> dict[str, Any]:
        urls = (cls.gallery or [c.url for c in cls.candidates if c.kind == "image"][:1])[:MAX_GALLERY_IMAGES]
        if not urls:
            raise PermanentJobError("no_media_found", "No image found.")
        gallery: list[dict[str, Any]] = []
        first: images.ImageResult | None = None
        warnings: list[str] = list(cls.warnings)
        for idx, image_url in enumerate(urls):
            lo = 20 + int(60 * idx / len(urls))
            hi = 20 + int(60 * (idx + 1) / len(urls))
            tmp = self.config.incoming_dir / f"{asset_id}-{idx}.src"
            try:
                dl = self._download(ctx, image_url, tmp, self.config.image_max_bytes, "download", lo, hi)
                if not sniff_bytes(dl.head).kind == "image":
                    warnings.append(f"skipped_non_image:{idx}")
                    continue
                ctx.progress("process", hi, f"Processing image {idx + 1}/{len(urls)}")
                try:
                    res = images.process_image(tmp, adir, f"{idx:02d}")
                except images.ImageError as exc:
                    warnings.append(f"image_{idx}_{exc.code}")
                    continue
            finally:
                tmp.unlink(missing_ok=True)
            if first is None:
                first = res
                if not force:
                    other = self.store.find_asset(sha256=res.sha256)
                    if other and len(urls) == 1:
                        shutil.rmtree(adir, ignore_errors=True)
                        return self._asset_result(other["id"], duplicate=True, mode="existing")
            gallery.append({"full": res.files["full"], "thumb": res.files.get("thumb"), "width": res.width, "height": res.height, "lqip": res.lqip})
            warnings.extend(res.warnings)
        if first is None:
            raise PermanentJobError("invalid_image", "None of the images at this URL could be processed.")
        ctx.progress("register", 90, "Adding to library")
        thumb = f"{asset_id}/{first.files.get('thumb')}"
        shot_id, _ = self._register_screenshot(
            term=cls.title or cls.source, source="import", page_url=cls.canonical_url,
            source_url=f"{self.config.public_prefix}/{asset_id}/{first.files['full']}",
            thumbnail_url=f"{self.config.public_prefix}/{thumb}", tags=tags,
        )
        self.store.insert_asset(asset_id, {
            "screenshot_id": shot_id, "kind": "gallery" if len(gallery) > 1 else "image", "title": cls.title,
            "canonical_url": cls.canonical_url, "source_url": cls.final_url, "origin": cls.strategy, "sha256": first.sha256,
            "phash": first.phash, "dhash": first.dhash, "width": first.width, "height": first.height, "aspect": first.aspect,
            "mime_type": first.mime_type, "dominant_color": first.dominant_color, "lqip": first.lqip,
            "media_path": first.files["full"], "thumb_path": first.files.get("thumb"),
            "poster_path": first.files.get("poster"), "gallery_json": json.dumps(gallery) if len(gallery) > 1 else None,
            "pipeline_json": json.dumps({"warnings": warnings}), "status": "ready",
        })
        dupes = self._flag_duplicates(asset_id, first.sha256, first.phash)
        self._invalidate()
        return self._asset_result(asset_id, dupes=dupes, warnings=warnings, mode="download")

    def _import_video_from_url(self, ctx: JobContext, cls: classify_mod.Classification, asset_id: str, adir: Path, tags: list[str], mode: str, force: bool) -> dict[str, Any]:
        best = cls.best_video
        if best is None:
            raise PermanentJobError("no_media_found", "No playable video stream found.")
        warnings: list[str] = list(cls.warnings)
        steps: list[dict[str, Any]] = []
        want_download = mode == "download" or (mode == "auto" and self.config.download_videos_default)
        can_download = best.protocol == "progressive"
        if want_download and not can_download:
            warnings.append("download_skipped_stream_is_manifest")
            want_download = False

        # Poster/thumbnail image (also feeds LQIP, dominant colour and the perceptual hash).
        thumb_res: images.ImageResult | None = None
        if cls.thumbnail_url:
            ctx.progress("thumbnail", 25, "Fetching poster image")
            tmp = self.config.incoming_dir / f"{asset_id}-thumb.src"
            try:
                dl = self._download(ctx, cls.thumbnail_url, tmp, self.config.image_max_bytes, "thumbnail", 25, 35)
                if sniff_bytes(dl.head).kind == "image":
                    thumb_res = images.process_image(tmp, adir, "poster", want_avif=False)
            except (PermanentJobError, RetryableJobError):
                warnings.append("thumbnail_download_failed")
            except images.ImageError as exc:
                warnings.append(f"thumbnail_{exc.code}")
            finally:
                tmp.unlink(missing_ok=True)

        media_file: Path | None = None
        sha: str | None = None
        if want_download:
            ctx.progress("download", 38, "Downloading video")
            tmp = self.config.incoming_dir / f"{asset_id}.video"
            dl = self._download(ctx, best.url, tmp, self.config.video_max_bytes, "download", 38, 75)
            sn = sniff_bytes(dl.head)
            if sn.kind != "video":
                tmp.unlink(missing_ok=True)
                raise PermanentJobError("not_a_video", "The URL did not serve a video file.")
            media_file = tmp
            sha = sha256_file(tmp)
            if not force:
                other = self.store.find_asset(sha256=sha)
                if other:
                    tmp.unlink(missing_ok=True)
                    shutil.rmtree(adir, ignore_errors=True)
                    return self._asset_result(other["id"], duplicate=True, mode="existing")

        ctx.progress("register", 78, "Adding to library")
        thumb_url = f"{self.config.public_prefix}/{asset_id}/{thumb_res.files['thumb']}" if thumb_res and "thumb" in thumb_res.files else cls.thumbnail_url
        source = "ytdlp" if cls.strategy == "ytdlp" else "import"
        page_url = cls.canonical_url
        shot_id, inserted = self._register_screenshot(
            term=cls.title or cls.source, source=source, page_url=page_url, source_url=best.url, thumbnail_url=thumb_url, tags=tags,
        )
        values: dict[str, Any] = {
            "screenshot_id": shot_id, "kind": "video", "title": cls.title, "canonical_url": cls.canonical_url,
            "source_url": best.url, "origin": cls.strategy, "sha256": sha, "width": cls.width or best.width,
            "height": cls.height or best.height, "duration_seconds": cls.duration_seconds or best.duration_seconds,
            "mime_type": cls.mime_type or best.mime, "codec": best.codec, "bitrate": best.bitrate,
            "status": "ready",
        }
        if best.kind == "hls":
            values["mime_type"] = "application/vnd.apple.mpegurl"
        if values["width"] and values["height"]:
            values["aspect"] = round(values["width"] / values["height"], 4)
        if thumb_res:
            values.update({
                "phash": thumb_res.phash, "dhash": thumb_res.dhash, "dominant_color": thumb_res.dominant_color,
                "lqip": thumb_res.lqip, "thumb_path": thumb_res.files.get("thumb"), "poster_path": thumb_res.files.get("full"),
            })
            if not values.get("aspect"):
                values["aspect"] = thumb_res.aspect
                values["width"] = values["width"] or thumb_res.width
                values["height"] = values["height"] or thumb_res.height

        try:
            if media_file is not None:
                values.update(self._finalize_video_file(ctx, media_file, shot_id, asset_id, adir, warnings, steps))
            self.store.insert_asset(asset_id, values)
        except BaseException:
            if media_file is not None:
                self._rollback_registration(shot_id, inserted)
            raise
        dupes = self._flag_duplicates(asset_id, sha, values.get("phash"))
        self._invalidate()
        ctx.progress("done", 99, "Imported")
        return self._asset_result(asset_id, dupes=dupes, warnings=warnings, steps=steps, mode="download" if media_file else "link")

    # ------------------------------------------------------------------
    # video file finalisation (shared by URL-download and upload)
    # ------------------------------------------------------------------

    def _finalize_video_file(self, ctx: JobContext, src: Path, shot_id: int, asset_id: str, adir: Path, warnings: list[str], steps: list[dict[str, Any]]) -> dict[str, Any]:
        """Move a local video into the serving cache and run the pipeline on it."""
        cache_path_fn = self.config.video_cache_path
        if cache_path_fn is None:
            dest = adir / "video.mp4"
        else:
            dest = cache_path_fn(shot_id)
            if self.config.evict_video_cache:
                try:
                    self.config.evict_video_cache()
                except Exception:
                    logger.debug("cache eviction failed", exc_info=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dest))
        ctx.progress("process", 80, "Analysing video")

        result = video.process_video(
            str(dest), str(adir), "v", do_normalize=self.config.normalize_videos, do_hls=self.config.hls_ladder,
            tc=self.tc, runner=self.runner,
            on_step=lambda s: ctx.store.progress(ctx.id, s.name, 80 + min(15, len(steps) * 3), f"{s.name}: {s.status}" + (f" ({s.reason})" if s.reason else "")),
        )
        steps.extend(s.to_dict() for s in result.steps)
        for s in result.steps:
            if s.status != "ok":
                warnings.append(f"{s.name}_{s.status}:{s.reason}" if s.reason else f"{s.name}_{s.status}")
        values: dict[str, Any] = {"pipeline_json": json.dumps(result.to_dict())}
        m = result.meta
        if m:
            values.update({
                "width": m.width, "height": m.height, "aspect": m.aspect, "duration_seconds": m.duration_seconds,
                "codec": m.codec_label, "has_audio": int(m.has_audio) if m.source == "ffprobe" else None, "bitrate": m.bitrate,
            })
            values["mime_type"] = "video/mp4"
        if result.faststart is not None:
            values["faststart"] = int(result.faststart)
        if result.plan:
            values["needs_transcode"] = int(result.plan.action in {"transcode", "remux"})
        if "normalized" in result.files:
            # Replace the served file with the browser-friendly rendition.
            norm = adir / result.files["normalized"]
            try:
                os.replace(norm, dest)
                values["needs_transcode"] = 0
                values["faststart"] = 1
                values["codec"] = "h264/aac" if (m and m.has_audio) else "h264"
            except OSError:
                warnings.append("normalize_replace_failed")
        if "poster" in result.files:
            values["poster_path"] = result.files["poster"]
            values.setdefault("thumb_path", result.files["poster"])
        if "sprite" in result.files:
            values["sprite_path"] = result.files["sprite"]
            values["sprite_grid_json"] = json.dumps(result.sprite_grid)
        if "preview" in result.files:
            values["preview_path"] = result.files["preview"]
        if "hls" in result.files:
            values["hls_path"] = result.files["hls"]
        if result.poster_phash:
            values["phash"] = result.poster_phash
        # Cached video is served through /api/screenshots/cached-video/{id}.
        values["media_path"] = None
        return {k: v for k, v in values.items() if v is not None}

    # ------------------------------------------------------------------
    # upload jobs
    # ------------------------------------------------------------------

    def run_upload_job(self, ctx: JobContext) -> dict[str, Any]:
        payload = ctx.payload
        files = payload.get("files") or []
        if not files:
            raise PermanentJobError("no_files", "The upload job has no files.")
        tags = [str(t) for t in (payload.get("tags") or []) if str(t).strip()]
        title = payload.get("title")
        self.config.ensure()
        for f in files:
            if not Path(f["path"]).exists():
                raise PermanentJobError("upload_missing", "The uploaded file is no longer available.")
        kinds = {f.get("kind") for f in files}
        asset_id = uuid.uuid4().hex[:16]
        adir = self.config.assets_dir / asset_id
        adir.mkdir(parents=True, exist_ok=True)
        try:
            if kinds == {"image"}:
                return self._import_uploaded_images(ctx, files, asset_id, adir, tags, title, bool(payload.get("force")))
            if kinds == {"video"} and len(files) == 1:
                return self._import_uploaded_video(ctx, files[0], asset_id, adir, tags, title)
            raise PermanentJobError("mixed_upload", "Upload either one video or one or more images per job.")
        except BaseException:
            shutil.rmtree(adir, ignore_errors=True)
            raise
        finally:
            # incoming files are consumed (videos are moved) or discarded either way
            for f in files:
                Path(f["path"]).unlink(missing_ok=True)

    def _import_uploaded_images(self, ctx: JobContext, files: list[dict[str, Any]], asset_id: str, adir: Path, tags: list[str], title: str | None, force: bool) -> dict[str, Any]:
        gallery: list[dict[str, Any]] = []
        first: images.ImageResult | None = None
        warnings: list[str] = []
        for idx, f in enumerate(files[:MAX_GALLERY_IMAGES]):
            ctx.progress("process", 10 + int(70 * idx / len(files)), f"Processing image {idx + 1}/{len(files)}")
            try:
                res = images.process_image(f["path"], adir, f"{idx:02d}")
            except images.ImageError as exc:
                if len(files) == 1:
                    raise PermanentJobError(exc.code, str(exc)) from exc
                warnings.append(f"image_{idx}_{exc.code}:{f.get('filename')}")
                continue
            if first is None:
                first = res
                if not force and len(files) == 1:
                    other = self.store.find_asset(sha256=res.sha256)
                    if other:
                        shutil.rmtree(adir, ignore_errors=True)
                        return self._asset_result(other["id"], duplicate=True, mode="existing")
            if res.had_gps:
                warnings.append(f"gps_metadata_removed:{f.get('filename')}")
            warnings.extend(res.warnings)
            gallery.append({"full": res.files["full"], "thumb": res.files.get("thumb"), "width": res.width, "height": res.height, "lqip": res.lqip})
        if first is None:
            raise PermanentJobError("invalid_image", "No uploaded image could be processed.")
        ctx.progress("register", 88, "Adding to library")
        label = title or Path(files[0].get("filename") or "upload").stem[:80]
        page_url = f"upload:{first.sha256[:32]}"
        thumb = first.files.get("thumb")
        shot_id, _ = self._register_screenshot(
            term=label, source="upload", page_url=page_url,
            source_url=f"{self.config.public_prefix}/{asset_id}/{first.files['full']}",
            thumbnail_url=f"{self.config.public_prefix}/{asset_id}/{thumb}" if thumb else None, tags=tags,
        )
        self.store.insert_asset(asset_id, {
            "screenshot_id": shot_id, "kind": "gallery" if len(gallery) > 1 else "image", "title": label, "canonical_url": page_url,
            "origin": "upload", "sha256": first.sha256, "phash": first.phash, "dhash": first.dhash, "width": first.width,
            "height": first.height, "aspect": first.aspect, "mime_type": first.mime_type, "dominant_color": first.dominant_color,
            "lqip": first.lqip, "media_path": first.files["full"], "thumb_path": thumb, "poster_path": first.files.get("poster"),
            "gallery_json": json.dumps(gallery) if len(gallery) > 1 else None, "pipeline_json": json.dumps({"warnings": warnings}),
            "status": "ready",
        })
        dupes = self._flag_duplicates(asset_id, first.sha256, first.phash)
        self._invalidate()
        return self._asset_result(asset_id, dupes=dupes, warnings=warnings, mode="upload")

    def _import_uploaded_video(self, ctx: JobContext, f: dict[str, Any], asset_id: str, adir: Path, tags: list[str], title: str | None) -> dict[str, Any]:
        src = Path(f["path"])
        sha = f.get("sha256") or sha256_file(src)
        if not payload_force(ctx):
            other = self.store.find_asset(sha256=sha)
            if other:
                shutil.rmtree(adir, ignore_errors=True)
                return self._asset_result(other["id"], duplicate=True, mode="existing")
        label = title or Path(f.get("filename") or "upload").stem[:80]
        page_url = f"upload:{sha[:32]}"
        ctx.progress("register", 10, "Adding to library")
        shot_id, inserted = self._register_screenshot(term=label, source="upload", page_url=page_url, source_url=None, thumbnail_url=None, tags=tags)
        warnings: list[str] = []
        steps: list[dict[str, Any]] = []
        values: dict[str, Any] = {
            "screenshot_id": shot_id, "kind": "video", "title": label, "canonical_url": page_url, "origin": "upload", "sha256": sha,
            "status": "ready",
        }
        try:
            # Consume the incoming file: move into the serving cache.
            values.update(self._finalize_video_file(ctx, src, shot_id, asset_id, adir, warnings, steps))
            if not values.get("mime_type"):
                values["mime_type"] = f.get("mime") or "video/mp4"
            if values.get("poster_path"):
                values.setdefault("thumb_path", values["poster_path"])
                # Point the library record at the generated poster.
                self._set_thumbnail(shot_id, f"{self.config.public_prefix}/{asset_id}/{values['poster_path']}")
            self.store.insert_asset(asset_id, values)
        except BaseException:
            self._rollback_registration(shot_id, inserted)
            raise
        dupes = self._flag_duplicates(asset_id, sha, values.get("phash"))
        self._invalidate()
        return self._asset_result(asset_id, dupes=dupes, warnings=warnings, steps=steps, mode="upload")

    def _rollback_registration(self, shot_id: int, inserted: bool) -> None:
        """Undo a screenshots row we created and drop its cached video."""
        try:
            if self.config.video_cache_path is not None:
                self.config.video_cache_path(shot_id).unlink(missing_ok=True)
            if inserted:
                with self.db.connect() as conn:
                    conn.execute("DELETE FROM screenshots WHERE id = ?", (shot_id,))
                    conn.commit()
        except Exception:
            logger.debug("registration rollback failed", exc_info=True)

    def _set_thumbnail(self, shot_id: int, url: str) -> None:
        try:
            with self.db.connect() as conn:
                conn.execute("UPDATE screenshots SET thumbnail_url = ? WHERE id = ?", (url, shot_id))
                conn.commit()
        except Exception:
            logger.debug("thumbnail update failed", exc_info=True)

    def _invalidate(self) -> None:
        try:
            self.db._invalidate_after_write()
        except Exception:
            pass
        hook = getattr(self, "on_change", None)
        if hook:
            try:
                hook()
            except Exception:
                pass


def payload_force(ctx: JobContext) -> bool:
    return bool(ctx.payload.get("force"))
