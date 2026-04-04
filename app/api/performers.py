from __future__ import annotations

import json
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock
import time
from urllib.parse import urlparse

import requests as req
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/performers", tags=["performers"])

_FIRST_PAGE_LIMIT_CAP_COMPACT = 36
_FIRST_PAGE_LIMIT_CAP_FULL = 24


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
    """Match existing screenshots to performers by username/aliases in term/page_url/ai_summary."""
    db = request.app.state.db
    linked = 0
    performers_matched = 0

    with db.connect() as conn:
        performers = conn.execute(
            "SELECT id, username, display_name, twitter_username, reddit_username FROM performers"
        ).fetchall()

    with db.connect() as conn:
        for p in performers:
            pid = p["id"]
            # Build list of all name forms to match against
            names: list[str] = [p["username"].lower()]
            for alias_col in ("display_name", "twitter_username", "reddit_username"):
                val = p[alias_col]
                if val:
                    names.append(val.lower())

            count = 0
            for name in names:
                cur = conn.execute(
                    """
                    UPDATE screenshots
                    SET performer_id = ?
                    WHERE performer_id IS NULL
                      AND (
                        LOWER(term) = ?
                        OR LOWER(term) LIKE ?
                        OR LOWER(page_url) LIKE ?
                        OR LOWER(COALESCE(ai_summary, '')) LIKE ?
                      )
                    """,
                    (pid, name, f"%{name}%", f"%{name}%", f"%{name}%"),
                )
                count += cur.rowcount
            if count > 0:
                linked += count
                performers_matched += 1
        conn.commit()

    if linked:
        _invalidate_performers_cache(request.app.state)
    return {"linked": linked, "performers_matched": performers_matched}


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
    return len(non_generic_tokens) >= 2


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


def _load_existing_performer_directory(db) -> tuple[list[dict], dict[str, dict], dict[str, dict]]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, platform, bio, tags, twitter_username, reddit_username "
            "FROM performers"
        ).fetchall()

    performers = [dict(row) for row in rows]
    username_lookup: dict[str, dict] = {}
    alias_lookup: dict[str, dict] = {}

    for performer in performers:
        username = str(performer.get("username") or "").strip()
        if username:
            username_lookup[username.lower()] = performer
        for alias in (
            username,
            performer.get("display_name"),
            performer.get("twitter_username"),
            performer.get("reddit_username"),
        ):
            normalized_alias = _normalize_creator_alias(str(alias)) if alias else ""
            if normalized_alias and normalized_alias not in alias_lookup:
                alias_lookup[normalized_alias] = performer

    return performers, username_lookup, alias_lookup


def _find_existing_performer_match(
    username: str,
    display_name: str | None,
    username_lookup: dict[str, dict],
    alias_lookup: dict[str, dict],
) -> dict | None:
    direct = username_lookup.get(username.strip().lower())
    if direct:
        return direct
    for alias in (username, display_name or ""):
        normalized_alias = _normalize_creator_alias(alias)
        if normalized_alias and normalized_alias in alias_lookup:
            return alias_lookup[normalized_alias]
    return None


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
            resp.raise_for_status()
            raw = str(resp.json()["choices"][0]["message"].get("content") or "").strip()
            suggestions = _coerce_discovery_suggestions(_parse_discovery_payload(raw))
            if suggestions:
                return suggestions
            print(f"[performers] discover {label} attempt produced no usable suggestions")
        except Exception as exc:
            print(f"[performers] discover {label} attempt failed: {exc}")
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

        existing_match = _find_existing_performer_match(username, display_name, username_lookup, alias_lookup)
        normalized_platform = _normalize_platform_name(str(candidate.get("platform") or "")) or desired_platform or "OnlyFans"
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
        score += 1.5 if existing_match is None else 0.5
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
    settings = request.app.state.settings
    db = request.app.state.db
    limit = max(1, min(body.limit, 20))
    seed_context = _build_discovery_seed_context(db, body.seed_performer_id, body.seed_term)
    query = (body.query or "").strip()
    if not query and not seed_context.get("seed_performer") and not seed_context.get("seed_term"):
        raise HTTPException(400, detail="Provide a query or seed performer")
    _, username_lookup, alias_lookup = _load_existing_performer_directory(db)
    existing_usernames = sorted(username_lookup.keys())[:250]

    prompt = (
        f"Suggest up to {limit} creators that fit this discovery request. "
        f"Discovery query: {query or 'Use the supplied seed creator and term context.'}. "
        f"Preferred platform: {_normalize_platform_name(body.platform) or 'any'}. "
        f"Seed context: {json.dumps(seed_context, ensure_ascii=True)}. "
        f"Prefer creators not already in this app, but if the strongest matches are already tracked, include them anyway. "
        f"Already tracked usernames: {json.dumps(existing_usernames, ensure_ascii=True)}. "
        f"Return JSON with a 'suggestions' array. Each item should include username, display_name, platform "
        f"(OnlyFans, Twitter/X, Instagram, Reddit, or Fansly), bio, tags, and reason."
    )

    ai_suggestions = _request_discovery_suggestions(settings, prompt)
    heuristic_suggestions = _heuristic_discover_performers(
        db,
        query=query,
        platform_hint=body.platform,
        seed_context=seed_context,
        limit=limit * 2,
        username_lookup=username_lookup,
        alias_lookup=alias_lookup,
    )

    results: list[dict] = []
    seen_aliases: set[str] = set()
    for suggestion in [*ai_suggestions, *heuristic_suggestions]:
        username = str(suggestion.get("username") or "").strip().lstrip("@")
        display_name = str(suggestion.get("display_name") or "").strip()
        if not username:
            continue

        existing_match = _find_existing_performer_match(username, display_name, username_lookup, alias_lookup)
        normalized_platform = _normalize_platform_name(str(suggestion.get("platform") or "")) or _normalize_platform_name(body.platform) or "OnlyFans"
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
        results.append(
            {
                "username": username,
                "display_name": display_name or None,
                "platform": normalized_platform,
                "bio": str(suggestion.get("bio") or ""),
                "tags": normalized_tags[:5],
                "reason": str(suggestion.get("reason") or ""),
                "exists": existing_match is not None,
            }
        )
        if len(results) >= limit:
            break

    return {"suggestions": results}


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

        current = _find_existing_performer_match(username, creator.display_name, username_lookup, alias_lookup)
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


# ── Single performer ──────────────────────────────────────────────────

@router.get("/{performer_id}")
def get_performer(performer_id: int, request: Request):
    db = request.app.state.db
    performer = db.get_performer(performer_id)
    if not performer:
        raise HTTPException(404, detail="Performer not found")
    links = db.get_performer_links(performer_id)
    media_result = db.browse_performer_media(performer_id=performer_id, limit=0)
    with db.connect() as conn:
        screenshots_count = conn.execute(
            "SELECT COUNT(*) FROM screenshots WHERE performer_id = ?", (performer_id,)
        ).fetchone()[0]
    performer["links"] = links
    performer["link_count"] = len(links)
    performer["media_count_actual"] = media_result["total"]
    performer["screenshots_count"] = screenshots_count
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
    return db.browse_performer_media(
        performer_id=performer_id,
        media_type=media_type,
        limit=limit,
        offset=offset,
    )


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
                f'{q} site:coomer.st',        # OF archiver
                f'{q} site:kemono.su',        # OF archiver
            ]
        elif platform_lower == "fansly":
            queries += [
                f'{q} fansly nude gay',
                f'{q} site:fansly.com',
                f'{q} site:coomer.st',
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
        ddg_jobs: list[dict] = []
        for i, row in enumerate(results):
            image_url = row.get("image") or ""
            page_url = row.get("url") or image_url
            if not image_url or image_url in seen_urls:
                continue
            seen_urls.add(image_url)
            if _page_url_exists(page_url):
                continue
            ext = Path(image_url.split("?")[0]).suffix.lower()
            if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp"}:
                ext = ".jpg"
            out_path = image_dir / f"{slug}_ddg_{uuid.uuid4().hex[:8]}{ext}"
            ddg_jobs.append({
                "term": display_name or username,
                "source": "ddg",
                "page_url": page_url,
                "url": image_url,
                "out_path": out_path,
                "accept": ("image/",),
            })
        if not ddg_jobs:
            continue

        for job in _download_many(ddg_jobs, max_workers=4):
            ok = bool(job.get("ok"))
            out_path = job["out_path"]
            if ok and _settings is not None:
                from app.vision_filter import contains_women, passes_vision_filter
                if contains_women(_settings, str(out_path)):
                    out_path.unlink(missing_ok=True)
                    ok = False
                elif not passes_vision_filter(_settings, str(out_path)):
                    out_path.unlink(missing_ok=True)
                    ok = False
            if ok:
                db.insert_screenshot(
                    term=display_name or username,
                    source="ddg",
                    page_url=job["page_url"],
                    local_path=str(out_path),
                    performer_id=performer_id,
                )
                _mark_page_url(job["page_url"])
                captured += 1

    # ── Coomer.su — scrape OnlyFans/Fansly archive directly ─────────────────
    if platform_lower in ("onlyfans", "fansly"):
        coomer_service = "onlyfans" if platform_lower == "onlyfans" else "fansly"
        for name in names:
            try:
                coomer_offset = 0
                coomer_page_size = 50
                coomer_fetched = 0
                while coomer_fetched < 500:  # cap at 500 items per creator
                    resp = session.get(
                        f"https://coomer.st/api/v1/{coomer_service}/user/{name}/posts",
                        params={"o": coomer_offset},
                        headers={
                            "User-Agent": "Mozilla/5.0",
                            "Accept": "text/css",  # required by coomer.st to bypass DDoS protection
                        },
                        timeout=20,
                    )
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
                        coomer_jobs: list[dict] = []
                        for att in attachments:
                            att_path = att.get("path") or ""
                            if not att_path:
                                continue
                            media_url = f"https://coomer.st/data{att_path}"
                            page_url = f"https://coomer.st/{coomer_service}/user/{name}/post/{post.get('id', '')}"
                            if _page_url_exists(media_url):
                                continue
                            ext = Path(att_path.split("?")[0]).suffix.lower()
                            if ext not in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".webm", ".mov"}:
                                continue
                            out_path = image_dir / f"{slug}_cm_{uuid.uuid4().hex[:8]}{ext}"
                            is_video = ext in {".mp4", ".webm", ".mov"}
                            coomer_jobs.append({
                                "term": display_name or username,
                                "source": "coomer",
                                "page_url": media_url,
                                "url": media_url,
                                "out_path": out_path,
                                "accept": (("video/",) if is_video else ("image/",)),
                                "is_video": is_video,
                            })
                        if coomer_jobs:
                            for job in _download_many(coomer_jobs, max_workers=4):
                                ok = bool(job.get("ok"))
                                out_path = job["out_path"]
                                is_video = bool(job.get("is_video"))
                                if ok and not is_video and _settings is not None:
                                    from app.vision_filter import contains_women, passes_vision_filter
                                    if contains_women(_settings, str(out_path)):
                                        out_path.unlink(missing_ok=True)
                                        ok = False
                                    elif not passes_vision_filter(_settings, str(out_path)):
                                        out_path.unlink(missing_ok=True)
                                        ok = False
                                if ok:
                                    db.insert_screenshot(
                                        term=display_name or username,
                                        source="coomer",
                                        page_url=job["page_url"],
                                        local_path=str(out_path),
                                        performer_id=performer_id,
                                    )
                                    _mark_page_url(job["page_url"])
                                    captured += 1
                                    coomer_fetched += 1
                    coomer_offset += coomer_page_size
                    if len(posts) < coomer_page_size:
                        break  # no more pages
            except Exception as e:
                print(f"[performer-capture] coomer.st error for {name}: {e}")

    # ── Redgifs — search by each name form ──────────────────────────────────
    for name in names:
        try:
            rg_results = _search_redgifs_videos(
                session, name, MAX_VIDEOS_PER_TERM, MAX_VIDEO_DURATION_S, order="top"
            )
            redgifs_jobs: list[dict] = []
            for i, gif in enumerate(rg_results):
                video_url = (gif.get("urls") or {}).get("hd") or (gif.get("urls") or {}).get("sd") or ""
                if not video_url:
                    continue
                page_url = f"https://redgifs.com/watch/{gif.get('id', '')}"
                if _page_url_exists(page_url):
                    continue
                ext = Path(video_url.split("?")[0]).suffix.lower() or ".mp4"
                out_path = image_dir / f"{slug}_rg_{uuid.uuid4().hex[:8]}{ext}"
                redgifs_jobs.append({
                    "term": display_name or username,
                    "source": "redgifs",
                    "page_url": page_url,
                    "url": video_url,
                    "out_path": out_path,
                    "accept": ("video/",),
                })
            if redgifs_jobs:
                for job in _download_many(redgifs_jobs, max_workers=3):
                    ok = bool(job.get("ok"))
                    out_path = job["out_path"]
                    if ok and _settings is not None and not _check_downloaded_video_vision(out_path, _settings):
                        out_path.unlink(missing_ok=True)
                        ok = False
                    if ok:
                        db.insert_screenshot(
                            term=display_name or username,
                            source="redgifs",
                            page_url=job["page_url"],
                            local_path=str(out_path),
                            performer_id=performer_id,
                        )
                        _mark_page_url(job["page_url"])
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
            rg_user_jobs: list[dict] = []
            for gif in rg_user_results:
                video_url = (gif.get("urls") or {}).get("hd") or (gif.get("urls") or {}).get("sd") or ""
                if not video_url:
                    continue
                page_url = f"https://redgifs.com/watch/{gif.get('id', '')}"
                if _page_url_exists(page_url):
                    continue
                ext = Path(video_url.split("?")[0]).suffix.lower() or ".mp4"
                out_path = image_dir / f"{slug}_rgu_{uuid.uuid4().hex[:8]}{ext}"
                rg_user_jobs.append({
                    "term": display_name or username,
                    "source": "redgifs",
                    "page_url": page_url,
                    "url": video_url,
                    "out_path": out_path,
                    "accept": ("video/",),
                })
            if rg_user_jobs:
                for job in _download_many(rg_user_jobs, max_workers=3):
                    ok = bool(job.get("ok"))
                    out_path = job["out_path"]
                    if ok and _settings is not None and not _check_downloaded_video_vision(out_path, _settings):
                        out_path.unlink(missing_ok=True)
                        ok = False
                    if ok:
                        db.insert_screenshot(
                            term=display_name or username,
                            source="redgifs",
                            page_url=job["page_url"],
                            local_path=str(out_path),
                            performer_id=performer_id,
                        )
                        _mark_page_url(job["page_url"])
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
                if result.get("ok") and result.get("local_path"):
                    db.insert_screenshot(
                        term=display_name or username,
                        source="ytdlp",
                        page_url=result.get("page_url", ""),
                        local_path=result["local_path"],
                        performer_id=performer_id,
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
                "merge_output_format": "mp4",
                "max_filesize": 200 * 1024 * 1024,
            }
            try:
                with _yt_dlp.YoutubeDL({**_tw_opts, "extract_flat": True, "playlistend": 10}) as ydl:
                    info = ydl.extract_info(profile_url, download=False)
                    entries = (info or {}).get("entries") or []
            except Exception as e:
                print(f"[performer-capture] twitter extract error for @{tw_user}: {e}")
                return 0

            tweet_jobs: list[dict] = []
            for entry in entries:
                if len(tweet_jobs) >= 5:
                    break
                tweet_url = entry.get("url") or entry.get("webpage_url") or ""
                if not tweet_url or _page_url_exists(tweet_url):
                    continue
                out_path = image_dir / f"{slug}_tw_{uuid.uuid4().hex[:8]}.mp4"
                tweet_jobs.append({
                    "tweet_url": tweet_url,
                    "out_path": out_path,
                    "yt_opts": _tw_opts,
                })

            if not tweet_jobs:
                return 0

            def _download_tweet(job: dict) -> dict:
                out_path = Path(job["out_path"])
                try:
                    with _yt_dlp.YoutubeDL({**job["yt_opts"], "outtmpl": str(out_path), "extract_flat": False}) as ydl:
                        ydl.download([job["tweet_url"]])
                    ok = out_path.exists() and out_path.stat().st_size > 0
                except Exception:
                    ok = False
                if not ok:
                    out_path.unlink(missing_ok=True)
                return {**job, "ok": ok}

            downloaded = 0
            with ThreadPoolExecutor(max_workers=min(2, len(tweet_jobs))) as pool:
                futures = [pool.submit(_download_tweet, job) for job in tweet_jobs]
                completed_jobs = [future.result() for future in as_completed(futures)]

            for job in completed_jobs:
                if not job.get("ok"):
                    continue
                tweet_url = job["tweet_url"]
                out_path = Path(job["out_path"])
                db.insert_screenshot(
                    term=display_name or username,
                    source="ytdlp",
                    page_url=tweet_url,
                    local_path=str(out_path),
                    performer_id=performer_id,
                )
                captured_nonlocal[0] += 1
                downloaded += 1
                _mark_page_url(tweet_url)
            return downloaded

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


@router.post("/enrich/{performer_id}")
def enrich_performer(performer_id: int, request: Request):
    """Attempt to fetch avatar_url from Redgifs user profile (best-effort)."""
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
    if avatar_url and not performer.get("avatar_url"):
        db.update_performer(performer_id, avatar_url=avatar_url)
        _invalidate_performers_cache(request.app.state)
    return {"avatar_url": avatar_url, "updated": bool(avatar_url and not performer.get("avatar_url"))}


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


@router.get("/{performer_id}/similar")
def find_similar_performers(performer_id: int, request: Request, limit: int = 8):
    """Find performers with overlapping tags."""
    db = request.app.state.db
    cache_key = f"similar:{performer_id}:{limit}"

    def build():
        with db.connect() as conn:
            source = conn.execute("SELECT id, tags, platform FROM performers WHERE id = ?", (performer_id,)).fetchone()
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
                "SELECT id, username, display_name, platform, avatar_url, avatar_local, tags, is_favorite, media_count, status "
                "FROM performers WHERE id != ? LIMIT 200",
                (performer_id,),
            ).fetchall()

            scored: list[tuple[int, dict]] = []
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

                overlap = len(src_tags & cand_tags) if src_tags else 0
                if overlap > 0:
                    scored.append((overlap, d))

            scored.sort(key=lambda x: -x[0])
            return [item for _, item in scored[:limit]]

    return _get_cached_performers_payload(request.app.state, cache_key, 60.0, build)


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
