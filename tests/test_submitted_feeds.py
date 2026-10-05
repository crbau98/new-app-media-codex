"""Creator-submitted feeds: strict validation, denylist, SSRF, rate limits, honeypot, probe failures,
dedupe, approval flow, and the crawler ingesting approved RSS / JSON Feed / PeerTube / Bluesky / Mastodon
feeds. Mocked transports only (nothing here touches the network)."""

from __future__ import annotations

import json
import sqlite3

import httpx
import pytest

from app.creator_index import feeds as F
from app.creator_index.crawler import CrawlConfig
from tests.creator_index_helpers import ADMIN, Net, feed_env, guarded, make_feed_env, rss, xml  # noqa: F401

SUBMIT = "/api/v1/creators/feeds/submit"
FEED_URL = "https://bearstudio.example/feed.xml"
ITEMS = [("Shower scene", "https://bearstudio.example/p/1"), ("Gym day", "https://bearstudio.example/p/2"),
         ("Poolside", "https://bearstudio.example/p/3")]
IP = {"X-Client-IP": "203.0.113.5"}


def submit(env, body, ip="203.0.113.5"):
    return env.client.post(SUBMIT, json=body, headers={"X-Client-IP": ip})


def serve_rss(env, items=ITEMS, **kw):
    env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(rss(items, **kw))


def rows(env, sql="SELECT * FROM submitted_feeds"):
    with env.db.connect() as conn:
        return [dict(r) for r in conn.execute(sql)]


def code_of(res):
    return res.json()["detail"]["code"]


# ── validation (no network involved) ─────────────────────────────────────────


@pytest.mark.parametrize("body,code", [
    ({}, "target_required"),
    ({"handle": "someone.bsky.social"}, "kind_required"),
    ({"url": "http://bearstudio.example/feed.xml"}, "https_required"),
    ({"url": "ftp://bearstudio.example/feed.xml"}, "https_required"),
    ({"url": "https://user:pw@bearstudio.example/feed.xml"}, "credentials_not_allowed"),
    ({"url": "https://bearstudio.example:8443/feed.xml"}, "port_not_allowed"),
    ({"url": "https://127.0.0.1/feed.xml"}, "ip_literal"),
    ({"url": "https://8.8.8.8/feed.xml"}, "ip_literal"),
    ({"url": "https://[::1]/feed.xml"}, "ip_literal"),
    ({"url": "https://2130706433/feed.xml"}, "ip_literal"),
    ({"url": "https://0x7f.1/feed.xml"}, "ip_literal"),
    ({"url": "https://169.254.169.254/latest/meta-data"}, "ip_literal"),
    ({"url": "https://localhost/feed.xml"}, "invalid_host"),
    ({"url": "https://intranet/feed.xml"}, "invalid_host"),
    ({"url": "https://printer.local/feed.xml"}, "private_host_blocked"),
    ({"url": "https://metadata.google.internal/x"}, "private_host_blocked"),
    ({"url": "https://bearstudio.example/feed.xml\nHost: evil"}, "invalid_url"),
    ({"url": "https://bearstudio.example/a b"}, "invalid_url"),
    ({"url": "https://bearstudio.example/feed.xml", "email": "not-an-email"}, "invalid_email"),
    ({"handle": "no-dot", "kind": "bluesky"}, "invalid_handle"),
    ({"handle": "nohost", "kind": "mastodon"}, "invalid_handle"),
    ({"handle": "name@127.0.0.1", "kind": "peertube-channel"}, "ip_literal"),
    ({"handle": "name@localhost", "kind": "mastodon"}, "invalid_host"),
    ({"url": "https://bearstudio.example/feed.xml", "kind": "bluesky"}, "invalid_url"),
])
def test_strict_validation_codes(feed_env, body, code):
    res = submit(feed_env, body)
    assert res.status_code == 422 and code_of(res) == code, res.text
    assert feed_env.net.seen == []  # rejected before any outbound request
    assert rows(feed_env) == []


def test_pydantic_level_validation(feed_env):
    for body in ({"url": "https://bearstudio.example/f", "unexpected": 1}, {"kind": "carrier-pigeon", "url": "https://a.example/f"},
                 {"url": "x" * 601}, {"name": "n" * 81, "url": "https://a.example/f"}, {"url": 5}):
        res = submit(feed_env, body)
        assert res.status_code == 422 and code_of(res) == "validation_error"
    assert feed_env.net.seen == []


def test_body_cap_and_content_type(feed_env):
    big = feed_env.client.post(SUBMIT, content=b'{"url": "' + b"a" * 9000 + b'"}', headers={"content-type": "application/json", **IP})
    assert big.status_code == 413 and code_of(big) == "payload_too_large"

    def chunks():  # chunked upload without Content-Length is capped as well
        for _ in range(10):
            yield b" " * 1024

    streamed = feed_env.client.post(SUBMIT, content=chunks(), headers={"content-type": "application/json", **IP})
    assert streamed.status_code == 413
    assert feed_env.client.post(SUBMIT, content=b"url=x", headers={"content-type": "text/plain"}).status_code == 415
    assert feed_env.client.post(SUBMIT, content=b"{not json", headers={"content-type": "application/json"}).status_code == 400
    assert feed_env.client.post(SUBMIT, json=["list"]).status_code == 422


# ── denylist / paywalls / forums ─────────────────────────────────────────────


@pytest.mark.parametrize("url", [
    "https://coomer.su/feed.xml", "https://www.coomer.party/onlyfans/user/x", "https://coomer.st/rss",
    "https://kemono.su/patreon/user/1", "https://kemono.cr/feed", "https://lpsg.com/forums/rss", "https://www.lpsg.com/feed.xml",
    "https://simpcity.su/feed", "https://xleaks-hub.example/feed.xml", "https://mirror.coomer.example/feed.xml",
])
def test_denylisted_domains(feed_env, url):
    res = submit(feed_env, {"url": url})
    assert res.status_code == 422 and code_of(res) == "denylisted"
    assert feed_env.net.seen == [] and rows(feed_env) == []


@pytest.mark.parametrize("url,code", [
    ("https://onlyfans.com/someone/feed.xml", "paywalled_platform"),
    ("https://www.patreon.com/rss/creator?auth=secret", "paywalled_platform"),
    ("https://fansly.com/x/rss", "paywalled_platform"),
    ("https://forum.example.com/feed.xml", "forum_content"),
    ("https://example.com/forums/index.rss", "forum_content"),
    ("https://example.com/threads/12/rss", "forum_content"),
    ("https://example.com/leaked-videos/feed.xml", "leak_marker"),
    ("https://example.com/feeds/onlyfans_leaks.xml", "leak_marker"),
])
def test_paywall_forum_and_leak_markers(feed_env, url, code):
    res = submit(feed_env, {"url": url})
    assert res.status_code == 422 and code_of(res) == code
    assert feed_env.net.seen == []


def test_env_denylist_extends_defaults(make_feed_env):
    env = make_feed_env(FEED_DENYLIST="badsite.example, *.shady.test, nuisance.*")
    for url in ("https://badsite.example/f.xml", "https://cdn.badsite.example/f.xml", "https://a.shady.test/f", "https://nuisance.org/f"):
        assert code_of(submit(env, {"url": url})) == "denylisted"
    assert "coomer.*" in F.denylist_patterns() and "badsite.example" in F.denylist_patterns()
    assert F.host_policy("goodsite.example") == "" and F.host_policy("mycoomerfans.com") == "denylisted"
    assert F.host_policy("coomer.co.uk") == "denylisted" and F.host_policy("example.com") == ""


def test_denylisted_final_host_after_redirect(feed_env):
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(301, headers={"location": "https://coomer.su/feed.xml"})
    feed_env.net.routes["coomer.su"] = lambda r: xml(rss(ITEMS))
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 422 and code_of(res) == "denylisted"


# ── SSRF: redirects are re-validated at every hop ────────────────────────────


@pytest.mark.parametrize("target", ["http://169.254.169.254/latest/meta-data", "http://127.0.0.1:8080/admin",
                                    "http://10.0.0.5/feed", "https://localhost/feed", "http://[::1]/x", "ftp://example.com/x"])
def test_redirect_to_private_target_is_blocked(feed_env, target):
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(302, headers={"location": target})
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 422 and code_of(res) in {"private_host_blocked"}
    assert feed_env.net.count("bearstudio.example") == 1 and len(feed_env.net.seen) == 1  # never followed


def test_insecure_redirect_target_is_refused(feed_env):
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(302, headers={"location": "http://cdn.other.example/feed.xml"})
    feed_env.net.routes["cdn.other.example"] = lambda r: xml(rss(ITEMS))
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 422 and code_of(res) == "insecure_redirect"


# ── login / paywall detection and probe failures ─────────────────────────────


@pytest.mark.parametrize("status", [401, 402, 403])
def test_login_or_paywall_status_is_refused(feed_env, status):
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(status, text="no")
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 422 and code_of(res) == "login_required" and rows(feed_env) == []


def test_login_redirects_are_refused(feed_env):
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(302, headers={"location": "https://bearstudio.example/account/login?next=/feed.xml"})
    feed_env.net.routes["/account/login"] = lambda r: xml("<html><form><input type='password'></form></html>", ctype="text/html")
    assert code_of(submit(feed_env, {"url": FEED_URL})) == "login_required"
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(302, headers={"location": "https://auth.example.org/subscribe"})
    feed_env.net.routes["auth.example.org"] = lambda r: xml("<html>subscribe</html>", ctype="text/html")
    assert code_of(submit(feed_env, {"url": FEED_URL})) == "login_required"


def test_html_page_with_login_form_is_refused_but_site_with_header_login_is_discovered(feed_env):
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(
        "<html><body><form><input type=\"password\" name=\"p\"></form></body></html>", ctype="text/html")
    assert code_of(submit(feed_env, {"url": FEED_URL})) == "login_required"
    page = ('<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"></head>'
            '<body><form><input type="password"></form></body></html>')
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(page, ctype="text/html")
    feed_env.net.routes["bearstudio.example/rss.xml"] = lambda r: xml(rss(ITEMS))
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 201 and res.json()["itemCount"] == 3


@pytest.mark.parametrize("responder,code", [
    (lambda r: httpx.Response(404, text="gone"), "not_found"),
    (lambda r: httpx.Response(410, text="gone"), "gone"),
    (lambda r: httpx.Response(500), "fetch_failed"),
    (lambda r: httpx.Response(429), "fetch_failed"),
    (lambda r: httpx.ConnectTimeout("slow"), "fetch_failed"),
    (lambda r: xml("<html><body>hello</body></html>", ctype="text/html"), "not_a_feed"),
    (lambda r: xml("plain text", ctype="text/plain"), "not_a_feed"),
    (lambda r: xml("<rss><channel><title>broken", ctype="application/xml"), "not_a_feed"),
    (lambda r: xml('<!DOCTYPE x [<!ENTITY a "b">]><rss><channel><title>t</title></channel></rss>'), "not_a_feed"),
    (lambda r: xml("{not json", ctype="application/json"), "not_a_feed"),
    (lambda r: xml('{"hello": "world"}', ctype="application/json"), "not_a_feed"),
    (lambda r: xml(rss([])), "no_items"),
    (lambda r: xml(rss([("Only http", "http://bearstudio.example/p/1")])), "no_items"),
    (lambda r: xml(rss([("Points at the feed", FEED_URL)])), "no_items"),
])
def test_probe_failures(feed_env, responder, code):
    feed_env.net.routes["bearstudio.example/feed.xml"] = responder
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 422 and code_of(res) == code, res.text
    assert rows(feed_env) == []


def test_oversize_feed_is_refused(feed_env):
    from app.creator_index.fetcher import TextResponse

    res = TextResponse(200, "x", "application/rss+xml", FEED_URL, truncated=True)
    with pytest.raises(F.FeedError) as err:
        F.check_response(res, FEED_URL)
    assert err.value.code == "too_large"


def test_non_https_items_are_dropped_but_secure_ones_kept(feed_env):
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(rss(
        [("Secure", "https://bearstudio.example/p/1"), ("Insecure", "http://bearstudio.example/p/2")]))
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 201 and res.json()["itemCount"] == 1


# ── hygiene at the feed level ────────────────────────────────────────────────


@pytest.mark.parametrize("title,extra,code", [
    ("Leaked Studio Videos", "", "leak_marker"),
    ("Hot Underage Fun", "", "unsafe_content"),
    ("Barely Legal Kids", "", "unsafe_content"),
    ("Girls Night", "", "excluded_content"),
    ("Studio", "<category>Lesbian</category>", "excluded_content"),
    ("Studio", "<category>non-consensual</category>", "unsafe_content"),
])
def test_feed_level_policy(feed_env, title, extra, code):
    serve_rss(feed_env, title=title, extra=extra)
    res = submit(feed_env, {"url": FEED_URL})
    assert res.status_code == 422 and code_of(res) == code, res.text
    assert rows(feed_env) == []


def test_submitters_name_is_only_a_fallback_never_overrides_the_feed(feed_env):
    serve_rss(feed_env)
    res = submit(feed_env, {"url": FEED_URL, "name": "Somebody Famous"})
    assert res.status_code == 201 and res.json()["displayName"] == "Bear Studio"


# ── rate limits, honeypot, queue cap ─────────────────────────────────────────


def test_per_client_rate_limit_is_5_per_hour_and_counts_failed_attempts(feed_env):
    serve_rss(feed_env)
    bodies = [{"url": f"https://bearstudio.example/feed.xml?n={i}"} for i in range(5)]
    feed_env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(rss(ITEMS, title=f"Studio {r.url.params.get('n')}"))
    for body in bodies:
        assert submit(feed_env, body).status_code == 201
    limited = submit(feed_env, {"url": "https://bearstudio.example/feed.xml?n=99"})
    assert limited.status_code == 429 and code_of(limited) == "rate_limited" and int(limited.headers["retry-after"]) >= 1
    assert submit(feed_env, {"url": "https://bearstudio.example/feed.xml?n=77"}, ip="198.51.100.9").status_code == 201  # other client
    # failed validations burn the budget too
    for _ in range(5):
        assert submit(feed_env, {"url": "http://x.example/f"}, ip="198.51.100.10").status_code == 422
    assert submit(feed_env, {"url": "http://x.example/f"}, ip="198.51.100.10").status_code == 429


def test_rate_limit_is_deterministic_with_injected_clock(feed_env):
    now = [0.0]
    limiter = F.abuse.SlidingWindowLimiter(2, 3600, clock=lambda: now[0])
    assert limiter.hit("a")[0] and limiter.hit("a")[0]
    allowed, retry = limiter.hit("a")
    assert not allowed and retry == 3600
    now[0] = 3601
    assert limiter.hit("a")[0]


def test_global_rate_limit_and_pending_cap(make_feed_env):
    env = make_feed_env(FEED_SUBMIT_GLOBAL_PER_HOUR="2")
    serve_rss(env)
    assert submit(env, {"url": FEED_URL}, ip="198.51.100.1").status_code == 201
    assert submit(env, {"url": FEED_URL + "?a=1"}, ip="198.51.100.2").status_code == 201
    third = submit(env, {"url": FEED_URL + "?a=2"}, ip="198.51.100.3")
    assert third.status_code == 429

    env2 = make_feed_env(FEED_MAX_PENDING="1")
    serve_rss(env2)
    assert submit(env2, {"url": FEED_URL}, ip="198.51.100.1").status_code == 201
    full = submit(env2, {"url": FEED_URL + "?b=1"}, ip="198.51.100.2")
    assert full.status_code == 503 and code_of(full) == "queue_full"


def test_honeypot_is_silently_dropped(feed_env):
    serve_rss(feed_env)
    res = submit(feed_env, {"url": FEED_URL, "website": "http://spam.example"})
    assert res.status_code == 202 and res.json()["accepted"] is True
    assert feed_env.net.seen == [] and rows(feed_env) == []


def test_x_client_ip_header_is_trusted_only_when_valid(feed_env, monkeypatch):
    serve_rss(feed_env)
    # an invalid header value falls back to the socket peer (shared testclient address)
    for _ in range(5):
        feed_env.client.post(SUBMIT, json={"url": "http://x.example/f"}, headers={"X-Client-IP": "not-an-ip"})
    assert feed_env.client.post(SUBMIT, json={"url": "http://x.example/f"}, headers={"X-Client-IP": "also-bad"}).status_code == 429
    monkeypatch.setenv("TRUST_GATEWAY_CLIENT_IP", "0")
    assert feed_env.client.post(SUBMIT, json={"url": "http://x.example/f"}, headers={"X-Client-IP": "198.51.100.77"}).status_code == 429


# ── dedupe + privacy of stored contact details ───────────────────────────────


def test_dedupe_by_canonical_url_and_email_is_only_hashed(feed_env):
    serve_rss(feed_env)
    first = submit(feed_env, {"url": FEED_URL, "email": "Owner@Example.com"})
    assert first.status_code == 201 and first.json() == {
        "id": 1, "status": "pending", "kind": "rss", "displayName": "Bear Studio", "itemCount": 3, "duplicate": False}
    fetched = feed_env.net.count("bearstudio.example")
    for variant in ("https://BearStudio.example/feed.xml", "https://www.bearstudio.example/feed.xml/",
                    "https://bearstudio.example/feed.xml?utm_source=x&utm_medium=y#frag"):
        dup = submit(feed_env, {"url": variant})
        assert dup.status_code == 200 and dup.json()["duplicate"] is True and dup.json()["id"] == 1, variant
    assert feed_env.net.count("bearstudio.example") == fetched  # duplicates never re-fetch
    (row,) = rows(feed_env)
    blob = json.dumps(row)
    assert "owner" not in blob.lower() and "example.com" not in blob and "203.0.113.5" not in blob
    assert len(row["contact_email_hash"]) == 40 and len(row["submitted_ip_hash"]) == 40
    assert row["contact_email_hash"] != row["submitted_ip_hash"]
    assert row["status"] == "pending" and row["canonical_key"] == "feed:https://bearstudio.example/feed.xml"


def test_privacy_salt_is_persisted_or_configured(feed_env, make_feed_env):
    salt = feed_env.rt.feeds.salt
    assert len(salt) >= 32 and feed_env.rt.repo.get_state("privacy_salt") == salt
    configured = make_feed_env(PRIVACY_HASH_SALT="operator-secret")
    assert configured.rt.feeds.salt == "operator-secret"
    assert F.abuse.hash_value("A@b.co", "s1") == F.abuse.hash_value(" a@B.co ", "s1") != F.abuse.hash_value("a@b.co", "s2")


# ── admin: auth, approval flow, force-fetch ──────────────────────────────────


def test_admin_endpoints_require_the_token(feed_env):
    c = feed_env.client
    for method, path in [("get", "/feeds"), ("post", "/feeds/1/approve"), ("post", "/feeds/1/reject"), ("post", "/feeds/1/pause"),
                         ("post", "/feeds/1/fetch"), ("get", "/takedowns"), ("post", "/takedowns/1/restore"),
                         ("post", "/takedowns/1/suppress"), ("get", "/suppressions"), ("post", "/suppress"), ("post", "/hidden"),
                         ("get", "/lanes"), ("post", "/lanes/reset"), ("get", "/tags")]:
        url = "/api/v1/creators/admin" + path
        assert getattr(c, method)(url).status_code == 401, path
        assert getattr(c, method)(url, headers={"X-Admin-Token": "wrong"}).status_code == 401, path


def test_approval_flow_end_to_end(feed_env):
    env = feed_env
    serve_rss(env, author="editor@bearstudio.example (Bear Studio Team)")
    created = submit(env, {"url": FEED_URL, "email": "owner@example.com"}).json()
    listing = env.client.get("/api/v1/creators/admin/feeds", headers=ADMIN).json()
    assert [f["id"] for f in listing["feeds"]] == [created["id"]] and listing["counts"]["pending"] == 1
    admin_row = listing["feeds"][0]
    assert admin_row["hasContact"] is True and "email" not in json.dumps(admin_row).lower().replace("hascontact", "")
    assert env.rt.repo.list()["total"] == 0  # pending feeds are NOT indexed

    # pending feeds are not crawled
    assert env.net.count("bearstudio.example") == 1
    report = pytest_run(env.rt.crawler.run_once(only="feeds"))
    assert report.pages == 0 and env.net.count("bearstudio.example") == 1

    approved = env.client.post(f"/api/v1/creators/admin/feeds/{created['id']}/approve", headers=ADMIN, json={"reason": "verified owner"})
    assert approved.status_code == 200 and approved.json()["feed"]["status"] == "approved"
    report = pytest_run(env.rt.crawler.run_once(only="feeds"))
    assert report.state in {"ok", "partial"} and report.new_creators == 1 and report.yields["feeds"] == {"requests": 1, "new": 1, "upserted": 1}
    creator = env.rt.repo.list()["creators"][0]
    assert creator["platform"] == "Creator feed" and creator["name"] == "Bear Studio Team"
    assert creator["username"] == "bear-studio-team@bearstudio.example"
    assert creator["sourceAttribution"] == f"Creator-submitted public feed: {FEED_URL}"
    assert creator["profileUrl"] == "https://bearstudio.example/" and creator["media"] == [] and creator["mediaCount"] == 3
    labels = {l["url"]: l["label"] for l in creator["profileLinks"]}
    assert labels[FEED_URL] == "Feed" and labels["https://bearstudio.example/p/1"] == "Shower scene"
    assert creator["id"].startswith("creator-feed-")
    state = env.client.get("/api/v1/creators/admin/feeds?status=approved", headers=ADMIN).json()["feeds"][0]
    assert state["lastStatus"] == "ok" and state["itemCount"] == 3 and state["lastFetchedAt"] and state["nextFetchAt"] > state["lastFetchedAt"]

    # not due again until nextFetchAt
    seen = env.net.count("bearstudio.example")
    pytest_run(env.rt.crawler.run_once(only="feeds"))
    assert env.net.count("bearstudio.example") == seen

    # pause stops crawling but keeps the creator visible; reject hides it
    env.client.post(f"/api/v1/creators/admin/feeds/{created['id']}/pause", headers=ADMIN, json={"reason": "check"})
    with env.db.connect() as conn:
        conn.execute("UPDATE submitted_feeds SET next_fetch_at = '2000-01-01T00:00:00Z'")
        conn.commit()
    pytest_run(env.rt.crawler.run_once(only="feeds"))
    assert env.net.count("bearstudio.example") == seen and env.rt.repo.list()["total"] == 1
    rejected = env.client.post(f"/api/v1/creators/admin/feeds/{created['id']}/reject", headers=ADMIN, json={"reason": "not a creator"})
    assert rejected.json()["feed"]["status"] == "rejected" and rejected.json()["feed"]["reason"] == "not a creator"
    assert env.rt.repo.list()["total"] == 0
    env.client.post(f"/api/v1/creators/admin/feeds/{created['id']}/approve", headers=ADMIN, json={})
    assert env.rt.repo.list()["total"] == 1  # approving again re-shows it
    assert env.client.post("/api/v1/creators/admin/feeds/999/approve", headers=ADMIN, json={}).status_code == 404
    assert env.client.post(f"/api/v1/creators/admin/feeds/{created['id']}/approve", headers=ADMIN, json={"bogus": 1}).status_code == 422


def pytest_run(coro):
    import asyncio

    return asyncio.run(coro)


def test_approve_with_fetch_now_and_force_fetch_preview(feed_env):
    env = feed_env
    serve_rss(env)
    fid = submit(env, {"url": FEED_URL}).json()["id"]
    preview = env.client.post(f"/api/v1/creators/admin/feeds/{fid}/fetch", headers=ADMIN).json()
    assert preview["ingested"] is False and preview["fetch"]["ok"] is True and preview["fetch"]["items"] == 3
    assert env.rt.repo.list()["total"] == 0  # a dry run indexes nothing
    done = env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={"fetchNow": True}).json()
    assert done["fetch"]["ok"] and done["fetch"]["new"] == 1 and env.rt.repo.list()["total"] == 1
    forced = env.client.post(f"/api/v1/creators/admin/feeds/{fid}/fetch", headers=ADMIN).json()
    assert forced["ingested"] is True and forced["fetch"]["new"] == 0 and forced["fetch"]["upserted"] == 1
    assert env.client.post("/api/v1/creators/admin/feeds/777/fetch", headers=ADMIN).status_code == 404


# ── crawler: ingestion of the supported feed kinds ───────────────────────────


def approve_and_crawl(env, fid):
    assert env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={}).status_code == 200
    return pytest_run(env.rt.crawler.run_once(only="feeds"))


def test_crawler_ingests_json_feed_with_servable_media_and_link_outs(feed_env):
    env = feed_env
    feed = {
        "version": "https://jsonfeed.org/version/1.1", "title": "Muscle Journal", "home_page_url": "https://musclejournal.example/",
        "authors": [{"name": "Rex Stone"}],
        "items": [
            {"id": "1", "url": "https://musclejournal.example/p/1", "title": "Leg day", "date_published": "2026-09-01T10:00:00Z",
             "tags": ["muscle", "gym"], "image": "https://thumbs44.redgifs.com/leg-t.jpg",
             "attachments": [{"url": "https://media.redgifs.com/leg.mp4", "mime_type": "video/mp4", "duration_in_seconds": 75}]},
            {"id": "2", "url": "https://musclejournal.example/p/2", "title": "Contact me at rex@example.com", "tags": ["bear"],
             "image": "https://musclejournal.example/img.jpg",
             "attachments": [{"url": "https://musclejournal.example/v.mp4", "mime_type": "video/mp4"}]},
            {"id": "3", "url": "https://musclejournal.example/p/3", "title": "Girls only", "tags": ["lesbian"]},
            {"id": "4", "url": "https://musclejournal.example/p/4", "title": "Underage nonsense", "tags": []},
            {"id": "5", "url": "http://musclejournal.example/p/5", "title": "Insecure link"},
            {"id": "6", "url": "https://coomer.su/p/6", "title": "From a denied host"},
        ],
    }
    env.net.routes["musclejournal.example/feed.json"] = lambda r: xml(json.dumps(feed), ctype="application/feed+json")
    created = submit(env, {"url": "https://musclejournal.example/feed.json", "kind": "jsonfeed"})
    assert created.status_code == 201 and created.json()["kind"] == "jsonfeed" and created.json()["itemCount"] == 2
    report = approve_and_crawl(env, created.json()["id"])
    assert report.new_creators == 1
    c = env.rt.repo.list()["creators"][0]
    assert c["name"] == "Rex Stone" and c["username"] == "rex-stone@musclejournal.example"
    # exactly one item is on a host the edge proxy serves -> real sample media; the other two are link-outs
    assert [m["id"][:5] for m in c["media"]] == ["feed-"] and c["media"][0]["mediaUrl"] == "https://media.redgifs.com/leg.mp4"
    assert c["media"][0]["thumbnail"] == "https://thumbs44.redgifs.com/leg-t.jpg" and c["media"][0]["pageUrl"] == "https://musclejournal.example/p/1"
    assert c["media"][0]["durationSeconds"] == 75 and c["media"][0]["source"] == "Creator feed"
    urls = [l["url"] for l in c["profileLinks"]]
    assert "https://musclejournal.example/p/2" in urls and not any(("coomer" in u or "p/3" in u or "p/4" in u or "p/5" in u) for u in urls)
    titles = " ".join(l["label"] for l in c["profileLinks"])
    assert "@" not in titles and "rex@" not in titles  # contact redaction on item titles
    assert set(c["discoveryTags"]) == {"muscle", "gym", "bear"} and c["mediaCount"] == 2


def test_crawler_ingests_rss_with_enclosures_and_atom(feed_env):
    env = feed_env
    atom = ('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Otter Notes</title>'
            '<link rel="self" href="https://otter.example/atom.xml"/><link rel="alternate" href="https://otter.example/"/>'
            '<author><name>Ollie Otter</name></author><category term="otter"/>'
            '<entry><title>Swim</title><link href="https://otter.example/swim"/><id>tag:otter,1</id><updated>2026-09-02T08:00:00Z</updated>'
            '<category term="hairy"/></entry></feed>')
    env.net.routes["otter.example/atom.xml"] = lambda r: xml(atom, ctype="application/atom+xml")
    created = submit(env, {"url": "https://otter.example/atom.xml", "kind": "rss"})  # hint says rss, detection says atom
    assert created.status_code == 201 and created.json()["kind"] == "atom"
    approve_and_crawl(env, created.json()["id"])
    c = env.rt.repo.list()["creators"][0]
    assert c["name"] == "Ollie Otter" and c["profileUrl"] == "https://otter.example/" and c["lastSeenAt"] == "2026-09-02T08:00:00Z"
    assert set(c["discoveryTags"]) == {"otter", "hairy"}


def test_site_url_discovery_for_rss(feed_env):
    env = feed_env
    html = '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>hi</body></html>'
    env.net.routes["bearstudio.example/index"] = lambda r: xml(html, ctype="text/html")
    env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(rss(ITEMS))
    res = submit(env, {"url": "https://bearstudio.example/index"})
    assert res.status_code == 201 and env.net.count("bearstudio.example") == 2


PEERTUBE_CHANNEL = {"name": "chan", "displayName": "Chan TV", "url": "https://tube.example/video-channels/chan",
                    "followersCount": 42, "description": "Official channel"}
PEERTUBE_VIDEOS = {"data": [
    {"uuid": "u1", "shortUUID": "s1", "name": "Hike", "url": "https://tube.example/videos/watch/u1", "publishedAt": "2026-09-03T09:00:00.000Z",
     "views": 100, "likes": 7, "tags": ["gay", "outdoor"], "duration": 61, "thumbnailPath": "/lazy-static/thumbnails/u1.jpg"},
    {"uuid": "u2", "name": "Private", "url": "https://tube.example/videos/watch/u2", "privacy": {"id": 3}, "tags": []},
    {"uuid": "u3", "name": "Cooking", "url": "https://tube.example/videos/watch/u3", "views": 5, "likes": 1, "tags": ["food"]},
]}


def peertube_routes(env):
    env.net.routes["tube.example/api/v1/video-channels/chan/videos"] = lambda r: PEERTUBE_VIDEOS
    env.net.routes["tube.example/api/v1/video-channels/chan"] = lambda r: PEERTUBE_CHANNEL


def test_crawler_ingests_a_peertube_channel(feed_env):
    env = feed_env
    peertube_routes(env)
    for body in ({"handle": "chan@tube.example", "kind": "peertube-channel"}, ):
        created = submit(env, body)
    assert created.status_code == 201 and created.json()["kind"] == "peertube-channel" and created.json()["itemCount"] == 2
    # the same channel via its URL is a duplicate
    dup = submit(env, {"url": "https://tube.example/video-channels/chan"})
    assert dup.status_code == 200 and dup.json()["duplicate"] is True
    report = approve_and_crawl(env, created.json()["id"])
    assert report.yields["feeds"]["requests"] == 2 and report.new_creators == 1
    c = env.rt.repo.list()["creators"][0]
    assert c["name"] == "Chan TV" and c["username"] == "chan@tube.example" and c["followers"] == 42
    assert c["viewCount"] == 105 and c["likeCount"] == 8 and c["media"] == []  # instance thumbnails are not edge-proxied
    assert {"https://tube.example/videos/watch/u1", "https://tube.example/videos/watch/u3"} <= {l["url"] for l in c["profileLinks"]}
    assert "https://tube.example/videos/watch/u2" not in {l["url"] for l in c["profileLinks"]}
    assert {"gay", "outdoor", "food"} <= set(c["discoveryTags"])
    assert c["sourceAttribution"].startswith("Creator-submitted public feed: https://tube.example/video-channels/chan")


def test_bluesky_and_mastodon_handles(feed_env):
    env = feed_env
    env.net.routes["app.bsky.actor.getProfile"] = lambda r: {"did": "did:1", "handle": "bear.example.com", "displayName": "Bear Bluesky",
                                                              "followersCount": 12, "description": "18+ bear"}
    posts = {"feed": [
        {"post": {"uri": "at://did:1/app.bsky.feed.post/3k1", "author": {"handle": "bear.example.com"}, "likeCount": 4,
                  "record": {"text": "New set #bear #gaymuscle", "createdAt": "2026-09-04T10:00:00.000Z"}}},
        {"post": {"uri": "at://did:2/app.bsky.feed.post/9z", "author": {"handle": "other.example.com"}, "record": {"text": "x"}}},
        {"post": {"uri": "at://did:1/app.bsky.feed.post/3k2", "author": {"handle": "bear.example.com"}, "record": {"text": "repost"}},
         "reason": {"$type": "app.bsky.feed.defs#reasonRepost"}},
    ]}
    env.net.routes["app.bsky.feed.getAuthorFeed"] = lambda r: posts
    sky = submit(env, {"url": "https://bsky.app/profile/Bear.Example.com"})
    assert sky.status_code == 201 and sky.json()["kind"] == "bluesky" and sky.json()["itemCount"] == 1
    assert submit(env, {"handle": "@bear.example.com", "kind": "bluesky"}).json()["duplicate"] is True

    account = {"id": "77", "acct": "fur", "url": "https://masto.example/@fur", "display_name": "Fur Fan", "followers_count": 9,
               "locked": False, "bot": False, "discoverable": True, "note": "<p>hello</p>"}
    env.net.routes["masto.example/api/v1/accounts/lookup"] = lambda r: account
    env.net.routes["masto.example/api/v1/accounts/77/statuses"] = lambda r: [
        {"id": "1", "url": "https://masto.example/@fur/1", "content": "<p>Hello <b>world</b> #bear</p>", "favourites_count": 3,
         "visibility": "public", "created_at": "2026-09-05T11:00:00.000Z", "tags": [{"name": "bear"}]},
        {"id": "2", "url": "https://masto.example/@fur/2", "content": "dm", "visibility": "direct", "tags": []},
    ]
    masto = submit(env, {"url": "https://masto.example/@fur"})
    assert masto.status_code == 201 and masto.json()["kind"] == "mastodon" and masto.json()["itemCount"] == 1
    for fid in (sky.json()["id"], masto.json()["id"]):
        env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={})
    report = pytest_run(env.rt.crawler.run_once(only="feeds"))
    assert report.new_creators == 2
    by = {c["username"]: c for c in env.rt.repo.list()["creators"]}
    b = by["bear.example.com@bsky.app"]
    assert b["name"] == "Bear Bluesky" and b["likeCount"] == 4 and b["followers"] == 12 and {"bear", "gaymuscle"} <= set(b["discoveryTags"])
    assert b["profileUrl"] == "https://bsky.app/profile/bear.example.com"
    assert "https://bsky.app/profile/bear.example.com/post/3k1" in [l["url"] for l in b["profileLinks"]]
    m = by["fur@masto.example"]
    assert m["name"] == "Fur Fan" and m["likeCount"] == 3 and m["lastSeenAt"] == "2026-09-05T11:00:00Z"
    assert "<" not in " ".join(l["label"] for l in m["profileLinks"])


@pytest.mark.parametrize("account,code", [
    ({"id": "1", "locked": True}, "login_required"), ({"id": "1", "bot": True}, "login_required"),
    ({"id": "1", "noindex": True}, "login_required"), ({"id": "1", "discoverable": False}, "login_required"),
    ({"acct": "no-id"}, "not_found"),
])
def test_private_mastodon_accounts_are_refused(feed_env, account, code):
    feed_env.net.routes["masto.example/api/v1/accounts/lookup"] = lambda r: {"url": "https://masto.example/@x", **account}
    res = submit(feed_env, {"handle": "x@masto.example", "kind": "mastodon"})
    assert res.status_code == 422 and code_of(res) == code


def test_bluesky_hidden_from_logged_out_is_refused(feed_env):
    feed_env.net.routes["app.bsky.actor.getProfile"] = lambda r: {"handle": "a.example.com", "labels": [{"val": "!no-unauthenticated"}]}
    res = submit(feed_env, {"handle": "a.example.com", "kind": "bluesky"})
    assert res.status_code == 422 and code_of(res) == "login_required"
    feed_env.net.routes["app.bsky.actor.getProfile"] = lambda r: httpx.Response(400, json={"error": "InvalidRequest"})
    assert code_of(submit(feed_env, {"handle": "b.example.com", "kind": "bluesky"})) == "not_found"


# ── crawler: failure handling for approved feeds ─────────────────────────────


def test_crawl_failures_back_off_then_pause_and_login_pauses_immediately(feed_env):
    env = feed_env
    serve_rss(env)
    fid = submit(env, {"url": FEED_URL}).json()["id"]
    env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={})
    env.rt.crawler.fetcher = guarded(env.net, failure_threshold=100)  # keep the host breaker out of this test
    env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(500)
    report = pytest_run(env.rt.crawler.run_once(only="feeds"))
    assert any("feed:1:http_500" in e for e in report.errors) and report.state == "partial"
    row = rows(env)[0]
    assert row["status"] == "approved" and row["failures"] == 1 and row["last_status"] == "http_500" and row["next_fetch_at"] > row["last_fetched_at"]
    assert json.loads(row["error_json"])[0]["code"] == "http_500"
    # repeated failures pause the feed
    for _ in range(F.FeedConfig.from_env().max_failures):
        with env.db.connect() as conn:
            conn.execute("UPDATE submitted_feeds SET next_fetch_at = '2000-01-01T00:00:00Z' WHERE status = 'approved'")
            conn.commit()
        pytest_run(env.rt.crawler.run_once(only="feeds"))
    row = rows(env)[0]
    assert row["status"] == "paused" and row["reason"] == "repeated_failures"

    # a feed that moves behind a login is paused at once
    env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={})
    env.net.routes["bearstudio.example/feed.xml"] = lambda r: httpx.Response(403)
    pytest_run(env.rt.crawler.run_once(only="feeds"))
    row = rows(env)[0]
    assert row["status"] == "paused" and row["reason"] == "login_required"
    assert env.rt.repo.list()["total"] == 0


def test_feed_that_turns_unsafe_is_paused_not_ingested(feed_env):
    env = feed_env
    serve_rss(env)
    fid = submit(env, {"url": FEED_URL}).json()["id"]
    env.client.post(f"/api/v1/creators/admin/feeds/{fid}/approve", headers=ADMIN, json={})
    serve_rss(env, title="Leaked Bears Collection")
    pytest_run(env.rt.crawler.run_once(only="feeds"))
    row = rows(env)[0]
    assert row["status"] == "paused" and row["reason"] == "leak_marker" and env.rt.repo.list()["total"] == 0


def test_item_level_hygiene_drops_single_items_only(feed_env):
    env = feed_env
    items = [("Fine post", "https://bearstudio.example/p/1"), ("Underage roleplay", "https://bearstudio.example/p/2"),
             ("Another", "https://bearstudio.example/p/3")]
    extra = ""
    env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(
        rss(items).replace("<guid>https://bearstudio.example/p/3</guid>",
                           "<guid>https://bearstudio.example/p/3</guid><category>femdom</category>"))
    fid = submit(env, {"url": FEED_URL}).json()["id"]
    assert rows(env)[0]["item_count"] == 1  # unsafe title and excluded-marker category each drop one item
    approve_and_crawl(env, fid)
    links = [l["url"] for l in env.rt.repo.list()["creators"][0]["profileLinks"]]
    assert "https://bearstudio.example/p/1" in links and not any(u.endswith(("/p/2", "/p/3")) for u in links)
    assert extra == ""


def test_media_hosts_not_servable_by_the_edge_become_link_outs():
    entry = F.FeedEntry(id="1", title="clip", url="https://x.example/1", media_url="https://x.example/v.mp4", media_kind="video",
                        thumbnail="https://x.example/t.jpg")
    assert F._media_item(entry, "X") is None
    entry.media_url, entry.thumbnail = "https://media.redgifs.com/v.mp4", "https://x.example/t.jpg"
    assert F._media_item(entry, "X") is None  # thumbnail must be servable too
    entry.thumbnail = "https://thumbs44.redgifs.com/t.jpg"
    assert F._media_item(entry, "X")["mediaUrl"] == "https://media.redgifs.com/v.mp4"
    entry.media_url = "http://media.redgifs.com/v.mp4"
    assert F._media_item(entry, "X") is None


def test_feed_handles_are_unique_per_feed(feed_env):
    env = feed_env
    env.net.routes["bearstudio.example/a.xml"] = lambda r: xml(rss(ITEMS))
    env.net.routes["bearstudio.example/b.xml"] = lambda r: xml(rss(ITEMS))
    a = submit(env, {"url": "https://bearstudio.example/a.xml"}).json()
    b = submit(env, {"url": "https://bearstudio.example/b.xml"}).json()
    handles = {r["creator_handle"] for r in rows(env)}
    assert len(handles) == 2 and "bear-studio@bearstudio.example" in handles and a["id"] != b["id"]


def test_feeds_source_is_selectable_in_the_admin_crawl_endpoint(feed_env):
    res = feed_env.client.post("/api/v1/creators/index/crawl?wait=true&source=feeds", headers=ADMIN)
    assert res.status_code == 200 and res.json()["started"] is True and res.json()["state"] in {"ok", "partial"}
    assert feed_env.client.post("/api/v1/creators/index/crawl?source=nope", headers=ADMIN).status_code == 422


def test_crawl_config_defaults_do_not_change():
    cfg = CrawlConfig()
    assert (cfg.max_pages, cfg.per_source_share, cfg.catalog_share) == (40, 0.1, 0.2)
    assert F.FeedConfig().max_per_run == 6 and F.FeedConfig().per_ip_per_hour == 5


def test_unsafe_urls_never_reach_the_network_even_if_stored(feed_env):
    """Defence in depth: a row that somehow holds a private URL is refused by the fetcher itself."""
    env = feed_env
    with env.db.connect() as conn:
        conn.execute(
            "INSERT INTO submitted_feeds (kind, url, canonical_key, status, created_at) VALUES "
            "('rss','http://127.0.0.1/feed','feed:http://127.0.0.1/feed','approved','2026-01-01T00:00:00Z')")
        conn.commit()
    report = pytest_run(env.rt.crawler.run_once(only="feeds"))
    assert env.net.seen == [] and any("unsafe_url" in e for e in report.errors)


def test_sqlite_schema_has_no_raw_contact_columns(feed_env):
    with feed_env.db.connect() as conn:
        for table in ("submitted_feeds", "takedown_requests"):
            cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
            assert not any(c in cols for c in ("email", "contact_email", "ip", "ip_address")), table
            assert "contact_email_hash" in cols and "submitted_ip_hash" in cols
    assert isinstance(sqlite3.sqlite_version, str)
