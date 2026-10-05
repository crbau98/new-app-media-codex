"""Round-3 discovery: adaptive lane weighting, related-tag snowballing, Redgifs niches, Bluesky hashtag + author
feeds, Mastodon Link pagination, Lemmy community discovery, PeerTube tag/category browse, lane-list sync with the
edge, and idempotent schema migrations. Mocked transports only."""

from __future__ import annotations

import asyncio
import re
import sqlite3
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.creator_index import lanes as L
from app.creator_index.adaptive import AdaptiveStore
from app.creator_index.crawler import CrawlConfig, CreatorCrawler
from app.creator_index.fetcher import GuardedFetcher, HttpxFetcher, JsonResponse
from app.creator_index.repository import CreatorIndexRepository
from app.creator_index.schema import ensure_creator_index_schema
from app.creator_index.sources import (
    LemmyCommunityUnit, LemmyDiscoverUnit, LemmySource, MastodonSource, MastodonUnit,
    PeerTubeSource, PeerTubeUnit, RedgifsNicheUnit, RedgifsSource, next_link,
)
from app.db import Database
from tests.creator_index_helpers import ADMIN, Net, guarded, make_env

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture()
def repo(tmp_path):
    db = Database(tmp_path / "d.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()
    return CreatorIndexRepository(db.connect)


@pytest.fixture(autouse=True)
def small_lanes(monkeypatch):
    for name in ("MASTODON_EXTRA_INSTANCES", "LEMMY_EXTRA_INSTANCES", "PEERTUBE_EXTRA_HOSTS", "MASTODON_TAG_PAGES", "LEMMY_MAX_COMMUNITIES"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(L, "plan_redgifs_units", lambda *a, **k: [L.RedgifsUnit("Gay", "trending", 1)])
    monkeypatch.setattr(L, "BLUESKY_QUERIES", ())
    monkeypatch.setattr(L, "BLUESKY_TAGS", ())
    monkeypatch.setattr(L, "MASTODON_TAGS", ("gaynsfw",))
    monkeypatch.setattr(L, "MASTODON_INSTANCES", ("mastodon.social",))
    monkeypatch.setattr(L, "LEMMY_QUERIES", ())
    monkeypatch.setattr(L, "LEMMY_COMMUNITY_QUERIES", ())
    monkeypatch.setattr(L, "LEMMY_INSTANCES", ("lemmynsfw.com",))
    monkeypatch.setattr(L, "PEERTUBE_QUERIES", ())
    monkeypatch.setattr(L, "PEERTUBE_TAGS", ())
    monkeypatch.setattr(L, "PEERTUBE_CATEGORIES", ())


def make_crawler(repo, net, wall=None, **cfg):
    config = CrawlConfig(**{"max_pages": 12, "max_seconds": 30, "catalog_share": 0.0, **cfg})
    return CreatorCrawler(repo, fetcher=guarded(net), config=config, wall_clock=wall or time.time)


def run(coro):
    return asyncio.run(coro)


def gif(gid, user, tags=("Gay", "Bear"), views=100, likes=5, **over):
    item = {
        "id": gid, "userName": user, "description": f"clip {gid}", "tags": list(tags), "duration": 12, "width": 1080, "height": 1920,
        "likes": likes, "views": views, "createDate": 1_790_000_000,
        "urls": {"hd": f"https://media.redgifs.com/{gid}.mp4", "sd": f"https://media.redgifs.com/{gid}-m.mp4",
                 "poster": f"https://media.redgifs.com/{gid}-p.jpg", "thumbnail": f"https://thumbs44.redgifs.com/{gid}-t.jpg"},
    }
    item.update(over)
    return item


def qs(request: httpx.Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlsplit(str(request.url)).query).items()}


# ── adaptive lane weighting ──────────────────────────────────────────────────


def test_back_off_schedule_is_exponential_capped_and_resets(repo):
    store = AdaptiveStore(repo.connect)
    t = 1_800_000_000.0
    kw = dict(after=3, base_hours=2.0, max_hours=10.0)
    ends = []
    for run_no in range(1, 8):
        entered = store.record_lane_runs("redgifs", {"redgifs:dead": (2, 0)}, now=t, **kw)
        ends.append(entered.get("redgifs:dead"))
    assert ends[:2] == [None, None]                                # below the threshold: no back-off yet
    hours = [(time.mktime(time.strptime(e, "%Y-%m-%dT%H:%M:%SZ")) - time.mktime(time.gmtime(t))) / 3600 for e in ends[2:]]
    assert [round(h) for h in hours] == [2, 4, 8, 10, 10]           # 2h * 2^k, capped at 10h
    assert store.backed_off("redgifs", t + 5 * 3600) == {"redgifs:dead"}
    assert store.backed_off("redgifs", t + 11 * 3600) == set()      # expires
    store.record_lane_runs("redgifs", {"redgifs:dead": (2, 3)}, now=t, **kw)  # found something: fully reset
    (row,) = store.lane_stats(source="redgifs")
    assert row["zeroRuns"] == 0 and row["backoffUntil"] is None and row["newCreators"] == 3 and row["requests"] == 16 and row["runs"] == 8
    assert row["yieldPerRequest"] == round(3 / 16, 3) and store.backed_off("redgifs", t) == set()


def test_zero_yield_lanes_back_off_automatically_and_budget_flows_to_live_lanes(repo, monkeypatch):
    monkeypatch.setattr(L, "plan_redgifs_units", lambda *a, **k: [L.RedgifsUnit("Dead", "trending", 1), L.RedgifsUnit("Live", "trending", 1)])
    now = [1_800_000_000.0]
    counter = iter(range(1_000))
    net = Net({
        "/auth/temporary": {"token": "t"},
        "/gifs/search": lambda r: {"gifs": [] if qs(r)["tags"] == "Dead" else [gif(f"g{next(counter)}", f"user{next(counter)}")]},
    })
    crawler = make_crawler(repo, net, wall=lambda: now[0], lane_backoff_after=3, lane_backoff_base_hours=2.0, lane_backoff_max_hours=16.0)

    def one_run():
        net.seen.clear()
        report = run(crawler.run_once(only="redgifs"))
        return report, net.count("tags=Dead"), net.count("tags=Live")

    for n in range(3):
        report, dead, live = one_run()
        assert (dead, live) == (1, 1)
        now[0] += 600
    assert report.backoffs == ["redgifs:dead"]                       # third zero-yield run triggers the back-off
    report, dead, live = one_run()                                    # skipped: no request spent on Dead, Live keeps going
    assert (dead, live) == (0, 1) and report.backoffs == []
    assert crawler.adaptive.backed_off("redgifs", now[0]) == {"redgifs:dead"}
    now[0] += 2 * 3600 + 1
    _, dead, live = one_run()                                         # back-off expired: probed again, zero again -> 4h
    assert (dead, live) == (1, 1)
    now[0] += 2 * 3600 + 1
    assert one_run()[1:] == (0, 1)                                    # 2h later it is still backed off (now 4h)
    now[0] += 2 * 3600
    assert one_run()[1:] == (1, 1)
    stats = {s["lane"]: s for s in crawler.adaptive.lane_stats(source="redgifs")}
    assert stats["redgifs:dead"]["zeroRuns"] == 5 and stats["redgifs:dead"]["newCreators"] == 0
    assert stats["redgifs:live"]["zeroRuns"] == 0 and stats["redgifs:live"]["newCreators"] == 7
    # operator reset
    assert crawler.adaptive.reset_lane("redgifs:dead") and crawler.adaptive.backed_off("redgifs", now[0]) == set()
    assert not crawler.adaptive.reset_lane("redgifs:unknown")


def test_yield_is_recorded_per_source_in_crawl_runs(repo, monkeypatch):
    monkeypatch.setattr(L, "BLUESKY_QUERIES", ("gay 18+",))
    net = Net({
        "/auth/temporary": {"token": "t"},
        "/gifs/search": lambda r: {"gifs": [gif("a1", "alpha"), gif("a2", "alpha"), gif("b1", "beta")]},
        "public.api.bsky.app": {"actors": [{"did": "d1", "handle": "x.bsky.social", "description": "18+"}]},
    })
    crawler = make_crawler(repo, net, max_pages=20)
    report = run(crawler.run_once(only=None))
    assert report.new_creators == 3 and report.yields["redgifs"]["new"] == 2 and report.yields["bluesky"]["new"] == 1
    assert report.yields["redgifs"]["requests"] >= 1 and report.yields["bluesky"]["requests"] >= 1
    latest = repo.recent_runs()[0]
    assert latest["newCreators"] == 3 and latest["requests"] == report.pages
    assert latest["yield"]["redgifs"]["new"] == 2 and latest["yield"]["bluesky"] == {"requests": latest["yield"]["bluesky"]["requests"], "new": 1, "upserted": 1}
    second = run(crawler.run_once(only=None))                          # same data again: nothing new, yield says so
    assert second.new_creators == 0 and second.yields["redgifs"]["new"] == 0 and repo.recent_runs()[0]["newCreators"] == 0
    assert second.yields["redgifs"]["upserted"] == 2  # still refreshed, just not new


def test_all_lanes_backed_off_ends_the_source_without_looping(repo):
    now = [1_800_000_000.0]
    net = Net({"/auth/temporary": {"token": "t"}, "/gifs/search": {"gifs": []}})
    crawler = make_crawler(repo, net, wall=lambda: now[0], lane_backoff_after=1, lane_backoff_base_hours=5)
    run(crawler.run_once(only="redgifs"))
    before = net.count("/gifs/search")
    report = run(crawler.run_once(only="redgifs"))
    assert report.state in {"ok", "partial"} and net.count("/gifs/search") == before


def test_transient_errors_are_not_counted_as_low_yield(repo):
    now = [1_800_000_000.0]
    net = Net({"/auth/temporary": {"token": "t"}, "/gifs/search": lambda r: httpx.Response(500)})
    crawler = make_crawler(repo, net, wall=lambda: now[0], lane_backoff_after=1)
    run(crawler.run_once(only="redgifs"))
    assert crawler.adaptive.lane_stats(source="redgifs") == [] and crawler.adaptive.backed_off("redgifs", now[0]) == set()


def test_admin_lane_endpoints(tmp_path, monkeypatch):
    env = make_env(tmp_path, monkeypatch, Net())
    env.rt.crawler.adaptive.record_lane_runs("redgifs", {"redgifs:dead": (3, 0), "redgifs:ok": (2, 4)}, after=1, base_hours=5)
    body = env.client.get("/api/v1/creators/admin/lanes?source=redgifs", headers=ADMIN).json()
    assert [l["lane"] for l in body["lanes"]] == ["redgifs:dead", "redgifs:ok"] and body["lanes"][0]["backoffUntil"]
    assert [l["lane"] for l in env.client.get("/api/v1/creators/admin/lanes?backedOff=true", headers=ADMIN).json()["lanes"]] == ["redgifs:dead"]
    assert env.client.post("/api/v1/creators/admin/lanes/reset", headers=ADMIN, json={"lane": "redgifs:dead"}).json()["reset"] is True
    assert env.client.get("/api/v1/creators/admin/lanes?backedOff=true", headers=ADMIN).json()["lanes"] == []
    assert env.client.post("/api/v1/creators/admin/lanes/reset", headers=ADMIN, json={"lane": "nope"}).status_code == 404
    assert "tags" in env.client.get("/api/v1/creators/admin/tags", headers=ADMIN).json()
    env.rt.repo.finish_run(env.rt.repo.start_run("all"), state="ok", pages=5, creators=3, lane="x", errors=[], new_creators=2,
                           requests=5, yields={"redgifs": {"requests": 5, "new": 2, "upserted": 3}})
    runs = env.client.get("/api/v1/creators/admin/runs?limit=3", headers=ADMIN).json()["runs"]
    assert runs[0]["newCreators"] == 2 and runs[0]["requests"] == 5 and runs[0]["yield"]["redgifs"]["new"] == 2
    assert env.client.get("/api/v1/creators/admin/runs").status_code == 401


# ── Redgifs: related-tag snowballing ─────────────────────────────────────────


def hot(user, tags, n=3):
    return [gif(f"{user}{i}", user, tags=tags, views=60_000, likes=900) for i in range(n)]


def test_related_tags_are_counted_promoted_into_lanes_and_crawled(repo):
    tags = ["Gay", "Gay Barista", "Gay Feet", "Blowjob", "Gay Chefs"]
    cold = [gif("c1", "cold", tags=["Gay", "Gay Lowviews"], views=3, likes=0)]
    net = Net({"/auth/temporary": {"token": "t"}, "/gifs/search": lambda r: {"gifs": hot("alpha", tags) + cold if qs(r)["tags"] == "Gay" else []}})
    crawler = make_crawler(repo, net, tag_snowball_min_items=3, tag_snowball_per_run=1, tag_snowball_max_lanes=5, tag_snowball_min_score=45)
    report = run(crawler.run_once(only="redgifs"))
    freq = {t["tag"]: t for t in crawler.adaptive.tag_frequencies("redgifs")}
    assert freq["gay barista"]["items"] == 3 and freq["gay chefs"]["items"] == 3
    assert "blowjob" not in freq                    # no male/gay token: never promoted into a lane
    assert "gay lowviews" not in freq               # only tags of high-engagement creators count
    assert report.promoted == ["gay barista"]       # per-run cap = 1; alphabetical among equals
    lanes = crawler.adaptive.discovered_lanes("redgifs", "tag")
    assert [d["payload"] for d in lanes] == [{"tag": "Gay Barista"}]
    # next process: the promoted lane becomes units and is crawled
    net.seen.clear()
    fresh = make_crawler(repo, net, tag_snowball_min_items=3, tag_snowball_per_run=1, tag_snowball_max_lanes=5)
    source = RedgifsSource(fresh.fetcher)
    run(source.prepare(repo, fresh.adaptive, fresh.config))
    assert [(u.tag, u.order, u.page) for u in source.units if getattr(u, "tag", "") == "Gay Barista"] == [
        ("Gay Barista", "trending", 1), ("Gay Barista", "top28", 1), ("Gay Barista", "recent", 1),
        ("Gay Barista", "trending", 2), ("Gay Barista", "top28", 2), ("Gay Barista", "recent", 2)]
    report2 = run(fresh.run_once(only="redgifs"))
    assert report2.promoted == ["gay chefs"] and net.count("tags=Gay+Barista") >= 1


def test_tag_promotion_respects_caps_static_lanes_and_markers(repo):
    store = AdaptiveStore(repo.connect)
    store.bump_tags("redgifs", {"gay feet": 50, "gay bareback": 40, "gay lesbian": 30, "gay minor": 30, "gay a": 20, "gay oldtag": 20})
    crawler = make_crawler(repo, Net({"/auth/temporary": {"token": "t"}, "/gifs/search": {"gifs": []}}), tag_snowball_min_items=5,
                           tag_snowball_per_run=10, tag_snowball_max_lanes=2)
    report = run(crawler.run_once(only="redgifs"))
    # "gay feet" and "gay bareback" are static lanes (marked done, not duplicated); the cap of 2 lanes then applies
    assert crawler.adaptive.count_lanes("redgifs", "tag") <= 2
    promoted = {d["payload"]["tag"].lower() for d in crawler.adaptive.discovered_lanes("redgifs", "tag")}
    assert promoted == {"gay a", "gay oldtag"} and report.promoted == ["gay a", "gay oldtag"]
    freq = {t["tag"]: t["promotedAt"] for t in crawler.adaptive.tag_frequencies("redgifs")}
    assert all(freq[t] for t in ("gay feet", "gay bareback", "gay lesbian", "gay minor"))   # considered once, never re-listed
    assert CreatorCrawler._eligible_tag("gay barista") and CreatorCrawler._eligible_tag("gay")
    assert not CreatorCrawler._eligible_tag("blowjob") and not CreatorCrawler._eligible_tag("gay lesbian")
    assert not CreatorCrawler._eligible_tag("gay minor") and not CreatorCrawler._eligible_tag("ab")


# ── Redgifs: niche discovery ─────────────────────────────────────────────────

NICHES = {"niches": [
    {"id": "gay-bears", "name": "Gay Bears", "subscribers": 900}, {"id": "fem", "name": "Female Bodybuilders", "subscribers": 5000},
    {"id": "cooking", "name": "Cooking"}, {"id": "gay-minor", "name": "Gay Minor Stuff"}, {"id": "men", "name": "Men"}, "junk", None,
]}


def test_niche_listing_is_probed_filtered_persisted_and_crawled(repo):
    net = Net({
        "/auth/temporary": {"token": "t"},
        "/niches?": NICHES,
        "/niches/gay-bears/gifs": lambda r: {"gifs": [gif("n1", "nicheguy", tags=["Gay Bears"])]},
        "/niches/men/gifs": lambda r: {"gifs": []},
        "/gifs/search": {"gifs": []},
    })
    crawler = make_crawler(repo, net, max_niches=5)
    report = run(crawler.run_once(only="redgifs"))
    lanes = {d["lane"]: d["payload"] for d in crawler.adaptive.discovered_lanes("redgifs", "niche")}
    assert lanes == {"niche:gay-bears": {"id": "gay-bears", "name": "Gay Bears"}, "niche:men": {"id": "men", "name": "Men"}}
    assert net.count("/niches?") == 1 and repo.get_state("probe:redgifs:niches")["ok"] is True
    run(crawler.run_once(only="redgifs"))                                  # refresh window: no second probe
    assert net.count("/niches?") == 1
    assert net.count("/niches/gay-bears/gifs") >= 1
    c = repo.list()["creators"][0]
    assert c["username"] == "nicheguy" and "gay bears" in c["discoveryTags"] and report.new_creators == 1
    assert crawler.adaptive.lane_stats(source="redgifs")[0]["lane"].startswith("redgifs:")


@pytest.mark.parametrize("responder", [
    lambda r: httpx.Response(404, json={}), lambda r: httpx.Response(200, text="<html>"), lambda r: {"niches": []},
    lambda r: {"unexpected": True}, lambda r: httpx.Response(403, json={}),
])
def test_unknown_niche_endpoint_is_skipped_and_not_reprobed(repo, responder):
    net = Net({"/auth/temporary": {"token": "t"}, "/niches?": responder, "/gifs/search": {"gifs": []}})
    crawler = make_crawler(repo, net)
    run(crawler.run_once(only="redgifs"))
    state = repo.get_state("probe:redgifs:niches")
    assert state["ok"] is False and not state.get("transient") and crawler.adaptive.count_lanes("redgifs", "niche") == 0
    run(crawler.run_once(only="redgifs"))
    assert net.count("/niches?") == 1                                      # remembered for niche_retry_days
    repo.set_state("probe:redgifs:niches", {"at": 0, "ok": False})
    run(crawler.run_once(only="redgifs"))
    assert net.count("/niches?") == 2                                      # retried after the window


def test_transient_niche_probe_failure_retries_sooner(repo):
    net = Net({"/auth/temporary": {"token": "t"}, "/niches?": lambda r: httpx.Response(503), "/gifs/search": {"gifs": []}})
    crawler = make_crawler(repo, net)
    run(crawler.run_once(only="redgifs"))
    assert repo.get_state("probe:redgifs:niches")["transient"] is True
    repo.set_state("probe:redgifs:niches", {"at": time.time() - 7 * 3600, "ok": False, "transient": True})
    run(crawler.run_once(only="redgifs"))
    assert net.count("/niches?") == 2


def test_niche_unit_keys_and_labels():
    unit = RedgifsNicheUnit("gay-bears", "Gay Bears", "trending", 1)
    assert RedgifsSource.lane_key(unit) == "redgifs:niche:gay-bears" and unit.query == "niche:Gay Bears"
    assert RedgifsSource.lane_key(L.RedgifsUnit("Twink", "recent", 3)) == "redgifs:twink"


# ── Bluesky ──────────────────────────────────────────────────────────────────


def post(handle, did, text, labels=None, likes=0, uri=None, created="2026-09-01T10:00:00.000Z", record_labels=None, **author):
    rec = {"text": text, "createdAt": created}
    if record_labels:
        rec["labels"] = {"values": [{"val": v} for v in record_labels]}
    return {"uri": uri or f"at://{did}/app.bsky.feed.post/{abs(hash((handle, text))) % 10_000}", "author": {"did": did, "handle": handle, **author},
            "record": rec, "labels": labels or [], "likeCount": likes}


def test_hashtag_search_maps_only_self_labelled_adult_posts(repo, monkeypatch):
    monkeypatch.setattr(L, "BLUESKY_TAGS", ("gaynsfw",))
    posts = {"posts": [
        post("good.bsky.social", "did:1", "fun #gaynsfw #bear", labels=[{"src": "did:1", "val": "porn"}], likes=4, displayName="Good Guy"),
        post("rec.bsky.social", "did:2", "set #gaynsfw", record_labels=["sexual"], likes=1),
        post("spoof.bsky.social", "did:3", "x #gaynsfw", labels=[{"src": "did:mod", "val": "porn"}]),
        post("plain.bsky.social", "did:4", "my cat #gaynsfw"),
        post("fem.bsky.social", "did:5", "hi #lesbian", labels=[{"src": "did:5", "val": "porn"}]),
        post("minor.bsky.social", "did:6", "underage fun #gaynsfw", labels=[{"src": "did:6", "val": "porn"}]),
        post("girls.bsky.social", "did:7", "x", labels=[{"src": "did:7", "val": "porn"}], displayName="Girls Club"),
        post("good.bsky.social", "did:1", "more #gaynsfw", labels=[{"src": "did:1", "val": "porn"}], likes=2),
        "junk",
    ]}
    net = Net({"app.bsky.feed.searchPosts": lambda r: posts})
    crawler = make_crawler(repo, net, max_pages=30)
    report = run(crawler.run_once(only="bluesky"))
    assert report.state in {"ok", "partial"}
    sent = [qs_ for u in net.seen if "searchPosts" in u for qs_ in [dict(parse_qs(urlsplit(u).query))]]
    assert sent[0]["q"] == ["#gaynsfw"] and sent[0]["sort"] == ["latest"]
    by = {c["username"]: c for c in repo.list(platform="bluesky")["creators"]}
    assert set(by) == {"good.bsky.social", "rec.bsky.social"}
    good = by["good.bsky.social"]
    assert good["name"] == "Good Guy" and good["likeCount"] == 6 and good["mediaCount"] == 2 and {"bear", "gaynsfw"} <= set(good["discoveryTags"])
    assert good["profileUrl"] == "https://bsky.app/profile/good.bsky.social" and good["media"] == []
    assert report.yields["bluesky"]["new"] == 2


@pytest.mark.parametrize("response", [lambda r: httpx.Response(403, json={"error": "AuthRequired"}), lambda r: httpx.Response(401),
                                      lambda r: {"unexpected": 1}, lambda r: httpx.Response(200, text="<html>")])
def test_hashtag_search_soft_fails_when_endpoint_needs_auth(repo, response, monkeypatch):
    monkeypatch.setattr(L, "BLUESKY_TAGS", ("gaynsfw",))
    net = Net({"app.bsky.feed.searchPosts": response})
    report = run(make_crawler(repo, net).run_once(only="bluesky"))
    assert report.state == "ok" and repo.list()["total"] == 0


def test_author_feed_sampling_for_discovered_actors(repo, monkeypatch):
    monkeypatch.setattr(L, "BLUESKY_QUERIES", ("gay 18+",))
    actors = {"actors": [{"did": "did:1", "handle": "good.bsky.social", "displayName": "Good Guy", "description": "18+ gay creator", "followersCount": 10,
                          "indexedAt": "2026-08-01T00:00:00.000Z"}]}
    feed = {"feed": [
        {"post": post("good.bsky.social", "did:1", "Top set #bear #gaymuscle", likes=50, uri="at://did:1/app.bsky.feed.post/top",
                      created="2026-09-02T10:00:00.000Z")},
        {"post": post("good.bsky.social", "did:1", "Small one #bear", likes=2, uri="at://did:1/app.bsky.feed.post/small")},
        {"post": post("good.bsky.social", "did:1", "Reposted thing", likes=999, uri="at://did:9/app.bsky.feed.post/rp"), "reason": {"$type": "repost"}},
        {"post": post("someone.else.social", "did:8", "Not theirs", likes=500, uri="at://did:8/app.bsky.feed.post/no")},
        {"post": post("good.bsky.social", "did:1", "straight guys #lesbian", likes=77, uri="at://did:1/app.bsky.feed.post/ex")},
        {"post": post("good.bsky.social", "did:1", "underage rubbish", likes=88, uri="at://did:1/app.bsky.feed.post/bad")},
        {"post": post("good.bsky.social", "did:1", "Contact bob@example.com #bear", likes=3, uri="at://did:1/app.bsky.feed.post/c")},
    ]}
    net = Net({"searchActors": lambda r: actors, "getAuthorFeed": lambda r: feed})
    crawler = make_crawler(repo, net, max_pages=40, per_source_share=0.1)   # cap 4 -> 2 catalog pages
    report = run(crawler.run_once(only="bluesky"))
    assert net.count("getAuthorFeed") == 1 and "filter=posts_with_media" in net.seen[-1]
    c = repo.list(platform="bluesky")["creators"][0]
    assert c["followers"] == 10 and c["likeCount"] == 55 and c["mediaCount"] == 3 and c["lastSeenAt"] == "2026-09-02T10:00:00Z"
    labels = [(l["label"], l["url"]) for l in c["profileLinks"][1:]]
    assert labels[0] == ("Top set #bear #gaymuscle", "https://bsky.app/profile/good.bsky.social/post/top")
    urls = [u for _l, u in labels]
    assert not any(u.endswith(("/rp", "/no", "/ex", "/bad")) for u in urls)
    assert all("@" not in l for l, _u in labels)
    assert {"bear", "gaymuscle"} <= set(c["discoveryTags"]) and report.pages >= 2
    assert repo.next_seeds("bluesky", 10) == []                            # sampled once, marked crawled


def reset_seeds(repo):
    with repo.connect() as conn:
        conn.execute("UPDATE creator_seed_queue SET crawled_at = NULL")
        conn.commit()


def test_author_feed_failures_are_soft(repo, monkeypatch):
    monkeypatch.setattr(L, "BLUESKY_QUERIES", ("gay 18+",))
    actors = {"actors": [{"did": "did:1", "handle": "good.bsky.social", "description": "18+"}]}
    for feed in (lambda r: httpx.Response(400, json={}), lambda r: httpx.Response(404), lambda r: {"nothing": 1}, lambda r: {"feed": []}):
        net = Net({"searchActors": lambda r: actors, "getAuthorFeed": feed})
        report = run(make_crawler(repo, net, max_pages=40).run_once(only="bluesky"))
        assert report.state == "ok" and repo.list(platform="bluesky")["total"] == 1 and net.count("getAuthorFeed") == 1
        reset_seeds(repo)
    net = Net({"searchActors": lambda r: actors, "getAuthorFeed": lambda r: httpx.Response(500)})
    report = run(make_crawler(repo, net, max_pages=40).run_once(only="bluesky"))
    assert report.state == "partial" and any("bluesky:catalog:http_500" in e for e in report.errors)


# ── Mastodon: Link pagination ────────────────────────────────────────────────


def status(i, acct="bear"):
    return {"sensitive": True, "account": {"acct": acct, "url": f"https://mastodon.social/@{acct}", "display_name": acct.title()},
            "tags": [{"name": "gaynsfw"}], "favourites_count": 1, "created_at": "2026-05-01T10:00:00.000Z", "id": str(i)}


def link(url: str, rel: str = "next") -> str:
    return f'<{url}>; rel="{rel}"'


def test_link_header_parsing_and_validation():
    base = "https://mastodon.social/api/v1/timelines/tag/gaynsfw"
    header = f'<{base}?min_id=9>; rel="prev", <{base}?max_id=5>; rel="next"'
    assert next_link(header, "mastodon.social", "/api/v1/timelines/tag/") == f"{base}?max_id=5"
    assert next_link(link(base + "?max_id=1"), "mastodon.social", "/api/v1/timelines/tag/") == base + "?max_id=1"
    for bad in (link("https://evil.example/api/v1/timelines/tag/gaynsfw?max_id=1"), link("http://mastodon.social/api/v1/timelines/tag/x"),
                link("https://mastodon.social/other/path"), link("https://u:p@mastodon.social/api/v1/timelines/tag/x"),
                link("https://mastodon.social:8443/api/v1/timelines/tag/x"), link(base, "prev"), "garbage", "", None):
        assert next_link(bad, "mastodon.social", "/api/v1/timelines/tag/") is None, bad


def test_mastodon_follows_next_links_up_to_the_cap(repo, monkeypatch):
    monkeypatch.setenv("MASTODON_TAG_PAGES", "3")
    pages = {}

    def timeline(r):
        n = int(qs(r).get("max_id", "0"))
        pages[n] = pages.get(n, 0) + 1
        nxt = f"https://mastodon.social/api/v1/timelines/tag/gaynsfw?max_id={n + 1}"
        return httpx.Response(200, json=[status(f"{n}-1", f"user{n}a"), status(f"{n}-2", f"user{n}b")], headers={"link": link(nxt)})

    net = Net({"/api/v1/timelines/tag/gaynsfw": timeline})
    report = run(make_crawler(repo, net, max_pages=40).run_once(only="mastodon"))
    assert net.count("/timelines/tag/") == 3 and report.pages == 3                # cap = 3 pages per unit
    assert {c["username"] for c in repo.list()["creators"]} == {f"user{n}{s}@mastodon.social" for n in range(3) for s in "ab"}
    assert report.yields["mastodon"] == {"requests": 3, "new": 6, "upserted": 6}


def test_mastodon_pagination_respects_the_run_budget_and_stops_at_the_last_page(repo):
    nxt = lambda n: f"https://mastodon.social/api/v1/timelines/tag/gaynsfw?max_id={n}"  # noqa: E731
    net = Net({"/api/v1/timelines/tag/gaynsfw": lambda r: httpx.Response(200, json=[status(1)], headers={"link": link(nxt(int(qs(r).get('max_id', '0')) + 1))})})
    # per-source cap = int(10 * 0.1) = 1 page: pagination may not exceed the budget even though links continue
    report = run(make_crawler(repo, net, max_pages=10).run_once(only="mastodon"))
    assert net.count("/timelines/tag/") == 1 and report.pages == 1
    # no Link header -> a single request
    net2 = Net({"/api/v1/timelines/tag/gaynsfw": [status(1)]})
    run(make_crawler(repo, net2, max_pages=40).run_once(only="mastodon"))
    assert net2.count("/timelines/tag/") == 1
    # a foreign next link is never followed
    net3 = Net({"/api/v1/timelines/tag/gaynsfw": httpx.Response(200, json=[status(2)], headers={"link": link("https://evil.example/api/v1/timelines/tag/x")})})
    run(make_crawler(repo, net3, max_pages=40).run_once(only="mastodon"))
    assert net3.count("evil.example") == 0 and net3.count("/timelines/tag/") == 1


def test_extra_mastodon_instances_come_from_env_and_are_validated(monkeypatch):
    monkeypatch.setenv("MASTODON_EXTRA_INSTANCES", "a.example.org, B.Example.org 127.0.0.1 localhost evil.coomer.su bad_host https://x.example")
    assert L.mastodon_instances() == ("mastodon.social", "a.example.org", "b.example.org")
    monkeypatch.setenv("LEMMY_EXTRA_INSTANCES", "lemmy.example.org")
    monkeypatch.setenv("PEERTUBE_EXTRA_HOSTS", "peer.example.org")
    assert L.lemmy_instances() == ("lemmynsfw.com", "lemmy.example.org") and L.peertube_hosts() == ("sepiasearch.org", "peer.example.org")
    units = MastodonSource(None).units
    assert {u.instance for u in units} == {"mastodon.social", "a.example.org", "b.example.org"}
    assert MastodonSource.lane_key(MastodonUnit("a.example.org", "GayNSFW")) == "mastodon:a.example.org/gaynsfw"


# ── Lemmy: community discovery ───────────────────────────────────────────────


def community(name, nsfw=True, subs=100, **over):
    comm = {"id": 1, "name": name, "title": over.pop("title", name.title()), "nsfw": nsfw, "actor_id": f"https://lemmynsfw.com/c/{name}"}
    comm.update(over)
    return {"community": comm, "counts": {"subscribers": subs}}


def lemmy_post(name, community_name, nsfw=True):
    return {"post": {"nsfw": nsfw, "published": "2026-04-01T00:00:00.000000Z"}, "creator": {"name": name, "display_name": name.title(),
            "actor_id": f"https://lemmynsfw.com/u/{name}"}, "community": {"name": community_name, "nsfw": nsfw}, "counts": {"score": 7}}


def lemmy_net(communities, posts, seen_posts=None):
    def search(r):
        return {"communities": communities} if qs(r).get("type_") == "Communities" else {"posts": []}

    def listing(r):
        if seen_posts is not None:
            seen_posts.append(qs(r)["community_name"])
        return {"posts": posts.get(qs(r)["community_name"], [])}

    return Net({"/api/v3/search": search, "/api/v3/post/list": listing})


def test_lemmy_discovers_nsfw_communities_and_crawls_their_new_posts(repo, monkeypatch):
    monkeypatch.setattr(L, "LEMMY_COMMUNITY_QUERIES", ("gay",))
    comms = [
        community("gaybears", title="Gay Bears"), community("sfwgay", nsfw=False), community("femgay", title="Female and gay"),
        community("gaygone", removed=True), community("minorgay", title="Gay minor"), community("cats", title="Cats"),
        community("remote", actor_id="https://lemmy.world/c/remote", title="Men Remote"), "junk",
    ]
    seen: list[str] = []
    net = lemmy_net(comms, {"gaybears": [lemmy_post("lem", "gaybears"), lemmy_post("sfw", "gaybears", nsfw=False)],
                            "remote@lemmy.world": [lemmy_post("rem", "remote")]}, seen)
    crawler = make_crawler(repo, net, max_pages=40, lemmy_max_communities=6)
    report = run(crawler.run_once(only="lemmy"))
    found = {d["payload"]["community"]: d for d in crawler.adaptive.discovered_lanes("lemmy", "community")}
    assert set(found) == {"gaybears", "remote@lemmy.world"} and found["gaybears"]["payload"]["instance"] == "lemmynsfw.com"
    assert "Communities" in net.seen[0] and report.state in {"ok", "partial"}
    run(crawler.run_once(only="lemmy"))                                  # next run crawls the discovered communities' new posts
    assert {"gaybears", "remote@lemmy.world"} <= set(seen)
    posts_req = [u for u in net.seen if "/post/list" in u][0]
    assert "sort=New" in posts_req and "community_name=" in posts_req
    names = {c["username"] for c in repo.list(platform="lemmy")["creators"]}
    assert "lem@lemmynsfw.com" in names and "sfw@lemmynsfw.com" not in names


def test_lemmy_caps_communities_per_run_and_soft_fails(repo, monkeypatch):
    store = AdaptiveStore(repo.connect)
    for i in range(5):
        store.upsert_lane("lemmy", f"lemmynsfw.com/gayc{i}", "community", {"instance": "lemmynsfw.com", "community": f"gayc{i}"}, now=1_700_000_000 + i)
    seen: list[str] = []
    net = lemmy_net([], {}, seen)
    run(make_crawler(repo, net, max_pages=60, lemmy_max_communities=2).run_once(only="lemmy"))
    assert len(seen) == 2                                                  # at most N communities per run, even with budget left
    assert seen == ["gayc0", "gayc1"]
    for failure in (lambda r: httpx.Response(404), lambda r: httpx.Response(200, text="x"), lambda r: {"communities": "weird"}, lambda r: httpx.Response(500)):
        monkeypatch.setattr(L, "LEMMY_COMMUNITY_QUERIES", ("gay",))
        report = run(make_crawler(repo, Net({"/api/v3/search": failure, "/api/v3/post/list": failure}), max_pages=60).run_once(only="lemmy"))
        assert report.state in {"ok", "partial"}
    assert LemmySource.lane_key(LemmyCommunityUnit("a.example", "Name@b.example")) == "lemmy:c:a.example/name@b.example"
    assert LemmySource.lane_key(LemmyDiscoverUnit("a.example", "Gay")) == "lemmy:discover:a.example/gay"


# ── PeerTube: tag / category browse ──────────────────────────────────────────


def test_peertube_tag_and_category_browse_parameters(repo, monkeypatch):
    monkeypatch.setattr(L, "PEERTUBE_TAGS", ("bear",))
    monkeypatch.setattr(L, "PEERTUBE_CATEGORIES", (4,))
    monkeypatch.setattr(L, "PEERTUBE_CATEGORY_QUERIES", ("gay",))
    rows = {"data": [{"nsfw": True, "views": 10, "likes": 2, "publishedAt": "2026-03-03T03:03:03.000Z", "tags": ["gay"],
                      "channel": {"name": "chan", "displayName": "Chan", "host": "peertube.example",
                                  "url": "https://peertube.example/video-channels/chan@peertube.example"}},
                     {"nsfw": False, "channel": {"name": "sfw", "host": "peertube.example"}}]}
    net = Net({"/api/v1/search/videos": lambda r: rows})
    report = run(make_crawler(repo, net, max_pages=60).run_once(only="peertube"))
    params = [qs(httpx.Request("GET", u)) for u in net.seen]
    assert any(p.get("tagsOneOf") == "bear" and p["nsfw"] == "true" for p in params)
    assert any(p.get("categoryOneOf") == "4" and p["search"] == "gay" for p in params)
    assert all(u.startswith("https://sepiasearch.org/api/v1/search/videos?") for u in net.seen)
    assert [c["username"] for c in repo.list(platform="peertube")["creators"]] == ["chan@peertube.example"]
    assert report.yields["peertube"]["new"] == 1
    src = PeerTubeSource(None)
    assert src.lane_key(PeerTubeUnit("h", "bear", tag="bear")) == "peertube:h/tag:bear"
    assert src.lane_key(PeerTubeUnit("h", "gay", category=4)) == "peertube:h/cat:4:gay"
    assert src.lane_key(PeerTubeUnit("h", "Gay Bear")) == "peertube:h/q:gay bear"


# ── lane lists stay in sync with the edge ────────────────────────────────────


def test_python_lanes_mirror_the_edge_discovery_lanes():
    text = (ROOT / "frontend/api/_lib/discovery-lanes.ts").read_text()
    block = text[text.index("export const DISCOVERY_LANES"):text.index("export const PROVIDER_PAGE_SIZE")]
    edge = re.findall(r"\b(core|best)\('([^']+)'(?:,\s*(\d+))?\)", block)
    assert len(edge) >= 34
    py = [(lane.tier, lane.tag) for lane in L.REDGIFS_LANES]
    py_edge = [("core" if t == "core" else "best", tag) for t, tag, _ in edge]
    mapped = [("core" if t == "core" else "best", tag) for t, tag in py]
    # every edge lane exists in the backend list with the same tier, in the same relative order
    positions = [mapped.index(item) for item in py_edge]
    assert positions == sorted(positions), "backend lane order must follow the edge order"
    tags = [tag for _t, tag in py]
    assert len(tags) == len(set(tags))


# ── idempotent migrations ────────────────────────────────────────────────────


def test_schema_migration_is_idempotent_and_upgrades_old_tables(tmp_path):
    path = tmp_path / "old.db"
    raw = sqlite3.connect(path)
    raw.executescript("""
        CREATE TABLE creator_index (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, handle TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '', avatar_url TEXT NOT NULL DEFAULT '', profile_url TEXT NOT NULL DEFAULT '',
            followers INTEGER, media_count INTEGER NOT NULL DEFAULT 0, view_count INTEGER NOT NULL DEFAULT 0,
            like_count INTEGER NOT NULL DEFAULT 0, curation_score INTEGER NOT NULL DEFAULT 0, tags_json TEXT NOT NULL DEFAULT '{}',
            first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL DEFAULT '', last_crawled_at TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT '', sample_media_json TEXT NOT NULL DEFAULT '[]', hidden INTEGER NOT NULL DEFAULT 0,
            UNIQUE (platform, handle));
        CREATE TABLE creator_crawl_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
            source TEXT NOT NULL DEFAULT 'all', lane TEXT NOT NULL DEFAULT '', pages INTEGER NOT NULL DEFAULT 0,
            creators_upserted INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'running');
        INSERT INTO creator_index (platform, handle, first_seen_at, last_crawled_at) VALUES ('redgifs', 'old', 'x', 'y');
        INSERT INTO creator_crawl_runs (started_at, state) VALUES ('2026-01-01T00:00:00Z', 'ok');
    """)
    raw.commit()
    raw.close()
    db = Database(path, timeout_seconds=5, busy_timeout_ms=5000)
    for _ in range(3):
        db.init()
    with db.connect() as conn:
        for _ in range(2):
            ensure_creator_index_schema(conn)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(creator_index)")}
        runs = {r[1] for r in conn.execute("PRAGMA table_info(creator_crawl_runs)")}
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        old = conn.execute("SELECT attribution, links_json FROM creator_index").fetchone()
    assert {"attribution", "links_json", "hidden"} <= cols and {"new_creators", "requests", "yield_json"} <= runs
    assert {"submitted_feeds", "takedown_requests", "creator_suppressions", "creator_lane_stats", "creator_tag_freq",
            "creator_discovered_lanes"} <= tables
    assert tuple(old) == ("", "[]")
    repo = CreatorIndexRepository(db.connect)
    assert repo.list()["creators"][0]["sourceAttribution"].startswith("Public source metadata")   # old rows still read fine
    assert repo.recent_runs()[0]["newCreators"] == 0 and repo.recent_runs()[0]["yield"] == {}


def test_concurrent_initialisers_tolerate_a_column_added_first(tmp_path):
    """Another initialiser adds the column between our PRAGMA check and our ALTER: the duplicate-column error is ignored."""
    from app.creator_index import schema

    db = Database(tmp_path / "race.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()

    class StaleConn:
        def __init__(self, conn):
            self.conn = conn

        def execute(self, sql, *args):
            if sql.startswith("PRAGMA table_info(creator_index)"):
                return [(0, "id"), (1, "platform")]                       # stale view: no new columns yet
            if sql.startswith("ALTER TABLE creator_index ADD COLUMN"):
                raise sqlite3.OperationalError("duplicate column name: attribution")
            return self.conn.execute(sql, *args)

    with db.connect() as conn:
        schema._ensure_columns(StaleConn(conn))  # must not raise
        class Broken(StaleConn):
            def execute(self, sql, *args):
                if sql.startswith("ALTER TABLE creator_index ADD COLUMN"):
                    raise sqlite3.OperationalError("disk I/O error")
                return super().execute(sql, *args)

        with pytest.raises(sqlite3.OperationalError):
            schema._ensure_columns(Broken(conn))                            # any other failure still surfaces


def test_json_response_headers_default_is_backwards_compatible():
    assert JsonResponse(200, {}).headers == {} and JsonResponse(200, {"a": 1}).ok
    assert isinstance(GuardedFetcher(HttpxFetcher(httpx.AsyncClient(transport=httpx.MockTransport(Net())))), GuardedFetcher)
