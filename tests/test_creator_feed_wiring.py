"""Production wiring of the feed fetcher and crawl-time policy for already-approved feeds."""

from __future__ import annotations

import asyncio

import pytest

from tests.creator_index_helpers import ADMIN, feed_env, make_feed_env, rss, xml  # noqa: F401

FEED_URL = "https://bearstudio.example/feed.xml"
ITEMS = [("Shower scene", "https://bearstudio.example/p/1"), ("Gym day", "https://bearstudio.example/p/2")]


def run(coro):
    return asyncio.run(coro)


def submit(env, body, ip="203.0.113.5"):
    return env.client.post("/api/v1/creators/feeds/submit", json=body, headers={"X-Client-IP": ip})


def serve(env):
    env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(rss(ITEMS))


def feed_rows(env):
    with env.db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM submitted_feeds")]


def test_production_text_fetcher_goes_through_netsafe(monkeypatch):
    from app.creator_index.fetcher import SafeFetcher, SourceError
    from app.media_pipeline.netsafe import FetchError, UnsafeUrlError

    calls = []

    class Res:
        status, truncated, body, url = 200, False, b"<rss/>", "https://cdn.example.org/final.xml"
        headers = {"content-type": "Application/RSS+XML; charset=utf-8", "link": "x"}

    def fake_safe_fetch(url, **kw):
        calls.append((url, kw))
        return Res()

    monkeypatch.setattr("app.creator_index.fetcher.safe_fetch", fake_safe_fetch)
    out = run(SafeFetcher().get_text("https://example.org/feed.xml"))
    assert out.text == "<rss/>" and out.content_type == "application/rss+xml" and out.url == "https://cdn.example.org/final.xml"
    assert out.ok and calls[0][1]["max_bytes"] == 2 * 1024 * 1024 and "rss" in calls[0][1]["headers"]["Accept"]

    for exc, code in ((UnsafeUrlError("private_host_blocked"), "unsafe_url"), (FetchError("timeout"), "timeout")):
        def boom(url, _e=exc, **kw):
            raise _e

        monkeypatch.setattr("app.creator_index.fetcher.safe_fetch", boom)
        with pytest.raises(SourceError) as err:
            run(SafeFetcher().get_text("https://example.org/feed.xml"))
        assert err.value.code == code

    for status in (429, 500, 503):
        Res.status = status
        monkeypatch.setattr("app.creator_index.fetcher.safe_fetch", lambda url, **kw: Res())
        with pytest.raises(SourceError) as err:
            run(SafeFetcher().get_text("https://example.org/feed.xml"))
        assert err.value.code == f"http_{status}"
    Res.status, Res.truncated = 200, True
    assert run(SafeFetcher().get_text("https://example.org/feed.xml")).ok is False  # truncated bodies are never "ok"


def test_default_crawler_fetcher_is_the_guarded_safe_fetcher(feed_env):
    from app.creator_index.crawler import CreatorCrawler
    from app.creator_index.fetcher import GuardedFetcher, SafeFetcher
    from app.creator_index.repository import CreatorIndexRepository

    crawler = CreatorCrawler(CreatorIndexRepository(feed_env.db.connect))
    assert isinstance(crawler.fetcher, GuardedFetcher) and isinstance(crawler.fetcher.inner, SafeFetcher)
    assert crawler.feeds._fetcher() is crawler.fetcher           # the feed probe and crawler share one guarded fetcher
    crawler.fetcher = "replaced"
    assert crawler.feeds._fetcher() == "replaced"                 # ... and follow replacements (tests, operators)


def test_guarded_fetcher_applies_breaker_and_rate_limit_to_text_requests():
    from app.creator_index.fetcher import GuardedFetcher, SourceError, TextResponse

    sleeps, now = [], [10.0]

    async def fake_sleep(s):
        sleeps.append(round(s, 3))
        now[0] += s

    class Inner:
        calls = 0

        async def get_text(self, url, headers=None):
            Inner.calls += 1
            raise SourceError("http_500")

    g = GuardedFetcher(Inner(), min_interval=1.0, jitter=0.0, failure_threshold=2, sleep=fake_sleep, clock=lambda: now[0])
    for _ in range(2):
        with pytest.raises(SourceError) as err:
            run(g.get_text("https://a.example/feed"))
        assert err.value.code == "http_500"
    with pytest.raises(SourceError) as err:
        run(g.get_text("https://a.example/feed"))                  # breaker open: rejected locally, no third call
    assert err.value.code == "circuit_open" and Inner.calls == 2 and sleeps[0] == 1.0

    class NoText:
        pass

    with pytest.raises(SourceError) as err:
        run(GuardedFetcher(NoText(), min_interval=0, jitter=0).get_text("https://a.example/x"))
    assert err.value.code == "unsupported" and isinstance(TextResponse(200, "x").ok, bool)


def test_tightened_denylist_pauses_feeds_that_were_approved_earlier(feed_env, monkeypatch):
    env = feed_env
    serve(env)
    fid = submit(env, {"url": FEED_URL}).json()["id"]
    env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={})
    monkeypatch.setenv("FEED_DENYLIST", "bearstudio.example")
    run(env.rt.crawler.run_once(only="feeds"))
    row = feed_rows(env)[0]
    assert row["status"] == "paused" and row["reason"] == "denylisted" and env.net.count("bearstudio.example") == 1  # only the probe
    assert env.rt.repo.list()["total"] == 0


def test_suppressing_a_feed_creator_rejects_the_feed_and_blocks_approval(feed_env):
    env = feed_env
    serve(env)
    fid = submit(env, {"url": FEED_URL}).json()["id"]
    handle = feed_rows(env)[0]["creator_handle"]
    res = env.client.post("/api/v1/creators/admin/suppress", headers=ADMIN, json={"platform": "feed", "handle": handle, "reason": "operator"})
    assert res.status_code == 201
    assert feed_rows(env)[0]["status"] == "rejected"
    assert env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={}).status_code == 409
    run(env.rt.crawler.run_once(only="feeds"))
    assert env.rt.repo.list()["total"] == 0 and env.net.count("bearstudio.example") == 1


def test_creator_suppressed_behind_the_feeds_back_is_still_never_indexed(feed_env):
    env = feed_env
    serve(env)
    fid = submit(env, {"url": FEED_URL}).json()["id"]
    handle = feed_rows(env)[0]["creator_handle"]
    with env.db.connect() as conn:  # a suppression row that does not touch the feed itself
        conn.execute("INSERT INTO creator_suppressions (kind, platform, handle, level, created_at) VALUES ('creator','feed',?,'permanent','x')", (handle,))
        conn.commit()
    env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={})
    run(env.rt.crawler.run_once(only="feeds"))
    assert feed_rows(env)[0]["last_status"] == "suppressed" and env.rt.repo.list()["total"] == 0


# ── client address resolution for the per-client limits ──────────────────────


def fake_request(headers: dict[str, str], peer: str = "10.0.0.9"):
    from starlette.requests import Request

    return Request({"type": "http", "method": "POST", "path": "/", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                    "client": (peer, 1234), "query_string": b""})


def test_client_ip_resolution(monkeypatch):
    from app.creator_index.abuse import client_ip

    for name in ("GATEWAY_CLIENT_IP_SECRET", "TRUST_GATEWAY_CLIENT_IP"):
        monkeypatch.delenv(name, raising=False)
    assert client_ip(fake_request({"x-client-ip": "198.51.100.7"})) == "198.51.100.7"
    assert client_ip(fake_request({"x-client-ip": "2001:DB8::1"})) == "2001:db8::1"
    assert client_ip(fake_request({"x-client-ip": "garbage", "x-forwarded-for": "1.1.1.1, 198.51.100.8"})) == "198.51.100.8"  # right-most hop
    assert client_ip(fake_request({"x-forwarded-for": "198.51.100.9, spoof, not-an-ip"})) == "10.0.0.9"
    assert client_ip(fake_request({})) == "10.0.0.9"
    monkeypatch.setenv("TRUST_GATEWAY_CLIENT_IP", "0")
    assert client_ip(fake_request({"x-client-ip": "198.51.100.7"})) == "10.0.0.9"
    monkeypatch.delenv("TRUST_GATEWAY_CLIENT_IP")
    monkeypatch.setenv("GATEWAY_CLIENT_IP_SECRET", "s3cret")
    assert client_ip(fake_request({"x-client-ip": "198.51.100.7"})) == "10.0.0.9"                       # no secret: not trusted
    assert client_ip(fake_request({"x-client-ip": "198.51.100.7", "x-gateway-secret": "wrong"})) == "10.0.0.9"
    assert client_ip(fake_request({"x-client-ip": "198.51.100.7", "x-gateway-secret": "s3cret"})) == "198.51.100.7"


def test_per_client_limits_follow_the_gateway_secret(make_feed_env):
    env = make_feed_env(FEED_SUBMIT_PER_HOUR="2", GATEWAY_CLIENT_IP_SECRET="s3cret")
    bad = {"url": "http://x.example/f"}  # invalid, but every attempt counts against the client's budget
    spoofed = [env.client.post("/api/v1/creators/feeds/submit", json=bad, headers={"X-Client-IP": f"198.51.100.{i}"}).status_code for i in range(3)]
    assert spoofed == [422, 422, 429]                      # without the secret every spoofed address collapses to the peer
    signed = [env.client.post("/api/v1/creators/feeds/submit", json=bad, headers={"X-Client-IP": f"198.51.101.{i}", "X-Gateway-Secret": "s3cret"}).status_code
              for i in range(3)]
    assert signed == [422, 422, 422]                       # genuine gateway traffic is limited per visitor
