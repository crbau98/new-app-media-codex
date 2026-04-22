from __future__ import annotations

import html
import math
import json
import re
import uuid
from difflib import SequenceMatcher
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock
import time
from urllib.parse import urljoin, urlparse

import requests as req
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.performer_identity import performer_identity_signature, score_candidate_identity

router = APIRouter(prefix="/api/performers", tags=["performers"])

_FIRST_PAGE_LIMIT_CAP_COMPACT = 80
_FIRST_PAGE_LIMIT_CAP_FULL = 60


def _performers_cache_bucket(app_state):
    cache = getattr(app_state, "_performers_cache", None)
    if cache is None:
        cache = {}
        app_state._performers_cache = cache
    lock = getattr(app_state, "_performers_cache_lock", None)
    if lock is None:
        lock = Lock()
        app_state._performers_cache_lock = lock
    return cache, lock


def _get_cached_performers_payload(app_state, key: str, ttl_seconds: float, builder):
    cache, lock = _performers_cache_bucket(app_state)
    now = time.monotonic()
    with lock:
        expired_keys = [cache_key for cache_key, entry in cache.items() if now >= entry["expires_at"]]
        for cache_key in expired_keys:
            cache.pop(cache_key, None)
        if len(cache) > 512:
            cache.clear()
        entry = cache.get(key)
        if entry and now < entry["expires_at"]:
            return entry["payload"]

    payload = builder()
    with lock:
        cache[key] = {"payload": payload, "expires_at": time.monotonic() + ttl_seconds}
    return payload


def _invalidate_performers_cache(app_state) -> None:
    cache, lock = _performers_cache_bucket(app_state)
    with lock:
        cache.clear()


# ── Request bodies ─────────────────────────────────────────────────────

class AddPerformerBody(BaseModel):
    username: str
    platform: str = "onlyfans"
    display_name: str | None = None
    profile_url: str | None = None
    bio: str | None = None
    tags: list[str] | None = None
    avatar_url: str | None = None
    discovered_via: str | None = None


class UpdatePerformerBody(BaseModel):
    username: str | None = None
    display_name: str | None = None
    platform: str | None = None
    profile_url: str | None = None
    avatar_url: str | None = None
    avatar_local: str | None = None
    bio: str | None = None
    tags: list[str] | None = None
    follower_count: int | None = None
    media_count: int | None = None
    is_verified: bool | None = None
    is_favorite: bool | None = None
    status: str | None = None
    notes: str | None = None
    discovered_via: str | None = None
    last_checked_at: str | None = None
    subscription_price: float | None = None
    is_subscribed: bool | None = None
    subscription_renewed_at: str | None = None
    reddit_username: str | None = None
    twitter_username: str | None = None


class AddLinkBody(BaseModel):
    platform: str
    url: str
    username: str | None = None


class AddMediaBody(BaseModel):
    media_type: str
    source_url: str | None = None
    local_path: str | None = None
    thumbnail_path: str | None = None
    width: int | None = None
    height: int | None = None
    duration: int | None = None
    file_size: int | None = None
    caption: str | None = None


class SearchBody(BaseModel):
    query: str
    platform: str | None = None
    limit: int = 20


class DiscoverBody(BaseModel):
    query: str | None = None
    platform: str | None = None
    seed_performer_id: int | None = None
    seed_term: str | None = None
    limit: int = 10


class DiscoveredCreatorBody(BaseModel):
    username: str
    display_name: str | None = None
    platform: str = "OnlyFans"
    bio: str | None = None
    tags: list[str] | None = None
    reason: str | None = None


class ImportDiscoveredBody(BaseModel):
    creators: list[DiscoveredCreatorBody]
    capture_existing: bool = True


class ImportUrlBody(BaseModel):
    url: str


class BulkImportBody(BaseModel):
    usernames: list[str]
    platform: str


# ── URL parsing helpers ───────────────────────────────────────────────

_URL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Twitter/X", re.compile(r"(?:twitter\.com|x\.com)/(?P<user>[A-Za-z0-9_]{1,50})(?:/|$|\?)")),
    ("Instagram", re.compile(r"instagram\.com/(?P<user>[A-Za-z0-9_.]{1,50})(?:/|$|\?)")),
    ("Reddit", re.compile(r"reddit\.com/(?:u|user)/(?P<user>[A-Za-z0-9_-]{1,50})(?:/|$|\?)")),
    ("OnlyFans", re.compile(r"onlyfans\.com/(?P<user>[A-Za-z0-9_.]{1,50})(?:/|$|\?)")),
    ("Fansly", re.compile(r"fansly\.com/(?P<user>[A-Za-z0-9_.]{1,50})(?:/|$|\?)")),
]

_DISCOVERY_STOPWORDS = {
    "creator", "creators", "similar", "like", "find", "show", "more", "from",
    "with", "for", "the", "and", "that", "this", "your", "already", "app",
    "related", "male", "adult", "content",
}

_DISCOVERY_GENERIC_TERMS = {
    "69", "anal", "ass", "balls", "bareback", "bear", "big", "blowjob", "bondage",
    "breeding", "chastity", "chub", "cock", "creampie", "cum", "daddy",
    "deepthroat", "dick", "docking", "edging", "ejaculate", "facial", "fitness",
    "foreskin", "frottage", "gay", "glory", "hands", "hairy", "hole", "hung",
    "jockstrap", "kissing", "latino", "leather", "massage", "masturbation",
    "men", "more", "multiple", "muscle", "mutual", "nipples", "onlyfans",
    "orgasm", "otter", "penis", "perineum", "precum", "prostate", "rimjob",
    "sauna", "shot", "shower", "solo", "speedo", "tattooed", "threesome",
    "twink", "twunk", "uncut", "underwear",
}

_DISCOVERY_STYLE_TOKENS = {
    "artist", "athletic", "bear", "daddy", "fitness", "hairy", "hung",
    "jock", "latino", "leather", "muscle", "otter", "tattooed", "twink", "twunk",
}

_DISCOVERY_TAG_SYNONYMS = {
    "artists": "artist",
    "athlete": "athletic",
    "athletes": "athletic",
    "fit": "fitness",
    "jockstrap": "jock",
    "jocks": "jock",
    "muscular": "muscle",
    "muscled": "muscle",
    "tattoo": "tattooed",
    "tattoos": "tattooed",
}

_CURATED_DISCOVERY_CREATORS: list[dict[str, object]] = [
    {"username": "jakipz", "display_name": "Jakipz", "platform": "OnlyFans", "bio": "Gay OnlyFans creator", "tags": ["twink", "latino"]},
    {"username": "hoguesdirtylaundry", "display_name": "Hogue", "platform": "Twitter/X", "bio": "Gay creator on Twitter/X", "tags": ["hairy", "bear"]},
    {"username": "michaelyerger", "display_name": "Michael Yerger", "platform": "OnlyFans", "bio": "Survivor contestant and creator", "tags": ["fitness", "muscle"]},
    {"username": "sebastiancox", "display_name": "Sebastian Cox", "platform": "OnlyFans", "bio": "Gay muscle content creator", "tags": ["muscle"]},
    {"username": "austinwolf", "display_name": "Austin Wolf", "platform": "OnlyFans", "bio": "Muscle daddy creator", "tags": ["muscle", "daddy"]},
    {"username": "cademaddox", "display_name": "Cade Maddox", "platform": "OnlyFans", "bio": "Gay muscle performer", "tags": ["muscle"]},
    {"username": "jjknight", "display_name": "JJ Knight", "platform": "OnlyFans", "bio": "Hung gay performer", "tags": ["hung", "muscle"]},
    {"username": "ryanbones", "display_name": "Ryan Bones", "platform": "OnlyFans", "bio": "Gay adult creator", "tags": ["muscle"]},
    {"username": "drewvalentino", "display_name": "Drew Valentino", "platform": "OnlyFans", "bio": "Twink creator", "tags": ["twink"]},
    {"username": "blakemitchell", "display_name": "Blake Mitchell", "platform": "OnlyFans", "bio": "Popular gay performer", "tags": ["twink"]},
    {"username": "alexmecum", "display_name": "Alex Mecum", "platform": "OnlyFans", "bio": "Bear muscle performer", "tags": ["muscle", "bear"]},
    {"username": "colbykeller", "display_name": "Colby Keller", "platform": "OnlyFans", "bio": "Artist and gay performer", "tags": ["muscle", "artist"]},
    {"username": "levicharming", "display_name": "Levi Charming", "platform": "OnlyFans", "bio": "Twink creator", "tags": ["twink"]},
    {"username": "brenteverett", "display_name": "Brent Everett", "platform": "OnlyFans", "bio": "Veteran gay performer", "tags": ["muscle"]},
    {"username": "nickfitt", "display_name": "Nick Fitt", "platform": "OnlyFans", "bio": "Muscle creator", "tags": ["muscle"]},
    {"username": "pierrefitch", "display_name": "Pierre Fitch", "platform": "OnlyFans", "bio": "Athletic gay performer", "tags": ["athletic"]},
    {"username": "troyedean", "display_name": "Troye Dean", "platform": "OnlyFans", "bio": "Twink performer", "tags": ["twink"]},
    {"username": "devinfrancoxx", "display_name": "Devin Franco", "platform": "OnlyFans", "bio": "Muscle creator", "tags": ["muscle"]},
    {"username": "manuelskye", "display_name": "Manuel Skye", "platform": "OnlyFans", "bio": "Hung muscle performer", "tags": ["muscle", "hung"]},
    {"username": "joshmoorexxx", "display_name": "Josh Moore", "platform": "OnlyFans", "bio": "Muscle gay performer", "tags": ["muscle"]},
    {"username": "boonerbanks", "display_name": "Boomer Banks", "platform": "OnlyFans", "bio": "Hung latino performer", "tags": ["hung", "latino"]},
    {"username": "skyyknox", "display_name": "Skyy Knox", "platform": "OnlyFans", "bio": "Muscle creator", "tags": ["muscle"]},
    {"username": "rafaelalencar", "display_name": "Rafael Alencar", "platform": "OnlyFans", "bio": "Hung muscle performer", "tags": ["hung", "muscle"]},
    {"username": "adamramzi", "display_name": "Adam Ramzi", "platform": "OnlyFans", "bio": "Hairy muscle performer", "tags": ["hairy", "muscle"]},
]

# Fallback discovery pool: creators NOT in the main curated list.
# Used when AI is rate-limited or unavailable, so discovery can still
# suggest genuinely new creators.
_FALLBACK_DISCOVERY_CREATORS: list[dict[str, object]] = [
    {"username": "rhyheimxxx", "display_name": "Rhyheim Shabazz", "platform": "OnlyFans", "bio": "Popular hung performer", "tags": ["hung", "muscle", "bbc"]},
    {"username": "maborooshi", "display_name": "Maborooshi", "platform": "Twitter/X", "bio": "Asian gay adult content creator", "tags": ["asian", "muscle"]},
    {"username": "frankydimario", "display_name": "Franky DiMario", "platform": "OnlyFans", "bio": "Muscle bear content creator", "tags": ["bear", "muscle", "hairy"]},
    {"username": "araborofficial", "display_name": "Arabor", "platform": "OnlyFans", "bio": "Hung muscle performer", "tags": ["hung", "muscle", "latino"]},
    {"username": "ethanchasexx", "display_name": "Ethan Chase", "platform": "OnlyFans", "bio": "Versatile performer", "tags": ["muscle", "asian"]},
    {"username": "jakecruise", "display_name": "Jake Cruise", "platform": "OnlyFans", "bio": "Veteran performer and producer", "tags": ["daddy", "producer"]},
    {"username": "c0letanxxx", "display_name": "Cole Tan", "platform": "OnlyFans", "bio": "Twink content creator", "tags": ["twink", "asian"]},
    {"username": "renoGoldxxx", "display_name": "Reno Gold", "platform": "OnlyFans", "bio": "Muscular solo performer", "tags": ["muscle", "solo"]},
    {"username": "taylorcoleman", "display_name": "Taylor Coleman", "platform": "OnlyFans", "bio": "Jock type creator", "tags": ["jock", "muscle"]},
    {"username": "mattandrew_", "display_name": "Matt Andrew", "platform": "OnlyFans", "bio": "Fitness model and creator", "tags": ["fitness", "muscle"]},
    {"username": "jaxfilmore", "display_name": "Jax Filmore", "platform": "OnlyFans", "bio": "Muscle bottom creator", "tags": ["muscle", "bottom"]},
    {"username": "zariofern", "display_name": "Zario Travezz", "platform": "OnlyFans", "bio": "Popular performer", "tags": ["bbc", "muscle"]},
    {"username": "drewsebastian", "display_name": "Drew Sebastian", "platform": "OnlyFans", "bio": "Hung bear leather daddy", "tags": ["bear", "hung", "leather"]},
    {"username": "calvinbanksxxx", "display_name": "Calvin Banks", "platform": "OnlyFans", "bio": "Popular twink performer", "tags": ["twink", "hung"]},
    {"username": "romantodd", "display_name": "Roman Todd", "platform": "OnlyFans", "bio": "Versatile muscle performer", "tags": ["muscle", "versatile"]},
    {"username": "daltonriley", "display_name": "Dalton Riley", "platform": "OnlyFans", "bio": "Tattooed performer", "tags": ["tattooed", "jock"]},
    {"username": "sharokcxxx", "display_name": "Sharok", "platform": "OnlyFans", "bio": "Middle Eastern muscle creator", "tags": ["hairy", "muscle", "hung"]},
    {"username": "michelangelo_of", "display_name": "Michelangelo", "platform": "OnlyFans", "bio": "Brazilian muscle creator", "tags": ["muscle", "latino"]},
    {"username": "davinciofficial", "display_name": "Da Vinci", "platform": "OnlyFans", "bio": "Hung performer", "tags": ["hung", "bbc"]},
    {"username": "kameronfrost", "display_name": "Kameron Frost", "platform": "OnlyFans", "bio": "Jock creator", "tags": ["jock", "twink"]},
]

_PLATFORM_NAME_MAP = {
    "fansly": "Fansly",
    "instagram": "Instagram",
    "onlyfans": "OnlyFans",
    "reddit": "Reddit",
    "twitter": "Twitter/X",
    "twitterx": "Twitter/X",
    "x": "Twitter/X",
}


def _parse_profile_url(url: str) -> tuple[str, str]:
    """Return (platform, username) from a profile URL. Raises ValueError on failure."""
    for platform, pattern in _URL_PATTERNS:
        m = pattern.search(url)
        if m:
            return platform, m.group("user")
    raise ValueError(f"Unrecognised profile URL: {url}")


def _extract_avatar_from_profile_url(profile_url: str) -> str | None:
    """Best-effort avatar discovery from an official profile or social page."""
    if not profile_url.startswith(("http://", "https://")):
        return None
    try:
        resp = req.get(profile_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if not resp.ok:
            return None
        html_text = resp.text
        patterns = (
            r'<meta[^>]+property=["\']og:image[^"\']*["\'][^>]+content=["\']([^"\']+)["\']',
            r'<meta[^>]+name=["\']twitter:image(?::src)?["\'][^>]+content=["\']([^"\']+)["\']',
            r'"profile_image_url_https"\s*:\s*"([^"]+)"',
            r'"avatar_url"\s*:\s*"([^"]+)"',
        )
        for pattern in patterns:
            match = re.search(pattern, html_text, re.IGNORECASE)
            if not match:
                continue
            candidate = html.unescape(match.group(1).replace("\\/", "/").strip())
            if candidate.startswith("//"):
                candidate = f"{urlparse(profile_url).scheme}:{candidate}"
            elif candidate.startswith("/"):
                candidate = urljoin(profile_url, candidate)
            if candidate.startswith(("http://", "https://")):
                return candidate
    except Exception:
        return None
    return None


def _candidate_avatar_urls(performer: dict) -> list[str]:
    urls: list[str] = []
    profile_url = str(performer.get("profile_url") or "").strip()
    if profile_url:
        urls.append(profile_url)
    twitter_username = str(performer.get("twitter_username") or "").strip()
    if twitter_username:
        urls.extend([f"https://x.com/{twitter_username}", f"https://twitter.com/{twitter_username}"])
    reddit_username = str(performer.get("reddit_username") or "").strip()
    if reddit_username:
        urls.append(f"https://www.reddit.com/user/{reddit_username}")
    return urls


def _candidate_mentions_identity(candidate: object, performer_signature: dict[str, object]) -> bool:
    return bool(score_candidate_identity(candidate, performer_signature)["accepted"])


# ── Stats (must be before /{id} routes) ────────────────────────────────

@router.get("/stats")
def performer_stats(request: Request):
    db = request.app.state.db
    return _get_cached_performers_payload(request.app.state, "stats", 30.0, db.get_performer_stats)


# ── Analytics ──────────────────────────────────────────────────────────

@router.get("/analytics")
def performer_analytics(request: Request):
    db = request.app.state.db
    return _get_cached_performers_payload(request.app.state, "analytics", 60.0, db.get_performer_analytics)


# ── Auto-link existing screenshots to performers ─────────────────────

@router.post("/auto-link")
def auto_link_performers(request: Request):
    """Match existing screenshots to performers by strict identity evidence."""
    db = request.app.state.db
    linked = db.backfill_screenshot_performers()
    if linked:
        _invalidate_performers_cache(request.app.state)
    return {"linked": linked, "performers_matched": linked}


# ── Search ─────────────────────────────────────────────────────────────

@router.post("/search")
def search_performers(body: SearchBody, request: Request):
    db = request.app.state.db
    results = db.search_performers(body.query, platform=body.platform, limit=body.limit)
    return {"performers": results, "total": len(results)}


# ── Discover (AI-powered) ─────────────────────────────────────────────

def _parse_tag_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(tag).strip() for tag in parsed if str(tag).strip()]
    except (json.JSONDecodeError, TypeError):
        pass
    return [part.strip() for part in raw.split(",") if part.strip()]


def _build_discovery_seed_context(db, seed_performer_id: int | None, seed_term: str | None) -> dict:
    context: dict[str, object] = {"seed_term": (seed_term or "").strip()}
    if seed_performer_id is None:
        return context

    performer = db.get_performer(seed_performer_id)
    if not performer:
        return context

    context["seed_performer"] = {
        "id": performer["id"],
        "username": performer["username"],
        "display_name": performer.get("display_name"),
        "platform": performer.get("platform"),
        "bio": performer.get("bio"),
        "tags": _parse_tag_list(performer.get("tags")),
    }

    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT term, COUNT(*) AS count
            FROM screenshots
            WHERE performer_id = ? AND term IS NOT NULL AND term != ''
            GROUP BY term
            ORDER BY count DESC, term ASC
            LIMIT 8
            """,
            (seed_performer_id,),
        ).fetchall()
    context["top_terms"] = [{"term": row["term"], "count": row["count"]} for row in rows]
    return context


def _normalize_platform_name(platform: str | None) -> str | None:
    if not platform:
        return None
    cleaned = platform.strip()
    key = re.sub(r"[^a-z0-9]+", "", cleaned.lower())
    return _PLATFORM_NAME_MAP.get(key, cleaned)


def _normalize_creator_alias(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _ordered_discovery_tokens(*parts: object) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for part in parts:
        if part is None:
            continue
        if isinstance(part, dict):
            text = " ".join(str(value) for value in part.values() if value)
        elif isinstance(part, (list, tuple, set)):
            text = " ".join(str(value) for value in part if value)
        else:
            text = str(part)
        for raw_token in re.findall(r"[a-z0-9]+", text.lower()):
            token = _DISCOVERY_TAG_SYNONYMS.get(raw_token, raw_token)
            if len(token) < 3 or token in _DISCOVERY_STOPWORDS:
                continue
            if token not in seen:
                seen.add(token)
                ordered.append(token)
    return ordered


def _tokenize_discovery_text(*parts: object) -> set[str]:
    return set(_ordered_discovery_tokens(*parts))


def _extract_candidate_tags(*parts: object, limit: int = 5) -> list[str]:
    tags: list[str] = []
    for token in _ordered_discovery_tokens(*parts):
        if token in _DISCOVERY_STYLE_TOKENS and token not in tags:
            tags.append(token)
        if len(tags) >= limit:
            break
    return tags


def _looks_like_creator_term(term: str) -> bool:
    cleaned = re.sub(r"\s+", " ", term.strip())
    lowered = cleaned.lower()
    if not cleaned or "http" in lowered or "t.me/" in lowered or lowered.startswith("group link"):
        return False
    tokens = [token for token in re.findall(r"[a-z0-9]+", lowered) if len(token) > 1]
    if not tokens or len(tokens) > 4:
        return False
    non_generic_tokens = [
        token for token in tokens
        if token not in _DISCOVERY_GENERIC_TERMS and token not in _DISCOVERY_STOPWORDS
    ]
    if not non_generic_tokens:
        return False
    if len(tokens) == 1:
        token = tokens[0]
        return (
            len(token) >= 5
            and any(ch.isalpha() for ch in token)
            and (
                any(ch.isdigit() for ch in cleaned)
                or "_" in cleaned
                or cleaned != cleaned.lower()
                or token.endswith(("x", "xx", "xxx"))
            )
        )
    # Multi-token: accept if at least one non-generic token looks like a handle
    # (>= 5 chars with alpha) — catches "jakipz onlyfans", "ryan bones", etc.
    return any(
        len(t) >= 5 and any(ch.isalpha() for ch in t)
        for t in non_generic_tokens
    )


def _creator_identity_from_term(term: str) -> tuple[str, str]:
    cleaned = re.sub(r"\s+", " ", term.strip(" ._-"))
    display_name = " ".join(part.capitalize() if part.islower() else part for part in cleaned.split()) or cleaned
    if len(cleaned.split()) == 1:
        username = cleaned.lstrip("@")
    else:
        username = re.sub(r"[^a-z0-9_.]+", "", cleaned.lower().replace(" ", ""))
    return username[:64], display_name[:80]


def _infer_candidate_platform(platform_hint: str | None, sources_blob: str | None, sample_url: str | None) -> str:
    normalized_hint = _normalize_platform_name(platform_hint)
    if normalized_hint:
        return normalized_hint
    haystack = " ".join(part for part in [sources_blob or "", sample_url or ""]).lower()
    for needle, platform in (
        ("onlyfans", "OnlyFans"),
        ("fansly", "Fansly"),
        ("reddit", "Reddit"),
        ("instagram", "Instagram"),
        ("twitter", "Twitter/X"),
        ("x.com", "Twitter/X"),
    ):
        if needle in haystack:
            return platform
    return "OnlyFans"


def _load_existing_performer_directory(db) -> tuple[list[dict], dict[str, dict], dict[str, list[dict]]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, platform, bio, tags, twitter_username, reddit_username "
            "FROM performers"
        ).fetchall()

    performers = [dict(row) for row in rows]
    username_lookup: dict[str, dict] = {}
    alias_lookup: dict[str, list[dict]] = {}

    for performer in performers:
        username = str(performer.get("username") or "").strip()
        platform_key = _normalize_platform_name(str(performer.get("platform") or "")) or ""
        if username:
            username_lookup[username.lower()] = performer
            if platform_key:
                username_lookup[f"{platform_key.lower()}::{username.lower()}"] = performer
        for alias in (
            username,
            performer.get("display_name"),
            performer.get("twitter_username"),
            performer.get("reddit_username"),
        ):
            normalized_alias = _normalize_creator_alias(str(alias)) if alias else ""
            if normalized_alias:
                alias_lookup.setdefault(normalized_alias, []).append(performer)

    return performers, username_lookup, alias_lookup


def _find_existing_performer_match(
    username: str,
    display_name: str | None,
    platform: str | None,
    username_lookup: dict[str, dict],
    alias_lookup: dict[str, list[dict]],
) -> dict | None:
    platform_key = (_normalize_platform_name(platform) or "").lower()
    direct = username_lookup.get(f"{platform_key}::{username.strip().lower()}") if platform_key else None
    if not direct:
        direct = username_lookup.get(username.strip().lower())
    if direct:
        return direct
    matches: dict[int, dict] = {}
    for alias in (username, display_name or ""):
        normalized_alias = _normalize_creator_alias(alias)
        if not normalized_alias:
            continue
        for performer in alias_lookup.get(normalized_alias, []):
            matches[int(performer["id"])] = performer
    if not matches:
        return None
    if platform_key:
        platform_matches = [
            performer
            for performer in matches.values()
            if (_normalize_platform_name(str(performer.get("platform") or "")) or "").lower() == platform_key
        ]
        if len(platform_matches) == 1:
            return platform_matches[0]
        if len(platform_matches) > 1:
            return None
    return next(iter(matches.values())) if len(matches) == 1 else None


def _parse_discovery_payload(raw: str) -> dict | list | None:
    cleaned = raw.strip()
    if not cleaned:
        return None
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.DOTALL).strip()

    payload_candidates = [cleaned]
    object_start = cleaned.find("{")
    object_end = cleaned.rfind("}")
    if object_start != -1 and object_end != -1 and object_end > object_start:
        payload_candidates.append(cleaned[object_start:object_end + 1])
    array_start = cleaned.find("[")
    array_end = cleaned.rfind("]")
    if array_start != -1 and array_end != -1 and array_end > array_start:
        payload_candidates.append(cleaned[array_start:array_end + 1])

    for candidate in payload_candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, (dict, list)):
            return parsed
    return None


def _coerce_discovery_suggestions(parsed: dict | list | None) -> list[dict]:
    if isinstance(parsed, dict):
        suggestions = (
            parsed.get("suggestions")
            or parsed.get("creators")
            or parsed.get("results")
            or parsed.get("items")
            or []
        )
    elif isinstance(parsed, list):
        suggestions = parsed
    else:
        suggestions = []

    normalized: list[dict] = []
    for item in suggestions:
        if isinstance(item, str):
            normalized.append({"username": item})
        elif isinstance(item, dict):
            normalized.append(item)
    return normalized


def _request_discovery_suggestions(settings, prompt: str) -> list[dict]:
    if not settings.openai_api_key:
        return []

    base_payload = {
        "model": settings.openai_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1500,
    }
    attempts = [
        ("json", {"response_format": {"type": "json_object"}}),
        ("plain", {}),
    ]

    for label, extra_payload in attempts:
        for retry in range(3):
            try:
                resp = req.post(
                    f"{settings.openai_base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {settings.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={**base_payload, **extra_payload},
                    timeout=25,
                )
                if resp.status_code == 429:
                    import time as _time
                    wait = min(2 ** retry * 2, 10)
                    _time.sleep(wait)
                    continue
                resp.raise_for_status()
                raw = str(resp.json()["choices"][0]["message"].get("content") or "").strip()
                suggestions = _coerce_discovery_suggestions(_parse_discovery_payload(raw))
                if suggestions:
                    return suggestions
                print(f"[performers] discover {label} attempt produced no usable suggestions")
                break
            except Exception as exc:
                print(f"[performers] discover {label} attempt failed: {exc}")
                break
    return []


def _mine_local_creator_candidates(db, platform_hint: str | None) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT
                LOWER(TRIM(term)) AS normalized_term,
                MIN(term) AS sample_term,
                COUNT(*) AS hit_count,
                GROUP_CONCAT(DISTINCT source) AS sources_blob,
                MAX(page_url) AS sample_url,
                MAX(COALESCE(ai_tags, '')) AS ai_tags_sample,
                MAX(COALESCE(ai_summary, '')) AS ai_summary_sample
            FROM screenshots
            WHERE performer_id IS NULL
              AND term IS NOT NULL
              AND TRIM(term) != ''
            GROUP BY LOWER(TRIM(term))
            HAVING COUNT(*) >= 2
            ORDER BY hit_count DESC, MAX(captured_at) DESC
            LIMIT 180
            """
        ).fetchall()

    mined: list[dict] = []
    for row in rows:
        sample_term = str(row["sample_term"] or "").strip()
        if not _looks_like_creator_term(sample_term):
            continue
        username, display_name = _creator_identity_from_term(sample_term)
        if not username:
            continue
        platform = _infer_candidate_platform(platform_hint, row["sources_blob"], row["sample_url"])
        tags = _extract_candidate_tags(
            sample_term,
            row["ai_tags_sample"],
            row["ai_summary_sample"],
            row["sample_url"],
        )
        hit_count = int(row["hit_count"] or 0)
        mined.append(
            {
                "username": username,
                "display_name": display_name,
                "platform": platform,
                "bio": f"Observed in {hit_count} captured results.",
                "tags": tags,
                "_local_hits": hit_count,
                "_source_context": row["sources_blob"] or "",
            }
        )
    return mined


def _heuristic_discover_performers(
    db,
    query: str,
    platform_hint: str | None,
    seed_context: dict,
    limit: int,
    username_lookup: dict[str, dict],
    alias_lookup: dict[str, dict],
) -> list[dict]:
    desired_platform = _normalize_platform_name(platform_hint)
    seed_performer = seed_context.get("seed_performer") or {}
    seed_terms = [row.get("term", "") for row in seed_context.get("top_terms", []) if isinstance(row, dict)]
    query_tokens = _tokenize_discovery_text(query, seed_context.get("seed_term"), seed_terms, seed_performer.get("tags"), seed_performer.get("bio"))

    candidates: list[dict[str, object]] = []
    candidates.extend(_CURATED_DISCOVERY_CREATORS)
    candidates.extend(_FALLBACK_DISCOVERY_CREATORS)
    candidates.extend(_mine_local_creator_candidates(db, desired_platform))

    deduped: dict[str, dict] = {}
    for candidate in candidates:
        username = str(candidate.get("username") or "").strip().lstrip("@")
        display_name = str(candidate.get("display_name") or "").strip()
        if not username:
            continue
        dedupe_key = _normalize_creator_alias(display_name or username)
        if dedupe_key and dedupe_key not in deduped:
            deduped[dedupe_key] = dict(candidate)

    scored: list[tuple[int, int, float, int, dict]] = []
    seed_alias = _normalize_creator_alias(str(seed_performer.get("username") or "")) or _normalize_creator_alias(str(seed_performer.get("display_name") or ""))

    for candidate in deduped.values():
        username = str(candidate.get("username") or "").strip().lstrip("@")
        display_name = str(candidate.get("display_name") or "").strip()
        candidate_alias = _normalize_creator_alias(display_name or username)
        if seed_alias and candidate_alias == seed_alias:
            continue

        normalized_platform = _normalize_platform_name(str(candidate.get("platform") or "")) or desired_platform or "OnlyFans"
        existing_match = _find_existing_performer_match(username, display_name, normalized_platform, username_lookup, alias_lookup)
        local_hits = int(candidate.get("_local_hits") or 0)
        tags = candidate.get("tags") if isinstance(candidate.get("tags"), list) else []
        candidate_tokens = _tokenize_discovery_text(
            username,
            display_name,
            candidate.get("bio"),
            tags,
            candidate.get("_source_context"),
        )
        overlap = sorted(query_tokens & candidate_tokens)

        score = 0.0
        if desired_platform and normalized_platform == desired_platform:
            score += 4.0
        elif desired_platform and normalized_platform != desired_platform:
            score -= 1.0
        else:
            score += 1.0
        score += len(overlap) * 3.0
        score += min(local_hits, 60) / 12.0
        score += 5.0 if existing_match is None else -2.0
        if not overlap and query_tokens and local_hits < 4:
            score -= 0.5

        candidate_tags = [tag for tag in tags if isinstance(tag, str)]
        if not candidate_tags:
            candidate_tags = _extract_candidate_tags(overlap)
        if " " in display_name:
            score += 1.0
        elif not candidate_tags:
            score -= 0.75
        if candidate_tags:
            score += min(len(candidate_tags), 2) * 0.5

        reason_bits: list[str] = []
        if overlap:
            reason_bits.append(f"Matches {', '.join(overlap[:3])}")
        if local_hits:
            reason_bits.append(f"seen in {local_hits} captured results")
        if existing_match is not None:
            reason_bits.append("already tracked, so discovery can queue another capture immediately")
        elif desired_platform:
            reason_bits.append(f"aligned to {desired_platform}")

        scored.append(
            (
                1 if existing_match is not None else 0,
                0 if " " in display_name else 1,
                score,
                local_hits,
                {
                    "username": username,
                    "display_name": display_name or None,
                    "platform": normalized_platform,
                    "bio": str(candidate.get("bio") or ""),
                    "tags": candidate_tags[:5],
                    "reason": ". ".join(reason_bits) or "Strong local match from your captured creator graph.",
                    "exists": existing_match is not None,
                },
            )
        )

    scored.sort(key=lambda item: (item[0], item[1], -item[2], -item[3], str(item[4]["username"]).lower()))
    return [item for _, _, _, _, item in scored[:limit]]

@router.post("/discover")
def discover_performers(body: DiscoverBody, request: Request):
    """Use OpenAI to suggest male content creators based on a query or tracked creator seed."""
    from copy import copy as _copy
    settings = request.app.state.settings
    db = request.app.state.db
    # Apply user-configured vision API key (same override as capture uses)
    user_settings = db.get_all_settings()
    if user_settings.get("vision_api_key"):
        settings = _copy(settings)
        settings.openai_api_key = user_settings["vision_api_key"]
        if user_settings.get("vision_base_url"):
            settings.openai_base_url = user_settings["vision_base_url"]
        if user_settings.get("vision_model"):
            settings.openai_model = user_settings["vision_model"]
    limit = max(1, min(body.limit, 20))
    seed_context = _build_discovery_seed_context(db, body.seed_performer_id, body.seed_term)
    query = (body.query or "").strip()
    if not query and not seed_context.get("seed_performer") and not seed_context.get("seed_term"):
        raise HTTPException(400, detail="Provide a query or seed performer")
    _, username_lookup, alias_lookup = _load_existing_performer_directory(db)
    existing_usernames = sorted(username_lookup.keys())[:250]

    prompt = (
        f"Suggest up to {limit} NEW creators that fit this discovery request. "
        f"Discovery query: {query or 'Use the supplied seed creator and term context.'}. "
        f"Preferred platform: {_normalize_platform_name(body.platform) or 'any'}. "
        f"Seed context: {json.dumps(seed_context, ensure_ascii=True)}. "
        f"IMPORTANT: Do NOT suggest any creator whose username is in this exclusion list. "
        f"Suggest fresh, undiscovered creators that the user has not tracked yet. "
        f"Exclusion list (already tracked): {json.dumps(existing_usernames, ensure_ascii=True)}. "
        f"Think broadly: suggest real creators from the same niche, style, or body type "
        f"who are NOT already tracked. Include lesser-known or up-and-coming creators. "
        f"Return JSON with a 'suggestions' array. Each item should include username, display_name, platform "
        f"(OnlyFans, Twitter/X, Instagram, Reddit, or Fansly), bio, tags, and reason."
    )

    ai_suggestions = _request_discovery_suggestions(settings, prompt)
    has_api_key = bool(settings.openai_api_key)
    print(f"[performers] discover: AI returned {len(ai_suggestions)} suggestions, "
          f"existing_usernames={len(existing_usernames)}, "
          f"has_api_key={has_api_key}, model={settings.openai_model}, "
          f"base_url={settings.openai_base_url}")
    heuristic_suggestions = _heuristic_discover_performers(
        db,
        query=query,
        platform_hint=body.platform,
        seed_context=seed_context,
        limit=limit * 2,
        username_lookup=username_lookup,
        alias_lookup=alias_lookup,
    )

    results_new: list[dict] = []
    results_existing: list[dict] = []
    seen_aliases: set[str] = set()
    # Process AI suggestions first (these should be novel), then heuristic
    for suggestion in [*ai_suggestions, *heuristic_suggestions]:
        username = str(suggestion.get("username") or "").strip().lstrip("@")
        display_name = str(suggestion.get("display_name") or "").strip()
        if not username:
            continue

        normalized_platform = _normalize_platform_name(str(suggestion.get("platform") or "")) or _normalize_platform_name(body.platform) or "OnlyFans"
        existing_match = _find_existing_performer_match(username, display_name, normalized_platform, username_lookup, alias_lookup)
        tags = suggestion.get("tags") if isinstance(suggestion.get("tags"), list) else []
        normalized_tags = [
            _DISCOVERY_TAG_SYNONYMS.get(str(tag).strip().lower(), str(tag).strip().lower())
            for tag in tags
            if str(tag).strip()
        ]
        if not normalized_tags:
            normalized_tags = _extract_candidate_tags(
                username,
                display_name,
                suggestion.get("bio"),
                suggestion.get("reason"),
            )
        dedupe_key = _normalize_creator_alias(display_name or username)
        if dedupe_key in seen_aliases:
            continue
        seen_aliases.add(dedupe_key)
        entry = {
            "username": username,
            "display_name": display_name or None,
            "platform": normalized_platform,
            "bio": str(suggestion.get("bio") or ""),
            "tags": normalized_tags[:5],
            "reason": str(suggestion.get("reason") or ""),
            "exists": existing_match is not None,
        }
        if existing_match is None:
            results_new.append(entry)
        else:
            results_existing.append(entry)

    # Always show new/undiscovered creators first. Only backfill with
    # existing creators if we don't have enough new ones.
    results = results_new[:limit]
    remaining = limit - len(results)
    if remaining > 0:
        results.extend(results_existing[:remaining])
    return {
        "suggestions": results,
    }


@router.post("/discover/import")
def import_discovered_performers(body: ImportDiscoveredBody, request: Request):
    """Bulk add AI-discovered performers and enqueue capture for new or existing matches."""
    db = request.app.state.db
    _, username_lookup, alias_lookup = _load_existing_performer_directory(db)
    created: list[dict] = []
    existing: list[dict] = []
    skipped = 0

    for creator in body.creators:
        username = creator.username.strip().lstrip("@")
        if not username:
            skipped += 1
            continue

        current = _find_existing_performer_match(username, creator.display_name, creator.platform, username_lookup, alias_lookup)
        if current:
            existing.append(current)
            if body.capture_existing:
                db.enqueue_capture(current["id"])
            continue

        try:
            performer = db.add_performer(
                username=username,
                platform=creator.platform,
                display_name=creator.display_name,
                bio=creator.bio,
                tags=creator.tags or [],
                discovered_via="ai_discovery",
            )
            db.enqueue_capture(performer["id"])
            created.append(performer)
            username_lookup[username.lower()] = performer
            for alias in (username, creator.display_name or ""):
                normalized_alias = _normalize_creator_alias(alias)
                if normalized_alias:
                    alias_lookup[normalized_alias] = performer
        except Exception:
            skipped += 1

    if created or existing:
        _invalidate_performers_cache(request.app.state)
    return {
        "created": len(created),
        "existing": len(existing),
        "skipped": skipped,
        "performers": created,
        "existing_performers": existing,
    }


# ── Import from URL ───────────────────────────────────────────────────

@router.post("/import-url")
def import_from_url(body: ImportUrlBody, request: Request):
    """Parse a social media profile URL and create a performer record."""
    db = request.app.state.db
    try:
        platform, username = _parse_profile_url(body.url)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))

    existing = db.get_performer_by_username(username)
    if existing:
        raise HTTPException(409, detail=f"Performer '{username}' already exists")

    performer = db.add_performer(
        username=username,
        platform=platform,
        profile_url=body.url,
        discovered_via="url_import",
    )
    db.enqueue_capture(performer["id"])
    _invalidate_performers_cache(request.app.state)
    return performer


# ── Bulk import ───────────────────────────────────────────────────────

@router.post("/bulk-import")
def bulk_import(body: BulkImportBody, request: Request):
    """Create multiple performers at once, skipping duplicates."""
    db = request.app.state.db
    created_count = 0
    skipped_count = 0
    created_performers = []

    for raw in body.usernames:
        username = raw.strip().lstrip("@")
        if not username:
            continue
        if db.get_performer_by_username(username):
            skipped_count += 1
            continue
        try:
            performer = db.add_performer(
                username=username,
                platform=body.platform,
                discovered_via="bulk_import",
            )
            db.enqueue_capture(performer["id"])
            created_performers.append(performer)
            created_count += 1
        except Exception:
            skipped_count += 1

    if created_count:
        _invalidate_performers_cache(request.app.state)
    return {
        "created": created_count,
        "skipped": skipped_count,
        "performers": created_performers,
    }


# ── Browse / List ──────────────────────────────────────────────────────

@router.get("")
def browse_performers(
    request: Request,
    search: str | None = Query(None),
    platform: str | None = Query(None),
    status: str | None = Query(None),
    is_favorite: bool | None = Query(None),
    stale_days: int | None = Query(None, ge=1, le=365),
    renewing_only: bool | None = Query(None),
    is_subscribed: bool | None = Query(None),
    tags: str | None = Query(None),
    sort: str = Query("created_at"),
    compact: bool = Query(False),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    effective_limit = (
        min(limit, _FIRST_PAGE_LIMIT_CAP_COMPACT if compact else _FIRST_PAGE_LIMIT_CAP_FULL)
        if offset == 0
        else limit
    )
    db = request.app.state.db
    cache_key = json.dumps(
        {
            "view": "browse",
            "search": search,
            "platform": platform,
            "status": status,
            "is_favorite": is_favorite,
            "stale_days": stale_days,
            "renewing_only": renewing_only,
            "is_subscribed": is_subscribed,
            "tags": tags,
            "sort": sort,
            "compact": compact,
            "limit": effective_limit,
            "offset": offset,
        },
        sort_keys=True,
    )
    return _get_cached_performers_payload(
        request.app.state,
        cache_key,
        15.0,
        lambda: db.browse_performers(
            search=search,
            platform=platform,
            status=status,
            is_favorite=is_favorite,
            stale_days=stale_days,
            renewing_only=renewing_only,
            is_subscribed=is_subscribed,
            tags=tags,
            sort=sort,
            compact=compact,
            limit=effective_limit,
            offset=offset,
        ),
    )


# ── Capture Queue ─────────────────────────────────────────────────────────

@router.get("/capture-queue")
def get_capture_queue(request: Request):
    db = request.app.state.db
    return {"queue": db.get_capture_queue()}


@router.delete("/capture-queue/{entry_id}")
def cancel_queue_entry(entry_id: int, request: Request):
    db = request.app.state.db
    ok = db.cancel_queue_entry(entry_id)
    if not ok:
        raise HTTPException(404, detail="Queue entry not found or already running")
    return {"ok": True}


# ── Create ─────────────────────────────────────────────────────────────

@router.post("")
def add_performer(body: AddPerformerBody, request: Request):
    db = request.app.state.db
    existing = db.get_performer_by_username(body.username)
    if existing:
        raise HTTPException(409, detail=f"Performer '{body.username}' already exists")
    try:
        performer = db.add_performer(
            username=body.username,
            platform=body.platform,
            display_name=body.display_name,
            profile_url=body.profile_url,
            bio=body.bio,
            tags=body.tags,
            avatar_url=body.avatar_url,
            discovered_via=body.discovered_via,
        )
        db.enqueue_capture(performer["id"])
        _invalidate_performers_cache(request.app.state)
        return performer
    except Exception as e:
        raise HTTPException(400, detail=str(e))


# ── Named routes (must precede /{performer_id} to avoid shadowing) ───

@router.post("/capture-stale")
def capture_stale(
    request: Request,
    stale_days: int = Query(7, ge=1, le=365),
):
    """Enqueue capture for all performers not checked in stale_days days."""
    db = request.app.state.db
    ids = db.get_stale_performer_ids(stale_days)
    queued = sum(1 for pid in ids if db.enqueue_capture(pid) is not None)
    return {"queued": queued, "total_stale": len(ids)}


@router.post("/capture-all")
def capture_all_performers(request: Request):
    """Enqueue capture for ALL active performers."""
    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id FROM performers WHERE status != 'inactive' "
            "ORDER BY last_checked_at ASC NULLS FIRST"
        ).fetchall()
    queued = sum(1 for r in rows if db.enqueue_capture(r["id"]) is not None)
    return {"status": "queued", "queued": queued}


@router.post("/watchlist/capture-all")
def capture_watchlist(request: Request):
    """Enqueue capture for all favorited performers."""
    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id FROM performers WHERE is_favorite = 1 AND status != 'inactive' "
            "ORDER BY last_checked_at ASC NULLS FIRST"
        ).fetchall()
    if not rows:
        return {"status": "no_watchlist", "queued": 0}
    queued = sum(1 for r in rows if db.enqueue_capture(r["id"]) is not None)
    return {"status": "queued", "queued": queued}


@router.get("/export.csv")
def export_performers_csv(request: Request):
    """Export all performers as CSV."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, platform, profile_url, bio, tags, "
            "follower_count, media_count, is_verified, is_favorite, status, "
            "subscription_price, is_subscribed, reddit_username, twitter_username, "
            "first_seen_at, last_checked_at, created_at "
            "FROM performers ORDER BY created_at DESC"
        ).fetchall()

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "id", "username", "display_name", "platform", "profile_url", "bio", "tags",
        "follower_count", "media_count", "is_verified", "is_favorite", "status",
        "subscription_price", "is_subscribed", "reddit_username", "twitter_username",
        "first_seen_at", "last_checked_at", "created_at"
    ])
    writer.writeheader()
    for row in rows:
        d = dict(row)
        # Flatten tags JSON to comma-separated
        if d.get("tags"):
            try:
                tags_list = json.loads(d["tags"])
                d["tags"] = ", ".join(tags_list) if isinstance(tags_list, list) else d["tags"]
            except (json.JSONDecodeError, TypeError):
                pass
        writer.writerow(d)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=creators.csv"},
    )


@router.get("/watchlist")
def get_watchlist(request: Request):
    """Return all favorited performers (the watchlist)."""
    db = request.app.state.db
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, username, platform, display_name, avatar_url, avatar_local, status, media_count, last_checked_at "
            "FROM performers WHERE is_favorite = 1 ORDER BY display_name, username"
        ).fetchall()
    return {"performers": [dict(r) for r in rows], "total": len(rows)}


# ── Single performer ──────────────────────────────────────────────────

@router.get("/{performer_id}")
def get_performer(performer_id: int, request: Request):
    db = request.app.state.db
    performer = db.get_performer(performer_id)
    if not performer:
        raise HTTPException(404, detail="Performer not found")
    links = db.get_performer_links(performer_id)
    media_result = db.browse_performer_media(performer_id=performer_id, limit=1)
    with db.connect() as conn:
        screenshots_count = conn.execute(
            "SELECT COUNT(*) FROM screenshots WHERE performer_id = ?", (performer_id,)
        ).fetchone()[0]
    performer["links"] = links
    performer["link_count"] = len(links)
    performer["media_count_actual"] = media_result["total"]
    performer["screenshots_count"] = screenshots_count
    if not performer.get("avatar_url") and not performer.get("avatar_local"):
        performer["avatar_url"] = None
    return performer


@router.patch("/{performer_id}")
def update_performer(performer_id: int, body: UpdatePerformerBody, request: Request):
    db = request.app.state.db
    existing = db.get_performer(performer_id)
    if not existing:
        raise HTTPException(404, detail="Performer not found")
    fields = body.model_dump(exclude_unset=True)
    # Convert booleans to ints for SQLite
    if "is_verified" in fields and fields["is_verified"] is not None:
        fields["is_verified"] = int(fields["is_verified"])
    if "is_favorite" in fields and fields["is_favorite"] is not None:
        fields["is_favorite"] = int(fields["is_favorite"])
    if "is_subscribed" in fields and fields["is_subscribed"] is not None:
        fields["is_subscribed"] = int(fields["is_subscribed"])
    updated = db.update_performer(performer_id, **fields)
    _invalidate_performers_cache(request.app.state)
    return updated


@router.delete("/{performer_id}")
def delete_performer(performer_id: int, request: Request):
    db = request.app.state.db
    if not db.delete_performer(performer_id):
        raise HTTPException(404, detail="Performer not found")
    _invalidate_performers_cache(request.app.state)
    return {"ok": True}


# ── Links ──────────────────────────────────────────────────────────────

@router.post("/{performer_id}/links")
def add_link(performer_id: int, body: AddLinkBody, request: Request):
    db = request.app.state.db
    if not db.get_performer(performer_id):
        raise HTTPException(404, detail="Performer not found")
    link = db.add_performer_link(
        performer_id=performer_id,
        platform=body.platform,
        url=body.url,
        username=body.username,
    )
    _invalidate_performers_cache(request.app.state)
    return link


@router.delete("/{performer_id}/links/{link_id}")
def delete_link(performer_id: int, link_id: int, request: Request):
    db = request.app.state.db
    if not db.delete_performer_link(link_id):
        raise HTTPException(404, detail="Link not found")
    _invalidate_performers_cache(request.app.state)
    return {"ok": True}


# ── Media ──────────────────────────────────────────────────────────────

def _screenshot_row_to_media(row: dict, app_state) -> dict:
    """Convert a screenshots row to the unified performer-media shape.

    Crucially, builds `local_url` via proxy_media_url(..., shot_id=row.id) so the
    backend can auto-refresh expired yt-dlp CDN URLs on 410/404. Without shot_id
    in the proxy URL, expired videos silently fail to load.
    """
    from app.api.screenshots import _decorate_screenshot_media, _screenshot_is_video

    decorated = _decorate_screenshot_media(app_state, dict(row))
    media_type = "video" if _screenshot_is_video(decorated) else "photo"
    return {
        "id": decorated.get("id"),
        "source_kind": "screenshot",
        "performer_id": decorated.get("performer_id"),
        "source": decorated.get("source"),
        "media_type": media_type,
        "source_url": decorated.get("source_url"),
        "local_url": decorated.get("local_url"),
        "local_path": decorated.get("local_path"),
        "thumbnail_path": None,
        "thumbnail_url": decorated.get("thumbnail_url"),
        "preview_url": decorated.get("preview_url"),
        "caption": decorated.get("term"),
        "ai_summary": decorated.get("ai_summary"),
        "ai_tags": decorated.get("ai_tags"),
        "is_favorite": 0,
        "captured_at": decorated.get("captured_at"),
        "width": None,
        "height": None,
        "duration": None,
        "file_size": None,
    }


def _performer_media_row_to_media(row: dict) -> dict:
    from app.api.screenshots import proxy_media_url

    d = dict(row)
    source_url = str(d.get("source_url") or "")
    local_url = None
    if source_url.startswith(("http://", "https://")):
        local_url = proxy_media_url(source_url)
    return {
        "id": d.get("id"),
        "source_kind": "performer_media",
        "performer_id": d.get("performer_id"),
        "source": None,
        "media_type": d.get("media_type"),
        "source_url": source_url or None,
        "local_url": local_url,
        "local_path": d.get("local_path"),
        "thumbnail_path": d.get("thumbnail_path"),
        "thumbnail_url": None,
        "preview_url": None,
        "caption": d.get("caption"),
        "ai_summary": d.get("ai_summary"),
        "ai_tags": d.get("ai_tags"),
        "is_favorite": d.get("is_favorite") or 0,
        "captured_at": d.get("captured_at"),
        "width": d.get("width"),
        "height": d.get("height"),
        "duration": d.get("duration"),
        "file_size": d.get("file_size"),
    }


@router.get("/{performer_id}/media")
def browse_media(
    performer_id: int,
    request: Request,
    media_type: str | None = Query(None),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    db = request.app.state.db
    if not db.get_performer(performer_id):
        raise HTTPException(404, detail="Performer not found")

    # Combine manually-added performer_media with auto-captured screenshots
    # linked by performer_id. The latter is the main data source for most
    # performers (manual performer_media is rare).
    with db.connect() as conn:
        pm_rows = conn.execute(
            "SELECT * FROM performer_media WHERE performer_id = ? ORDER BY captured_at DESC",
            (performer_id,),
        ).fetchall()
        shot_rows = conn.execute(
            "SELECT * FROM screenshots WHERE performer_id = ? ORDER BY captured_at DESC",
            (performer_id,),
        ).fetchall()

    app_state = request.app.state
    items: list[dict] = [_performer_media_row_to_media(dict(r)) for r in pm_rows]
    items.extend(_screenshot_row_to_media(dict(r), app_state) for r in shot_rows)

    if media_type in ("photo", "video"):
        items = [m for m in items if m.get("media_type") == media_type]

    items.sort(key=lambda m: m.get("captured_at") or "", reverse=True)

    total = len(items)
    page = items[offset : offset + limit]
    has_more = offset + len(page) < total
    return {"items": page, "total": total, "offset": offset, "limit": limit, "has_more": has_more}


@router.get("/{performer_id}/activity")
def performer_activity(
    performer_id: int,
    request: Request,
    weeks: int = Query(12, ge=1, le=52),
):
    db = request.app.state.db
    if not db.get_performer(performer_id):
        raise HTTPException(404, detail="Performer not found")

    with db.connect() as conn:
        rows = conn.execute(
            """
            SELECT strftime('%Y-%W', captured_at) AS week_key, COUNT(*) AS count
            FROM screenshots
            WHERE performer_id = ?
            GROUP BY week_key
            """,
            (performer_id,),
        ).fetchall()

    counts = {str(row["week_key"] or ""): int(row["count"] or 0) for row in rows}
    now = datetime.utcnow()
    buckets = []
    for index in range(weeks - 1, -1, -1):
        week_key = (now - timedelta(weeks=index)).strftime("%Y-%W")
        buckets.append({"week": week_key, "count": counts.get(week_key, 0)})

    return {
        "weeks": buckets,
        "total": sum(bucket["count"] for bucket in buckets),
    }


@router.post("/{performer_id}/media")
def add_media(performer_id: int, body: AddMediaBody, request: Request):
    db = request.app.state.db
    if not db.get_performer(performer_id):
        raise HTTPException(404, detail="Performer not found")
    try:
        media = db.add_performer_media(
            performer_id=performer_id,
            media_type=body.media_type,
            source_url=body.source_url,
            local_path=body.local_path,
            thumbnail_path=body.thumbnail_path,
            width=body.width,
            height=body.height,
            duration=body.duration,
            file_size=body.file_size,
            caption=body.caption,
        )
        _invalidate_performers_cache(request.app.state)
        return media
    except Exception as e:
        raise HTTPException(400, detail=str(e))


# ── Username variation helpers for coomer.st resolution ───────────────

_COOMER_STRIP_SUFFIXES = [
    "_official", "official", "_xxx", "xxx", "_nyc", "nyc",
    "_fit", "fit", "_real", "real", "_of", "of",
    "_nsfw", "nsfw", "_vip", "vip",
]


def _generate_coomer_username_variants(username: str, display_name: str | None) -> list[str]:
    """Generate plausible coomer.st username variations for a performer.

    Tries the username as-is first, then strips common suffixes,
    tries display_name (lowercased, no spaces), and first-name-only variants.
    """
    seen: set[str] = set()
    variants: list[str] = []

    def _add(v: str) -> None:
        v = v.strip().lower()
        if v and v not in seen:
            seen.add(v)
            variants.append(v)

    # 1. Original username as-is
    _add(username)

    # 2. Strip common suffixes from username
    uname_lower = username.lower()
    for suffix in _COOMER_STRIP_SUFFIXES:
        if uname_lower.endswith(suffix) and len(uname_lower) > len(suffix):
            _add(uname_lower[: -len(suffix)])

    # 3. Remove trailing digits (e.g., "austinwolf69" → "austinwolf")
    stripped_digits = re.sub(r"\d+$", "", uname_lower)
    if stripped_digits and stripped_digits != uname_lower:
        _add(stripped_digits)

    # 4. Remove underscores (e.g., "austin_wolf" → "austinwolf")
    no_underscores = uname_lower.replace("_", "")
    if no_underscores != uname_lower:
        _add(no_underscores)

    # 5. Add common suffixes (the inverse of stripping)
    base_names = list(variants)  # snapshot current list
    for base in base_names:
        for suffix in ("_of", "_xxx", "xxx", "_official", "_xo", "xo", "xx", "ff"):
            _add(base + suffix)

    # 6. Display name variations
    if display_name:
        dn = display_name.strip()
        # Lowercased, spaces removed
        _add(dn.replace(" ", "").lower())
        # Lowercased, spaces to underscores
        _add(dn.replace(" ", "_").lower())
        # First name only (if multi-word)
        parts = dn.split()
        if len(parts) >= 2:
            _add(parts[0].lower())
            # FirstLast concatenated
            _add("".join(parts).lower())

    return variants


def _coomer_try_username(session, service: str, name: str) -> bool:
    """Quick HEAD-style check if a username exists on coomer.st."""
    try:
        resp = session.get(
            f"https://coomer.st/api/v1/{service}/user/{name}/posts",
            params={"o": 0},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/css"},
            timeout=10,
        )
        if resp.status_code == 429:
            print(f"[performer-capture] coomer.st rate-limited checking username '{name}'")
            # Wait and retry once on rate limit
            time.sleep(2)
            resp = session.get(
                f"https://coomer.st/api/v1/{service}/user/{name}/posts",
                params={"o": 0},
                headers={"User-Agent": "Mozilla/5.0", "Accept": "text/css"},
                timeout=10,
            )
        if not resp.ok:
            return False
        posts = resp.json()
        return bool(posts)
    except Exception as e:
        print(f"[performer-capture] coomer.st error checking username '{name}': {e}")
        return False


# In-memory cache of the coomer.st creators list (loaded once per process).
_COOMER_CREATORS_CACHE: list[dict] | None = None
_COOMER_CREATORS_CACHE_LOCK = __import__("threading").Lock()


def _load_coomer_creators_cache(session) -> list[dict]:
    """Fetch the full coomer.st creators list (cached in memory)."""
    global _COOMER_CREATORS_CACHE
    with _COOMER_CREATORS_CACHE_LOCK:
        if _COOMER_CREATORS_CACHE is not None:
            return _COOMER_CREATORS_CACHE
    try:
        resp = session.get(
            "https://coomer.st/api/v1/creators",
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/css"},
            timeout=30,
        )
        if resp.ok:
            data = resp.json()
            if isinstance(data, list):
                with _COOMER_CREATORS_CACHE_LOCK:
                    _COOMER_CREATORS_CACHE = data
                print(f"[performer-capture] loaded coomer.st creators cache: {len(data)} entries")
                return data
    except Exception as e:
        print(f"[performer-capture] failed to load coomer.st creators list: {e}")
    return []


def _coomer_search_username(session, service: str, query: str) -> str | None:
    """Search the coomer.st creators list for a matching username.

    Uses the /api/v1/creators endpoint (full list) and does in-memory
    substring matching to find creators whose id contains the query.
    """
    creators = _load_coomer_creators_cache(session)
    if not creators:
        return None
    query_lower = query.lower().replace(" ", "").replace("_", "")
    if len(query_lower) < 4:
        return None  # too short for reliable matching
    best = None
    best_len_diff = 999
    for c in creators:
        if c.get("service") != service:
            continue
        cid = str(c.get("id", "")).lower()
        cid_clean = cid.replace("_", "")
        # Exact match (normalized)
        if cid_clean == query_lower:
            return cid
        # Substring match — prefer shortest id that contains the query
        if query_lower in cid_clean or cid_clean in query_lower:
            diff = abs(len(cid_clean) - len(query_lower))
            if diff < best_len_diff:
                best = cid
                best_len_diff = diff
    # Only accept close matches (within 6 chars difference)
    if best and best_len_diff <= 6:
        return best
    return None


# ── Capture content for a performer ───────────────────────────────────

def _run_performer_capture(app_state, performer_id: int, username: str, platform: str, display_name: str | None = None) -> int:
    """Run targeted image/video capture for a specific performer. Sync, runs in thread."""
    from app.sources.screenshot import (
        _search_ddg_images,
        _search_redgifs_videos,
        _search_redgifs_user,
        _search_ytdlp_videos,
        _download_file,
        _DDG_EXCLUDE,
        MAX_VIDEOS_PER_TERM,
        MAX_VIDEO_DURATION_S,
    )

    from copy import copy as _copy

    db = app_state.db
    tracked_performer = db.get_performer(performer_id) or {
        "username": username,
        "display_name": display_name,
        "twitter_username": None,
        "reddit_username": None,
        "profile_url": None,
    }
    performer_signature = performer_identity_signature(tracked_performer)
    # Apply DB-configured vision settings so vision filter calls use the user's key
    _settings = app_state.settings
    if _settings is not None:
        _user_settings = db.get_all_settings()
        if _user_settings.get("vision_api_key"):
            _settings = _copy(_settings)
            _settings.openai_api_key = _user_settings["vision_api_key"]
            if _user_settings.get("vision_base_url"):
                _settings.openai_base_url = _user_settings["vision_base_url"]
            if _user_settings.get("vision_model"):
                _settings.openai_model = _user_settings["vision_model"]

    image_dir = Path(app_state.settings.image_dir).parent / "screenshots"
    image_dir.mkdir(parents=True, exist_ok=True)
    session = req.Session()
    captured = 0
    slug = re.sub(r"[^a-zA-Z0-9_]", "_", username.lower())
    seen_page_urls: dict[str, bool] = {}

    def _page_url_exists(page_url: str) -> bool:
        cached = seen_page_urls.get(page_url)
        if cached is not None:
            return cached
        exists = bool(db.screenshot_page_url_exists(page_url))
        seen_page_urls[page_url] = exists
        return exists

    def _mark_page_url(page_url: str) -> None:
        seen_page_urls[page_url] = True

    def _download_job(candidate: dict) -> dict:
        from app.sources.screenshot import _build_session

        with _build_session() as worker_session:
            ok = _download_file(worker_session, candidate["url"], candidate["out_path"], candidate["accept"])
        candidate = dict(candidate)
        candidate["ok"] = ok
        return candidate

    def _download_many(candidates: list[dict], max_workers: int = 4) -> list[dict]:
        if not candidates:
            return []
        downloaded: list[dict] = []
        with ThreadPoolExecutor(max_workers=min(max_workers, len(candidates))) as pool:
            futures = [pool.submit(_download_job, job) for job in candidates]
            for future in as_completed(futures):
                downloaded.append(future.result())
        return downloaded

    # Build all name forms for targeted searching
    # Using both username AND display name ensures specificity
    names: list[str] = [username]
    if display_name and display_name.lower() != username.lower():
        names.append(display_name)

    platform_lower = platform.lower().replace("/", "").replace(" ", "")

    # ── Build highly specific queries for each name form ────────────────────
    queries: list[str] = []
    for name in names:
        q = f'"{name}"'
        # Platform-specific primary sources
        if platform_lower == "onlyfans":
            queries += [
                f'{q} onlyfans nude gay',
                f'{q} onlyfans leaked gay',
                f'{q} site:onlyfans.com',
                                            ]
        elif platform_lower == "fansly":
            queries += [
                f'{q} fansly nude gay',
                f'{q} site:fansly.com',
                            ]
        elif platform_lower in ("twitter", "twitterx", "twitter/x"):
            queries += [
                f'{q} site:x.com nude gay',
                f'{q} site:twitter.com nude',
                f'{q} pbs.twimg.com gay nude',
            ]
        elif platform_lower == "instagram":
            queries += [
                f'{q} instagram nude gay',
                f'{q} site:instagram.com',
            ]
        else:
            queries += [f'{q} nude gay']

        # Cross-platform — always useful
        queries += [
            f'{q} gay nude',
            f'{q} site:reddit.com gay',
            f'{q} site:redgifs.com',
            f'{q} site:thisvid.com gay',
            f'{q} site:xvideos.com gay',
            f'{q} site:pornhub.com gay',
        ]

    # ── DDG image search — strictly quoted names, vision-filtered ───────────
    seen_urls: set[str] = set()
    for q in queries[:12]:  # limit to 12 queries × 10 results = up to 120 candidates
        filtered_q = f"{q} {_DDG_EXCLUDE}"
        results = _search_ddg_images(session, filtered_q, 10, start=0)
        ddg_candidates: list[dict] = []
        for i, row in enumerate(results):
            image_url = row.get("image") or ""
            page_url = row.get("url") or image_url
            if not image_url or image_url in seen_urls:
                continue
            seen_urls.add(image_url)
            if _page_url_exists(page_url):
                continue
            candidate = {
                "term": display_name or username,
                "source": row.get("source") or "ddg",
                "page_url": page_url,
                "url": image_url,
                "title": row.get("title"),
                "text": row.get("title"),
            }
            if not _candidate_mentions_identity(candidate, performer_signature):
                continue
            ddg_candidates.append(candidate)
        if not ddg_candidates:
            continue

        for cand in ddg_candidates:
            image_url = cand["url"]
            ok = True
            # Use strict filter only when vision API key is available;
            # otherwise fall through (identity check already passed above)
            if _settings is not None and _settings.openai_api_key:
                from app.vision_filter import passes_strict_content_filter_url
                if not passes_strict_content_filter_url(_settings, image_url):
                    ok = False
            if ok:
                db.insert_screenshot(
                    term=display_name or username,
                    source="ddg",
                    page_url=cand["page_url"],
                    local_path=None,
                    performer_id=performer_id,
                    source_url=image_url,
                )
                _mark_page_url(cand["page_url"])
                captured += 1

    # ── Coomer.st — scrape OnlyFans/Fansly archive with smart username resolution ──
    if platform_lower in ("onlyfans", "fansly"):
        # Try both services — many OnlyFans creators also appear under fansly and vice versa
        services_to_try = ["onlyfans", "fansly"] if platform_lower == "onlyfans" else ["fansly", "onlyfans"]
        coomer_variants = _generate_coomer_username_variants(username, display_name)
        coomer_resolved_name: str | None = None
        coomer_service = services_to_try[0]
        # Strategy: search the full creators list FIRST (one cached API call)
        # then fall back to per-variant API probes (expensive, many requests)
        for svc in services_to_try:
            for search_term in [username, display_name] if display_name else [username]:
                found = _coomer_search_username(session, svc, search_term)
                if found and _coomer_try_username(session, svc, found):
                    coomer_resolved_name = found
                    coomer_service = svc
                    print(f"[performer-capture] coomer.st creators-list resolved '{search_term}' → '{found}' (service={svc})")
                    break
            if coomer_resolved_name:
                break
        # Fallback: try each variant with direct API probe
        if not coomer_resolved_name:
            for svc in services_to_try:
                for variant in coomer_variants:
                    if _coomer_try_username(session, svc, variant):
                        coomer_resolved_name = variant
                        coomer_service = svc
                        break
                if coomer_resolved_name:
                    break
        if not coomer_resolved_name:
            print(f"[performer-capture] coomer.st: no username found for {username} (tried creators-list + {len(coomer_variants)} variants × {len(services_to_try)} services)")
        if coomer_resolved_name:
            try:
                coomer_offset = 0
                coomer_page_size = 50
                coomer_fetched = 0
                while coomer_fetched < 500:  # cap at 500 items per creator
                    resp = session.get(
                        f"https://coomer.st/api/v1/{coomer_service}/user/{coomer_resolved_name}/posts",
                        params={"o": coomer_offset},
                        headers={
                            "User-Agent": "Mozilla/5.0",
                            "Accept": "text/css",  # required by coomer.st to bypass DDoS protection
                        },
                        timeout=20,
                    )
                    if resp.status_code == 429:
                        time.sleep(3)
                        continue  # retry same offset
                    if not resp.ok:
                        break
                    posts = resp.json()
                    if not posts:
                        break
                    for post in posts:
                        attachments = post.get("attachments") or []
                        # Also check the 'file' field (main post media)
                        main_file = post.get("file")
                        if main_file and isinstance(main_file, dict) and main_file.get("path"):
                            attachments = [main_file] + list(attachments)
                        for att in attachments:
                            att_path = att.get("path") or ""
                            if not att_path:
                                continue
                            media_url = f"https://coomer.st/data{att_path}"
                            page_url = f"https://coomer.st/{coomer_service}/user/{coomer_resolved_name}/post/{post.get('id', '')}"
                            if _page_url_exists(media_url):
                                continue
                            ext = Path(att_path.split("?")[0]).suffix.lower()
                            if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov"}:
                                continue
                            is_video = ext in {".mp4", ".webm", ".mov"}
                            ok = True
                            # Coomer.st content is already from the verified creator page,
                            # so use fail-open vision filter (don't reject when API is unavailable)
                            if not is_video and _settings is not None and _settings.openai_api_key:
                                from app.vision_filter import passes_vision_filter_url
                                if not passes_vision_filter_url(_settings, media_url, fail_open=True):
                                    ok = False
                            if ok:
                                db.insert_screenshot(
                                    term=display_name or username,
                                    source="coomer",
                                    page_url=media_url,
                                    local_path=None,
                                    performer_id=performer_id,
                                    source_url=media_url,
                                )
                                _mark_page_url(media_url)
                                captured += 1
                                coomer_fetched += 1
                    coomer_offset += coomer_page_size
                    if len(posts) < coomer_page_size:
                        break  # no more pages
            except Exception as e:
                print(f"[performer-capture] coomer.st error for {coomer_resolved_name}: {e}")

    # ── Redgifs — search by each name form ──────────────────────────────────
    for name in names:
        try:
            rg_results = _search_redgifs_videos(
                session, name, MAX_VIDEOS_PER_TERM, MAX_VIDEO_DURATION_S, order="top"
            )
            for i, gif in enumerate(rg_results):
                video_url = (gif.get("urls") or {}).get("hd") or (gif.get("urls") or {}).get("sd") or ""
                if not video_url:
                    continue
                page_url = f"https://redgifs.com/watch/{gif.get('id', '')}"
                if _page_url_exists(page_url):
                    continue
                poster_url = (gif.get("urls") or {}).get("poster") or None
                candidate = {
                    "page_url": page_url,
                    "source": "redgifs",
                    "title": gif.get("title"),
                    "username": gif.get("userName") or gif.get("username"),
                    "url": video_url,
                    "image": poster_url,
                }
                if not _candidate_mentions_identity(candidate, performer_signature):
                    continue
                if not _candidate_mentions_identity(candidate, performer_signature):
                    continue
                db.insert_screenshot(
                    term=display_name or username,
                    source="redgifs",
                    page_url=page_url,
                    local_path=None,
                    performer_id=performer_id,
                    source_url=video_url,
                    thumbnail_url=poster_url,
                )
                _mark_page_url(page_url)
                captured += 1
        except Exception as e:
            print(f"[performer-capture] redgifs error for {name}: {e}")

    # ── Redgifs — direct user profile scrape ────────────────────────────────
    # Try the performer's username as a Redgifs handle for a direct profile fetch
    for name in [username] + ([display_name] if display_name and display_name.lower() != username.lower() else []):
        try:
            rg_user_results = _search_redgifs_user(
                session, name, MAX_VIDEOS_PER_TERM * 2, MAX_VIDEO_DURATION_S
            )
            for gif in rg_user_results:
                video_url = (gif.get("urls") or {}).get("hd") or (gif.get("urls") or {}).get("sd") or ""
                if not video_url:
                    continue
                page_url = f"https://redgifs.com/watch/{gif.get('id', '')}"
                if _page_url_exists(page_url):
                    continue
                poster_url = (gif.get("urls") or {}).get("poster") or None
                db.insert_screenshot(
                    term=display_name or username,
                    source="redgifs",
                    page_url=page_url,
                    local_path=None,
                    performer_id=performer_id,
                    source_url=video_url,
                    thumbnail_url=poster_url,
                )
                _mark_page_url(page_url)
                captured += 1
        except Exception as e:
            print(f"[performer-capture] redgifs user profile error for {name}: {e}")

    # ── yt-dlp — search tube sites + X/Twitter by creator name ─────────────
    ytdlp_jobs = [name for name in names]
    if len(ytdlp_jobs) > 1:
        with ThreadPoolExecutor(max_workers=min(2, len(ytdlp_jobs))) as pool:
            ytdlp_results_by_name = list(pool.map(lambda n: (n, _search_ytdlp_videos(
                f'"{n}" gay',
                image_dir,
                slug,
                db,
                max_count=5,
                settings=_settings,
            )), ytdlp_jobs))
    else:
        ytdlp_results_by_name = [(name, _search_ytdlp_videos(
            f'"{name}" gay',
            image_dir,
            slug,
            db,
            max_count=5,
            settings=_settings,
        )) for name in ytdlp_jobs]

    for name, ytdlp_results in ytdlp_results_by_name:
        try:
            for result in ytdlp_results:
                if result.get("ok"):
                    candidate = {
                        "page_url": result.get("page_url", ""),
                        "url": result.get("source_url", ""),
                        "image": result.get("thumbnail_url"),
                        "title": result.get("title"),
                        "username": result.get("uploader") or result.get("channel"),
                        "display_name": result.get("uploader"),
                        "description": result.get("description"),
                    }
                    if not _candidate_mentions_identity(candidate, performer_signature):
                        continue
                    db.insert_screenshot(
                        term=display_name or username,
                        source="ytdlp",
                        page_url=result.get("page_url", ""),
                        local_path=result.get("local_path"),
                        performer_id=performer_id,
                        source_url=result.get("source_url", ""),
                        thumbnail_url=result.get("thumbnail_url"),
                    )
                    captured += 1
        except Exception as e:
            print(f"[performer-capture] ytdlp error for {name}: {e}")

    # ── X/Twitter profile videos — download directly via yt-dlp ─────────────
    # Try the performer's Twitter handle to pull video tweets from their timeline
    twitter_usernames: list[str] = []
    if platform_lower in ("twitter", "twitterx", "twitter/x"):
        twitter_usernames.append(username.lstrip("@"))
    # Also check performer_links for a twitter URL
    try:
        with db.connect() as conn:
            tw_links = conn.execute(
                "SELECT url FROM performer_links WHERE performer_id = ? AND (platform = 'twitter' OR url LIKE '%twitter.com%' OR url LIKE '%x.com/%')",
                (performer_id,),
            ).fetchall()
        for lnk in tw_links:
            lnk_url = lnk["url"] or ""
            m = re.search(r"(?:twitter\.com|x\.com)/([A-Za-z0-9_]+)", lnk_url)
            if m:
                tw_handle = m.group(1)
                if tw_handle not in twitter_usernames:
                    twitter_usernames.append(tw_handle)
    except Exception:
        pass
    # Also check performer_links for a Twitter URL
    try:
        import yt_dlp as _yt_dlp
        _yt_avail = True
    except ImportError:
        _yt_avail = False

    if _yt_avail:
        twitter_targets = twitter_usernames[:2]

        def _capture_twitter_user(tw_user: str) -> int:
            profile_url = f"https://twitter.com/{tw_user}/media"
            _tw_opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": True,
                "playlistend": 10,
                "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
            }
            try:
                with _yt_dlp.YoutubeDL({**_tw_opts, "extract_flat": True, "playlistend": 10}) as ydl:
                    info = ydl.extract_info(profile_url, download=False)
                    entries = (info or {}).get("entries") or []
            except Exception as e:
                print(f"[performer-capture] twitter extract error for @{tw_user}: {e}")
                return 0

            _extract_opts = {
                "quiet": True,
                "no_warnings": True,
                "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
            }

            tweet_urls: list[str] = []
            for entry in entries:
                if len(tweet_urls) >= 5:
                    break
                tweet_url = entry.get("url") or entry.get("webpage_url") or ""
                if not tweet_url or _page_url_exists(tweet_url):
                    continue
                tweet_urls.append(tweet_url)

            if not tweet_urls:
                return 0

            def _extract_tweet(tweet_url: str) -> dict:
                try:
                    with _yt_dlp.YoutubeDL(_extract_opts) as ydl:
                        info = ydl.extract_info(tweet_url, download=False)
                    if not info:
                        return {"tweet_url": tweet_url, "ok": False}
                    stream_url = info.get("url")
                    if not stream_url:
                        formats = info.get("formats") or []
                        best = None
                        for fmt in formats:
                            ext = fmt.get("ext", "")
                            height = fmt.get("height") or 0
                            fmt_url = fmt.get("url")
                            if not fmt_url:
                                continue
                            if ext == "mp4" and 0 < height <= 720:
                                if best is None or (fmt.get("height") or 0) > (best.get("height") or 0):
                                    best = fmt
                        if best is None:
                            for fmt in reversed(formats):
                                if fmt.get("url"):
                                    best = fmt
                                    break
                        if best:
                            stream_url = best["url"]
                    return {"tweet_url": tweet_url, "stream_url": stream_url, "ok": bool(stream_url)}
                except Exception:
                    return {"tweet_url": tweet_url, "ok": False}

            extracted = 0
            with ThreadPoolExecutor(max_workers=min(2, len(tweet_urls))) as pool:
                futures = [pool.submit(_extract_tweet, u) for u in tweet_urls]
                completed_jobs = [future.result() for future in as_completed(futures)]

            for job in completed_jobs:
                if not job.get("ok"):
                    continue
                tweet_url = job["tweet_url"]
                candidate = {
                    "page_url": tweet_url,
                    "url": job.get("stream_url", ""),
                    "username": tw_user,
                }
                if not _candidate_mentions_identity(candidate, performer_signature):
                    continue
                db.insert_screenshot(
                    term=display_name or username,
                    source="ytdlp",
                    page_url=tweet_url,
                    local_path=None,
                    performer_id=performer_id,
                    source_url=job.get("stream_url", ""),
                )
                captured_nonlocal[0] += 1
                extracted += 1
                _mark_page_url(tweet_url)
            return extracted

        captured_nonlocal = [captured]
        for tw_user in twitter_targets:
            try:
                captured_this = _capture_twitter_user(tw_user)
                if captured_this:
                    captured_nonlocal[0] += 0
            except Exception as e:
                print(f"[performer-capture] twitter error for @{tw_user}: {e}")
        captured = captured_nonlocal[0]

    print(f"[performer-capture] {display_name or username}: captured {captured} items")
    with db.connect() as conn:
        conn.execute("UPDATE performers SET last_checked_at = datetime('now') WHERE id = ?", (performer_id,))
        conn.commit()
    # Invalidate DB-level caches so new captures appear immediately
    if captured > 0:
        db._invalidate_snapshot_cache()
    return captured


@router.post("/{performer_id}/capture")
def capture_performer_content(performer_id: int, request: Request):
    """Enqueue a targeted capture for a specific performer."""
    db = request.app.state.db
    performer = db.get_performer(performer_id)
    if not performer:
        raise HTTPException(404, detail="Performer not found")
    entry = db.enqueue_capture(performer_id)
    if entry is None:
        return {"status": "already_queued", "performer_id": performer_id}
    return {"status": "queued", "performer_id": performer_id}


@router.post("/enrich/{performer_id}")
def enrich_performer(performer_id: int, request: Request):
    """Attempt to discover a real creator avatar from official or social profile sources."""
    db = request.app.state.db
    performer = db.get_performer(performer_id)
    if not performer:
        raise HTTPException(404, detail="Performer not found")
    username = performer["username"]
    avatar_url = None
    try:
        resp = req.get(
            f"https://api.redgifs.com/v2/users/{username.lower()}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=8,
        )
        if resp.ok:
            data = resp.json()
            user = data.get("user") or {}
            avatar_url = user.get("profileImageUrl") or user.get("poster") or None
    except Exception as exc:
        print(f"[enrich] redgifs error for {username}: {exc}")
    if not avatar_url:
        for profile_url in _candidate_avatar_urls(performer):
            avatar_url = _extract_avatar_from_profile_url(profile_url)
            if avatar_url:
                break
    should_update = bool(avatar_url and (avatar_url != performer.get("avatar_url") or performer.get("avatar_local")))
    if should_update:
        db.update_performer(performer_id, avatar_url=avatar_url, avatar_local=None)
        _invalidate_performers_cache(request.app.state)
    return {"avatar_url": avatar_url, "updated": should_update}


@router.get("/{performer_id}/similar")
def find_similar_performers(performer_id: int, request: Request, limit: int = 8):
    """Find performers with overlapping tags and identity signals, not just broad tag overlap."""
    db = request.app.state.db
    cache_key = f"similar:{performer_id}:{limit}"

    def build():
        with db.connect() as conn:
            source = conn.execute(
                "SELECT id, username, display_name, tags, platform, media_count, is_verified, is_favorite, status FROM performers WHERE id = ?",
                (performer_id,),
            ).fetchone()
            if not source:
                return []

            src_tags: set[str] = set()
            if source["tags"]:
                try:
                    parsed = json.loads(source["tags"])
                    if isinstance(parsed, list):
                        src_tags = {t.lower().strip() for t in parsed if isinstance(t, str)}
                    elif isinstance(parsed, str):
                        src_tags = {t.strip().lower() for t in parsed.split(",") if t.strip()}
                except (json.JSONDecodeError, TypeError):
                    src_tags = {t.strip().lower() for t in source["tags"].split(",") if t.strip()}

            candidates = conn.execute(
                "SELECT id, username, display_name, platform, avatar_url, avatar_local, tags, is_favorite, media_count, status, is_verified, profile_url "
                "FROM performers WHERE id != ? LIMIT 200",
                (performer_id,),
            ).fetchall()

            scored: list[tuple[float, dict]] = []
            for row in candidates:
                d = dict(row)
                cand_tags: set[str] = set()
                if d["tags"]:
                    try:
                        parsed = json.loads(d["tags"])
                        if isinstance(parsed, list):
                            cand_tags = {t.lower().strip() for t in parsed if isinstance(t, str)}
                        elif isinstance(parsed, str):
                            cand_tags = {t.strip().lower() for t in parsed.split(",") if t.strip()}
                    except (json.JSONDecodeError, TypeError):
                        cand_tags = {t.strip().lower() for t in d["tags"].split(",") if t.strip()}

                score = 0.0
                reasons: list[str] = []

                overlap = len(src_tags & cand_tags) if src_tags else 0
                if overlap > 0:
                    score += overlap * 3.0
                    reasons.append(f"{overlap} shared tags")

                if source["platform"] == d.get("platform"):
                    score += 1.5
                    reasons.append("same platform")

                src_name = " ".join(filter(None, [source["username"], source["display_name"] or ""])).lower()
                cand_name = " ".join(filter(None, [d["username"], d.get("display_name") or ""])).lower()
                name_similarity = SequenceMatcher(None, src_name, cand_name).ratio()
                if name_similarity >= 0.55:
                    score += name_similarity * 2.0
                    reasons.append("name similarity")

                if d.get("is_verified"):
                    score += 0.5
                    reasons.append("verified")
                if d.get("is_favorite"):
                    score += 0.25
                    reasons.append("favorited")
                if d.get("status") == "active":
                    score += 0.25
                media_count = int(d.get("media_count") or 0)
                if media_count > 0:
                    score += min(1.5, math.log1p(media_count) / 3.5)

                if d.get("avatar_url"):
                    score += 0.25

                if score > 0:
                    d["similarity_score"] = round(score, 2)
                    if reasons:
                        d["match_reason"] = ", ".join(reasons[:3])
                    scored.append((score, d))

            scored.sort(key=lambda x: (-x[0], -(x[1].get("media_count") or 0), x[1].get("username") or ""))
            return [item for _, item in scored[:limit]]

    return _get_cached_performers_payload(request.app.state, cache_key, 60.0, build)
