"""Creator index repository: schema migration, merge-safe upsert, keyset pagination, filters, stats."""

from __future__ import annotations

import sqlite3

import pytest

from app.creator_index.repository import CreatorIndexRepository, CreatorObservation, InvalidCursor
from app.db import Database


@pytest.fixture()
def db(tmp_path):
    database = Database(tmp_path / "idx.db", timeout_seconds=5, busy_timeout_ms=5000)
    database.init()
    return database


@pytest.fixture()
def repo(db):
    return CreatorIndexRepository(db.connect)


def media(i: int, views: int = 10, likes: int = 1) -> dict:
    return {"id": f"rg-{i}", "title": f"clip {i}", "thumbnail": f"https://thumbs44.redgifs.com/{i}-t.jpg",
            "views": views, "likes": likes, "createdAt": "2026-01-01T00:00:00Z"}


def obs(handle="alpha", **kw) -> CreatorObservation:
    base = dict(platform="redgifs", handle=handle, display_name=handle.title(), media_count=3, view_count=300,
                like_count=30, tags={"gay": 2, "bear": 1}, last_seen_at="2026-02-01T00:00:00Z", source="redgifs",
                profile_url=f"https://www.redgifs.com/users/{handle}", avatar_url="https://thumbs44.redgifs.com/a.jpg")
    base.update(kw)
    return CreatorObservation(**base)


# ── schema ───────────────────────────────────────────────────────────────────


def test_migration_is_idempotent_and_preserves_data(db, repo):
    repo.upsert([obs("keepme")])
    db.init()
    db.init()
    assert repo.list()["total"] == 1
    with db.connect() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"creator_index", "creator_crawl_runs", "creator_tags", "creator_crawl_state", "creator_seed_queue"} <= tables


def test_migration_on_existing_legacy_db(tmp_path):
    path = tmp_path / "legacy.db"
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE legacy_things (id INTEGER PRIMARY KEY, name TEXT)")
    raw.execute("INSERT INTO legacy_things (name) VALUES ('x')")
    raw.commit()
    raw.close()
    database = Database(path, timeout_seconds=5, busy_timeout_ms=5000)
    database.init()
    with database.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM legacy_things").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM creator_index").fetchone()[0] == 0
        idx = {r[1] for r in conn.execute("PRAGMA index_list(creator_index)")}
    assert "idx_creator_index_platform_seen" in idx and "idx_creator_index_hidden" in idx


# ── upsert / merge ───────────────────────────────────────────────────────────


def test_upsert_merges_without_losing_data(repo):
    repo.upsert([obs("alpha", sample_media=[media(1, 50), media(2, 40)], followers=100)], now="2026-03-01T00:00:00Z")
    # a partial crawl: smaller counts, no avatar/name, different tags, new media
    repo.upsert([obs("alpha", media_count=1, view_count=5, like_count=0, display_name="", avatar_url="",
                     profile_url="", followers=None, tags={"muscle": 1}, last_seen_at="2025-01-01T00:00:00Z",
                     sample_media=[media(3, 60)])], now="2026-03-02T00:00:00Z")
    c = repo.list()["creators"][0]
    assert c["mediaCount"] == 3 and c["viewCount"] == 300 and c["likeCount"] == 30 and c["followers"] == 100
    assert c["name"] == "Alpha" and c["avatar"].startswith("https://thumbs44") and c["profileUrl"]
    assert set(c["discoveryTags"]) == {"gay", "bear", "muscle"}
    assert {m["id"] for m in c["media"]} == {"rg-1", "rg-2", "rg-3"}
    assert c["lastSeenAt"] == "2026-02-01T00:00:00Z"  # never moves backwards
    assert c["observedAt"] == "2026-03-02T00:00:00Z"
    with repo._connect() as conn:  # first_seen preserved
        assert conn.execute("SELECT first_seen_at FROM creator_index").fetchone()[0] == "2026-03-01T00:00:00Z"


def test_authoritative_media_count_replaces_but_views_never_shrink(repo):
    repo.upsert([obs("alpha", media_count=99)])
    repo.upsert([obs("alpha", media_count=40, view_count=1, authoritative=True)])
    c = repo.list()["creators"][0]
    assert c["mediaCount"] == 40 and c["viewCount"] == 300


def test_bounds_on_tags_and_samples(repo):
    repo.upsert([obs("alpha", tags={f"tag{i:02d}": 1 for i in range(100)}, sample_media=[media(i, i) for i in range(20)])])
    repo.upsert([obs("alpha", tags={"zzz": 50}, sample_media=[media(99, 1000)])])
    c = repo.list()["creators"][0]
    assert len(c["media"]) == 6 and c["media"][0]["id"] == "rg-99"
    assert len(c["discoveryTags"]) == 20 and c["discoveryTags"][0] == "zzz"
    with repo._connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM creator_tags WHERE handle='alpha'").fetchone()[0] == 40


def test_creator_shape_and_ids(repo):
    repo.upsert([obs("top_dry"), obs("someone@mastodon.social", platform="mastodon", profile_url="https://mastodon.social/@someone")])
    by_id = {c["id"]: c for c in repo.list()["creators"]}
    assert "creator-topdry" in by_id and "creator-mastodon-someonemastodonsocial" in by_id
    c = by_id["creator-topdry"]
    for key in ("name", "username", "avatar", "platform", "platforms", "profileUrl", "profileLinks", "mediaCount",
                "evidenceCount", "viewCount", "likeCount", "curationScore", "lastSeenAt", "observedAt",
                "discoveryTags", "sourceAttribution", "media", "followers"):
        assert key in c
    assert c["platform"] == "Redgifs" and c["platforms"] == ["Redgifs"] and c["username"] == "top_dry"
    assert c["profileLinks"] == [{"label": "redgifs.com", "url": "https://www.redgifs.com/users/top_dry"}]


def test_invalid_observations_ignored(repo):
    assert repo.upsert([obs("!!!"), CreatorObservation(platform="", handle="x")]) == 0
    assert repo.list()["total"] == 0


# ── pagination / filters / sorts ─────────────────────────────────────────────


def seed(repo, n=25):
    repo.upsert([
        obs(f"user{i:02d}", media_count=i % 7, view_count=(i * 37) % 11 * 100, like_count=i,
            last_seen_at=f"2026-01-{(i % 28) + 1:02d}T00:00:00Z",
            tags={"gay": 1, **({"bear": 1} if i % 2 == 0 else {}), **({"twink": 1} if i % 5 == 0 else {})})
        for i in range(n)
    ])


@pytest.mark.parametrize("sort", ["smart", "newest", "popular", "count"])
def test_keyset_pagination_is_complete_and_duplicate_free(repo, sort):
    seed(repo)
    seen, cursor = [], None
    for _ in range(20):
        page = repo.list(cursor=cursor, limit=6, sort=sort)
        seen += [c["id"] for c in page["creators"]]
        cursor = page["nextCursor"]
        assert page["total"] == 25
        if not cursor:
            break
    assert len(seen) == 25 and len(set(seen)) == 25


def test_sort_orders(repo):
    seed(repo)
    pop = repo.list(sort="popular", limit=96)["creators"]
    assert [c["viewCount"] for c in pop] == sorted((c["viewCount"] for c in pop), reverse=True)
    new = repo.list(sort="newest", limit=96)["creators"]
    assert [c["lastSeenAt"] for c in new] == sorted((c["lastSeenAt"] for c in new), reverse=True)
    cnt = repo.list(sort="count", limit=96)["creators"]
    assert [c["mediaCount"] for c in cnt] == sorted((c["mediaCount"] for c in cnt), reverse=True)


def test_filters(repo):
    seed(repo)
    assert repo.list(tag="bear", limit=96)["total"] == 13
    assert repo.list(tag="#Twink", limit=96)["total"] == 5
    assert repo.list(tag="nothing-like-this")["total"] == 0
    assert repo.list(q="user07")["creators"][0]["username"] == "user07"
    assert repo.list(q="TWINK", limit=96)["total"] == 5  # matches tags too
    assert repo.list(platform="Redgifs", limit=96)["total"] == 25
    assert repo.list(platform="bluesky")["total"] == 0
    repo.upsert([obs("100%_real")])  # LIKE wildcards are escaped
    assert repo.list(q="%")["total"] == 1 and repo.list(q="_")["total"] == 1
    assert repo.list(q="a%z")["total"] == 0


def test_hidden_is_excluded_and_never_reset_by_crawl(repo):
    seed(repo, 3)
    assert repo.set_hidden("redgifs", "user01", True)
    assert repo.list()["total"] == 2
    repo.upsert([obs("user01")])
    assert repo.list()["total"] == 2


def test_sources_breakdown_ignores_platform_filter(repo):
    repo.upsert([obs("a"), obs("b"), obs("c@x.social", platform="mastodon")])
    body = repo.list(platform="mastodon")
    assert body["total"] == 1
    assert {s["platform"]: s["count"] for s in body["sources"]} == {"Redgifs": 2, "Mastodon": 1}


def test_bad_cursors(repo):
    seed(repo, 10)
    page = repo.list(limit=3, sort="smart")
    for bad in ("not-a-cursor!", "e30", "", "a" * 50):
        if bad == "":
            continue
        with pytest.raises(InvalidCursor):
            repo.list(cursor=bad)
    with pytest.raises(InvalidCursor):  # cursor from another sort
        repo.list(cursor=page["nextCursor"], sort="newest")


def test_stats_and_seed_queue_and_state(repo):
    repo.upsert([obs("a"), obs("b", platform="bluesky")])
    rid = repo.start_run("all")
    repo.finish_run(rid, state="ok", pages=2, creators=2, lane="x", errors=[])
    stats = repo.stats()
    assert stats["total"] == 2 and stats["byPlatform"] == {"Redgifs": 1, "Bluesky": 1} and stats["lastCrawlAt"]
    assert repo.enqueue_seeds("redgifs", ["s1", "s2", "s1"], priority=3) == 2
    assert repo.next_seeds("redgifs", 5) == ["s1", "s2"]
    repo.mark_seed_crawled("redgifs", "s1")
    assert repo.next_seeds("redgifs", 5) == ["s2"]
    assert repo.enqueue_seeds("redgifs", ["s1"]) == 0  # recently crawled: not re-queued
    repo.set_state("cursor:x", 7)
    assert repo.get_state("cursor:x") == 7 and repo.get_state("missing", 0) == 0
    assert repo.abandon_stale_runs() == 0
