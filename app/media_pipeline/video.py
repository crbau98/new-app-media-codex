"""Video processing pipeline (ffprobe/ffmpeg driven, degrade-gracefully).

Every step returns a `StepResult` (`ok` / `skipped` / `failed` + reason) and
never raises: a missing toolchain, a timeout or a corrupt file simply turns
the step into `skipped`/`failed`. Pure logic (probe parsing, browser
compatibility, poster timestamps, blank-frame detection, sprite geometry,
command construction) is separated from process execution so it can be unit
tested without ffmpeg installed.
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from app.media_pipeline import ffmpeg, mp4probe

_logger = logging.getLogger(__name__)

Runner = Callable[..., ffmpeg.RunResult]

PROBE_TIMEOUT = 25.0
FRAME_TIMEOUT = 15.0
SPRITE_TIMEOUT = 120.0
PREVIEW_TIMEOUT = 60.0
TRANSCODE_TIMEOUT = float(os.getenv("MEDIA_TRANSCODE_TIMEOUT", "1800"))
HLS_TIMEOUT = float(os.getenv("MEDIA_HLS_TIMEOUT", "3600"))

BROWSER_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}
BROWSER_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac"}
MP4_FAMILY = {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}


@dataclass
class StepResult:
    name: str
    status: str  # ok | skipped | failed
    reason: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "status": self.status, "reason": self.reason, "durationMs": self.duration_ms, "data": self.data}


def _ok(name: str, data: dict[str, Any] | None = None, t0: float | None = None) -> StepResult:
    return StepResult(name, "ok", data=data or {}, duration_ms=int((time.monotonic() - t0) * 1000) if t0 else 0)


def _skip(name: str, reason: str) -> StepResult:
    return StepResult(name, "skipped", reason)


def _fail(name: str, reason: str, t0: float | None = None) -> StepResult:
    return StepResult(name, "failed", reason, duration_ms=int((time.monotonic() - t0) * 1000) if t0 else 0)


# --------------------------------------------------------------------------
# probing
# --------------------------------------------------------------------------


@dataclass
class VideoMeta:
    duration_seconds: float | None = None
    width: int | None = None  # display dimensions (rotation applied)
    height: int | None = None
    video_codec: str | None = None
    profile: str | None = None
    pix_fmt: str | None = None
    audio_codec: str | None = None
    has_audio: bool = False
    bitrate: int | None = None
    fps: float | None = None
    container: str | None = None
    rotation: int = 0
    size_bytes: int | None = None
    source: str = "ffprobe"

    @property
    def aspect(self) -> float | None:
        if self.width and self.height:
            return round(self.width / self.height, 4)
        return None

    @property
    def codec_label(self) -> str | None:
        parts = [p for p in (self.video_codec, self.audio_codec) if p]
        return "/".join(parts) or None


def _as_int(value: Any) -> int | None:
    try:
        return int(str(value)) if value not in (None, "") else None
    except ValueError:
        return None


def _fraction(value: str | None) -> float | None:
    if not value or "/" not in value:
        try:
            return float(value) if value else None
        except ValueError:
            return None
    num, den = value.split("/", 1)
    try:
        return round(float(num) / float(den), 3) if float(den) else None
    except ValueError:
        return None


def _rotation(stream: dict[str, Any]) -> int:
    tags = stream.get("tags") or {}
    if "rotate" in tags:
        try:
            return int(float(tags["rotate"])) % 360
        except ValueError:
            pass
    for sd in stream.get("side_data_list") or []:
        if "rotation" in sd:
            try:
                return (-int(float(sd["rotation"]))) % 360  # ffprobe reports CCW-negative
            except (ValueError, TypeError):
                pass
    return 0


def parse_ffprobe(payload: dict[str, Any]) -> VideoMeta:
    streams = payload.get("streams") or []
    fmt = payload.get("format") or {}
    video = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    meta = VideoMeta(container=(fmt.get("format_name") or "").split(",")[0] or None)
    if fmt.get("duration"):
        try:
            meta.duration_seconds = round(float(fmt["duration"]), 3)
        except ValueError:
            pass
    meta.bitrate = _as_int(fmt.get("bit_rate"))
    meta.size_bytes = _as_int(fmt.get("size"))
    if video:
        w, h = video.get("width"), video.get("height")
        rot = _rotation(video)
        if rot in (90, 270):
            w, h = h, w
        meta.width, meta.height, meta.rotation = w, h, rot
        meta.video_codec = (video.get("codec_name") or "").lower() or None
        meta.profile = video.get("profile")
        meta.pix_fmt = video.get("pix_fmt")
        meta.fps = _fraction(video.get("avg_frame_rate")) or _fraction(video.get("r_frame_rate"))
        if meta.duration_seconds is None and video.get("duration"):
            try:
                meta.duration_seconds = round(float(video["duration"]), 3)
            except ValueError:
                pass
    if audio:
        meta.has_audio = True
        meta.audio_codec = (audio.get("codec_name") or "").lower() or None
    return meta


def probe_video(path: str, *, tc: ffmpeg.Toolchain | None = None, runner: Runner = ffmpeg.run) -> tuple[StepResult, VideoMeta | None]:
    t0 = time.monotonic()
    tc = tc or ffmpeg.toolchain()
    if tc.ffprobe:
        cmd = [
            tc.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_error", path,
        ]
        res = runner(cmd, PROBE_TIMEOUT)
        if res.timed_out:
            return _fail("probe", "ffprobe_timeout", t0), None
        if res.ok:
            try:
                meta = parse_ffprobe(json.loads(res.stdout.decode("utf-8", "replace") or "{}"))
            except ValueError:
                return _fail("probe", "ffprobe_bad_output", t0), None
            if not meta.width and not meta.has_audio:
                return _fail("probe", "no_media_streams", t0), None
            return _ok("probe", _meta_dict(meta), t0), meta
        return _fail("probe", f"ffprobe_error:{res.error_tail(160)}", t0), None
    # Pure-python fallback for local MP4/MOV files.
    p = Path(path)
    if p.exists():
        layout = mp4probe.scan_layout(p)
        if layout.is_mp4 and layout.moov_offset is not None:
            with p.open("rb") as fh:
                fh.seek(layout.moov_offset)
                head = fh.read(min(4 * 1024 * 1024, next((s for k, o, s in layout.boxes if k == "moov"), 1 << 20)))
            info = mp4probe.parse_head(head)
            meta = VideoMeta(
                duration_seconds=info.duration_seconds, width=info.width, height=info.height,
                container="mov", size_bytes=p.stat().st_size, source="mp4probe",
            )
            step = _ok("probe", _meta_dict(meta), t0)
            step.reason = "ffprobe_unavailable_fallback"
            return step, meta
    return _skip("probe", "ffprobe_unavailable"), None


def _meta_dict(m: VideoMeta) -> dict[str, Any]:
    return {
        "durationSeconds": m.duration_seconds, "width": m.width, "height": m.height, "aspect": m.aspect,
        "videoCodec": m.video_codec, "audioCodec": m.audio_codec, "hasAudio": m.has_audio, "bitrate": m.bitrate,
        "fps": m.fps, "container": m.container, "rotation": m.rotation, "pixFmt": m.pix_fmt, "source": m.source,
    }


# --------------------------------------------------------------------------
# browser compatibility / transcode planning
# --------------------------------------------------------------------------


@dataclass
class CompatPlan:
    playable: bool
    action: str  # none | faststart | remux | transcode
    reasons: list[str] = field(default_factory=list)


def plan_for(meta: VideoMeta, faststart: bool | None, *, max_height: int = 1080) -> CompatPlan:
    """Decide what (if anything) must be done so a browser can stream the file."""
    reasons: list[str] = []
    container = (meta.container or "").lower()
    in_mp4 = container in MP4_FAMILY or container == "mp4"
    is_webm = container in {"matroska", "webm"} and meta.video_codec in {"vp8", "vp9", "av1"}
    vc, ac = meta.video_codec, meta.audio_codec

    video_ok = vc in BROWSER_VIDEO_CODECS
    if vc == "h264" and meta.pix_fmt and meta.pix_fmt not in {"yuv420p", "yuvj420p"}:
        video_ok = False
        reasons.append(f"pix_fmt_{meta.pix_fmt}_unsupported")
    audio_ok = ac is None or ac in BROWSER_AUDIO_CODECS
    if not video_ok and vc:
        reasons.append(f"video_codec_{vc}_not_browser_safe")
    if not audio_ok:
        reasons.append(f"audio_codec_{ac}_not_browser_safe")
    if meta.height and meta.height > max_height * 2:
        reasons.append("oversized_resolution")
        video_ok = False

    if video_ok and audio_ok and (in_mp4 or is_webm):
        if in_mp4 and faststart is False:
            return CompatPlan(True, "faststart", reasons + ["moov_at_end"])
        return CompatPlan(True, "none", reasons)
    if video_ok and audio_ok:
        return CompatPlan(False, "remux", reasons + [f"container_{container or 'unknown'}"])
    return CompatPlan(False, "transcode", reasons)


# --------------------------------------------------------------------------
# frame analysis + geometry (pure)
# --------------------------------------------------------------------------


def poster_timestamps(duration: float | None) -> list[float]:
    """Candidate timestamps (seconds), best first. Avoids the very start/end
    where fades, logos and black frames live."""
    if not duration or duration <= 0:
        return [1.0, 3.0, 0.0]
    if duration < 4:
        return [round(duration * f, 3) for f in (0.5, 0.25, 0.75)] + [0.0]
    fractions = (0.22, 0.38, 0.55, 0.08, 0.7)
    out = [round(min(duration - 1, max(0.5, duration * f)), 3) for f in fractions]
    return list(dict.fromkeys(out))


def frame_stats(gray: bytes) -> tuple[float, float]:
    """(mean, standard deviation) of 8-bit luminance samples."""
    n = len(gray)
    if n == 0:
        return 0.0, 0.0
    mean = sum(gray) / n
    var = sum((b - mean) ** 2 for b in gray) / n
    return mean, math.sqrt(var)


def is_blank_frame(gray: bytes, *, dark: float = 16.0, bright: float = 242.0, flat: float = 6.0) -> bool:
    """Black, white or featureless (flat) frame."""
    mean, std = frame_stats(gray)
    return mean < dark or mean > bright or std < flat


def frame_quality(gray: bytes) -> float:
    """Higher is better: contrast (std) penalised when far from mid-grey."""
    mean, std = frame_stats(gray)
    return std - abs(mean - 128) * 0.15


def sprite_geometry(duration: float | None, width: int | None, height: int | None, *, max_tiles: int = 100, tile_width: int = 160, cols: int = 10) -> dict[str, Any] | None:
    """Thumbnail-sheet layout for scrubbing. None when duration is unknown."""
    if not duration or duration < 2:
        return None
    interval = max(1, math.ceil(duration / max_tiles))
    count = max(1, min(max_tiles, math.ceil(duration / interval)))
    aspect = (width / height) if width and height else 16 / 9
    tile_height = max(2, int(round(tile_width / aspect / 2)) * 2)
    cols = min(cols, count)
    rows = math.ceil(count / cols)
    return {
        "cols": cols, "rows": rows, "count": count, "tileWidth": tile_width, "tileHeight": tile_height,
        "intervalSeconds": interval,
    }


def hls_ladder(source_height: int | None) -> list[tuple[int, int]]:
    """[(height, video_kbps)] rungs not exceeding the source height."""
    rungs = [(360, 800), (540, 1400), (720, 2800), (1080, 5000)]
    if not source_height:
        return rungs[:2]
    fit = [r for r in rungs if r[0] <= source_height + 8]
    return fit or [rungs[0]]


# --------------------------------------------------------------------------
# command builders (pure)
# --------------------------------------------------------------------------

_BASE = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]


def cmd_gray_frame(ff: str, src: str, ts: float) -> list[str]:
    return [ff, *_BASE, "-ss", f"{ts:.3f}", "-i", src, "-frames:v", "1", "-an", "-sn", "-dn",
            "-vf", "scale=64:36:flags=fast_bilinear,format=gray", "-f", "rawvideo", "-"]


def cmd_poster(ff: str, src: str, ts: float, out: str, max_width: int = 1280) -> list[str]:
    return [ff, *_BASE, "-ss", f"{ts:.3f}", "-i", src, "-frames:v", "1", "-an", "-sn", "-dn",
            "-vf", f"scale='min({max_width},iw)':-2", "-q:v", "3", "-f", "image2", out]


def cmd_sprite(ff: str, src: str, geo: dict[str, Any], out: str) -> list[str]:
    vf = f"fps=1/{geo['intervalSeconds']},scale={geo['tileWidth']}:{geo['tileHeight']},tile={geo['cols']}x{geo['rows']}"
    return [ff, *_BASE, "-i", src, "-an", "-sn", "-dn", "-vf", vf, "-frames:v", "1", "-q:v", "5", "-f", "image2", out]


def cmd_preview(ff: str, src: str, start: float, out: str, seconds: float = 3.0, height: int = 360) -> list[str]:
    return [ff, *_BASE, "-ss", f"{start:.3f}", "-t", f"{seconds:.1f}", "-i", src, "-an", "-sn", "-dn",
            "-vf", f"scale=-2:{height},fps=24", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]


def cmd_faststart(ff: str, src: str, out: str) -> list[str]:
    return [ff, *_BASE, "-i", src, "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-movflags", "+faststart", out]


def cmd_transcode(ff: str, src: str, out: str, *, max_height: int = 1080, has_audio: bool = True, crf: int = 22) -> list[str]:
    cmd = [ff, *_BASE, "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
           "-vf", f"scale=-2:'min({max_height},ih)':flags=lanczos,format=yuv420p",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-profile:v", "high", "-level", "4.1"]
    if has_audio:
        cmd += ["-c:a", "aac", "-b:a", "128k", "-ac", "2"]
    else:
        cmd += ["-an"]
    cmd += ["-movflags", "+faststart", out]
    return cmd


def cmd_hls_rung(ff: str, src: str, out_dir: str, height: int, kbps: int, has_audio: bool = True) -> list[str]:
    cmd = [ff, *_BASE, "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
           "-vf", f"scale=-2:{height},format=yuv420p", "-c:v", "libx264", "-preset", "veryfast",
           "-b:v", f"{kbps}k", "-maxrate", f"{int(kbps * 1.2)}k", "-bufsize", f"{kbps * 2}k",
           "-g", "48", "-keyint_min", "48", "-sc_threshold", "0"]
    cmd += ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] if has_audio else ["-an"]
    cmd += ["-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
            "-hls_segment_filename", os.path.join(out_dir, f"{height}p", "seg_%04d.ts"),
            os.path.join(out_dir, f"{height}p", "index.m3u8")]
    return cmd


def build_master_playlist(rungs: list[tuple[int, int]], aspect: float) -> str:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for height, kbps in rungs:
        width = int(round(height * aspect / 2)) * 2
        bandwidth = int(kbps * 1000 * 1.1) + 128_000
        lines.append(f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={width}x{height},CODECS="avc1.640029,mp4a.40.2"')
        lines.append(f"{height}p/index.m3u8")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# steps (process execution)
# --------------------------------------------------------------------------


def choose_poster(src: str, meta: VideoMeta | None, *, tc: ffmpeg.Toolchain, runner: Runner = ffmpeg.run) -> tuple[float | None, list[dict[str, Any]]]:
    """Pick the best poster timestamp by sampling candidates and rejecting
    black/white/flat frames. Returns (timestamp, samples)."""
    samples: list[dict[str, Any]] = []
    best: tuple[float, float] | None = None
    for ts in poster_timestamps(meta.duration_seconds if meta else None):
        res = runner(cmd_gray_frame(tc.ffmpeg or "ffmpeg", src, ts), FRAME_TIMEOUT)
        if not res.ok or not res.stdout:
            samples.append({"t": ts, "error": True})
            continue
        mean, std = frame_stats(res.stdout)
        blank = is_blank_frame(res.stdout)
        samples.append({"t": ts, "mean": round(mean, 1), "std": round(std, 1), "blank": blank})
        if not blank:
            return ts, samples  # first acceptable candidate wins (they are ordered best-first)
        score = frame_quality(res.stdout)
        if best is None or score > best[0]:
            best = (score, ts)
    return (best[1] if best else None), samples


def extract_poster(src: str, out_path: str, meta: VideoMeta | None, *, tc: ffmpeg.Toolchain | None = None, runner: Runner = ffmpeg.run) -> StepResult:
    t0 = time.monotonic()
    tc = tc or ffmpeg.toolchain()
    if not tc.ffmpeg:
        return _skip("poster", "ffmpeg_unavailable")
    ts, samples = choose_poster(src, meta, tc=tc, runner=runner)
    if ts is None:
        return _fail("poster", "no_decodable_frame", t0)
    res = runner(cmd_poster(tc.ffmpeg, src, ts, out_path), FRAME_TIMEOUT)
    if res.ok and Path(out_path).exists() and Path(out_path).stat().st_size > 0:
        return _ok("poster", {"timestamp": ts, "samples": samples, "blankFallback": bool(samples and all(s.get("blank") for s in samples if "blank" in s))}, t0)
    Path(out_path).unlink(missing_ok=True)
    return _fail("poster", f"ffmpeg_error:{res.error_tail(160)}", t0)


def make_sprite(src: str, out_path: str, meta: VideoMeta | None, *, tc: ffmpeg.Toolchain | None = None, runner: Runner = ffmpeg.run) -> StepResult:
    t0 = time.monotonic()
    tc = tc or ffmpeg.toolchain()
    if not tc.ffmpeg:
        return _skip("sprite", "ffmpeg_unavailable")
    if not meta or not meta.duration_seconds:
        return _skip("sprite", "duration_unknown")
    geo = sprite_geometry(meta.duration_seconds, meta.width, meta.height)
    if geo is None:
        return _skip("sprite", "video_too_short")
    res = runner(cmd_sprite(tc.ffmpeg, src, geo, out_path), SPRITE_TIMEOUT)
    if res.ok and Path(out_path).exists() and Path(out_path).stat().st_size > 0:
        return _ok("sprite", {"grid": geo}, t0)
    Path(out_path).unlink(missing_ok=True)
    return _fail("sprite", "timeout" if res.timed_out else f"ffmpeg_error:{res.error_tail(160)}", t0)


def make_preview(src: str, out_path: str, meta: VideoMeta | None, *, tc: ffmpeg.Toolchain | None = None, runner: Runner = ffmpeg.run) -> StepResult:
    t0 = time.monotonic()
    tc = tc or ffmpeg.toolchain()
    if not tc.ffmpeg:
        return _skip("preview", "ffmpeg_unavailable")
    if not tc.has_encoder("libx264") and tc.encoders:
        return _skip("preview", "libx264_unavailable")
    duration = meta.duration_seconds if meta else None
    seconds = 3.0 if not duration else min(3.0, max(1.0, duration))
    start = 0.0 if not duration or duration <= seconds + 1 else max(0.0, duration * 0.3 - seconds / 2)
    res = runner(cmd_preview(tc.ffmpeg, src, start, out_path, seconds), PREVIEW_TIMEOUT)
    if res.ok and Path(out_path).exists() and Path(out_path).stat().st_size > 0:
        return _ok("preview", {"start": start, "seconds": seconds}, t0)
    Path(out_path).unlink(missing_ok=True)
    return _fail("preview", "timeout" if res.timed_out else f"ffmpeg_error:{res.error_tail(160)}", t0)


def normalize_for_browser(src: str, out_path: str, meta: VideoMeta, plan: CompatPlan, *, tc: ffmpeg.Toolchain | None = None, runner: Runner = ffmpeg.run) -> StepResult:
    """Faststart remux / container remux / H.264+AAC transcode as planned."""
    t0 = time.monotonic()
    tc = tc or ffmpeg.toolchain()
    if plan.action == "none":
        return _skip("normalize", "already_browser_friendly")
    if not tc.ffmpeg:
        return _skip("normalize", "ffmpeg_unavailable")
    if plan.action == "transcode" and tc.encoders and not tc.has_encoder("libx264"):
        return _skip("normalize", "libx264_unavailable")
    tmp = out_path + ".part.mp4"
    if plan.action in {"faststart", "remux"}:
        cmd = cmd_faststart(tc.ffmpeg, src, tmp)
        timeout = TRANSCODE_TIMEOUT / 4
    else:
        cmd = cmd_transcode(tc.ffmpeg, src, tmp, has_audio=meta.has_audio)
        timeout = TRANSCODE_TIMEOUT
    res = runner(cmd, timeout)
    if res.ok and Path(tmp).exists() and Path(tmp).stat().st_size > 0:
        os.replace(tmp, out_path)
        return _ok("normalize", {"action": plan.action, "output": os.path.basename(out_path)}, t0)
    Path(tmp).unlink(missing_ok=True)
    if plan.action == "remux" and not res.timed_out:
        # Stream copy can fail on odd codecs/timestamps; fall back to a real transcode.
        return normalize_for_browser(src, out_path, meta, CompatPlan(False, "transcode", plan.reasons), tc=tc, runner=runner)
    return _fail("normalize", "timeout" if res.timed_out else f"ffmpeg_error:{res.error_tail(160)}", t0)


def make_hls(src: str, out_dir: str, meta: VideoMeta, *, tc: ffmpeg.Toolchain | None = None, runner: Runner = ffmpeg.run) -> StepResult:
    t0 = time.monotonic()
    tc = tc or ffmpeg.toolchain()
    if not tc.ffmpeg:
        return _skip("hls", "ffmpeg_unavailable")
    if tc.encoders and not tc.has_encoder("libx264"):
        return _skip("hls", "libx264_unavailable")
    rungs = hls_ladder(meta.height)
    done: list[tuple[int, int]] = []
    for height, kbps in rungs:
        os.makedirs(os.path.join(out_dir, f"{height}p"), exist_ok=True)
        res = runner(cmd_hls_rung(tc.ffmpeg, src, out_dir, height, kbps, meta.has_audio), HLS_TIMEOUT / len(rungs))
        if res.ok and os.path.exists(os.path.join(out_dir, f"{height}p", "index.m3u8")):
            done.append((height, kbps))
        else:
            _logger.warning("hls rung %sp failed: %s", height, res.error_tail(120))
    if not done:
        return _fail("hls", "no_rung_succeeded", t0)
    master = build_master_playlist(done, meta.aspect or 16 / 9)
    Path(out_dir, "master.m3u8").write_text(master, encoding="utf-8")
    return _ok("hls", {"rungs": [h for h, _ in done], "master": "master.m3u8"}, t0)


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------


@dataclass
class VideoProcessResult:
    meta: VideoMeta | None = None
    plan: CompatPlan | None = None
    faststart: bool | None = None
    steps: list[StepResult] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)
    sprite_grid: dict[str, Any] | None = None
    poster_phash: str | None = None

    def step(self, name: str) -> StepResult | None:
        return next((s for s in self.steps if s.name == name), None)

    def to_dict(self) -> dict[str, Any]:
        m = self.meta
        return {
            "meta": _meta_dict(m) if m else None,
            "plan": {"playable": self.plan.playable, "action": self.plan.action, "reasons": self.plan.reasons} if self.plan else None,
            "faststart": self.faststart,
            "steps": [s.to_dict() for s in self.steps],
            "files": self.files,
            "spriteGrid": self.sprite_grid,
        }


def process_video(
    src: str,
    out_dir: str,
    basename: str,
    *,
    do_poster: bool = True,
    do_sprite: bool = True,
    do_preview: bool = True,
    do_normalize: bool = False,
    do_hls: bool = False,
    tc: ffmpeg.Toolchain | None = None,
    runner: Runner = ffmpeg.run,
    on_step: Callable[[StepResult], None] | None = None,
) -> VideoProcessResult:
    """Run the full pipeline; each stage is independent and degrade-safe."""
    tc = tc or ffmpeg.toolchain()
    os.makedirs(out_dir, exist_ok=True)
    result = VideoProcessResult()

    def record(step: StepResult) -> StepResult:
        result.steps.append(step)
        if on_step:
            try:
                on_step(step)
            except Exception:  # progress callbacks must never break processing
                _logger.debug("on_step callback failed", exc_info=True)
        return step

    is_local = os.path.exists(src)
    if is_local:
        result.faststart = mp4probe.is_faststart(src)
    step, meta = probe_video(src, tc=tc, runner=runner)
    record(step)
    result.meta = meta
    if meta:
        result.plan = plan_for(meta, result.faststart)

    if do_poster:
        out = os.path.join(out_dir, f"{basename}.poster.jpg")
        s = record(extract_poster(src, out, meta, tc=tc, runner=runner))
        if s.ok:
            result.files["poster"] = os.path.basename(out)
            try:
                from PIL import Image

                from app.media_pipeline.hashing import perceptual_hashes

                with Image.open(out) as im:
                    result.poster_phash = perceptual_hashes(im)[0]
            except Exception:
                pass
    if do_sprite:
        out = os.path.join(out_dir, f"{basename}.sprite.jpg")
        s = record(make_sprite(src, out, meta, tc=tc, runner=runner))
        if s.ok:
            result.files["sprite"] = os.path.basename(out)
            result.sprite_grid = s.data.get("grid")
    if do_preview:
        out = os.path.join(out_dir, f"{basename}.preview.mp4")
        s = record(make_preview(src, out, meta, tc=tc, runner=runner))
        if s.ok:
            result.files["preview"] = os.path.basename(out)
    if do_normalize and meta and result.plan:
        out = os.path.join(out_dir, f"{basename}.mp4")
        s = record(normalize_for_browser(src, out, meta, result.plan, tc=tc, runner=runner))
        if s.ok:
            result.files["normalized"] = os.path.basename(out)
    if do_hls and meta:
        s = record(make_hls(src, os.path.join(out_dir, f"{basename}.hls"), meta, tc=tc, runner=runner))
        if s.ok:
            result.files["hls"] = f"{basename}.hls/master.m3u8"
    return result
