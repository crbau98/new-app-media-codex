"""Unit tests for netsafe, sniff, canonical, mp4probe and manifests."""

from __future__ import annotations

import http.server
import socket
import struct
import threading

import pytest

from app.media_pipeline import canonical, manifests, mp4probe, netsafe, sniff


# --------------------------------------------------------------------------
# netsafe
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1", "10.1.2.3", "172.16.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
        "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1",
        "224.0.0.1", "255.255.255.255",
    ],
)
def test_private_ips_rejected(ip):
    assert netsafe.is_public_ip(ip) is False


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"])
def test_public_ips_accepted(ip):
    assert netsafe.is_public_ip(ip) is True


@pytest.mark.parametrize(
    "url,code",
    [
        ("ftp://example.com/a.mp4", "unsupported_protocol"),
        ("file:///etc/passwd", "unsupported_protocol"),
        ("javascript:alert(1)", "unsupported_protocol"),
        ("http://localhost/x", "private_host_blocked"),
        ("http://foo.internal/x", "private_host_blocked"),
        ("http://127.0.0.1/x", "private_host_blocked"),
        ("http://169.254.169.254/latest/meta-data", "private_host_blocked"),
        ("http://[::1]/x", "private_host_blocked"),
        ("http://2130706433/", "private_host_blocked"),
        ("http://user:pw@example.com/", "credentials_not_allowed"),
        ("https://example.com:22/", "port_not_allowed"),
        ("", "url_required"),
        ("https://exa\nmple.com/", "invalid_url"),
    ],
)
def test_validate_url_rejects(url, code):
    with pytest.raises(netsafe.UnsafeUrlError) as err:
        netsafe.validate_url(url)
    assert err.value.code == code


def test_validate_url_accepts_public():
    got = netsafe.validate_url("https://Example.com/a/b.mp4?x=1")
    assert got.host == "example.com" and got.port == 443


def test_hostname_resolving_to_private_is_blocked(monkeypatch):
    """DNS rebinding: a public-looking name that resolves to loopback."""

    def fake_getaddrinfo(host, port, *a, **k):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]

    monkeypatch.setattr(netsafe.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(netsafe.UnsafeUrlError):
        netsafe.safe_fetch("http://rebind.example.com/x")


def test_mixed_dns_answers_block_if_any_private(monkeypatch):
    def fake_getaddrinfo(host, port, *a, **k):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.7", port)),
        ]

    monkeypatch.setattr(netsafe.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(netsafe.UnsafeUrlError):
        netsafe.resolve_public("mixed.example.com", 80)


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence
        pass

    def do_GET(self):
        if self.path == "/redir-private":
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest")
            self.end_headers()
        elif self.path == "/loop":
            self.send_response(302)
            self.send_header("Location", "/loop")
            self.end_headers()
        elif self.path == "/big":
            body = b"x" * 200_000
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            body = b"hello"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    do_HEAD = do_GET


@pytest.fixture()
def local_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def test_loopback_blocked_by_default(local_server):
    with pytest.raises(netsafe.UnsafeUrlError):
        netsafe.safe_fetch(local_server + "/x")


def test_fetch_ok_when_private_allowed(local_server, monkeypatch):
    monkeypatch.setenv("MEDIA_INGEST_ALLOW_PRIVATE", "1")
    monkeypatch.setenv("MEDIA_INGEST_ALLOWED_PORTS", "80,443")
    res = netsafe.safe_fetch(local_server + "/x")
    assert res.ok and res.body == b"hello" and res.content_type == "text/plain"


def test_fetch_truncates_at_max_bytes(local_server, monkeypatch):
    monkeypatch.setenv("MEDIA_INGEST_ALLOW_PRIVATE", "1")
    res = netsafe.safe_fetch(local_server + "/big", max_bytes=50_000)
    assert res.truncated and len(res.body) == 50_000 and res.content_length == 200_000


def test_redirect_to_metadata_ip_is_revalidated(local_server, monkeypatch):
    # Allow the loopback test server but keep the link-local block active by
    # validating the hop explicitly: the redirect target must be rejected even
    # though private hosts are "allowed" only for the first hop in this test.
    monkeypatch.setenv("MEDIA_INGEST_ALLOW_PRIVATE", "1")
    calls = []
    real = netsafe.validate_url

    def strict(url):
        calls.append(url)
        if "169.254" in url:
            raise netsafe.UnsafeUrlError("private_host_blocked")
        return real(url)

    monkeypatch.setattr(netsafe, "validate_url", strict)
    with pytest.raises(netsafe.UnsafeUrlError):
        netsafe.safe_fetch(local_server + "/redir-private")
    assert any("169.254" in c for c in calls)


def test_redirect_loop_limited(local_server, monkeypatch):
    monkeypatch.setenv("MEDIA_INGEST_ALLOW_PRIVATE", "1")
    with pytest.raises(netsafe.FetchError) as err:
        netsafe.safe_fetch(local_server + "/loop", max_redirects=3)
    assert err.value.code == "too_many_redirects"


def test_proxy_env_ignored(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://10.0.0.1:3128")
    assert netsafe.build_session().trust_env is False


# --------------------------------------------------------------------------
# sniff
# --------------------------------------------------------------------------


def _ftyp(major: bytes, compat=(b"isom",)) -> bytes:
    body = major + b"\x00\x00\x00\x00" + b"".join(compat)
    return struct.pack(">I", 8 + len(body)) + b"ftyp" + body


@pytest.mark.parametrize(
    "head,kind,mime",
    [
        (b"\xff\xd8\xff\xe0" + b"\x00" * 20, "image", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 20, "image", "image/png"),
        (b"GIF89a" + b"\x00" * 20, "image", "image/gif"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image", "image/webp"),
        (b"RIFF\x00\x00\x00\x00AVI LIST", "video", "video/x-msvideo"),
        (_ftyp(b"isom"), "video", "video/mp4"),
        (_ftyp(b"qt  ", (b"qt  ",)), "video", "video/quicktime"),
        (_ftyp(b"avif", (b"avif", b"mif1")), "image", "image/avif"),
        (_ftyp(b"heic", (b"mif1", b"heic")), "image", "image/heic"),
        (b"\x1a\x45\xdf\xa3\x01\x00\x00\x00\x42\x82\x84webm", "video", "video/webm"),
        (b"\x1a\x45\xdf\xa3\x01\x00\x00\x00\x42\x82\x88matroska", "video", "video/x-matroska"),
        (b"#EXTM3U\n#EXT-X-VERSION:3", "hls", "application/vnd.apple.mpegurl"),
        (b'<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011">', "dash", "application/dash+xml"),
        (b"<!DOCTYPE html><html><head>", "html", "text/html"),
        (b'<?xml version="1.0"?><rss version="2.0"><channel>', "feed", "application/xml"),
        (b'{"version": "https://jsonfeed.org/version/1.1"}', "json", "application/json"),
        (b"", "unknown", None),
        (b"random bytes here 1234567890", "unknown", None),
    ],
)
def test_sniff(head, kind, mime):
    got = sniff.sniff_bytes(head)
    assert got.kind == kind and got.mime == mime


def test_sniff_mpegts():
    ts = bytearray(400)
    for i in (0, 188, 376):
        ts[i] = 0x47
    assert sniff.sniff_bytes(bytes(ts)).mime == "video/mp2t"


def test_extension_mismatch_detected():
    assert sniff.extension_matches("image/png", "photo.jpg") is False
    assert sniff.extension_matches("image/jpeg", "photo.JPEG") is True
    assert sniff.extension_matches("video/mp4", "clip.mov") is True
    assert sniff.extension_matches("video/mp4", "clip") is True
    assert sniff.extension_matches("image/jpeg", "evil.mp4") is False


# --------------------------------------------------------------------------
# canonical
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("https://www.Example.com/a/b/?utm_source=x&fbclid=1&q=2#frag", "https://example.com/a/b?q=2"),
        ("http://example.com:80/x", "http://example.com/x"),
        ("https://m.example.com/x", "https://example.com/x"),
        ("https://twitter.com/user/status/123?s=20&t=abc", "https://x.com/user/status/123"),
        ("https://mobile.twitter.com/user/status/123", "https://x.com/user/status/123"),
        ("https://youtu.be/abc123?si=zzz&t=30", "https://youtube.com/watch?t=30&v=abc123"),
        ("https://www.youtube.com/watch?v=abc123&feature=share&utm_medium=x", "https://youtube.com/watch?v=abc123"),
        ("https://youtube.com/shorts/xyz", "https://youtube.com/watch?v=xyz"),
        ("https://www.redgifs.com/ifr/SomeName?x=1", "https://redgifs.com/watch/somename"),
        ("https://old.reddit.com/r/x/comments/1/t/?context=3", "https://reddit.com/r/x/comments/1/t"),
        ("example.com/a//b", "https://example.com/a/b"),
        ("https://example.com/a?b=2&a=1", "https://example.com/a?a=1&b=2"),
    ],
)
def test_canonicalize(raw, expected):
    assert canonical.canonicalize_url(raw) == expected


def test_canonicalize_idempotent():
    once = canonical.canonicalize_url("https://www.example.com/a/?utm_x=1&z=1&a=2")
    assert canonical.canonicalize_url(once) == once


def test_shortener_resolution_uses_safe_fetch():
    class R:
        url = "https://example.com/final?utm_source=x"

    seen = {}

    def fake(url, **kw):
        seen["url"], seen["method"] = url, kw.get("method")
        return R()

    assert canonical.resolve_shortener("https://bit.ly/abc", fetcher=fake) == "https://example.com/final?utm_source=x"
    assert seen["method"] == "HEAD"
    # not a shortener -> untouched, no fetch
    assert canonical.resolve_shortener("https://example.com/x", fetcher=lambda *a, **k: 1 / 0) == "https://example.com/x"


def test_shortener_to_private_target_rejected():
    class R:
        url = "http://127.0.0.1/admin"

    assert canonical.resolve_shortener("https://t.co/abc", fetcher=lambda *a, **k: R()) == "https://t.co/abc"


def test_shortener_failure_returns_original():
    def boom(*a, **k):
        raise netsafe.FetchError("timeout")

    assert canonical.resolve_shortener("https://t.co/abc", fetcher=boom) == "https://t.co/abc"


# --------------------------------------------------------------------------
# mp4probe
# --------------------------------------------------------------------------


def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def _mvhd(timescale=1000, duration=5000) -> bytes:
    return _box(b"mvhd", b"\x00" + b"\x00" * 3 + struct.pack(">IIII", 0, 0, timescale, duration) + b"\x00" * 80)


def _trak(w=640, h=360) -> bytes:
    tkhd_payload = b"\x00\x00\x00\x07" + b"\x00" * 72 + struct.pack(">II", w << 16, h << 16)
    return _box(b"trak", _box(b"tkhd", tkhd_payload))


def _mp4(moov_first: bool) -> bytes:
    moov = _box(b"moov", _mvhd() + _trak())
    mdat = _box(b"mdat", b"\x00" * 100)
    ftyp = _ftyp(b"isom")
    return ftyp + (moov + mdat if moov_first else mdat + moov)


def test_faststart_detection(tmp_path):
    fast = tmp_path / "fast.mp4"
    slow = tmp_path / "slow.mp4"
    fast.write_bytes(_mp4(True))
    slow.write_bytes(_mp4(False))
    assert mp4probe.is_faststart(fast) is True
    assert mp4probe.is_faststart(slow) is False
    junk = tmp_path / "junk.bin"
    junk.write_bytes(b"not an mp4 at all")
    assert mp4probe.is_faststart(junk) is None
    assert mp4probe.is_faststart(tmp_path / "missing.mp4") is None


def test_parse_head_reads_duration_and_dimensions():
    info = mp4probe.parse_head(_mp4(True))
    assert info.moov_in_head and info.duration_seconds == 5.0
    assert (info.width, info.height) == (640, 360)


def test_parse_head_when_moov_at_end():
    info = mp4probe.parse_head(_mp4(False)[:150])
    assert info.moov_in_head is False and info.duration_seconds is None


# --------------------------------------------------------------------------
# manifests
# --------------------------------------------------------------------------

MASTER = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401f,mp4a.40.2"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
mid/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160,CODECS="avc1.640033,mp4a.40.2"
uhd/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"
audio/index.m3u8
"""


def test_hls_master_variants_and_pick():
    info = manifests.parse_hls(MASTER, "https://cdn.example.com/v/master.m3u8")
    assert info.is_master and len(info.variants) == 4
    assert info.variants[0].url == "https://cdn.example.com/v/low/index.m3u8"
    best = info.best_variant
    assert best is not None and best.height == 720  # 4K exceeds the 1080 cap
    assert info.has_audio_only_variants


def test_hls_media_playlist_duration_and_live():
    vod = "#EXTM3U\n#EXTINF:4.0,\na.ts\n#EXTINF:2.5,\nb.ts\n#EXT-X-ENDLIST\n"
    info = manifests.parse_hls(vod, "https://x/y.m3u8")
    assert info.duration_seconds == 6.5 and not info.live
    live = manifests.parse_hls("#EXTM3U\n#EXTINF:4.0,\na.ts\n", "https://x/y.m3u8")
    assert live.live and live.duration_seconds is None


def test_hls_drm_detected():
    fairplay = '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://k",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:4,\na.ts\n'
    assert manifests.parse_hls(fairplay, "https://x/y.m3u8").protected
    aes = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://x/key"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n'
    info = manifests.parse_hls(aes, "https://x/y.m3u8")
    assert info.encrypted and not info.protected


MPD = """<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1M30.5S" type="static">
 <Period><AdaptationSet mimeType="video/mp4">
  <Representation id="1" bandwidth="1000000" width="1280" height="720" codecs="avc1.64001f"/>
  <Representation id="2" bandwidth="3000000" width="1920" height="1080" codecs="avc1.640028"/>
 </AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation id="a" bandwidth="128000"/></AdaptationSet></Period>
</MPD>"""


def test_dash_parse_and_drm():
    info = manifests.parse_dash(MPD, "https://x/m.mpd")
    assert info.duration_seconds == 90.5 and len(info.variants) == 2 and info.best_variant.height == 1080
    drm = MPD.replace("<Period>", '<Period><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>')
    assert manifests.parse_dash(drm, "https://x/m.mpd").protected


def test_xml_entity_bomb_rejected():
    bomb = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa">]><MPD>&a;</MPD>'
    info = manifests.parse_dash(bomb, "https://x/m.mpd")
    assert "invalid_mpd" in info.warnings


def test_iso_duration():
    assert manifests.parse_iso_duration("PT1H2M3S") == 3723
    assert manifests.parse_iso_duration("PT45.5S") == 45.5
    assert manifests.parse_iso_duration("bogus") is None
    assert manifests.parse_iso_duration(None) is None


def test_safe_download_streams_caps_and_cleans(local_server, monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_INGEST_ALLOW_PRIVATE", "1")
    dest = tmp_path / "f.bin"
    res = netsafe.safe_download(local_server + "/big", str(dest), max_bytes=1_000_000)
    assert res.size == 200_000 and dest.stat().st_size == 200_000 and not (tmp_path / "f.bin.part").exists()
    dest2 = tmp_path / "g.bin"
    with pytest.raises(netsafe.FetchError) as err:
        netsafe.safe_download(local_server + "/big", str(dest2), max_bytes=1000)
    assert err.value.code == "too_large" and not dest2.exists() and not (tmp_path / "g.bin.part").exists()
    with pytest.raises(netsafe.FetchError) as err:
        netsafe.safe_download(local_server + "/big", str(dest2), max_bytes=10**7, should_cancel=lambda: True)
    assert err.value.code == "cancelled" and not (tmp_path / "g.bin.part").exists()
