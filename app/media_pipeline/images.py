"""Image normalisation: validate, auto-orient, strip ALL metadata (EXIF/GPS/ICC
/comments), re-encode, generate thumbnail + modern-format variants, dominant
colour, LQIP and perceptual hashes.

Privacy: images are re-created from raw pixel data, so no metadata block from
the source can survive into any output file.
"""

from __future__ import annotations

import base64
import io
import logging
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, features

from app.media_pipeline.hashing import perceptual_hashes, sha256_file

_logger = logging.getLogger(__name__)

MAX_PIXELS = 120_000_000  # decompression-bomb guard (~ 11k x 11k)
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
MAX_DIMENSION = 4096
THUMB_DIMENSION = 480
MAX_ANIMATION_FRAMES = 300

_HEIF_STATE: dict[str, Any] = {"checked": False, "ok": False}


def heif_supported() -> bool:
    """Register the optional pillow-heif opener once; degrade gracefully."""
    if not _HEIF_STATE["checked"]:
        _HEIF_STATE["checked"] = True
        try:
            import pillow_heif  # type: ignore

            pillow_heif.register_heif_opener()
            _HEIF_STATE["ok"] = True
        except Exception:
            _HEIF_STATE["ok"] = False
    return bool(_HEIF_STATE["ok"])


def avif_supported() -> bool:
    try:
        return bool(features.check("avif"))
    except Exception:
        return False


def webp_supported() -> bool:
    try:
        return bool(features.check("webp"))
    except Exception:
        return False


class ImageError(Exception):
    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code


@dataclass
class ImageResult:
    width: int
    height: int
    mime_type: str
    animated: bool = False
    frames: int = 1
    dominant_color: str | None = None
    lqip: str | None = None
    sha256: str = ""
    phash: str | None = None
    dhash: str | None = None
    exif_stripped: bool = False
    had_gps: bool = False
    orientation_applied: bool = False
    files: dict[str, str] = field(default_factory=dict)  # role -> filename (relative to out_dir)
    warnings: list[str] = field(default_factory=list)

    @property
    def aspect(self) -> float:
        return round(self.width / self.height, 4) if self.height else 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "width": self.width,
            "height": self.height,
            "aspect": self.aspect,
            "mimeType": self.mime_type,
            "animated": self.animated,
            "frames": self.frames,
            "dominantColor": self.dominant_color,
            "lqip": self.lqip,
            "sha256": self.sha256,
            "phash": self.phash,
            "dhash": self.dhash,
            "exifStripped": self.exif_stripped,
            "hadGps": self.had_gps,
            "files": self.files,
            "warnings": self.warnings,
        }


def _open(path: Path) -> Image.Image:
    heif_supported()
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(path)
            if getattr(img, "is_animated", False):
                img.seek(0)
            else:
                img.load()
        return img
    except Image.DecompressionBombError as exc:
        raise ImageError("image_too_large", "Image dimensions exceed the safety limit") from exc
    except Image.DecompressionBombWarning as exc:
        raise ImageError("image_too_large", "Image dimensions exceed the safety limit") from exc
    except Exception as exc:
        raise ImageError("invalid_image", f"Not a readable image: {type(exc).__name__}") from exc


def _has_gps(img: Image.Image) -> bool:
    try:
        exif = img.getexif()
        return bool(exif.get_ifd(0x8825))
    except Exception:
        return False


def _clean_copy(img: Image.Image) -> Image.Image:
    """Recreate the image from pixels only (drops EXIF/ICC/comment/text chunks)."""
    mode = img.mode
    if mode not in {"RGB", "RGBA", "L", "LA"}:
        mode = "RGBA" if ("A" in mode or img.info.get("transparency") is not None) else "RGB"
        img = img.convert(mode)
    clean = Image.frombytes(mode, img.size, img.tobytes())
    return clean


def _has_alpha(img: Image.Image) -> bool:
    if img.mode in {"RGBA", "LA"}:
        try:
            lo, _hi = img.getchannel("A").getextrema()
            return lo < 255
        except Exception:
            return True
    return False


def dominant_color(img: Image.Image) -> str:
    small = img.convert("RGB").resize((48, 48))
    quant = small.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
    palette = quant.getpalette() or []
    counts = sorted(quant.getcolors() or [], reverse=True)  # [(count, idx)]
    best: tuple[float, tuple[int, int, int]] | None = None
    for count, idx in counts:
        r, g, b = palette[idx * 3 : idx * 3 + 3]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        # Prefer prominent colours but avoid near-black/near-white backgrounds.
        penalty = 0.5 if lum < 18 or lum > 240 else 1.0
        score = count * penalty
        if best is None or score > best[0]:
            best = (score, (r, g, b))
    r, g, b = best[1] if best else (0, 0, 0)
    return f"#{r:02x}{g:02x}{b:02x}"


def make_lqip(img: Image.Image, width: int = 20) -> str:
    """Tiny blurred placeholder as a data URL (well under 1 KB)."""
    w = max(1, min(width, img.width))
    h = max(1, round(img.height * w / img.width))
    tiny = img.convert("RGB").resize((w, h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    if webp_supported():
        tiny.save(buf, "WEBP", quality=25, method=6)
        mime = "image/webp"
    else:
        tiny.save(buf, "JPEG", quality=30)
        mime = "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def _save(img: Image.Image, path: Path, fmt: str, **kw: Any) -> None:
    img.save(path, fmt, **kw)


def process_image(
    src: str | Path,
    out_dir: str | Path,
    basename: str,
    *,
    max_dimension: int = MAX_DIMENSION,
    thumb_dimension: int = THUMB_DIMENSION,
    want_avif: bool = True,
) -> ImageResult:
    """Normalise `src` into `out_dir` (created if needed). Raises ImageError."""
    src_path = Path(src)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    sha = sha256_file(src_path)
    img = _open(src_path)
    result = ImageResult(width=img.width, height=img.height, mime_type="image/jpeg", sha256=sha)
    result.had_gps = _has_gps(img)
    animated = bool(getattr(img, "is_animated", False)) and getattr(img, "n_frames", 1) > 1
    fmt_in = (img.format or "").upper()

    if animated:
        return _process_animated(img, out, basename, result, thumb_dimension, fmt_in)

    orientation = img.getexif().get(0x0112, 1)
    result.orientation_applied = orientation not in (1, None)
    oriented = ImageOps.exif_transpose(img) or img
    clean = _clean_copy(oriented)
    result.exif_stripped = True
    if max(clean.size) > max_dimension:
        clean.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
    result.width, result.height = clean.size
    alpha = _has_alpha(clean)

    if alpha:
        full_name = f"{basename}.png"
        _save(clean, out / full_name, "PNG", optimize=True)
        result.mime_type = "image/png"
    else:
        rgb = clean.convert("RGB")
        full_name = f"{basename}.jpg"
        _save(rgb, out / full_name, "JPEG", quality=88, optimize=True, progressive=True)
        clean = rgb
        result.mime_type = "image/jpeg"
    result.files["full"] = full_name

    thumb = clean.copy()
    thumb.thumbnail((thumb_dimension, thumb_dimension), Image.Resampling.LANCZOS)
    if webp_supported():
        _save(clean, out / f"{basename}.webp", "WEBP", quality=82, method=4)
        result.files["webp"] = f"{basename}.webp"
        _save(thumb, out / f"{basename}.thumb.webp", "WEBP", quality=78, method=4)
        result.files["thumb"] = f"{basename}.thumb.webp"
    else:
        _save(thumb.convert("RGB"), out / f"{basename}.thumb.jpg", "JPEG", quality=80)
        result.files["thumb"] = f"{basename}.thumb.jpg"
        result.warnings.append("webp_unavailable")
    if want_avif and avif_supported():
        try:
            _save(clean, out / f"{basename}.avif", "AVIF", quality=60)
            result.files["avif"] = f"{basename}.avif"
        except Exception as exc:  # encoder present but failing on this input
            result.warnings.append(f"avif_failed:{type(exc).__name__}")
    elif want_avif:
        result.warnings.append("avif_unavailable")

    result.dominant_color = dominant_color(thumb)
    result.lqip = make_lqip(thumb)
    result.phash, result.dhash = perceptual_hashes(thumb)
    if fmt_in in {"HEIF", "HEIC"}:
        result.warnings.append("converted_from_heic")
    return result


def _process_animated(img: Image.Image, out: Path, basename: str, result: ImageResult, thumb_dimension: int, fmt_in: str) -> ImageResult:
    frames: list[Image.Image] = []
    durations: list[int] = []
    n = min(getattr(img, "n_frames", 1), MAX_ANIMATION_FRAMES)
    for i in range(n):
        img.seek(i)
        frame = _clean_copy(img.convert("RGBA"))
        durations.append(int(img.info.get("duration", 100) or 100))
        if max(frame.size) > MAX_DIMENSION:
            frame.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
        frames.append(frame)
    if getattr(img, "n_frames", 1) > n:
        result.warnings.append("animation_truncated")
    first = frames[0]
    result.width, result.height = first.size
    result.animated, result.frames = True, len(frames)
    if webp_supported():
        frames[0].save(
            out / f"{basename}.webp", "WEBP", save_all=True, append_images=frames[1:], duration=durations,
            loop=0, quality=80, method=4,
        )
        result.files["webp"] = f"{basename}.webp"
        result.files["full"] = f"{basename}.webp"
        result.mime_type = "image/webp"
    else:
        pal = [f.convert("P", palette=Image.Palette.ADAPTIVE) for f in frames]
        pal[0].save(out / f"{basename}.gif", "GIF", save_all=True, append_images=pal[1:], duration=durations, loop=0, optimize=True)
        result.files["full"] = f"{basename}.gif"
        result.mime_type = "image/gif"
        result.warnings.append("webp_unavailable")
    still = first.convert("RGB")
    thumb = still.copy()
    thumb.thumbnail((thumb_dimension, thumb_dimension), Image.Resampling.LANCZOS)
    _save(thumb, out / f"{basename}.thumb.jpg", "JPEG", quality=80)
    result.files["thumb"] = f"{basename}.thumb.jpg"
    _save(still, out / f"{basename}.poster.jpg", "JPEG", quality=85)
    result.files["poster"] = f"{basename}.poster.jpg"
    result.exif_stripped = True
    result.dominant_color = dominant_color(thumb)
    result.lqip = make_lqip(thumb)
    result.phash, result.dhash = perceptual_hashes(thumb)
    return result
