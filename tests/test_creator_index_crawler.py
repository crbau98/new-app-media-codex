"""Crawler with mocked httpx transports (no network): sources, soft failures,
circuit breaker, budgets, resumable cursors, hygiene rules, SSRF helper wiring."""

from __future__ import annotations

import asyncio
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.creator_index import lanes as L
from app.creator_index.crawler import Budget, CrawlConfig, CreatorCrawler
from app.creator_index.fetcher import GuardedFetcher, HttpxFetcher, SafeFetcher, SourceError
from app.creator_index.repository import CreatorIndexRepository
from app.creator_index.sources import BlueskySource, LemmySource, MastodonSource, PeerTubeSource, aggregate_redgifs
from app.db import Database


_ORIG_PLAN = L.plan_redgifs_units


@pytest.fixture()
def repo(tmp_path):
    db = Database(tmp_path / "c.db", timeout_seconds=5, busy_timeout_ms=5000)
    db.init()
    return CreatorIndexRepository(db.connect)


def gif(gid, user, **over):
    item = {
        "id": gid, "userName": user, "description": f"clip {gid}", "tags": ["Gay", "Bear"], "duration": 12,
        "width": 1080, "height": 1920, "likes": 5, "views": 100, "createDate": 1_790_000_000,
        "urls": {"hd": f"https://media.redgifs.com/{gid}.mp4", "sd": f"https://media.redgifs.com/{gid}-m.mp4",
                 "poster": f"https://media.redgifs.com/{gid}-p.jpg", "thumbnail": f"https://thumbs44.redgifs.com/{gid}-t.jpg"},
    }
    item.update(over)
    return item


class Net:
    """Programmable mock network; records every request."""

    def __init__(self, routes=None):
        self.routes = routes or {}
        self.seen: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.seen.append(url)
        for prefix, responder in self.routes.items():
            if prefix in url:
                out = responder(request)
                if isinstance(out, Exception):
                    raise out
                return out if isinstance(out, httpx.Response) else httpx.Response(200, json=out)
        return httpx.Response(404, json={})

    def count(self, part: str) -> int:
        return sum(1 for u in self.seen if part in u)


def make_crawler(repo, net, **cfg):
    client = httpx.AsyncClient(transport=httpx.MockTransport(net))

    async def no_sleep(_s):
        return None

    fetcher = GuardedFetcher(HttpxFetcher(client), min_interval=0, jitter=0, sleep=no_sleep, failure_threshold=3)
    config = CrawlConfig(**{"max_pages": 12, "max_seconds": 30, **cfg})
    return CreatorCrawler(repo, fetcher=fetcher, config=config)


@pytest.fixture(autouse=True)
def small_lanes(monkeypatch):
    units = [L.RedgifsUnit("Gay", "trending", 1), L.RedgifsUnit("Twink", "trending", 1), L.RedgifsUnit("Bear", "recent", 1)]
    monkeypatch.setattr(L, "plan_redgifs_units", lambda *a, **k: list(units))
    monkeypatch.setattr(L, "BLUESKY_QUERIES", ("gay 18+",))
    monkeypatch.setattr(L, "MASTODON_TAGS", ("gaynsfw",))
    monkeypatch.setattr(L, "MASTODON_INSTANCES", ("mastodon.social",))
    monkeypatch.setattr(L, "LEMMY_QUERIES", ("gay",))
    monkeypatch.setattr(L, "LEMMY_INSTANCES", ("lemmynsfw.com",))
    monkeypatch.setattr(L, "PEERTUBE_QUERIES", ("gay",))


def redgifs_routes(search):
    return {
        "/auth/temporary": lambda r: {"token": "tok"},
        "/gifs/search": search,
    }


def search_by_tag(table):
    return lambda r: {"gifs": table.get(parse_qs(urlsplit(str(r.url)).query)["tags"][0], [])}


# ── lane plan ────────────────────────────────────────────────────────────────


def test_default_lanes_mirror_edge_and_extend():
    tags = [lane.tag for lane in L.REDGIFS_LANES]
    for t in ("Gay", "Gay Porn", "Twink", "Bear", "Muscle", "Jock", "Daddy", "Hunk", "Otter", "Gay Solo"):
        assert t in tags
    assert len(tags) > 40 and len(set(tags)) == len(tags)
    units = _ORIG_PLAN()
    assert units == _ORIG_PLAN() and units[0].page == 1
    first_p2 = next(i for i, u in enumerate(units) if u.page == 2)
    assert {u.tag for u in units[:first_p2]} == set(tags)  # breadth before depth


# ── redgifs mapping & hygiene ────────────────────────────────────────────────


def test_redgifs_aggregation_hygiene():
    gifs = [
        gif("a1", "TopGuy", views=500, description="mail me at bob@example.com or +1 (555) 123-4567"),
        gif("a2", "TopGuy", views=50),
        gif("b1", "Excluded", tags=["Gay", "Female"]),                        # excluded marker in tags -> item dropped
        gif("c1", "Captioned", description="straight guy gets a massage"),    # description is not checked
        gif("d1", "BadHost", urls={"hd": "https://evil.example.com/x.mp4", "poster": "https://media.redgifs.com/p.jpg"}),
        gif("e1", "HttpOnly", urls={"hd": "http://media.redgifs.com/x.mp4", "poster": "http://media.redgifs.com/p.jpg"}),
        gif("f1", "Public creator"),
        gif("g1", "mail@example.com"),
        gif("h1", "Girlfriend_fan"),                                          # marker token in userName
        "not-a-dict",
    ]
    by = {o.handle: o for o in aggregate_redgifs(gifs, "Twink")}
    assert set(by) == {"topguy", "captioned"}
    top = by["topguy"]
    assert top.media_count == 2 and top.view_count == 550 and top.display_name == "TopGuy"
    assert top.tags["twink"] == 2 and top.tags["gay"] == 2
    first = top.sample_media[0]
    assert first["id"] == "rg-a1" and first["views"] == 500 and first["aspect"] == round(1080 / 1920, 4)
    assert "@" not in first["title"] and "555" not in first["title"]
    assert first["thumbnail"].startswith("https://thumbs44.redgifs.com/")
    assert first["streamCandidates"] == ["https://media.redgifs.com/a1.mp4", "https://media.redgifs.com/a1-m.mp4"]
    assert first["pageUrl"] == "https://www.redgifs.com/watch/a1" and first["posterUrl"]
    assert top.avatar_url.startswith("https://thumbs44.redgifs.com/")
    assert top.profile_url == "https://www.redgifs.com/users/topguy"


# ── full run ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_persists_creators_and_snowballs(repo):
    net = Net(redgifs_routes(search_by_tag({"Gay": [gif("a1", "alpha"), gif("a2", "beta")], "Twink": [gif("a3", "alpha")]})))
    net.routes["/users/"] = lambda r: {"total": 321, "gifs": [gif("z1", "alpha"), gif("z2", "alpha", views=9000)]}
    crawler = make_crawler(repo, net)
    report = await crawler.run_once(only="redgifs")
    assert report.state in {"ok", "partial"} and report.pages >= 4 and report.run_id
    listing = repo.list(limit=50)
    by = {c["username"]: c for c in listing["creators"]}
    assert set(by) == {"alpha", "beta"}
    # catalog refresh (seed queue) made the count authoritative
    assert by["alpha"]["mediaCount"] == 321 and by["alpha"]["viewCount"] >= 9000
    assert net.count("/users/alpha/search") == 1 and net.count("/users/beta/search") == 1
    assert repo.next_seeds("redgifs", 10) == []
    runs = repo.recent_runs()
    assert runs[0]["pages"] == report.pages and runs[0]["state"] == report.state
    assert all(u.startswith("https://api.redgifs.com/") for u in net.seen)
    # bearer token used for provider calls
    assert repo.stats()["total"] == 2


@pytest.mark.asyncio
async def test_each_federated_source_maps_and_filters(repo):
    bsky = {"actors": [
        {"did": "did:1", "handle": "good.bsky.social", "displayName": "Good Guy", "description": "18+ gay creator #bear #muscle",
         "followersCount": 12},
        {"did": "did:2", "handle": "no-adult.bsky.social", "displayName": "Plain", "description": "I like bikes"},
        {"did": "did:3", "handle": "excluded.bsky.social", "displayName": "Lesbian Hub", "description": "18+ nsfw"},
        {"did": "did:4", "handle": "labelled.bsky.social", "displayName": "Labelled", "description": "",
         "labels": [{"src": "did:4", "val": "porn"}]},
        {"did": "did:5", "handle": "spoof.bsky.social", "displayName": "Spoof", "labels": [{"src": "did:other", "val": "porn"}]},
    ]}
    masto = [
        {"sensitive": True, "account": {"acct": "bear", "url": "https://mastodon.social/@bear", "display_name": "Bear",
                                        "followers_count": 9}, "tags": [{"name": "GayNSFW"}, {"name": "bear"}],
         "favourites_count": 4, "created_at": "2026-05-01T10:00:00.000Z"},
        {"sensitive": False, "account": {"acct": "plain", "url": "https://mastodon.social/@plain"}, "tags": []},
        {"sensitive": True, "account": {"acct": "locked", "url": "https://mastodon.social/@locked", "locked": True}, "tags": []},
        {"sensitive": True, "account": {"acct": "noidx", "url": "https://mastodon.social/@noidx", "noindex": True}, "tags": []},
        {"sensitive": True, "account": {"acct": "robot", "url": "https://mastodon.social/@robot", "bot": True}, "tags": []},
        {"sensitive": True, "account": {"acct": "x", "url": "https://mastodon.social/@x", "display_name": "x"}, "tags": [{"name": "women"}]},
    ]
    lemmy = {"posts": [
        {"post": {"nsfw": True, "published": "2026-04-01T00:00:00.000000Z"}, "creator": {"name": "lem", "display_name": "Lem",
         "actor_id": "https://lemmynsfw.com/u/lem"}, "community": {"name": "gaybears"}, "counts": {"score": 7}},
        {"post": {"nsfw": False}, "creator": {"name": "sfw", "actor_id": "https://lemmynsfw.com/u/sfw"}, "community": {}},
        {"post": {"nsfw": True}, "creator": {"name": "bot", "bot_account": True, "actor_id": "https://lemmynsfw.com/u/bot"}},
    ]}
    peer = {"data": [
        {"nsfw": True, "views": 10, "likes": 2, "publishedAt": "2026-03-03T03:03:03.000Z", "tags": ["gay"],
         "channel": {"name": "chan", "displayName": "Chan", "host": "peertube.example", "url": "https://peertube.example/video-channels/chan@peertube.example"}},
        {"nsfw": False, "channel": {"name": "sfwchan", "host": "peertube.example"}},
    ]}
    net = Net({
        "public.api.bsky.app": lambda r: bsky, "/api/v1/timelines/tag/": lambda r: masto,
        "/api/v3/search": lambda r: lemmy, "/api/v1/search/videos": lambda r: peer,
    })
    crawler = make_crawler(repo, net, max_pages=20)
    for name in ("bluesky", "mastodon", "lemmy", "peertube"):
        await crawler.run_once(only=name)
    by = {(c["platform"], c["username"]): c for c in repo.list(limit=50)["creators"]}
    assert set(by) == {
        ("Bluesky", "good.bsky.social"), ("Bluesky", "labelled.bsky.social"), ("Mastodon", "bear@mastodon.social"),
        ("Lemmy", "lem@lemmynsfw.com"), ("PeerTube", "chan@peertube.example"),
    }
    g = by[("Bluesky", "good.bsky.social")]
    assert g["followers"] == 12 and {"bear", "muscle"} <= set(g["discoveryTags"])
    assert g["profileUrl"] == "https://bsky.app/profile/good.bsky.social" and g["media"] == [] and g["avatar"] == ""
    m = by[("Mastodon", "bear@mastodon.social")]
    assert m["likeCount"] == 4 and m["followers"] == 9 and m["lastSeenAt"] == "2026-05-01T10:00:00Z"
    assert by[("Lemmy", "lem@lemmynsfw.com")]["likeCount"] == 7
    assert by[("PeerTube", "chan@peertube.example")]["viewCount"] == 10


# ── failures ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [
    lambda r: httpx.Response(500), lambda r: httpx.Response(429), lambda r: httpx.ConnectTimeout("slow"),
    lambda r: httpx.Response(403, json={}), lambda r: httpx.Response(200, text="<html>not json</html>"),
    lambda r: httpx.Response(200, json={"gifs": "weird"}),
])
async def test_source_failures_are_soft(repo, failure):
    net = Net(redgifs_routes(failure))
    report = await make_crawler(repo, net).run_once(only="redgifs")
    assert report.state in {"ok", "partial"} and repo.list()["total"] == 0  # never raised


@pytest.mark.asyncio
async def test_auth_failure_stops_redgifs_but_not_others(repo):
    net = Net({"/auth/temporary": lambda r: httpx.Response(503),
               "public.api.bsky.app": lambda r: {"actors": [{"did": "d", "handle": "a.bsky.social", "description": "18+"}]}})
    report = await make_crawler(repo, net).run_once()
    assert any("redgifs" in e for e in report.errors)
    assert repo.list(platform="bluesky")["total"] == 1


@pytest.mark.asyncio
async def test_circuit_breaker_opens_and_stops_hammering(repo, monkeypatch):
    units = [L.RedgifsUnit("T%d" % i, "trending", 1) for i in range(10)]
    monkeypatch.setattr(L, "plan_redgifs_units", lambda *a, **k: units)
    net = Net({"/auth/temporary": lambda r: {"token": "t"}, "/gifs/search": lambda r: httpx.Response(500)})
    crawler = make_crawler(repo, net, max_pages=30)
    report = await crawler.run_once(only="redgifs")
    # failure_threshold=3: exactly 3 real calls hit the host, the 4th is rejected locally
    assert net.count("/gifs/search") == 3
    assert any("circuit_open" in e for e in report.errors)
    assert repo.get_state("cursor:redgifs") == 3  # cursor stays on the unit that hit the open breaker
    before = net.count("/gifs/search")
    await crawler.run_once(only="redgifs")  # breaker still open (recovery 300s): no new calls
    assert net.count("/gifs/search") == before


@pytest.mark.asyncio
async def test_page_budget_and_resume_cursor(repo, monkeypatch):
    units = [L.RedgifsUnit(f"T{i}", "trending", 1) for i in range(7)]
    monkeypatch.setattr(L, "plan_redgifs_units", lambda *a, **k: units)
    net = Net(redgifs_routes(lambda r: {"gifs": []}))
    crawler = make_crawler(repo, net, max_pages=10, catalog_share=0.0, per_source_share=0.1)
    # redgifs lane cap = 10 - 0 - 4*1 = 6 pages per run
    await crawler.run_once(only="redgifs")
    tags_run1 = [parse_qs(urlsplit(u).query)["tags"][0] for u in net.seen if "/gifs/search" in u]
    assert tags_run1 == ["T0", "T1", "T2", "T3", "T4", "T5"] and repo.get_state("cursor:redgifs") == 6
    net.seen.clear()
    await crawler.run_once(only="redgifs")  # resumes at T6, wraps around
    tags_run2 = [parse_qs(urlsplit(u).query)["tags"][0] for u in net.seen if "/gifs/search" in u]
    assert tags_run2[:3] == ["T6", "T0", "T1"] and repo.get_state("cursor:redgifs") == 5
    # a fresh crawler object (process restart) continues from the persisted cursor
    net.seen.clear()
    await make_crawler(repo, net, max_pages=10, catalog_share=0.0).run_once(only="redgifs")
    assert parse_qs(urlsplit([u for u in net.seen if "/gifs/search" in u][0]).query)["tags"][0] == "T5"


def test_budget_time_limit():
    now = [0.0]
    budget = Budget(100, 10.0, clock=lambda: now[0])
    assert not budget.exhausted()
    now[0] = 11.0
    assert budget.exhausted()


@pytest.mark.asyncio
async def test_time_budget_stops_run(repo, monkeypatch):
    units = [L.RedgifsUnit(f"T{i}", "trending", 1) for i in range(20)]
    monkeypatch.setattr(L, "plan_redgifs_units", lambda *a, **k: units)
    now = [0.0]
    net = Net(redgifs_routes(lambda r: (now.__setitem__(0, now[0] + 4.0), {"gifs": []})[1]))
    client = httpx.AsyncClient(transport=httpx.MockTransport(net))
    crawler = CreatorCrawler(repo, fetcher=HttpxFetcher(client), config=CrawlConfig(max_pages=50, max_seconds=10, catalog_share=0.0),
                             clock=lambda: now[0])
    await crawler.run_once(only="redgifs")
    assert net.count("/gifs/search") == 3  # 4s per call, 10s budget


@pytest.mark.asyncio
async def test_single_flight(repo):
    gate = asyncio.Event()

    class Slow:
        async def get_json(self, url, headers=None):
            await gate.wait()
            from app.creator_index.fetcher import JsonResponse
            return JsonResponse(404, None)

    crawler = CreatorCrawler(repo, fetcher=Slow(), config=CrawlConfig(max_pages=2, max_seconds=30))
    first = asyncio.create_task(crawler.run_once(only="bluesky"))
    await asyncio.sleep(0.05)
    assert crawler.running
    second = await crawler.run_once(only="bluesky")
    assert second.skipped and second.state == "skipped"
    gate.set()
    assert not (await first).skipped and not crawler.running


@pytest.mark.asyncio
async def test_run_records_errors_and_survives_unexpected_exceptions(repo):
    class Boom:
        async def get_json(self, url, headers=None):
            raise ValueError("kaboom")

    crawler = CreatorCrawler(repo, fetcher=Boom(), config=CrawlConfig(max_pages=3, max_seconds=30))
    report = await crawler.run_once(only="bluesky")
    assert report.state == "error" and "kaboom" in report.errors[0]
    assert repo.recent_runs()[0]["state"] == "error"


# ── SSRF helper wiring ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unsafe_urls_are_rejected_before_any_request():
    net = Net()
    fetcher = HttpxFetcher(httpx.AsyncClient(transport=httpx.MockTransport(net)))
    for url in ("http://127.0.0.1/x", "http://169.254.169.254/latest", "https://user:pw@example.com/", "ftp://example.com/x",
                "https://localhost/x"):
        with pytest.raises(SourceError) as err:
            await fetcher.get_json(url)
        assert err.value.code == "unsafe_url"
    assert net.seen == []


@pytest.mark.asyncio
async def test_production_fetcher_goes_through_netsafe(monkeypatch):
    calls = []

    class Res:
        status, truncated, body = 200, False, b'{"ok": true}'

    def fake_safe_fetch(url, **kw):
        calls.append((url, kw))
        return Res()

    monkeypatch.setattr("app.creator_index.fetcher.safe_fetch", fake_safe_fetch)
    out = await SafeFetcher().get_json("https://api.redgifs.com/v2/auth/temporary", {"Authorization": "Bearer t"})
    assert out.data == {"ok": True}
    assert calls[0][1]["headers"]["Authorization"] == "Bearer t" and calls[0][1]["max_bytes"] > 0
    # a policy violation surfaces as a soft SourceError
    from app.media_pipeline.netsafe import UnsafeUrlError

    def blocked(url, **kw):
        raise UnsafeUrlError("private_host_blocked")

    monkeypatch.setattr("app.creator_index.fetcher.safe_fetch", blocked)
    with pytest.raises(SourceError):
        await SafeFetcher().get_json("https://api.redgifs.com/x")


@pytest.mark.asyncio
async def test_rate_limit_interval_and_jitter():
    sleeps, now = [], [100.0]

    async def fake_sleep(s):
        sleeps.append(round(s, 3))
        now[0] += s

    class Inner:
        async def get_json(self, url, headers=None):
            from app.creator_index.fetcher import JsonResponse
            return JsonResponse(200, {})

    g = GuardedFetcher(Inner(), min_interval=1.0, jitter=0.0, sleep=fake_sleep, clock=lambda: now[0])
    for _ in range(3):
        await g.get_json("https://a.example/x")
    await g.get_json("https://b.example/x")
    assert sleeps == [1.0, 1.0] and g.requests == 4  # per-host spacing; other host unaffected
