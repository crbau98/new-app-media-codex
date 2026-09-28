"""ffmpeg / ffprobe feature detection and a bounded subprocess runner.

Nothing in the app may assume the binaries exist. `toolchain()` detects them
once (cached); every processing step reports `skipped` with a reason instead
of raising when they are missing. The runner always enforces a timeout and
kills the child on expiry.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from typing import Sequence

_logger = logging.getLogger(__name__)
_LOCK = threading.Lock()
_CACHED: "Toolchain | None" = None


@dataclass(frozen=True)
class Toolchain:
    ffmpeg: str | None = None
    ffprobe: str | None = None
    version: str | None = None
    encoders: frozenset[str] = field(default_factory=frozenset)

    @property
    def can_probe(self) -> bool:
        return self.ffprobe is not None

    @property
    def can_transcode(self) -> bool:
        return self.ffmpeg is not None

    def has_encoder(self, name: str) -> bool:
        return name in self.encoders

    def describe(self) -> dict:
        return {
            "ffmpeg": bool(self.ffmpeg),
            "ffprobe": bool(self.ffprobe),
            "version": self.version,
            "h264": self.has_encoder("libx264"),
            "aac": self.has_encoder("aac"),
            "webp": self.has_encoder("libwebp"),
        }


@dataclass
class RunResult:
    returncode: int
    stdout: bytes
    stderr: bytes
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.timed_out

    def error_tail(self, n: int = 300) -> str:
        return (self.stderr or b"").decode("utf-8", "replace")[-n:]


def _detect() -> Toolchain:
    ffmpeg = os.getenv("FFMPEG_PATH") or shutil.which("ffmpeg")
    ffprobe = os.getenv("FFPROBE_PATH") or shutil.which("ffprobe")
    if ffmpeg and not (os.path.isfile(ffmpeg) and os.access(ffmpeg, os.X_OK)):
        ffmpeg = shutil.which(ffmpeg)
    if ffprobe and not (os.path.isfile(ffprobe) and os.access(ffprobe, os.X_OK)):
        ffprobe = shutil.which(ffprobe)
    version = None
    encoders: set[str] = set()
    if ffmpeg:
        try:
            proc = subprocess.run([ffmpeg, "-hide_banner", "-version"], capture_output=True, timeout=10)
            m = re.search(rb"version\s+(\S+)", proc.stdout)
            version = m.group(1).decode() if m else None
            enc = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, timeout=10)
            for line in enc.stdout.decode("utf-8", "replace").splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[0].startswith(("V", "A")) and len(parts[0]) == 6:
                    encoders.add(parts[1])
        except Exception as exc:  # pragma: no cover - defensive
            _logger.warning("ffmpeg detection failed: %s", exc)
    return Toolchain(ffmpeg=ffmpeg, ffprobe=ffprobe, version=version, encoders=frozenset(encoders))


def toolchain(refresh: bool = False) -> Toolchain:
    global _CACHED
    with _LOCK:
        if _CACHED is None or refresh:
            _CACHED = _detect()
            _logger.info("media toolchain: %s", _CACHED.describe())
        return _CACHED


def reset_toolchain_cache() -> None:
    global _CACHED
    with _LOCK:
        _CACHED = None


def set_toolchain_for_tests(tc: "Toolchain | None") -> None:
    global _CACHED
    with _LOCK:
        _CACHED = tc


def run(cmd: Sequence[str], timeout: float, *, input_bytes: bytes | None = None) -> RunResult:
    """Run a command with a hard timeout; never raises for process failures."""
    try:
        proc = subprocess.Popen(
            list(cmd), stdin=subprocess.PIPE if input_bytes else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
    except (OSError, ValueError) as exc:
        return RunResult(127, b"", str(exc).encode())
    try:
        out, err = proc.communicate(input=input_bytes, timeout=timeout)
        return RunResult(proc.returncode, out or b"", err or b"")
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            out, err = proc.communicate(timeout=5)
        except Exception:
            out, err = b"", b""
        return RunResult(-9, out or b"", err or b"", timed_out=True)
