"""Source adapters: turn official, public, unauthenticated API responses into
``CreatorObservation`` objects. Each adapter soft-fails (SourceError) and never
stores anything from paywalled/leaked-content mirrors.

Privacy posture: federated platforms (Bluesky, Mastodon, Lemmy, PeerTube) only
contribute accounts that self-label adult content (sensitive/NSFW flags or an
explicit 18+ marker), skip locked/bot/noindex accounts, and keep only public
profile metadata (handle, display name, counts, hashtags, profile link).
Media URLs are kept only for allow-listed provider CDNs (Redgifs), so the edge
can proxy them; other platforms are stored as profile leads without media.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlencode, urlsplit

from app.creator_index import lanes as L
from app.creator_index.fetcher import Fetcher, JsonResponse, SourceError
from app.creator_index.hygiene import (
    MAX_SAMPLE_MEDIA,
    canonical,
    clean_handle,
    clean_tag,
    has_contact_info,
    has_excluded_marker,
    redact,
    safe_media_url,
    safe_profile_url,
    to_int,
)
from app.creator_index.repository import CreatorObservation, now_iso

REDGIFS_API = "https://api.redgifs.com/v2"
PROVIDER_PAGE_SIZE = 80
_ADULT_BIO = re.compile(r"(18\s*\+|\bnsfw\b|\badults?\s+only\b|\bminors\s+dni\b|\bmdni\b|🔞|\bexplicit\b|\bxxx\b)", re.I)
_HASHTAG = re.compile(r"#([\w]{2,30})", re.UNICODE)


@dataclass
class UnitResult:
    observations: list[CreatorObservation] = field(default_factory=list)
    pages: int = 1
    #: creators worth a catalog crawl (platform-local handles)
    seeds: list[str] = field(default_factory=list)


def _iso_from_epoch(value: Any) -> str:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return ""
    if n <= 0:
        return ""
    if n > 1_000_000_000_000:
        n /= 1000.0
    try:
        return now_iso(n)
    except (OverflowError, OSError, ValueError):
        return ""


def _iso_from_text(value: Any) -> str:
    text = str(value or "")
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})", text)
    return f"{m.group(1)}T{m.group(2)}Z" if m else ""


def _duration_label(seconds: Any) -> str:
    whole = max(0, int(to_int(seconds)))
    return f"{whole // 60}:{whole % 60:02d}"


def _hashtags(text: str) -> list[str]:
    return [t for t in (clean_tag(h) for h in _HASHTAG.findall(text or "")) if t]


# ── Redgifs ──────────────────────────────────────────────────────────────────


class RedgifsSource:
    name = "redgifs"

    def __init__(self, fetcher: Fetcher):
        self.fetcher = fetcher
        self._token: str | None = None
        self.units = L.plan_redgifs_units()

    async def _auth(self, force: bool = False) -> str:
        if self._token and not force:
            return self._token
        res = await self.fetcher.get_json(f"{REDGIFS_API}/auth/temporary")
        token = str((res.data or {}).get("token") or "") if isinstance(res.data, dict) else ""
        if not res.ok or not token:
            raise SourceError("auth_failed", f"redgifs auth returned {res.status}", res.status)
        self._token = token
        return token

    async def _get(self, url: str) -> JsonResponse:
        token = await self._auth()
        res = await self.fetcher.get_json(url, {"Authorization": f"Bearer {token}"})
        if res.status == 401:
            token = await self._auth(force=True)
            res = await self.fetcher.get_json(url, {"Authorization": f"Bearer {token}"})
        return res

    async def crawl_unit(self, unit: L.RedgifsUnit) -> UnitResult:
        params = urlencode({
            "type": "g", "tags": unit.tag, "count": PROVIDER_PAGE_SIZE, "page": unit.page, "order": unit.order,
        })
        res = await self._get(f"{REDGIFS_API}/gifs/search?{params}")
        gifs = res.data.get("gifs") if isinstance(res.data, dict) else None
        if not res.ok or not isinstance(gifs, list):
            return UnitResult(pages=1)
        obs = aggregate_redgifs(gifs, lane_tag=unit.tag)
        return UnitResult(
            observations=obs,
            pages=1,
            seeds=[o.handle for o in sorted(obs, key=lambda o: -o.media_count)],
        )

    async def crawl_catalog(self, handle: str) -> UnitResult:
        """One creator's top catalog page: refreshes real counts (authoritative media_count)."""
        params = urlencode({"count": PROVIDER_PAGE_SIZE, "page": 1, "order": "top"})
        res = await self._get(f"{REDGIFS_API}/users/{quote(handle, safe='')}/search?{params}")
        if res.status == 404:
            return UnitResult(pages=1)
        gifs = res.data.get("gifs") if isinstance(res.data, dict) else None
        if not res.ok or not isinstance(gifs, list):
            raise SourceError("bad_catalog", f"catalog returned {res.status}", res.status)
        total = to_int(res.data.get("total")) if isinstance(res.data, dict) else 0
        obs = [o for o in aggregate_redgifs(gifs, lane_tag=None) if canonical(o.handle) == canonical(handle)]
        for o in obs:
            o.media_count = max(total, o.media_count)
            o.authoritative = total > 0
        return UnitResult(observations=obs, pages=1)


def _redgifs_eligible(item: dict[str, Any]) -> bool:
    niches = [n if isinstance(n, str) else str((n or {}).get("name") or "") for n in (item.get("niches") or [])]
    return not has_excluded_marker([str(item.get("userName") or ""), *map(str, item.get("tags") or []), *niches])


def map_redgifs_item(item: dict[str, Any], creator: str) -> dict[str, Any] | None:
    """Frontend MediaItem shape with raw (allow-listed) provider URLs."""
    urls = item.get("urls") or {}
    thumb = safe_media_url(urls.get("thumbnail"))
    poster = safe_media_url(urls.get("poster"))
    hd, sd = safe_media_url(urls.get("hd")), safe_media_url(urls.get("sd"))
    gid = str(item.get("id") or "")
    if not gid or not (thumb or poster) or not (hd or sd):
        return None
    tags = [t for t in (clean_tag(t) for t in (item.get("tags") or [])) if t][:12]
    desc = redact(item.get("description"))[:300]
    candidates = [u for u in (hd, sd) if u]
    media: dict[str, Any] = {
        "id": f"rg-{gid}",
        "title": desc or " · ".join(tags[:3]) or f"Video by {creator}",
        "thumbnail": thumb or poster,
        "source": "Redgifs",
        "duration": _duration_label(item.get("duration")),
        "isVideo": True,
        "category": tags[0] if tags else "gay male",
        "creator": creator,
        "tags": tags,
        "rating": 0,
        "createdAt": _iso_from_epoch(item.get("createDate")),
        "views": to_int(item.get("views")),
        "mediaUrl": candidates[0],
        "streamCandidates": candidates,
        "pageUrl": f"https://www.redgifs.com/watch/{quote(gid, safe='')}",
        "likes": to_int(item.get("likes")),
    }
    if poster:
        media["posterUrl"] = poster
    w, h = to_int(item.get("width")), to_int(item.get("height"))
    if w and h:
        media.update({"width": w, "height": h, "aspect": round(w / h, 4)})
    if item.get("duration"):
        media["durationSeconds"] = to_int(item.get("duration"))
    return media


def aggregate_redgifs(gifs: list[Any], lane_tag: str | None) -> list[CreatorObservation]:
    groups: dict[str, list[dict[str, Any]]] = {}
    names: dict[str, str] = {}
    for raw in gifs:
        if not isinstance(raw, dict):
            continue
        name = redact(raw.get("userName"))
        handle = clean_handle(name)
        if not canonical(handle) or name == "Public creator" or has_contact_info(raw.get("userName")):
            continue
        if not _redgifs_eligible(raw) or map_redgifs_item(raw, name) is None:
            continue
        groups.setdefault(handle, []).append(raw)
        names.setdefault(handle, name)
    out: list[CreatorObservation] = []
    for handle, items in groups.items():
        media = [m for m in (map_redgifs_item(i, names[handle]) for i in items) if m]
        media.sort(key=lambda m: (m["views"], m["likes"]), reverse=True)
        tags: dict[str, int] = {}
        for item in items:
            for t in item.get("tags") or []:
                label = clean_tag(t)
                if label:
                    tags[label] = tags.get(label, 0) + 1
        if lane_tag and clean_tag(lane_tag):
            tags[clean_tag(lane_tag)] = tags.get(clean_tag(lane_tag), 0) + len(items)
        newest = max((_iso_from_epoch(i.get("createDate")) for i in items), default="")
        out.append(CreatorObservation(
            platform="redgifs",
            handle=handle,
            display_name=names[handle],
            avatar_url=media[0]["thumbnail"],
            profile_url=f"https://www.redgifs.com/users/{quote(handle, safe='')}",
            media_count=len(items),
            view_count=sum(to_int(i.get("views")) for i in items),
            like_count=sum(to_int(i.get("likes")) for i in items),
            tags=tags,
            last_seen_at=newest,
            source="redgifs",
            sample_media=media[:MAX_SAMPLE_MEDIA],
        ))
    return out


# ── Bluesky (public AppView, unauthenticated actor search) ───────────────────

_ADULT_LABELS = {"porn", "sexual", "nudity", "graphic-media"}


class BlueskySource:
    name = "bluesky"

    def __init__(self, fetcher: Fetcher):
        self.fetcher = fetcher
        self.units = list(L.BLUESKY_QUERIES)

    async def crawl_unit(self, query: str) -> UnitResult:
        params = urlencode({"q": query, "limit": 25})
        res = await self.fetcher.get_json(f"{L.BLUESKY_APPVIEW}/xrpc/app.bsky.actor.searchActors?{params}")
        actors = res.data.get("actors") if isinstance(res.data, dict) else None
        if not res.ok or not isinstance(actors, list):
            return UnitResult(pages=1)
        return UnitResult(observations=[o for o in (self.map_actor(a, query) for a in actors) if o], pages=1)

    @staticmethod
    def map_actor(actor: Any, query: str) -> CreatorObservation | None:
        if not isinstance(actor, dict):
            return None
        handle = clean_handle(str(actor.get("handle") or ""))
        did = str(actor.get("did") or "")
        bio = str(actor.get("description") or "")
        name = redact(actor.get("displayName"))
        if not canonical(handle) or has_contact_info(actor.get("handle")):
            return None
        labels = {
            str(lb.get("val")) for lb in (actor.get("labels") or [])
            if isinstance(lb, dict) and lb.get("src") == did
        }
        if not (labels & _ADULT_LABELS) and not _ADULT_BIO.search(bio):
            return None  # only accounts that self-declare adult content
        tags = _hashtags(bio)
        if has_excluded_marker([handle, name, *tags]):  # structured fields only, not the bio text
            return None
        tag_counts = {t: 1 for t in tags[:10]}
        q_tag = clean_tag(query.replace("18+", "").replace("nsfw", ""))
        if q_tag:
            tag_counts[q_tag] = tag_counts.get(q_tag, 0) + 1
        return CreatorObservation(
            platform="bluesky", handle=handle, display_name=name or handle,
            profile_url=f"https://bsky.app/profile/{quote(handle, safe='.')}",
            followers=to_int(actor["followersCount"]) if "followersCount" in actor else None,
            tags=tag_counts, last_seen_at=_iso_from_text(actor.get("indexedAt")), source="bluesky",
        )


# ── Mastodon (public hashtag timelines) ──────────────────────────────────────


@dataclass(frozen=True)
class MastodonUnit:
    instance: str
    tag: str


class MastodonSource:
    name = "mastodon"

    def __init__(self, fetcher: Fetcher):
        self.fetcher = fetcher
        self.units = [MastodonUnit(i, t) for t in L.MASTODON_TAGS for i in L.MASTODON_INSTANCES]

    async def crawl_unit(self, unit: MastodonUnit) -> UnitResult:
        res = await self.fetcher.get_json(
            f"https://{unit.instance}/api/v1/timelines/tag/{quote(unit.tag, safe='')}?limit=40"
        )
        if not res.ok or not isinstance(res.data, list):
            return UnitResult(pages=1)
        return UnitResult(observations=self.aggregate(res.data, unit), pages=1)

    @staticmethod
    def aggregate(statuses: list[Any], unit: MastodonUnit) -> list[CreatorObservation]:
        groups: dict[str, CreatorObservation] = {}
        for st in statuses:
            if not isinstance(st, dict) or not st.get("sensitive"):
                continue  # only content its author flagged as sensitive
            acct = st.get("account")
            if not isinstance(acct, dict) or acct.get("locked") or acct.get("bot") or acct.get("noindex"):
                continue
            url = safe_profile_url(acct.get("url"))
            host = (urlsplit(url).hostname or unit.instance).lower()
            local = clean_handle(str(acct.get("acct") or acct.get("username") or "").split("@")[0])
            handle = f"{local}@{host}"
            if not canonical(local) or has_contact_info(local):
                continue
            name = redact(acct.get("display_name"))
            tags = [t for t in (clean_tag((x or {}).get("name")) for x in (st.get("tags") or []) if isinstance(x, dict)) if t]
            if has_excluded_marker([local, name, *tags]):
                continue
            ob = groups.get(handle)
            if ob is None:
                ob = groups[handle] = CreatorObservation(
                    platform="mastodon", handle=handle, display_name=name or local, profile_url=url,
                    followers=to_int(acct["followers_count"]) if "followers_count" in acct else None,
                    source="mastodon",
                )
            ob.media_count += 1
            ob.like_count += to_int(st.get("favourites_count"))
            for t in [*tags[:10], clean_tag(unit.tag)]:
                if t:
                    ob.tags[t] = ob.tags.get(t, 0) + 1
            ob.last_seen_at = max(ob.last_seen_at, _iso_from_text(st.get("created_at")))
        return list(groups.values())


# ── Lemmy (public search API) ────────────────────────────────────────────────


@dataclass(frozen=True)
class LemmyUnit:
    instance: str
    query: str


class LemmySource:
    name = "lemmy"

    def __init__(self, fetcher: Fetcher):
        self.fetcher = fetcher
        self.units = [LemmyUnit(i, q) for q in L.LEMMY_QUERIES for i in L.LEMMY_INSTANCES]

    async def crawl_unit(self, unit: LemmyUnit) -> UnitResult:
        params = urlencode({"q": unit.query, "type_": "Posts", "sort": "TopMonth", "limit": 40, "listing_type": "All"})
        res = await self.fetcher.get_json(f"https://{unit.instance}/api/v3/search?{params}")
        posts = res.data.get("posts") if isinstance(res.data, dict) else None
        if not res.ok or not isinstance(posts, list):
            return UnitResult(pages=1)
        return UnitResult(observations=self.aggregate(posts, unit), pages=1)

    @staticmethod
    def aggregate(posts: list[Any], unit: LemmyUnit) -> list[CreatorObservation]:
        groups: dict[str, CreatorObservation] = {}
        for pv in posts:
            if not isinstance(pv, dict):
                continue
            post, person = pv.get("post") or {}, pv.get("creator") or {}
            community = pv.get("community") or {}
            if not isinstance(post, dict) or not isinstance(person, dict):
                continue
            if not (post.get("nsfw") or (isinstance(community, dict) and community.get("nsfw"))):
                continue  # only self-labelled NSFW posts
            if person.get("deleted") or person.get("banned") or person.get("bot_account"):
                continue
            actor = safe_profile_url(person.get("actor_id"))
            host = (urlsplit(actor).hostname or unit.instance).lower()
            local = clean_handle(str(person.get("name") or ""))
            handle = f"{local}@{host}"
            name = redact(person.get("display_name"))
            comm = clean_tag((community or {}).get("name")) if isinstance(community, dict) else ""
            tags = [t for t in [comm, clean_tag(unit.query)] if t]
            if not canonical(local) or has_contact_info(person.get("name")) or has_excluded_marker([local, name, *tags]):
                continue
            ob = groups.get(handle)
            if ob is None:
                ob = groups[handle] = CreatorObservation(
                    platform="lemmy", handle=handle, display_name=name or local, profile_url=actor, source="lemmy",
                )
            counts = pv.get("counts") or {}
            ob.media_count += 1
            ob.like_count += to_int(counts.get("score") if isinstance(counts, dict) else 0)
            for t in tags:
                ob.tags[t] = ob.tags.get(t, 0) + 1
            ob.last_seen_at = max(ob.last_seen_at, _iso_from_text(post.get("published")))
        return list(groups.values())


# ── PeerTube (sepiasearch federated index) ───────────────────────────────────


@dataclass(frozen=True)
class PeerTubeUnit:
    host: str
    query: str


class PeerTubeSource:
    name = "peertube"

    def __init__(self, fetcher: Fetcher):
        self.fetcher = fetcher
        self.units = [PeerTubeUnit(h, q) for q in L.PEERTUBE_QUERIES for h in L.PEERTUBE_HOSTS]

    async def crawl_unit(self, unit: PeerTubeUnit) -> UnitResult:
        params = urlencode({"search": unit.query, "count": 40, "nsfw": "true", "sort": "-trending"})
        res = await self.fetcher.get_json(f"https://{unit.host}/api/v1/search/videos?{params}")
        rows = res.data.get("data") if isinstance(res.data, dict) else None
        if not res.ok or not isinstance(rows, list):
            return UnitResult(pages=1)
        return UnitResult(observations=self.aggregate(rows, unit), pages=1)

    @staticmethod
    def aggregate(rows: list[Any], unit: PeerTubeUnit) -> list[CreatorObservation]:
        groups: dict[str, CreatorObservation] = {}
        for video in rows:
            if not isinstance(video, dict) or not video.get("nsfw"):
                continue  # only videos flagged NSFW by their uploader
            ch = video.get("channel")
            if not isinstance(ch, dict):
                continue
            host = clean_handle(str(ch.get("host") or unit.host))
            local = clean_handle(str(ch.get("name") or ""))
            handle = f"{local}@{host}"
            name = redact(ch.get("displayName"))
            tags = [t for t in (clean_tag(x) for x in (video.get("tags") or [])) if t][:12]
            if not canonical(local) or has_contact_info(ch.get("name")) or has_excluded_marker([local, name, *tags]):
                continue
            ob = groups.get(handle)
            if ob is None:
                url = safe_profile_url(ch.get("url")) or f"https://{host}/video-channels/{quote(local, safe='')}"
                ob = groups[handle] = CreatorObservation(
                    platform="peertube", handle=handle, display_name=name or local, profile_url=url, source="peertube",
                )
            ob.media_count += 1
            ob.view_count += to_int(video.get("views"))
            ob.like_count += to_int(video.get("likes"))
            for t in [*tags, clean_tag(unit.query)]:
                if t:
                    ob.tags[t] = ob.tags.get(t, 0) + 1
            ob.last_seen_at = max(ob.last_seen_at, _iso_from_text(video.get("publishedAt")))
        return list(groups.values())
