"""Utilities for extracting frames from video files using ffmpeg."""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


def extract_video_frame(video_path: str, time_offset: float = 1.0) -> str | None:
    """Extract a single frame from a video file at the given offset (seconds).

    Returns the path to a temporary JPEG file, or None on failure.
    The caller is responsible for deleting the temp file.
    """
    video = Path(video_path)
    if not video.exists():
        return None

    tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
    tmp.close()
    tmp_path = tmp.name

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-probesize", "32k",
                "-analyzeduration", "0",
                "-ss", str(time_offset),
                "-i", str(video),
                "-frames:v", "1",
                "-vf", "scale=min(480\\,iw):-2:flags=fast_bilinear",
                "-an", "-sn", "-dn",
                "-q:v", "5",
                "-f", "image2",
                tmp_path,
            ],
            capture_output=True,
            timeout=8,
        )
        # If seeking to offset failed (video shorter), try frame 0
        if result.returncode != 0 or not Path(tmp_path).exists() or Path(tmp_path).stat().st_size == 0:
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                    "-probesize", "32k",
                    "-analyzeduration", "0",
                    "-i", str(video),
                    "-frames:v", "1",
                    "-vf", "scale=min(480\\,iw):-2:flags=fast_bilinear",
                    "-an", "-sn", "-dn",
                    "-q:v", "5",
                    "-f", "image2",
                    tmp_path,
                ],
                capture_output=True,
                timeout=8,
            )

        if Path(tmp_path).exists() and Path(tmp_path).stat().st_size > 0:
            return tmp_path
        else:
            Path(tmp_path).unlink(missing_ok=True)
            return None
    except Exception as e:
        print(f"[video_utils] frame extraction failed for {video_path}: {e}")
        Path(tmp_path).unlink(missing_ok=True)
        return None
