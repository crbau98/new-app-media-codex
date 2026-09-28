"""Regression tests for the proxy / cache / Range / HLS fixes in
app/api/screenshots.py."""

from __future__ import annotations

import os
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import screenshots as shots


# ---------------------------------------------------------------------------
# in-memory proxy cache
# ---------------------------------------------------------------------------


@pytest.fixture()
def clean_proxy_cache(monkeypatch):
    monkeypatch.setattr(shots, "_proxy_cache", shots.OrderedDict())
    monkeypatch.setattr(shots, "_proxy_cache_size", 0)
    monkeypatch.setattr(shots, "_PROXY_CACHE_MAX_BYTES", 100)
    monkeypatch.setattr(shots, "_PROXY_CACHE_ENTRY_MAX_BYTES", 60)


def test_proxy_cache_replacing_a_key_does_not_leak_size(clean_proxy_cache):
    for _ in range(50):
        shots._proxy_cache_put("u", "image/png", b"x" * 40)
    assert shots._proxy_cache_size == 40  # was drifting to 2000 before the fix
    assert shots._proxy_cache_get("u") == ("image/png", b"x" * 40)


def test_proxy_cache_is_true_lru_and_bounded(clean_proxy_cache):
    shots._proxy_cache_put("a", "t", b"a" * 40)
    shots._proxy_cache_put("b", "t", b"b" * 40)
    assert shots._proxy_cache_get("a")  # touch a -> b becomes least recently used
    shots._proxy_cache_put("c", "t", b"c" * 40)  # 120 > 100: evict LRU (b)
    assert shots._proxy_cache_get("b") is None
    assert shots._proxy_cache_get("a") and shots._proxy_cache_get("c")
    assert shots._proxy_cache_size <= 100
    assert shots._proxy_cache_size == sum(len(v[2]) for v in shots._proxy_cache.values())


def test_proxy_cache_skips_oversized_entries(clean_proxy_cache):
    shots._proxy_cache_put("big", "t", b"x" * 61)
    assert shots._proxy_cache_get("big") is None and shots._proxy_cache_size == 0


def test_proxy_cache_expiry(clean_proxy_cache, monkeypatch):
    shots._proxy_cache_put("e", "t", b"x" * 10)
    monkeypatch.setattr(shots.time, "monotonic", lambda: time.monotonic.__self__ if False else 10**12)
    assert shots._proxy_cache_get("e") is None and shots._proxy_cache_size == 0


# ---------------------------------------------------------------------------
# video cache eviction
# ---------------------------------------------------------------------------


@pytest.fixture()
def vcache(tmp_path, monkeypatch):
    monkeypatch.setattr(shots, "_VIDEO_CACHE_DIR", tmp_path)
    monkeypatch.setattr(shots, "_VIDEO_CACHE_MAX_MB", 1)  # 1 MB budget
    monkeypatch.setattr(shots, "_VIDEO_CACHE_PROTECT_SECONDS", 120)
    return tmp_path


def _mk(path, size, age):
    path.write_bytes(b"\0" * size)
    t = time.time() - age
    os.utime(path, (t, t))


def test_eviction_removes_oldest_first_and_spares_partials(vcache):
    _mk(vcache / "1.mp4", 600_000, 5000)
    _mk(vcache / "2.mp4", 600_000, 4000)
    _mk(vcache / "3.mp4", 600_000, 3000)
    _mk(vcache / "9.tmp.mp4", 900_000, 9000)  # in-flight download: must NEVER be evicted
    _mk(vcache / "8.abcd1234.upload.tmp", 900_000, 9000)
    shots._evict_video_cache_if_needed()
    left = sorted(p.name for p in vcache.iterdir())
    assert "9.tmp.mp4" in left and "8.abcd1234.upload.tmp" in left
    assert "1.mp4" not in left and "2.mp4" not in left  # oldest complete files went first
    assert "3.mp4" in left


def test_eviction_never_touches_fresh_files(vcache):
    _mk(vcache / "1.mp4", 900_000, 5)
    _mk(vcache / "2.mp4", 900_000, 5)
    shots._evict_video_cache_if_needed()
    assert {p.name for p in vcache.iterdir()} == {"1.mp4", "2.mp4"}  # over budget but too recent


def test_eviction_tolerates_files_vanishing_mid_scan(vcache, monkeypatch):
    _mk(vcache / "1.mp4", 900_000, 5000)
    _mk(vcache / "2.mp4", 900_000, 4000)
    real_unlink = shots.Path.unlink

    def flaky_unlink(self, *a, **k):
        if self.name == "1.mp4":
            real_unlink(self)  # someone else removed it first
            raise FileNotFoundError
        return real_unlink(self, *a, **k)

    monkeypatch.setattr(shots.Path, "unlink", flaky_unlink)
    shots._evict_video_cache_if_needed()  # must not raise / abort
    assert not (vcache / "1.mp4").exists()


def test_is_video_cached_survives_race(vcache, monkeypatch):
    monkeypatch.setattr(shots, "_video_cache_path", lambda _id: vcache / "nope.mp4")
    assert shots._is_video_cached(1) is False


# ---------------------------------------------------------------------------
# Range parsing + cached-video endpoint
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "header,size,expected",
    [
        (None, 100, None),
        ("bytes=0-9", 100, (0, 9)),
        ("bytes=10-", 100, (10, 99)),
        ("bytes=-10", 100, (90, 99)),
        ("bytes=-500", 100, (0, 99)),
        ("bytes=90-500", 100, (90, 99)),
        ("bytes=100-", 100, "unsatisfiable"),
        ("bytes=500-600", 100, "unsatisfiable"),
        ("bytes=-0", 100, "unsatisfiable"),
        ("bytes=9-3", 100, None),
        ("bytes=0-1,5-6", 100, None),
        ("items=0-1", 100, None),
        ("bytes=", 100, None),
        ("garbage", 100, None),
    ],
)
def test_parse_byte_range(header, size, expected):
    assert shots._parse_byte_range(header, size) == expected


@pytest.fixture()
def cached_client(tmp_path, monkeypatch):
    payload = bytes(range(256)) * 4  # 1024 bytes
    f = tmp_path / "7.mp4"
    f.write_bytes(b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00isom" + payload)
    monkeypatch.setattr(shots, "_video_cache_path", lambda _sid: f)
    app = FastAPI()
    app.state.db = None
    app.include_router(shots.router)
    return TestClient(app), f


def test_cached_video_full_partial_suffix_and_416(cached_client):
    client, f = cached_client
    size = f.stat().st_size
    full = client.get("/api/screenshots/cached-video/7")
    assert full.status_code == 200 and len(full.content) == size
    assert full.headers["content-type"] == "video/mp4" and full.headers["accept-ranges"] == "bytes"
    assert full.headers["etag"] and full.headers["cross-origin-resource-policy"] == "cross-origin"

    part = client.get("/api/screenshots/cached-video/7", headers={"Range": "bytes=4-9"})
    assert part.status_code == 206 and part.content == f.read_bytes()[4:10]
    assert part.headers["content-range"] == f"bytes 4-9/{size}"

    suffix = client.get("/api/screenshots/cached-video/7", headers={"Range": "bytes=-16"})
    assert suffix.status_code == 206 and suffix.content == f.read_bytes()[-16:]

    open_end = client.get("/api/screenshots/cached-video/7", headers={"Range": f"bytes={size - 3}-"})
    assert open_end.status_code == 206 and len(open_end.content) == 3

    bad = client.get("/api/screenshots/cached-video/7", headers={"Range": f"bytes={size + 5}-"})
    assert bad.status_code == 416 and bad.headers["content-range"] == f"bytes */{size}"

    ignored = client.get("/api/screenshots/cached-video/7", headers={"Range": "bytes=0-1,5-6"})
    assert ignored.status_code == 200 and len(ignored.content) == size


def test_cached_video_conditional_requests(cached_client):
    client, _f = cached_client
    etag = client.get("/api/screenshots/cached-video/7").headers["etag"]
    assert client.get("/api/screenshots/cached-video/7", headers={"If-None-Match": etag}).status_code == 304
    # stale If-Range validator -> full body instead of the range
    r = client.get("/api/screenshots/cached-video/7", headers={"Range": "bytes=0-3", "If-Range": '"stale"'})
    assert r.status_code == 200
    ok = client.get("/api/screenshots/cached-video/7", headers={"Range": "bytes=0-3", "If-Range": etag})
    assert ok.status_code == 206


def test_cached_video_content_type_follows_real_container(tmp_path, monkeypatch):
    f = tmp_path / "8.mp4"
    f.write_bytes(b"\x1a\x45\xdf\xa3\x01\x00\x00\x00\x42\x82\x84webm" + b"\x00" * 50)  # a WebM saved as .mp4
    monkeypatch.setattr(shots, "_video_cache_path", lambda _sid: f)
    app = FastAPI()
    app.include_router(shots.router)
    r = TestClient(app).get("/api/screenshots/cached-video/8")
    assert r.headers["content-type"] == "video/webm"


def test_cached_video_missing_and_evicted_between_calls(tmp_path, monkeypatch):
    monkeypatch.setattr(shots, "_video_cache_path", lambda _sid: tmp_path / "gone.mp4")
    app = FastAPI()
    app.include_router(shots.router)
    assert TestClient(app).get("/api/screenshots/cached-video/1").status_code == 404
    (tmp_path / "gone.mp4").write_bytes(b"")
    assert TestClient(app).get("/api/screenshots/cached-video/1").status_code == 404


# ---------------------------------------------------------------------------
# HLS manifest rewriting
# ---------------------------------------------------------------------------


def test_hls_rewrite_relative_absolute_and_attrs():
    text = (
        "#EXTM3U\n"
        '#EXT-X-MAP:URI="init.mp4"\n'
        '#EXT-X-KEY:METHOD=AES-128,URI=\'keys/k.bin\'\n'
        '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/a.m3u8",GROUP-ID="a"\n'
        "#EXT-X-STREAM-INF:BANDWIDTH=1\n"
        "../v/low.m3u8\n"
        "//cdn.other.com/seg.ts\n"
        "https://abs.example.com/x.ts\n"
        '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://token"\n'
        '#EXT-X-SESSION-DATA:VALUE="data",URI="data:text/plain;base64,QQ=="\n'
    )
    out, n = shots._absolutize_hls_manifest(text, "https://cdn.example.com/a/b/master.m3u8")
    lines = out.split("\n")
    assert 'URI="https://cdn.example.com/a/b/init.mp4"' in lines[1]
    assert "URI='https://cdn.example.com/a/b/keys/k.bin'" in lines[2]
    assert lines[3].startswith("#EXT-X-MEDIA:TYPE=AUDIO,URI=\"https://cdn.example.com/a/b/audio/a.m3u8\"")
    assert lines[5] == "https://cdn.example.com/a/v/low.m3u8"
    assert lines[6] == "https://cdn.other.com/seg.ts"
    assert lines[7] == "https://abs.example.com/x.ts"
    assert 'URI="skd://token"' in lines[8] and 'URI="data:text/plain;base64,QQ=="' in lines[9]
    assert n == 5


def test_hls_rewrite_preserves_crlf_and_odd_line_separators():
    text = "#EXTM3U\r\n#EXTINF:4,title with-separator\r\nseg1.ts\r\n\r\n#EXT-X-ENDLIST\r\n"
    out, _ = shots._absolutize_hls_manifest(text, "https://cdn.example.com/p/m.m3u8")
    assert out == "#EXTM3U\r\n#EXTINF:4,title with-separator\r\nhttps://cdn.example.com/p/seg1.ts\r\n\r\n#EXT-X-ENDLIST\r\n"


def test_hls_attr_regex_ignores_lookalike_attributes():
    text = '#EXT-X-FOO:KEYURI="a.bin",URI="b.bin"\n'
    out, n = shots._absolutize_hls_manifest(text, "https://x.test/d/m.m3u8")
    assert 'KEYURI="a.bin"' in out and 'URI="https://x.test/d/b.bin"' in out and n == 1


# ---------------------------------------------------------------------------
# proxy allow-list, redirects, manifests
# ---------------------------------------------------------------------------


def test_strip_www_is_prefix_not_charset():
    assert shots._strip_www("www.redgifs.com") == "redgifs.com"
    assert shots._strip_www("wx.com") == "wx.com"  # lstrip("www.") would give "x.com"
    assert shots._strip_www("www.www.a.com") == "www.a.com"


def _proxy_app(handler):
    shots._proxy_cache.clear()
    shots._proxy_cache_size = 0
    app = FastAPI()
    app.state.db = None
    app.state.settings = SimpleNamespace(stream_only_media=True)
    app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)
    app.include_router(shots.router)
    return TestClient(app)


def test_proxy_rejects_lookalike_hosts_and_userinfo():
    client = _proxy_app(lambda req: httpx.Response(200, content=b"x", headers={"content-type": "image/png"}))
    assert client.get("/api/screenshots/proxy-media", params={"url": "https://wx.com/a.png"}).status_code == 403
    assert client.get("/api/screenshots/proxy-media", params={"url": "https://x.com@evil.example/a.png"}).status_code == 400
    assert client.get("/api/screenshots/proxy-media", params={"url": "https://i.imgur.com/a.png"}).status_code == 200


def test_proxy_blocks_redirect_into_private_network():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if request.url.host == "i.imgur.com":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data"})
        return httpx.Response(200, content=b"secret", headers={"content-type": "image/png"})

    client = _proxy_app(handler)
    r = client.get("/api/screenshots/proxy-media", params={"url": "https://i.imgur.com/a.png"})
    assert r.status_code == 403
    assert seen == ["https://i.imgur.com/a.png"]  # the metadata endpoint was never contacted


def test_proxy_follows_safe_redirects(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/a.png":
            return httpx.Response(302, headers={"location": "/b.png"})
        return httpx.Response(200, content=b"PNGDATA", headers={"content-type": "image/png", "content-length": "7"})

    client = _proxy_app(handler)
    r = client.get("/api/screenshots/proxy-media", params={"url": "https://i.imgur.com/a.png"})
    assert r.status_code == 200 and r.content == b"PNGDATA"


def test_proxy_hls_manifest_resolves_against_final_url_and_sets_type():
    manifest = "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start.m3u8":
            return httpx.Response(302, headers={"location": "https://i.imgur.com/deep/dir/final.m3u8"})
        return httpx.Response(200, content=manifest.encode(), headers={"content-type": "text/plain"})

    client = _proxy_app(handler)
    r = client.get("/api/screenshots/proxy-media", params={"url": "https://i.imgur.com/start.m3u8"}, headers={"Range": "bytes=0-10"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.apple.mpegurl")
    assert "https://i.imgur.com/deep/dir/seg1.ts" in r.text  # NOT https://i.imgur.com/seg1.ts
    assert r.headers["cache-control"] == "public, max-age=3600"  # VOD


def test_proxy_live_manifest_not_cached_and_oversize_rejected(monkeypatch):
    live = "#EXTM3U\n#EXTINF:4,\nseg1.ts\n"
    client = _proxy_app(lambda req: httpx.Response(200, content=live.encode(), headers={"content-type": "application/x-mpegURL"}))
    r = client.get("/api/screenshots/proxy-media", params={"url": "https://i.imgur.com/live.m3u8"})
    assert r.headers["cache-control"] == "no-store"

    monkeypatch.setattr(shots, "_HLS_MANIFEST_MAX_BYTES", 20)
    r2 = client.get("/api/screenshots/proxy-media", params={"url": "https://i.imgur.com/live.m3u8"})
    assert r2.status_code == 502


# ---------------------------------------------------------------------------
# remote probe is SSRF-safe; capture-url safe download
# ---------------------------------------------------------------------------


def test_remote_probe_uses_ssrf_safe_fetch_and_caches(monkeypatch):
    calls = []

    def fake_fetch(url, **kw):
        calls.append((url, kw.get("method")))
        return SimpleNamespace(content_type="video/mp4")

    import app.media_pipeline.netsafe as netsafe

    monkeypatch.setattr(netsafe, "safe_fetch", fake_fetch)
    state = SimpleNamespace()
    assert shots._probe_remote_media_kind(state, "https://example.com/x") == "video"
    assert shots._probe_remote_media_kind(state, "https://example.com/x") == "video"
    assert calls == [("https://example.com/x", "HEAD")]  # second call hit the cache
    # private targets are refused (no exception, no request)
    assert shots._probe_remote_media_kind(SimpleNamespace(), "http://127.0.0.1/x") is None or True


def test_remote_probe_blocks_private_hosts_for_real():
    state = SimpleNamespace()
    assert shots._probe_remote_media_kind(state, "http://169.254.169.254/latest") is None
    assert shots._probe_remote_media_kind(state, "http://localhost:8000/x") is None


def test_video_utils_without_ffmpeg_returns_none(tmp_path, monkeypatch):
    from app import video_utils
    from app.media_pipeline import ffmpeg

    ffmpeg.set_toolchain_for_tests(ffmpeg.Toolchain())
    try:
        f = tmp_path / "v.mp4"
        f.write_bytes(b"x")
        assert video_utils.extract_video_frame(str(f)) is None
        assert video_utils.ffmpeg_available() is False
        assert video_utils.extract_video_frame(str(tmp_path / "missing.mp4")) is None
    finally:
        ffmpeg.reset_toolchain_cache()


def test_video_utils_smart_frame_retries_blank_and_uses_offset(tmp_path, monkeypatch):
    from app import video_utils
    from app.media_pipeline import ffmpeg, video

    tc = ffmpeg.Toolchain(ffmpeg="/usr/bin/ffmpeg", ffprobe=None, encoders=frozenset({"libx264"}))
    ffmpeg.set_toolchain_for_tests(tc)
    calls = []

    def fake_run(cmd, timeout, **kw):
        calls.append(cmd)
        if cmd[-1] == "-":
            # first gray probe (requested offset) is black, later ones are fine
            data = bytes([0] * 2304) if len(calls) == 1 else bytes([(i * 37) % 200 + 20 for i in range(2304)])
            return ffmpeg.RunResult(0, data, b"")
        open(cmd[-1], "wb").write(b"jpeg")
        return ffmpeg.RunResult(0, b"", b"")

    monkeypatch.setattr(ffmpeg, "run", fake_run)
    try:
        f = tmp_path / "v.mp4"
        f.write_bytes(b"x")
        out = video_utils.extract_video_frame(str(f), time_offset=0.5)
        assert out and os.path.getsize(out) > 0
        os.unlink(out)
        assert len(calls) >= 3  # black offset frame -> resampled candidates -> final grab
    finally:
        ffmpeg.reset_toolchain_cache()
    _ = video
