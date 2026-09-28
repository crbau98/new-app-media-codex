"""Utilities for extracting frames from local video files using ffmpeg.

Thin, backwards-compatible wrappers over :mod:`app.media_pipeline`. ffmpeg is
feature-detected once; when it is absent every function returns ``None``
quickly (no exception, no per-call subprocess spawn).
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from app.media_pipeline import ffmpeg, video

_logger = logging.getLogger(__name__)


def ffmpeg_available() -> bool:
    return ffmpeg.toolchain().can_transcode


def _grab(tc: ffmpeg.Toolchain, src: str, ts: float, out: str, timeout: float) -> bool:
    cmd = [
        tc.ffmpeg or "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-probesize", "32k", "-analyzeduration", "0",
    ]
    if ts > 0:
        cmd += ["-ss", f"{ts:.3f}"]
    cmd += [
        "-i", src, "-frames:v", "1",
        "-vf", "scale=min(480\\,iw):-2:flags=fast_bilinear",
        "-an", "-sn", "-dn", "-q:v", "5", "-f", "image2", out,
    ]
    res = ffmpeg.run(cmd, timeout)
    p = Path(out)
    return res.ok and p.exists() and p.stat().st_size > 0


def extract_video_frame(video_path: str, time_offset: float = 1.0, *, smart: bool = True) -> str | None:
    """Extract one frame from a local video at ``time_offset`` seconds.

    With ``smart`` (default) the frame is checked for luminance: if it is black,
    white or featureless the pipeline's poster heuristics pick a better
    timestamp. Falls back to frame 0 when the offset is past the end.

    Returns the path of a temporary JPEG (caller deletes it) or ``None``.
    """
    src = Path(video_path)
    if not src.exists():
        return None
    tc = ffmpeg.toolchain()
    if not tc.can_transcode:
        return None

    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp.close()
    out = tmp.name
    try:
        ts = max(0.0, float(time_offset))
        if smart:
            frame = ffmpeg.run(video.cmd_gray_frame(tc.ffmpeg or "ffmpeg", str(src), ts), 8)
            if frame.ok and frame.stdout and video.is_blank_frame(frame.stdout):
                meta = None
                if tc.can_probe:
                    _step, meta = video.probe_video(str(src), tc=tc)
                better, _samples = video.choose_poster(str(src), meta, tc=tc)
                if better is not None:
                    ts = better
        if not _grab(tc, str(src), ts, out, 8):
            # Offset beyond the end of a short clip: use the first frame.
            if not _grab(tc, str(src), 0.0, out, 8):
                Path(out).unlink(missing_ok=True)
                return None
        return out
    except Exception as exc:  # never break a request path over a thumbnail
        _logger.warning("frame extraction failed for %s: %s", video_path, exc)
        Path(out).unlink(missing_ok=True)
        return None
