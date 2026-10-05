"""Takedown / hide requests: immediate hiding, suppression that survives crawls, admin restore / permanent
suppression, rate limits, honeypot and the privacy of the stored contact details."""

from __future__ import annotations

import asyncio
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.creator_index import lanes as L
from app.creator_index.moderation import ModerationError, build_target
from app.creator_index.repository import CreatorObservation
from tests.creator_index_helpers import ADMIN, Net, feed_env, make_feed_env, rss, xml  # noqa: F401

TAKEDOWN = "/api/v1/creators/takedown"
A = "/api/v1/creators/admin"
EMAIL = "Owner@Example.com"


def post(env, body, ip="203.0.113.5"):
    return env.client.post(TAKEDOWN, json=body, headers={"X-Client-IP": ip})


def run(coro):
    return asyncio.run(coro)


def media(item_id: str, url: str | None = None, views: int = 10):
    return {"id": item_id, "title": f"clip {item_id}", "thumbnail": f"https://thumbs44.redgifs.com/{item_id}-t.jpg", "views": views,
            "likes": 1, "mediaUrl": f"https://media.redgifs.com/{item_id}.mp4", "streamCandidates": [f"https://media.redgifs.com/{item_id}.mp4"],
            "pageUrl": url or f"https://www.redgifs.com/watch/{item_id.removeprefix('rg-')}", "createdAt": "2026-01-01T00:00:00Z"}


def seed(env, handle="alpha", platform="redgifs", items=("rg-one", "rg-two"), **kw):
    base = dict(platform=platform, handle=handle, display_name=handle.title(), media_count=5, view_count=500, like_count=20,
                tags={"gay": 2}, last_seen_at="2026-02-01T00:00:00Z", source=platform,
                profile_url=f"https://www.redgifs.com/users/{handle}", sample_media=[media(i) for i in items])
    base.update(kw)
    env.rt.repo.upsert([CreatorObservation(**base)])


def visible(env) -> set[str]:
    return {c["username"] for c in env.rt.repo.list(limit=96)["creators"]}


def requests(env):
    with env.db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM takedown_requests ORDER BY id")]


# ── target parsing ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("url,creators,items", [
    ("https://www.redgifs.com/users/Alpha", [("redgifs", "alpha")], []),
    ("https://redgifs.com/watch/TastyGif", [], ["id:rg-tastygif", "url:https://redgifs.com/watch/tastygif"]),
    ("https://bsky.app/profile/bear.example.com", [("bluesky", "bear.example.com")], []),
    ("https://bsky.app/profile/bear.example.com/post/3k1", [], ["url:https://bsky.app/profile/bear.example.com/post/3k1"]),
    ("https://masto.example/@fur", [("mastodon", "fur@masto.example")], []),
    ("https://masto.example/@fur@other.example", [("mastodon", "fur@other.example")], []),
    ("https://masto.example/@fur/1234", [], ["url:https://masto.example/@fur/1234"]),
    ("https://lemmy.example/u/lem", [("lemmy", "lem@lemmy.example")], []),
    ("https://tube.example/video-channels/chan", [("peertube", "chan@tube.example")], []),
])
def test_url_targets(url, creators, items):
    t = build_target(None, None, url)
    assert t.creators == creators and t.items == items


def test_generic_urls_hide_profiles_and_items():
    t = build_target(None, None, "https://example.com/blog/feed.xml?utm_source=x")
    assert t.profiles == ["https://example.com/blog/feed.xml"] and t.items == ["url:https://example.com/blog/feed.xml"]


@pytest.mark.parametrize("args,code", [
    ((None, None, None), "target_required"), (("redgifs", None, None), "target_required"),
    (("mastodon", "nohost", None), "handle_needs_host"), (("redgifs", "a@b.example", None), "invalid_handle"),
    (("nope", "x", None), "unknown_platform"), (("redgifs", "+1 (555) 123-4567", None), "invalid_handle"),
    ((None, None, "http://example.com/a"), "invalid_url"), ((None, None, "https://example.com/"), "target_not_specific"),
    ((None, None, "https://u:p@example.com/a"), "invalid_url"), ((None, None, "https://example.com/" + "a" * 600), "invalid_url"),
])
def test_invalid_targets(args, code):
    with pytest.raises(ModerationError) as err:
        build_target(*args)
    assert err.value.code == code


def test_platform_labels_are_accepted():
    assert build_target("Creator feed", "slug@site.example", None).creators == [("feed", "slug@site.example")]
    assert build_target("Redgifs", "@Alpha", None).creators == [("redgifs", "alpha")]


# ── public endpoint ──────────────────────────────────────────────────────────


def test_takedown_hides_immediately_and_stores_only_hashes(feed_env):
    env = feed_env
    seed(env, "alpha")
    seed(env, "beta")
    res = post(env, {"platform": "redgifs", "handle": "Alpha", "reason": "This is my content, mail me at me@example.com", "email": EMAIL})
    assert res.status_code == 201 and res.headers["cache-control"] == "no-store"
    body = res.json()
    assert body["status"] == "hidden" and body["matchedCreators"] == 1 and body["matchedItems"] == 0 and body["id"] == 1
    # hidden from every index read at once
    assert visible(env) == {"beta"}
    assert env.client.get("/api/v1/creators/index").json()["total"] == 1
    assert env.client.get("/api/v1/creators/index?q=alpha").json()["total"] == 0
    assert env.client.get("/api/v1/creators/index?tag=gay&sort=newest").json()["total"] == 1
    assert env.client.get("/api/v1/creators/index/stats").json()["total"] == 1
    assert env.client.get("/api/v1/creators/index/hidden").json()["keys"] == ["redgifs:alpha"]
    (row,) = requests(env)
    blob = json.dumps(row)
    assert "owner" not in blob.lower() and "example.com" not in blob and "203.0.113.5" not in blob and "me@" not in blob
    assert len(row["contact_email_hash"]) == 40 and row["status"] == "hidden" and row["platform"] == "redgifs" and row["handle"] == "alpha"


def test_takedown_by_profile_url_post_url_and_unknown_creator(feed_env):
    env = feed_env
    seed(env, "alpha", items=("rg-one", "rg-two"))
    seed(env, "beta", items=("rg-three",))
    # a single post: the item disappears from the samples, the creator stays
    res = post(env, {"url": "https://www.redgifs.com/watch/one", "reason": "my clip", "email": EMAIL}).json()
    assert res["matchedItems"] == 1 and res["matchedCreators"] == 0
    alpha = next(c for c in env.rt.repo.list()["creators"] if c["username"] == "alpha")
    assert [m["id"] for m in alpha["media"]] == ["rg-two"]
    # a profile URL hides the creator
    res = post(env, {"url": "https://www.redgifs.com/users/beta", "reason": "my account", "email": EMAIL}).json()
    assert res["matchedCreators"] == 1 and visible(env) == {"alpha"}
    # a creator that is not indexed (yet) is still recorded and pre-emptively suppressed
    res = post(env, {"platform": "bluesky", "handle": "ghost.example.com", "reason": "not wanted", "email": EMAIL}).json()
    assert res["matchedCreators"] == 0 and res["status"] == "hidden"
    with env.db.connect() as conn:
        kinds = {(r["kind"], r["platform"], r["handle"], r["item_key"]) for r in conn.execute("SELECT * FROM creator_suppressions")}
    assert ("creator", "bluesky", "ghost.example.com", "") in kinds and ("item", "", "", "id:rg-one") in kinds


def test_validation_honeypot_and_email(feed_env):
    env = feed_env
    seed(env, "alpha")
    good = {"platform": "redgifs", "handle": "alpha", "reason": "mine", "email": EMAIL}
    assert post(env, {**good, "email": "nope@x"}).json()["detail"]["code"] == "invalid_email"
    assert post(env, {**good, "reason": "x"}).status_code == 422  # reason too short
    assert post(env, {**good, "extra": 1}).status_code == 422
    assert post(env, {"reason": "mine", "email": EMAIL}).json()["detail"]["code"] == "target_required"
    assert post(env, {**good, "platform": "myspace"}).json()["detail"]["code"] == "unknown_platform"
    assert post(env, {"url": "https://www.redgifs.com/", "reason": "mine", "email": EMAIL}).json()["detail"]["code"] == "target_not_specific"
    assert visible(env) == {"alpha"} and requests(env) == []  # nothing recorded for invalid requests
    trap = post(env, {**good, "website": "http://spam.example"})
    assert trap.status_code == 202 and visible(env) == {"alpha"} and requests(env) == []
    big = env.client.post(TAKEDOWN, content=b"{" + b" " * 9000 + b"}", headers={"content-type": "application/json"})
    assert big.status_code == 413


def test_takedown_rate_limits(make_feed_env):
    env = make_feed_env(TAKEDOWN_PER_HOUR="3", TAKEDOWN_GLOBAL_PER_HOUR="5")
    seed(env, "alpha")
    for i in range(3):
        assert post(env, {"platform": "redgifs", "handle": f"h{i}", "reason": "mine", "email": EMAIL}, ip="198.51.100.1").status_code == 201
    limited = post(env, {"platform": "redgifs", "handle": "h9", "reason": "mine", "email": EMAIL}, ip="198.51.100.1")
    assert limited.status_code == 429 and int(limited.headers["retry-after"]) >= 1
    assert post(env, {"platform": "redgifs", "handle": "h4", "reason": "mine", "email": EMAIL}, ip="198.51.100.2").status_code == 201
    assert post(env, {"platform": "redgifs", "handle": "h5", "reason": "mine", "email": EMAIL}, ip="198.51.100.3").status_code == 201
    over = post(env, {"platform": "redgifs", "handle": "h6", "reason": "mine", "email": EMAIL}, ip="198.51.100.4")
    assert over.status_code == 429  # global ceiling


def test_per_contact_daily_cap(feed_env):
    env = feed_env
    env.rt.moderation.max_per_email_day = 2
    for i in range(2):
        assert post(env, {"platform": "redgifs", "handle": f"h{i}", "reason": "mine", "email": EMAIL}, ip=f"198.51.100.{i + 1}").status_code == 201
    assert post(env, {"platform": "redgifs", "handle": "h3", "reason": "mine", "email": EMAIL}, ip="198.51.100.9").status_code == 429
    assert post(env, {"platform": "redgifs", "handle": "h3", "reason": "mine", "email": "someone@else.org"}, ip="198.51.100.9").status_code == 201


# ── suppression persists across every write path ─────────────────────────────


def gif(gid, user, **over):
    item = {
        "id": gid, "userName": user, "description": f"clip {gid}", "tags": ["Gay", "Bear"], "duration": 12, "width": 1080, "height": 1920,
        "likes": 5, "views": 100, "createDate": 1_790_000_000,
        "urls": {"hd": f"https://media.redgifs.com/{gid}.mp4", "sd": f"https://media.redgifs.com/{gid}-m.mp4",
                 "poster": f"https://media.redgifs.com/{gid}-p.jpg", "thumbnail": f"https://thumbs44.redgifs.com/{gid}-t.jpg"},
    }
    item.update(over)
    return item


@pytest.fixture()
def redgifs_net(feed_env, monkeypatch):
    units = [L.RedgifsUnit("Gay", "trending", 1), L.RedgifsUnit("Twink", "trending", 1)]
    monkeypatch.setattr(L, "plan_redgifs_units", lambda *a, **k: list(units))
    feed_env.rt.crawler.config.max_pages = 12
    table = {"Gay": [gif("a1", "alpha"), gif("a2", "alpha"), gif("b1", "beta")], "Twink": [gif("c1", "gamma")]}
    feed_env.net.routes["/auth/temporary"] = lambda r: {"token": "tok"}
    feed_env.net.routes["/gifs/search"] = lambda r: {"gifs": table.get(parse_qs(urlsplit(str(r.url)).query)["tags"][0], [])}
    feed_env.net.routes["/users/"] = lambda r: {"total": 9, "gifs": [gif("a1", "alpha"), gif("a3", "alpha")]}
    return feed_env


def test_hidden_creator_is_never_resurrected_by_crawls(redgifs_net):
    env = redgifs_net
    run(env.rt.crawler.run_once(only="redgifs"))
    assert visible(env) == {"alpha", "beta", "gamma"}
    assert post(env, {"platform": "redgifs", "handle": "alpha", "reason": "mine", "email": EMAIL}).status_code == 201
    assert post(env, {"url": "https://www.redgifs.com/watch/b1", "reason": "mine", "email": EMAIL}).status_code == 201
    assert visible(env) == {"beta", "gamma"}
    for _ in range(3):  # lanes + catalogs re-observe alpha and beta's removed clip every run
        env.rt.repo.set_state("cursor:redgifs", 0)
        run(env.rt.crawler.run_once(only="redgifs"))
    assert visible(env) == {"beta", "gamma"}
    with env.db.connect() as conn:
        assert conn.execute("SELECT hidden FROM creator_index WHERE handle = 'alpha'").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM creator_index WHERE handle = 'alpha'").fetchone()[0] == 1
    beta = next(c for c in env.rt.repo.list()["creators"] if c["username"] == "beta")
    assert "rg-b1" not in [m["id"] for m in beta["media"]]  # the suppressed item stays out of the samples
    seeds = env.rt.repo.next_seeds("redgifs", 10)
    assert "alpha" not in seeds


def test_preemptive_suppression_blocks_creators_not_yet_indexed(redgifs_net):
    env = redgifs_net
    post(env, {"platform": "redgifs", "handle": "gamma", "reason": "mine", "email": EMAIL})
    report = run(env.rt.crawler.run_once(only="redgifs"))
    assert visible(env) == {"alpha", "beta"} and report.new_creators == 2
    with env.db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM creator_index WHERE handle = 'gamma'").fetchone()[0] == 0


def test_observe_and_repository_upserts_honour_the_suppression_list(feed_env):
    env = feed_env
    post(env, {"platform": "redgifs", "handle": "alpha", "reason": "mine", "email": EMAIL})
    res = env.client.post("/api/v1/creators/index/observe", headers=ADMIN, json={"creators": [
        {"platform": "redgifs", "handle": "alpha", "displayName": "Alpha", "mediaCount": 3}, {"platform": "redgifs", "handle": "other"}]})
    assert res.status_code == 200 and visible(env) == {"other"}
    outcome = env.rt.repo.upsert_detailed([CreatorObservation(platform="redgifs", handle="ALPHA", media_count=9)])
    assert outcome.written == 0 and outcome.suppressed == 1 and outcome.new == []


def test_profile_url_suppression_blocks_matching_creators_on_any_platform(feed_env):
    env = feed_env
    post(env, {"url": "https://bearstudio.example/about", "reason": "mine", "email": EMAIL})
    outcome = env.rt.repo.upsert_detailed([CreatorObservation(platform="feed", handle="x@bearstudio.example", profile_url="https://www.bearstudio.example/about/")])
    assert outcome.suppressed == 1 and visible(env) == set()


def test_takedown_of_a_submitted_feed_rejects_it_for_good(feed_env):
    env = feed_env
    env.net.routes["bearstudio.example/feed.xml"] = lambda r: xml(rss([("Post", "https://bearstudio.example/p/1")]))
    fid = env.client.post("/api/v1/creators/feeds/submit", json={"url": "https://bearstudio.example/feed.xml"}, headers={"X-Client-IP": "203.0.113.9"}).json()["id"]
    env.client.post(f"{A}/feeds/{fid}/approve", headers=ADMIN, json={"fetchNow": True})
    assert len(visible(env)) == 1
    res = post(env, {"url": "https://bearstudio.example/feed.xml", "reason": "not my feed", "email": EMAIL})
    assert res.status_code == 201 and res.json()["matchedCreators"] == 1 and visible(env) == set()
    feed = env.client.get(f"{A}/feeds?status=rejected", headers=ADMIN).json()["feeds"][0]
    assert feed["status"] == "rejected" and feed["reason"] == "takedown"
    assert env.client.post(f"{A}/feeds/{fid}/approve", headers=ADMIN, json={}).status_code == 409
    again = env.client.post("/api/v1/creators/feeds/submit", json={"url": "https://bearstudio.example/feed.xml"}, headers={"X-Client-IP": "203.0.113.10"})
    assert again.status_code == 422 and again.json()["detail"]["code"] == "not_accepted"
    # restoring the takedown makes the feed reviewable again, never silently live
    assert env.client.post(f"{A}/takedowns/{res.json()['id']}/restore", headers=ADMIN, json={}).status_code == 200
    feed = env.client.get(f"{A}/feeds?status=paused", headers=ADMIN).json()["feeds"][0]
    assert feed["id"] == fid and "re-approval" in feed["reason"]
    assert env.client.post(f"{A}/feeds/{fid}/approve", headers=ADMIN, json={"fetchNow": True}).status_code == 200 and len(visible(env)) == 1


# ── admin: list / restore / permanent / set_hidden ───────────────────────────


def test_admin_list_restore_and_permanent_suppression(feed_env):
    env = feed_env
    seed(env, "alpha")
    seed(env, "beta")
    first = post(env, {"platform": "redgifs", "handle": "alpha", "reason": "mine", "email": EMAIL}).json()["id"]
    second = post(env, {"platform": "redgifs", "handle": "beta", "reason": "mine too", "email": EMAIL}).json()["id"]
    listing = env.client.get(f"{A}/takedowns", headers=ADMIN).json()
    assert [r["id"] for r in listing["requests"]] == [second, first]
    row = listing["requests"][1]
    assert row["status"] == "hidden" and row["hasContact"] is True and row["handle"] == "alpha" and "contactEmailHash" not in row
    assert "owner" not in json.dumps(listing).lower()
    assert [r["id"] for r in env.client.get(f"{A}/takedowns?status=restored", headers=ADMIN).json()["requests"]] == []

    assert env.client.post(f"{A}/takedowns/{first}/restore", headers=ADMIN, json={"note": "verified wrong person"}).json() == {"restored": True, "id": first}
    assert visible(env) == {"alpha"} and env.rt.repo.hidden_keys() == ["redgifs:beta"]
    assert requests(env)[0]["status"] == "restored" and requests(env)[0]["admin_note"] == "verified wrong person"
    # once restored, crawlers may write the creator again
    assert env.rt.repo.upsert_detailed([CreatorObservation(platform="redgifs", handle="alpha", media_count=9)]).written == 1

    assert env.client.post(f"{A}/takedowns/{second}/suppress", headers=ADMIN, json={"note": "confirmed"}).json()["suppressed"] is True
    assert env.client.post(f"{A}/takedowns/{second}/restore", headers=ADMIN, json={}).status_code == 409
    assert env.client.post(f"{A}/takedowns/999/restore", headers=ADMIN, json={}).status_code == 404
    assert env.client.post(f"{A}/takedowns/999/suppress", headers=ADMIN, json={}).status_code == 404
    sup = env.client.get(f"{A}/suppressions", headers=ADMIN).json()["suppressions"]
    assert [(s["kind"], s["handle"], s["level"]) for s in sup] == [("creator", "beta", "permanent")]
    assert visible(env) == {"alpha"}


def test_admin_direct_suppress_and_set_hidden(feed_env):
    env = feed_env
    seed(env, "alpha")
    seed(env, "beta")
    res = env.client.post(f"{A}/suppress", headers=ADMIN, json={"platform": "redgifs", "handle": "alpha", "reason": "operator decision"})
    assert res.status_code == 201 and res.json()["status"] == "suppressed" and res.json()["matchedCreators"] == 1
    assert env.client.post(f"{A}/takedowns/{res.json()['id']}/restore", headers=ADMIN, json={}).status_code == 409
    assert env.client.post(f"{A}/suppress", headers=ADMIN, json={"reason": "x"}).status_code == 422
    # set_hidden: reversible hide for any creator, but never un-hides a suppressed one
    assert env.client.post(f"{A}/hidden", headers=ADMIN, json={"platform": "redgifs", "handle": "beta", "hidden": True}).json() == {"updated": True, "hidden": True}
    assert visible(env) == set()
    assert env.client.post(f"{A}/hidden", headers=ADMIN, json={"platform": "redgifs", "handle": "beta", "hidden": False}).status_code == 200
    assert visible(env) == {"beta"}
    assert env.client.post(f"{A}/hidden", headers=ADMIN, json={"platform": "redgifs", "handle": "alpha", "hidden": False}).status_code == 409
    assert env.client.post(f"{A}/hidden", headers=ADMIN, json={"platform": "redgifs", "handle": "zzz", "hidden": True}).status_code == 404
    assert env.client.post(f"{A}/hidden", headers=ADMIN, json={"platform": "redgifs", "handle": "beta"}).status_code == 422


def test_restore_keeps_creators_hidden_while_another_request_still_suppresses_them(feed_env):
    env = feed_env
    seed(env, "alpha")
    a = post(env, {"platform": "redgifs", "handle": "alpha", "reason": "first", "email": EMAIL}).json()["id"]
    b = post(env, {"platform": "redgifs", "handle": "alpha", "reason": "second", "email": "x@y.org"}, ip="198.51.100.2").json()["id"]
    env.client.post(f"{A}/takedowns/{a}/restore", headers=ADMIN, json={})  # the suppression now belongs to the newer request
    assert visible(env) == set()  # still hidden: request b still stands
    env.client.post(f"{A}/takedowns/{b}/restore", headers=ADMIN, json={})
    assert visible(env) == {"alpha"}


def test_hidden_keys_endpoint_is_public_and_minimal(feed_env):
    env = feed_env
    seed(env, "alpha")
    seed(env, "bsky", platform="bluesky", profile_url="https://bsky.app/profile/bsky")
    post(env, {"platform": "redgifs", "handle": "Alpha", "reason": "mine", "email": EMAIL})
    post(env, {"platform": "bluesky", "handle": "ghost.example.com", "reason": "mine", "email": EMAIL})
    res = env.client.get("/api/v1/creators/index/hidden")
    assert res.status_code == 200 and "max-age" in res.headers["cache-control"]
    assert res.json() == {"keys": ["bluesky:ghostexamplecom", "redgifs:alpha"]}
    assert "reason" not in res.text and "owner" not in res.text.lower()


def test_hidden_rows_do_not_leak_through_any_read(feed_env):
    env = feed_env
    for h in ("alpha", "beta"):
        seed(env, h)
    post(env, {"platform": "redgifs", "handle": "alpha", "reason": "mine", "email": EMAIL})
    for query in ("", "?sort=newest", "?sort=popular", "?sort=count", "?q=alp", "?tag=gay", "?platform=redgifs"):
        body = env.client.get("/api/v1/creators/index" + query).json()
        assert all(c["username"] != "alpha" for c in body["creators"]), query
        assert body["total"] == len([c for c in body["creators"]]), query
    assert env.client.get("/api/v1/creators/index/stats").json()["byPlatform"] == {"Redgifs": 1}
