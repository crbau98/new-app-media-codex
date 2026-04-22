"""Tests for new scraping sources and reliability utilities."""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.config import Settings, Theme
from app.sources.instagram import collect_instagram, collect_instagram_theme
from app.sources.fansly import collect_fansly, collect_fansly_theme
from app.sources.justforfans import collect_justforfans, collect_justforfans_theme
from app.sources.spankbang import collect_spankbang, collect_spankbang_theme
from app.sources.boyfriendtv import collect_boyfriendtv, collect_boyfriendtv_theme
from app.utils.circuit_breaker import CircuitBreaker, CircuitState


@pytest.fixture
def theme() -> Theme:
    return Theme(slug="twinks", label="Gay Twinks", queries=["twink nude"])


@pytest.fixture
def settings() -> Settings:
    s = Settings()
    s.instagram_results = 5
    s.fansly_results = 5
    s.justforfans_results = 5
    s.spankbang_results = 5
    s.boyfriendtv_results = 5
    return s


# ── Instagram ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collect_instagram_extracts_images(httpx_mock: Any) -> None:
    html = '''
    <html><body>
    <img src="https://instagram.com/p/1.jpg" alt="Post 1">
    <img src="https://instagram.com/p/2.jpg" alt="Post 2">
    </body></html>
    '''
    httpx_mock.add_response(url="https://www.instagram.com/testuser/embed/", text=html)
    results = await collect_instagram("testuser", limit=10)
    assert len(results) == 2
    assert results[0]["type"] == "image"
    assert "instagram.com" in results[0]["url"]


@pytest.mark.asyncio
async def test_collect_instagram_handles_private_or_404(httpx_mock: Any) -> None:
    httpx_mock.add_response(url="https://www.instagram.com/privateuser/embed/", status_code=404)
    results = await collect_instagram("privateuser", limit=10)
    assert results == []


@pytest.mark.asyncio
async def test_collect_instagram_theme_no_db_returns_empty(settings: Settings, theme: Theme) -> None:
    items, images = await collect_instagram_theme(settings, theme, db=None)
    assert items == []
    assert images == []


# ── Fansly ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collect_fansly_extracts_images(httpx_mock: Any) -> None:
    html = '''
    <html><body>
    <img src="https://cdn.fansly.com/img1.jpg" alt="Post 1">
    <img src="https://cdn.fansly.com/img2.jpg" alt="Post 2">
    </body></html>
    '''
    httpx_mock.add_response(url="https://fansly.com/testcreator", text=html)
    results = await collect_fansly("testcreator", limit=10)
    assert len(results) == 2
    assert results[0]["type"] == "image"


@pytest.mark.asyncio
async def test_collect_fansly_fallback_url(httpx_mock: Any) -> None:
    html = '<html><body><img src="https://cdn.fansly.com/img.jpg" alt="hey"></body></html>'
    httpx_mock.add_response(url="https://fansly.com/testcreator", status_code=404)
    httpx_mock.add_response(url="https://fansly.com/a/testcreator", text=html)
    results = await collect_fansly("testcreator", limit=10)
    assert len(results) == 1


# ── JustForFans ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collect_justforfans_extracts_video_and_images(httpx_mock: Any) -> None:
    html = '''
    <html><body>
    <video poster="https://cdn.jff/poster.jpg">
        <source src="https://cdn.jff/video.mp4">
    </video>
    <img src="https://cdn.jff/photo.jpg" alt="Photo">
    </body></html>
    '''
    httpx_mock.add_response(url="https://justfor.fans/testuser", text=html)
    results = await collect_justforfans("testuser", limit=10)
    assert len(results) == 2
    types = {r["type"] for r in results}
    assert "video" in types
    assert "image" in types


@pytest.mark.asyncio
async def test_collect_justforfans_handles_404(httpx_mock: Any) -> None:
    httpx_mock.add_response(url="https://justfor.fans/nobody", status_code=404)
    results = await collect_justforfans("nobody", limit=10)
    assert results == []


# ── SpankBang ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collect_spankbang_extracts_videos(httpx_mock: Any) -> None:
    html = '''
    <html><body>
    <div class="video-list">
        <div class="video-item">
            <a href="/3abc/video/gay+twink"><img src="https://tb.com/1.jpg"></a>
            <span class="n" title="Hot Twink">Hot Twink</span>
        </div>
        <div class="video-item">
            <a href="/4def/video/gay+bear"><img src="https://tb.com/2.jpg"></a>
            <span class="n" title="Bear Fun">Bear Fun</span>
        </div>
    </div>
    </body></html>
    '''
    httpx_mock.add_response(url="https://spankbang.com/s/gay+twink/", text=html)
    results = await collect_spankbang("gay twink", limit=10)
    assert len(results) == 2
    assert all(r["type"] == "video" for r in results)
    assert "spankbang.com" in results[0]["url"]


@pytest.mark.asyncio
async def test_collect_spankbang_theme(settings: Settings, theme: Theme, httpx_mock: Any) -> None:
    html = '''
    <html><body>
    <div class="video-item">
        <a href="/5/video/twink"><img src="https://tb.com/t.jpg"></a>
        <span class="n">Twink Video</span>
    </div>
    </body></html>
    '''
    httpx_mock.add_response(url="https://spankbang.com/s/twink+nude/", text=html)
    items, images = await collect_spankbang_theme(settings, theme)
    assert len(items) == 1
    assert items[0].source_type == "spankbang"
    assert len(images) == 1


# ── BoyfriendTV ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collect_boyfriendtv_extracts_videos(httpx_mock: Any) -> None:
    html = '''
    <html><body>
    <div class="thumbs">
        <div class="thumb">
            <a href="/videos/123456/gay-twink.html">
                <img data-original="https://tb.com/1.jpg" alt="Twink">
            </a>
            <span class="duration">12:34</span>
        </div>
    </div>
    </body></html>
    '''
    httpx_mock.add_response(url="https://www.boyfriendtv.com/search/?q=gay+twink", text=html)
    results = await collect_boyfriendtv("gay twink", limit=10)
    assert len(results) >= 1
    assert results[0]["type"] == "video"
    assert "boyfriendtv.com" in results[0]["url"]


@pytest.mark.asyncio
async def test_collect_boyfriendtv_theme(settings: Settings, theme: Theme, httpx_mock: Any) -> None:
    html = '''
    <html><body>
    <div class="thumb">
        <a href="/videos/999/xxx.html"><img src="https://tb.com/x.jpg" alt="Vid"></a>
    </div>
    </body></html>
    '''
    httpx_mock.add_response(url="https://www.boyfriendtv.com/search/?q=twink+nude", text=html)
    items, images = await collect_boyfriendtv_theme(settings, theme)
    assert len(items) == 1
    assert items[0].source_type == "boyfriendtv"


# ── Circuit Breaker ──────────────────────────────────────────────────────────

def test_circuit_breaker_closed_by_default() -> None:
    cb = CircuitBreaker("test")
    assert cb._state == CircuitState.CLOSED


def test_circuit_breaker_opens_after_failures() -> None:
    cb = CircuitBreaker("test", failure_threshold=2, recovery_timeout=1.0)
    with pytest.raises(RuntimeError):
        cb.call(lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert cb._state == CircuitState.CLOSED
    assert cb._failure_count == 1

    with pytest.raises(RuntimeError):
        cb.call(lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert cb._state == CircuitState.OPEN

    with pytest.raises(RuntimeError, match="OPEN"):
        cb.call(lambda: 42)


def test_circuit_breaker_resets_after_timeout() -> None:
    cb = CircuitBreaker("test", failure_threshold=1, recovery_timeout=0.1)
    with pytest.raises(RuntimeError):
        cb.call(lambda: (_ for _ in ()).throw(RuntimeError("boom")))
    assert cb._state == CircuitState.OPEN
    import time
    time.sleep(0.15)
    # Half-open allows one call
    result = cb.call(lambda: 42)
    assert result == 42
    assert cb._state == CircuitState.CLOSED


@pytest.mark.asyncio
async def test_circuit_breaker_async_call() -> None:
    cb = CircuitBreaker("async_test", failure_threshold=1, recovery_timeout=0.1)

    async def good() -> int:
        return 42

    async def bad() -> int:
        raise RuntimeError("boom")

    result = await cb.async_call(good)
    assert result == 42

    with pytest.raises(RuntimeError):
        await cb.async_call(bad)
    assert cb._state == CircuitState.OPEN

    import time
    time.sleep(0.15)
    result2 = await cb.async_call(good)
    assert result2 == 42
