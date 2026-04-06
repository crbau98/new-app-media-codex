"""Vision-based image quality and gender filters.

The default quality filter keeps the historical fail-open behavior so temporary
vision outages do not halt the whole pipeline. Strict callers can opt into
fail-closed handling when they need to guarantee that female content stays out.
"""
from __future__ import annotations

import base64
import hashlib
import json
import time
from pathlib import Path
from threading import Lock

import requests

from app.config import Settings

_VISION_PROMPT = (
    "You are a strict content filter. Evaluate this image and respond ONLY with JSON.\n\n"
    "PASS criteria — ALL must be true:\n"
    "1. Contains one or more real adult human males (not cartoon, illustration, or CGI).\n"
    "2. Every visible male appears young-to-middle-aged (roughly 18–45), NOT elderly or old.\n"
    "3. Every visible male has a fit, lean, athletic, or muscular physique — "
    "no overweight, fat, chubby, or average/dad-bod builds.\n"
    "4. NO women or female-presenting individuals are present anywhere in the image.\n"
    "5. Content must be sexual or erotic in nature (nude, semi-nude, or explicitly sexual).\n\n"
    "If ANY criterion fails, set pass=false.\n"
    "Respond with JSON only, no markdown: "
    '{"pass": true_or_false, "reason": "one-line reason"}'
)

_WOMEN_CHECK_PROMPT = (
    "Look at this image carefully. Does it contain any women, girls, or female-presenting individuals "
    "(including transgender women)? Answer based only on visual cues — body shape, breasts, facial features, etc.\n\n"
    "Respond ONLY with JSON, no markdown: "
    '{"has_women": true_or_false, "reason": "one-line reason"}'
)

# Extensions treated as video — skip vision check (model can't evaluate video frames).
_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".avi", ".mkv"}

# MIME type map for base64 data URIs.
_MIME: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
}
_VISION_LOG_TTL_S = 120.0
_VISION_LOGGED_AT: dict[str, float] = {}
_VISION_CACHE_TTL_S = 6 * 60 * 60
_VISION_FAILURE_CACHE_TTL_S = 5 * 60
_VISION_CACHE_MISS = object()
_VISION_RESULT_CACHE: dict[str, tuple[float, dict | None]] = {}
_VISION_RESULT_CACHE_LOCK = Lock()


def _log_once_per_window(key: str, message: str) -> None:
    now = time.time()
    expired = [name for name, logged_at in _VISION_LOGGED_AT.items() if now - logged_at > _VISION_LOG_TTL_S]
    for name in expired:
        _VISION_LOGGED_AT.pop(name, None)
    last_logged = _VISION_LOGGED_AT.get(key, 0.0)
    if now - last_logged < _VISION_LOG_TTL_S:
        return
    _VISION_LOGGED_AT[key] = now
    print(message)


def _call_vision_api(settings: Settings, image_path: str, prompt: str) -> dict | None:
    """Send an image to the vision API with the given prompt.

    Returns the parsed JSON dict from the model, or None on any error
    (missing key, file not found, network error, non-JSON response, etc.).
    Callers decide how to handle None (fail-open vs fail-closed).
    Skips video files (returns None) since the model cannot evaluate video frames.
    """
    path = Path(image_path)
    if not path.exists():
        return None

    suffix = path.suffix.lower()
    if suffix in _VIDEO_EXTS:
        return None

    try:
        image_bytes = path.read_bytes()
        b64 = base64.b64encode(image_bytes).decode("ascii")
        mime = _MIME.get(suffix, "image/jpeg")

        response = requests.post(
            f"{settings.openai_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openai_model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime};base64,{b64}",
                                    "detail": "low",
                                },
                            },
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "max_tokens": 80,
            },
            timeout=30,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception:
        return None


def _vision_cache_key(image_path: str, prompt: str) -> str | None:
    path = Path(image_path)
    if not path.exists() or path.suffix.lower() in _VIDEO_EXTS:
        return None
    try:
        stat = path.stat()
    except OSError:
        return None
    fingerprint = f"{path.resolve()}:{stat.st_mtime_ns}:{stat.st_size}:{prompt}"
    return hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()


def _get_cached_vision_result(image_path: str, prompt: str) -> dict | None | object:
    cache_key = _vision_cache_key(image_path, prompt)
    if not cache_key:
        return _VISION_CACHE_MISS
    now = time.time()
    with _VISION_RESULT_CACHE_LOCK:
        entry = _VISION_RESULT_CACHE.get(cache_key)
        if entry and now < entry[0]:
            return entry[1]
    return _VISION_CACHE_MISS


def _store_cached_vision_result(image_path: str, prompt: str, parsed: dict | None) -> None:
    cache_key = _vision_cache_key(image_path, prompt)
    if not cache_key:
        return
    ttl = _VISION_FAILURE_CACHE_TTL_S if parsed is None else _VISION_CACHE_TTL_S
    with _VISION_RESULT_CACHE_LOCK:
        if len(_VISION_RESULT_CACHE) > 4000:
            now = time.time()
            expired = [key for key, (expires_at, _) in _VISION_RESULT_CACHE.items() if expires_at <= now]
            for key in expired:
                _VISION_RESULT_CACHE.pop(key, None)
            if len(_VISION_RESULT_CACHE) > 4000:
                _VISION_RESULT_CACHE.clear()
        _VISION_RESULT_CACHE[cache_key] = (time.time() + ttl, parsed)


def passes_vision_filter(settings: Settings, image_path: str, *, fail_open: bool = True) -> bool:
    """Return True if the image passes the fit-male filter.

    • If no API key is configured → returns ``fail_open``.
    • If the file is a video → returns ``fail_open``.
    • If the vision call fails for any reason → returns ``fail_open``.
    """
    if not settings.openai_api_key:
        return fail_open

    cached = _get_cached_vision_result(image_path, _VISION_PROMPT)
    parsed = _call_vision_api(settings, image_path, _VISION_PROMPT) if cached is _VISION_CACHE_MISS else cached
    if cached is _VISION_CACHE_MISS:
        _store_cached_vision_result(image_path, _VISION_PROMPT, parsed)
    if parsed is None:
        return fail_open

    result = bool(parsed.get("pass", False))
    if not result:
        reason = parsed.get("reason", "")
        _log_once_per_window(
            f"rejected:{reason}",
            f"[vision_filter] REJECTED {Path(image_path).name}: {reason}",
        )
    return result


def contains_women(settings: Settings, image_path: str, *, default_on_error: bool = False) -> bool:
    """Return True if the image appears to contain women.

    ``default_on_error`` lets strict callers treat unknown or unevaluable media
    as unsafe instead of letting it pass through.
    """
    if not settings.openai_api_key:
        return default_on_error

    cached = _get_cached_vision_result(image_path, _WOMEN_CHECK_PROMPT)
    parsed = _call_vision_api(settings, image_path, _WOMEN_CHECK_PROMPT) if cached is _VISION_CACHE_MISS else cached
    if cached is _VISION_CACHE_MISS:
        _store_cached_vision_result(image_path, _WOMEN_CHECK_PROMPT, parsed)
    if parsed is None:
        return default_on_error

    result = bool(parsed.get("has_women", False))
    if result:
        reason = parsed.get("reason", "")
        _log_once_per_window(
            f"women:{reason}",
            f"[vision_filter] WOMEN DETECTED in {Path(image_path).name}: {reason}",
        )
    return result


def passes_strict_content_filter(settings: Settings, image_path: str) -> bool:
    """Return True only for confidently male-only, in-scope content."""
    if contains_women(settings, image_path, default_on_error=True):
        return False
    return passes_vision_filter(settings, image_path, fail_open=False)


# ── URL-based vision filtering (no local file needed) ────────────────────

def _call_vision_api_url(settings: Settings, image_url: str, prompt: str) -> dict | None:
    """Send a remote image URL to the vision API. Returns parsed JSON or None."""
    try:
        response = requests.post(
            f"{settings.openai_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openai_model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": image_url, "detail": "low"},
                            },
                        ],
                    }
                ],
                "response_format": {"type": "json_object"},
                "max_tokens": 80,
            },
            timeout=30,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception:
        return None


def _url_cache_key(image_url: str, prompt: str) -> str:
    fingerprint = f"url:{image_url}:{prompt}"
    return hashlib.sha1(fingerprint.encode("utf-8")).hexdigest()


def _get_cached_url_vision(image_url: str, prompt: str):
    cache_key = _url_cache_key(image_url, prompt)
    now = time.time()
    with _VISION_RESULT_CACHE_LOCK:
        entry = _VISION_RESULT_CACHE.get(cache_key)
        if entry and now < entry[0]:
            return entry[1]
    return _VISION_CACHE_MISS


def _store_cached_url_vision(image_url: str, prompt: str, parsed: dict | None) -> None:
    cache_key = _url_cache_key(image_url, prompt)
    ttl = _VISION_FAILURE_CACHE_TTL_S if parsed is None else _VISION_CACHE_TTL_S
    with _VISION_RESULT_CACHE_LOCK:
        if len(_VISION_RESULT_CACHE) > 4000:
            now = time.time()
            expired = [k for k, (exp, _) in _VISION_RESULT_CACHE.items() if exp <= now]
            for k in expired:
                _VISION_RESULT_CACHE.pop(k, None)
            if len(_VISION_RESULT_CACHE) > 4000:
                _VISION_RESULT_CACHE.clear()
        _VISION_RESULT_CACHE[cache_key] = (time.time() + ttl, parsed)


def passes_vision_filter_url(settings: Settings, image_url: str, *, fail_open: bool = True) -> bool:
    """Like passes_vision_filter but works on a remote image URL."""
    if not settings.openai_api_key:
        return fail_open
    cached = _get_cached_url_vision(image_url, _VISION_PROMPT)
    parsed = _call_vision_api_url(settings, image_url, _VISION_PROMPT) if cached is _VISION_CACHE_MISS else cached
    if cached is _VISION_CACHE_MISS:
        _store_cached_url_vision(image_url, _VISION_PROMPT, parsed)
    if parsed is None:
        return fail_open
    result = bool(parsed.get("pass", False))
    if not result:
        reason = parsed.get("reason", "")
        _log_once_per_window(f"rejected-url:{reason}", f"[vision_filter] REJECTED URL ...{image_url[-60:]}: {reason}")
    return result


def contains_women_url(settings: Settings, image_url: str, *, default_on_error: bool = False) -> bool:
    """Like contains_women but works on a remote image URL."""
    if not settings.openai_api_key:
        return default_on_error
    cached = _get_cached_url_vision(image_url, _WOMEN_CHECK_PROMPT)
    parsed = _call_vision_api_url(settings, image_url, _WOMEN_CHECK_PROMPT) if cached is _VISION_CACHE_MISS else cached
    if cached is _VISION_CACHE_MISS:
        _store_cached_url_vision(image_url, _WOMEN_CHECK_PROMPT, parsed)
    if parsed is None:
        return default_on_error
    return bool(parsed.get("has_women", False))


def passes_strict_content_filter_url(settings: Settings, image_url: str) -> bool:
    """Like passes_strict_content_filter but works on a remote image URL."""
    if contains_women_url(settings, image_url, default_on_error=True):
        return False
    return passes_vision_filter_url(settings, image_url, fail_open=False)
