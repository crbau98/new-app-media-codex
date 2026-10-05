"""Curated crawl lanes.

Redgifs lanes mirror ``frontend/api/_lib/discovery-lanes.ts`` (same tags, same
page-major enumeration) and then extend it with more male/gay niche tags. A lane
is only a provider tag query; creators are whoever the provider returns. Unknown
tags just return nothing (every request soft-fails). Tag names marked
``best-effort`` are unverified offline.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.creator_index.config import env_list, valid_public_hostname

REDGIFS_ORDERS_CORE = ("trending", "top28", "recent", "latest")
REDGIFS_ORDERS_LIGHT = ("trending", "top28", "recent")


@dataclass(frozen=True)
class RedgifsLane:
    tag: str
    tier: str  # 'core' | 'best-effort'
    orders: tuple[str, ...]
    max_pages: int


def _core(tag: str, pages: int = 8) -> RedgifsLane:
    return RedgifsLane(tag, "core", REDGIFS_ORDERS_CORE, pages)


def _best(tag: str, pages: int = 4) -> RedgifsLane:
    return RedgifsLane(tag, "best-effort", REDGIFS_ORDERS_LIGHT, pages)


# 1) Mirror of the edge lanes (order preserved).
_EDGE_TAGS_CORE = ["Gay Porn", "Twink", "Bear", "Muscle", "Jock", "Daddy", "Hunk"]
_EDGE_TAGS_BEST = [
    "Otter", "Bisexual", "Amateur Gay", "Solo Male", "Gay Couple", "Trans Man", "Hairy", "Uncut",
    "Gay Threesome", "Gay Amateur", "Latino", "Asian Gay", "Black Gay", "Gay Solo",
    # Round 3: widened lanes (also mirrored in frontend/api/_lib/discovery-lanes.ts; a test keeps them in sync).
    "Gay Bear", "Gay Muscle", "Gay Twink", "Gay Daddy", "Gay Jock", "Gay Hunk", "Chub", "Silver Fox",
    "Gay Feet", "Gay Kink", "Gay Leather", "Gay Cam",
]
# 2) Extensions (male/gay niches; structured tags only, no identity inference).
_EXTRA_TAGS = [
    "Gay Blowjob", "Gay Anal",
    "Gay Cum", "Gay Handjob", "Gay Shower", "Gay Gym", "Gay Webcam",
    "Gay Fetish", "Gay Hairy", "Gay Older", "Gay Dilf", "Gay Ginger", "Gay Tattoo", "Gay Big Dick",
    "Gay Interracial", "Gay College", "Gay Outdoor", "Gay Public", "Gay Massage", "Gay Bareback", "Gay Flip Flop",
    "Gay Sub", "Gay Dom", "Gay Latino", "Gay Asian", "Gay Ebony", "Gay Redhead", "Gay Skinny", "Gay Chub",
    "Male Masturbation", "Male Solo", "Men", "Hairy Chest", "Bearded", "Stud", "Thick Cock", "Big Cock",
    "Jerk Off", "Nude Men", "Naked Men", "Fit Guy", "Hung", "Bi Male", "Trans Guy",
    # Round 3 additions (best-effort provider tags; unknown ones soft-fail and back off automatically).
    "Gay Locker Room", "Gay Sauna", "Gay Underwear", "Gay Jockstrap", "Gay Speedo", "Gay Boots",
    "Gay Skinhead", "Gay Cowboy", "Gay Uniform", "Gay Rimming", "Gay Edging", "Gay Mutual",
]

REDGIFS_LANES: tuple[RedgifsLane, ...] = tuple(
    [_core("Gay", 10)]
    + [_core(t, 8) for t in _EDGE_TAGS_CORE]
    + [_best(t) for t in _EDGE_TAGS_BEST]
    + [_best(t, 3) for t in _EXTRA_TAGS]
)


@dataclass(frozen=True)
class RedgifsUnit:
    tag: str
    order: str
    page: int

    def label(self) -> str:
        return f"redgifs:{self.tag}/{self.order}/p{self.page}"


def plan_redgifs_units(lanes: tuple[RedgifsLane, ...] = REDGIFS_LANES) -> list[RedgifsUnit]:
    """Deterministic page-major enumeration (breadth before depth), like the edge."""
    deepest = max((lane.max_pages for lane in lanes), default=0)
    units: list[RedgifsUnit] = []
    for page in range(1, deepest + 1):
        for lane in lanes:
            if page > lane.max_pages:
                continue
            for order in lane.orders:
                units.append(RedgifsUnit(lane.tag, order, page))
    return units


# ── Federated sources ────────────────────────────────────────────────────────

BLUESKY_APPVIEW = "https://public.api.bsky.app"
BLUESKY_QUERIES: tuple[str, ...] = (
    "gay 18+", "gay nsfw", "gay bear nsfw", "gay muscle nsfw", "gay twink nsfw", "gay daddy nsfw",
    "gay creator 18+", "gay onlyfans", "gay porn creator", "male nsfw artist", "gay erotica", "gay kink nsfw",
)
# Hashtag units: ``app.bsky.feed.searchPosts`` (public AppView; soft-fails when the endpoint needs auth).
BLUESKY_TAGS: tuple[str, ...] = (
    "gaynsfw", "gaybear", "gaymuscle", "gaytwink", "gaydaddy", "gayporn", "gaykink", "gaymen", "malenude", "nsfwgay",
)

MASTODON_INSTANCES: tuple[str, ...] = (
    "mastodon.social", "mstdn.social", "sunny.garden", "pixelfed.social", "mas.to", "mastodon.world", "mastodon.online",
)
MASTODON_TAGS: tuple[str, ...] = (
    "gaynsfw", "gayporn", "gaybear", "gaymuscle", "gaytwink", "gaydaddy", "gaykink", "gaymen", "malenude", "nsfwgay",
    "gayart", "gaycreator",
)

LEMMY_INSTANCES: tuple[str, ...] = ("lemmynsfw.com", "lemmy.world")
LEMMY_QUERIES: tuple[str, ...] = ("gay", "gaybear", "gaymuscle", "gaytwink", "gay men", "male nude", "gaykink")
# Community discovery (public search with type_=Communities); only NSFW-flagged, male/gay-named communities qualify.
LEMMY_COMMUNITY_QUERIES: tuple[str, ...] = ("gay", "gaybears", "gaymuscle", "gaytwinks", "gayporn", "malenude", "men")

PEERTUBE_HOSTS: tuple[str, ...] = ("sepiasearch.org",)
PEERTUBE_QUERIES: tuple[str, ...] = ("gay", "gay bear", "gay muscle", "gay erotica", "male nude art", "gay kink")
# sepiasearch tag / category browse (PeerTube category ids: 4 Art, 8 People, 10 Entertainment).
PEERTUBE_TAGS: tuple[str, ...] = ("gay", "bear", "muscle", "twink", "daddy", "erotic", "naked", "nude", "lgbt")
PEERTUBE_CATEGORIES: tuple[int, ...] = (4, 8, 10)
PEERTUBE_CATEGORY_QUERIES: tuple[str, ...] = ("gay", "men")


def _extend(base: tuple[str, ...], env_name: str) -> tuple[str, ...]:
    """Static list plus operator-configured hosts (``MASTODON_EXTRA_INSTANCES`` ...), validated and de-duplicated."""
    from app.creator_index.feeds import host_policy  # lazy: feeds imports the repository

    extra = [h for h in env_list(env_name) if valid_public_hostname(h) and not host_policy(h)]
    return tuple(dict.fromkeys([*base, *extra]))


def mastodon_instances() -> tuple[str, ...]:
    return _extend(MASTODON_INSTANCES, "MASTODON_EXTRA_INSTANCES")


def lemmy_instances() -> tuple[str, ...]:
    return _extend(LEMMY_INSTANCES, "LEMMY_EXTRA_INSTANCES")


def peertube_hosts() -> tuple[str, ...]:
    return _extend(PEERTUBE_HOSTS, "PEERTUBE_EXTRA_HOSTS")
