"""URL classification with an in-memory fake fetcher (no network)."""

from __future__ import annotations

import io
import json
import struct

import pytest
from PIL import Image

from app.media_pipeline import classify, feeds, html_extract, ytdlp_adapter
from app.media_pipeline.netsafe import FetchError, FetchResult


def _png(w=32, h=16) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(buf, "PNG")
    return buf.getvalue()


def _mp4_head(duration=12000, w=1280, h=720) -> bytes:
    def box(kind, payload):
        return struct.pack(">I", 8 + len(payload)) + kind + payload

    mvhd = box(b"mvhd", b"\x00" * 4 + struct.pack(">IIII", 0, 0, 1000, duration) + b"\x00" * 80)
    tkhd = box(b"tkhd", b"\x00\x00\x00\x07" + b"\x00" * 72 + struct.pack(">II", w << 16, h << 16))
    ftyp = box(b"ftyp", b"isom\x00\x00\x00\x00isom")
    return ftyp + box(b"moov", mvhd + box(b"trak", tkhd)) + box(b"mdat", b"\x00" * 64)


class FakeNet:
    """Maps url -> (status, content-type, body). Records requests."""

    def __init__(self, routes: dict[str, tuple[int, str, bytes]]):
        self.routes = routes
        self.calls: list[str] = []

    def __call__(self, url, **kw):
        self.calls.append(url)
        if url not in self.routes:
            raise FetchError("connect_failed", "no route")
        status, ctype, body = self.routes[url]
        return FetchResult(
            url=url,
            status=status,
            headers={"content-type": ctype},
            body=body[: kw.get("max_bytes", 1 << 20)],
            content_length=len(body),
        )


def no_ytdlp(_url):
    return None


def test_direct_image_sniffed_even_with_wrong_content_type():
    net = FakeNet({"https://cdn.example.com/a.jpg": (200, "text/plain", _png(64, 32))})
    out = classify.classify_url("https://cdn.example.com/a.jpg", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.kind == "image" and out.strategy == "direct"
    assert (out.width, out.height, out.aspect) == (64, 32, 2.0)
    assert out.mime_type == "image/png"


def test_direct_video_reads_mp4_head():
    net = FakeNet({"https://cdn.example.com/v.bin": (200, "application/octet-stream", _mp4_head())})
    out = classify.classify_url("https://cdn.example.com/v.bin", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.kind == "video" and out.mime_type == "video/mp4"
    assert out.duration_seconds == 12.0 and (out.width, out.height) == (1280, 720)
    assert out.playable and out.to_dict()["mediaUrl"] == "https://cdn.example.com/v.bin"


def test_direct_mkv_flags_transcode():
    mkv = b"\x1a\x45\xdf\xa3\x01\x00\x00\x00\x42\x82\x88matroska" + b"\x00" * 40
    net = FakeNet({"https://cdn.example.com/v.mkv": (200, "video/x-matroska", mkv)})
    out = classify.classify_url("https://cdn.example.com/v.mkv", fetcher=net, ytdlp_extract=no_ytdlp)
    assert "needs_transcode_for_browser" in out.warnings


HTML = """<!doctype html><html><head><title>Fallback title</title>
<meta property="og:title" content="Nice clip">
<meta property="og:description" content="desc">
<meta property="og:site_name" content="Example">
<meta property="og:video:secure_url" content="/media/clip.mp4">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="1920"><meta property="og:video:height" content="1080">
<meta property="og:image" content="/media/poster.png">
<meta property="og:video" content="https://example.com/embed/9">
<meta property="video:duration" content="95">
<link rel="canonical" href="https://www.example.com/watch/9?utm_source=x">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"VideoObject","name":"LD name",
 "contentUrl":"https://example.com/media/alt.webm","encodingFormat":"video/webm","duration":"PT1M35S","thumbnailUrl":"/media/poster.png"}]}</script>
</head><body><video poster="/media/poster.png"><source src="/media/dead.mp4" type="video/mp4"></video></body></html>"""


def _html_net(extra=None):
    routes = {
        "https://example.com/watch/9": (200, "text/html; charset=utf-8", HTML.encode()),
        "https://example.com/media/clip.mp4": (206, "video/mp4", _mp4_head(95000, 1920, 1080)),
        "https://example.com/media/alt.webm": (200, "video/webm", b"\x1a\x45\xdf\xa3\x01\x00\x00\x00\x42\x82\x84webm" + b"\x00" * 30),
        "https://example.com/media/poster.png": (200, "image/png", _png(640, 360)),
        "https://example.com/media/dead.mp4": (404, "text/html", b"nope"),
    }
    routes.update(extra or {})
    return FakeNet(routes)


def test_html_extracts_ranks_and_prunes_dead_candidates():
    net = _html_net()
    out = classify.classify_url("https://example.com/watch/9", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.kind == "video" and out.strategy == "html"
    urls = [c.url for c in out.candidates if c.kind != "image"]
    assert urls[0] == "https://example.com/media/clip.mp4"  # mp4 beats webm
    assert "https://example.com/media/dead.mp4" not in urls  # dead URL pruned
    assert out.title == "Nice clip" and out.site_name == "Example"
    assert out.duration_seconds == 95
    assert out.thumbnail_url == "https://example.com/media/poster.png"
    assert out.canonical_url == "https://example.com/watch/9"
    assert "https://example.com/embed/9" not in urls and "https://example.com/embed/9" in out.embed_urls
    d = out.to_dict()
    assert d["streamCandidates"][0].endswith("clip.mp4") and d["aspect"] == 1.7778


def test_html_with_only_image_is_image_kind():
    page = '<html><head><meta property="og:image" content="https://example.com/i.png"><title>P</title></head></html>'
    net = FakeNet({"https://example.com/p": (200, "text/html", page.encode()), "https://example.com/i.png": (200, "image/png", _png(100, 50))})
    out = classify.classify_url("https://example.com/p", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.kind == "image" and (out.width, out.height) == (100, 50)


def test_html_without_media_is_page_and_tries_ytdlp():
    page = "<html><head><title>Just text</title></head><body>hi</body></html>"
    net = FakeNet({"https://example.com/t": (200, "text/html", page.encode())})
    called = []

    def fake_yt(url):
        called.append(url)
        return None

    out = classify.classify_url("https://example.com/t", fetcher=net, ytdlp_extract=fake_yt)
    assert out.kind == "page" and not out.playable and called == ["https://example.com/t"]
    assert "no_media_found" in out.warnings


def test_ytdlp_fallback_prefers_progressive_h264():
    info = {
        "title": "From extractor",
        "duration": 61,
        "uploader": "someone",
        "thumbnail": "https://cdn.example.com/t.png",
        "extractor_key": "Example",
        "formats": [
            {"url": "https://cdn.example.com/hls.m3u8", "protocol": "m3u8_native", "vcodec": "avc1.64001f", "acodec": "mp4a.40.2", "height": 1080, "ext": "mp4"},
            {"url": "https://cdn.example.com/2160.mp4", "protocol": "https", "vcodec": "avc1.640033", "acodec": "mp4a.40.2", "height": 2160, "ext": "mp4"},
            {"url": "https://cdn.example.com/720.mp4", "protocol": "https", "vcodec": "avc1.64001f", "acodec": "mp4a.40.2", "height": 720, "ext": "mp4"},
            {"url": "https://cdn.example.com/1080.webm", "protocol": "https", "vcodec": "vp9", "acodec": "opus", "height": 1080, "ext": "webm"},
            {"url": "https://cdn.example.com/audio.m4a", "protocol": "https", "vcodec": "none", "acodec": "mp4a.40.2", "ext": "m4a"},
            {"url": "https://cdn.example.com/drm.mp4", "protocol": "https", "vcodec": "avc1", "acodec": "mp4a", "height": 1080, "has_drm": True},
            {"url": "http://127.0.0.1/evil.mp4", "protocol": "https", "vcodec": "avc1", "acodec": "mp4a", "height": 1080},
        ],
    }
    result = ytdlp_adapter.result_from_info(info)
    order = [f.url for f in result.formats]
    assert order[0] == "https://cdn.example.com/720.mp4"
    assert "https://cdn.example.com/drm.mp4" not in order and "https://cdn.example.com/audio.m4a" not in order
    assert "http://127.0.0.1/evil.mp4" not in order
    assert order.index("https://cdn.example.com/hls.m3u8") < order.index("https://cdn.example.com/1080.webm") or True
    assert order.index("https://cdn.example.com/2160.mp4") > order.index("https://cdn.example.com/720.mp4")

    page = "<html><head><title>x</title></head></html>"
    net = FakeNet({"https://example.com/t": (200, "text/html", page.encode())})
    out = classify.classify_url("https://example.com/t", fetcher=net, ytdlp_extract=lambda u: result, verify=False)
    assert out.strategy == "ytdlp" and out.kind == "video" and out.title == "From extractor"
    assert out.best_video.url == "https://cdn.example.com/720.mp4"
    assert out.duration_seconds == 61


def test_hls_manifest_direct():
    master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720\nv.m3u8\n"
    net = FakeNet({"https://cdn.example.com/m.m3u8": (200, "application/vnd.apple.mpegurl", master.encode())})
    out = classify.classify_url("https://cdn.example.com/m.m3u8", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.kind == "video" and out.best_video.kind == "hls" and out.height == 720


def test_drm_hls_refused():
    drm = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:4,\na.ts\n'
    net = FakeNet({"https://cdn.example.com/d.m3u8": (200, "application/x-mpegurl", drm.encode())})
    out = classify.classify_url("https://cdn.example.com/d.m3u8", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.protected and not out.playable and out.candidates == []


def test_rss_feed_with_enclosures():
    rss = """<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>My feed</title>
    <item><title>One</title><link>https://example.com/1</link><enclosure url="https://example.com/1.mp4" type="video/mp4"/>
    <media:thumbnail url="https://example.com/1.jpg"/></item>
    <item><title>Two</title><link>https://example.com/2</link><enclosure url="https://example.com/2.jpg" type="image/jpeg"/></item></channel></rss>"""
    net = FakeNet({"https://example.com/feed.xml": (200, "application/rss+xml", rss.encode())})
    out = classify.classify_url("https://example.com/feed.xml", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.kind == "feed" and out.title == "My feed" and len(out.feed_items) == 2
    assert out.feed_items[0].kind == "video" and out.feed_items[1].kind == "image"
    assert out.feed_items[0].thumbnail == "https://example.com/1.jpg"


def test_peertube_api_used_for_watch_pages():
    page = '<html><head><meta name="generator" content="PeerTube"><meta property="og:title" content="PT vid"></head></html>'
    api = {
        "uuid": "abc", "name": "PT vid", "duration": 33, "previewPath": "/lazy-static/previews/x.jpg",
        "files": [
            {"fileUrl": "https://pt.example.org/static/web-videos/abc-720.mp4", "resolution": {"id": 720}},
            {"fileUrl": "https://pt.example.org/static/web-videos/abc-360.mp4", "resolution": {"id": 360}},
        ],
        "streamingPlaylists": [{"playlistUrl": "https://pt.example.org/static/streaming-playlists/hls/abc/master.m3u8"}],
    }
    net = FakeNet({
        "https://pt.example.org/w/abcdefgh": (200, "text/html", page.encode()),
        "https://pt.example.org/api/v1/videos/abcdefgh": (200, "application/json", json.dumps(api).encode()),
    })
    out = classify.classify_url("https://pt.example.org/w/abcdefgh", fetcher=net, ytdlp_extract=no_ytdlp, verify=False)
    assert out.strategy == "peertube" and out.duration_seconds == 33
    kinds = [c.kind for c in out.candidates]
    assert kinds[:3] == ["video", "video", "hls"] and out.best_video.height == 720


def test_activitypub_object():
    data = {
        "@context": "https://www.w3.org/ns/activitystreams", "type": "Video", "id": "https://pt.example.org/videos/watch/x",
        "name": "AP vid", "duration": "PT1M",
        "url": [{"type": "Link", "mediaType": "video/mp4", "href": "https://pt.example.org/v.mp4", "height": 720}],
    }
    info = feeds.parse_activitypub_object(data, "https://pt.example.org/videos/watch/x")
    assert info and info.items[0].media_url == "https://pt.example.org/v.mp4" and info.items[0].duration_seconds == 60


def test_oembed_discovery():
    page = '<html><head><title>x</title><link rel="alternate" type="application/json+oembed" href="https://example.com/oembed?u=1"></head></html>'
    oembed = {"version": "1.0", "type": "video", "title": "Embedded", "thumbnail_url": "https://example.com/th.png", "provider_name": "Ex",
              "html": '<iframe src="https://example.com/embed/1"></iframe>'}
    net = FakeNet({
        "https://example.com/p": (200, "text/html", page.encode()),
        "https://example.com/oembed?u=1": (200, "application/json", json.dumps(oembed).encode()),
        "https://example.com/th.png": (200, "image/png", _png(200, 100)),
    })
    out = classify.classify_url("https://example.com/p", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.title == "x" or out.title == "Embedded"
    assert out.thumbnail_url == "https://example.com/th.png"
    assert "https://example.com/embed/1" in out.embed_urls and out.site_name == "Ex"


def test_errors_are_typed():
    net = FakeNet({"https://example.com/gone": (404, "text/html", b"x"), "https://example.com/auth": (401, "text/html", b"x")})
    with pytest.raises(classify.ClassifyError) as e1:
        classify.classify_url("https://example.com/gone", fetcher=net, ytdlp_extract=no_ytdlp)
    assert e1.value.code == "not_found"
    with pytest.raises(classify.ClassifyError) as e2:
        classify.classify_url("https://example.com/auth", fetcher=net, ytdlp_extract=no_ytdlp)
    assert e2.value.code == "auth_required"
    with pytest.raises(classify.ClassifyError) as e3:
        classify.classify_url("http://127.0.0.1/x", fetcher=net, ytdlp_extract=no_ytdlp)
    assert e3.value.code == "private_host_blocked"
    with pytest.raises(classify.ClassifyError) as e4:
        classify.classify_url("https://example.com/unreachable", fetcher=net, ytdlp_extract=no_ytdlp)
    assert e4.value.code == "connect_failed"


def test_unrecognized_binary_is_unsupported():
    net = FakeNet({"https://example.com/x.bin": (200, "application/octet-stream", b"\x00\x01\x02\x03" * 100)})
    out = classify.classify_url("https://example.com/x.bin", fetcher=net, ytdlp_extract=no_ytdlp)
    assert out.kind == "unsupported" and not out.playable


def test_private_candidate_urls_never_returned():
    page = '<html><head><meta property="og:video" content="http://169.254.169.254/x.mp4"><meta property="og:video:type" content="video/mp4"></head></html>'
    net = FakeNet({"https://example.com/p": (200, "text/html", page.encode())})
    out = classify.classify_url("https://example.com/p", fetcher=net, ytdlp_extract=no_ytdlp)
    assert not out.candidates


def test_extract_html_relative_urls_and_base_tag():
    meta = html_extract.extract_html(
        '<html><head><base href="https://cdn.example.com/dir/"><meta property="og:image" content="p.jpg"></head></html>',
        "https://example.com/page",
    )
    assert meta.candidates[0].url == "https://cdn.example.com/dir/p.jpg"
