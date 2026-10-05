"""X (Twitter) discovery through the official API v2 (app-only bearer token).

Endpoints (https://api.x.com):
  GET /2/users/by/username/{username}      exact-handle lookup (watchlist handles)
  GET /2/users/{id}/tweets                 public timeline, retweets/replies excluded
  GET /2/tweets/search/recent              rotating hashtag queries (default feed)

Only public posts whose media lives on pbs.twimg.com / video.twimg.com are kept.
Posts the author flagged ``possibly_sensitive`` are adult-labelled and kept
(adults-only app); posts that signal minors / non-consent / illegality are
dropped. Everything is attributed to X and links back to the post and profile.

Budgets: search calls are capped per backend request and per hour, results are
cached in memory (never below 10 minutes), and a 401/402/403/429 puts that
endpoint group on a cooldown so a feed reload cannot burn quota. No response is
ever written to disk and the bearer token is never logged.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from .common import (
    RunCounter,
    TTLCache,
    api_request,
    call_timeout,
    canonical,
    clean_int,
    clean_text,
    empty_result,
    int_setting,
    mark_watched,
    media_item,
    now_iso,
    run_parallel,
    safe_https_any,
    source_status,
    split_list,
    strip_shortlinks,
    text_setting,
)
from .safety import is_unsafe_identifier, is_unsafe_text, looks_like_adult_promo

logger = logging.getLogger(__name__)

X_API = "https://api.x.com"
X_SEARCH_PAGE = "https://x.com/search?q=gay%20creator&src=typed_query&f=live"

DEFAULT_QUERIES: tuple[str, ...] = (
    "(#gay OR #gaymen OR #gaycreator) has:media -is:retweet -is:reply lang:en",
    "(#gaymuscle OR #gaybear OR #musclebear OR #gaybeard) has:media -is:retweet -is:reply lang:en",
    "(#gaycouple OR #gayfitness OR #gaycontentcreator OR #gayartist) has:media -is:retweet -is:reply lang:en",
)

TWEET_FIELDS = "created_at,public_metrics,possibly_sensitive,lang"
MEDIA_FIELDS = "type,url,preview_image_url,variants,duration_ms,width,height"
USER_FIELDS = "username,name,profile_image_url,public_metrics,description"
EXPANSIONS = "attachments.media_keys,author_id"

MIN_CACHE_TTL = 600  # seconds; repeated feed loads must never re-spend quota sooner
USER_CACHE_TTL = 6 * 3600
MISSING_USER_TTL = 3600
MAX_MEDIA = 100
MAX_QUERIES = 6
MAX_VIDEO_SHORT_SIDE = 1080

_HANDLE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
_HASHTAG = re.compile(r"#(\w{2,30})")
_RES_IN_PATH = re.compile(r"/(\d{2,5})x(\d{2,5})/")
_AVATAR = re.compile(r"_normal(\.\w+)$")
_QUERY_UNSAFE = re.compile(r"[^\w#@' \-]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_REASON_HINTS = (
    ("client-not-enrolled", "X credentials are not attached to a developer Project/App with API access"),
    ("usagecapexceeded", "X API usage cap for this plan is exhausted"),
    ("creditsdepleted", "X API credits for this plan are depleted"),
    ("client-forbidden", "this X API plan does not include the endpoint"),
)


class _State:
    """Per-process budgets, caches and cooldowns (memory only)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.search_cache = TTLCache(64)
        self.timeline_cache = TTLCache(128)
        self.user_cache = TTLCache(256)
        self.blocked: dict[str, tuple[float, str, str]] = {}
        self.search_calls: deque[float] = deque()
        self.cursor = 0

    def reset(self) -> None:
        self.__init__()  # type: ignore[misc]


_STATE = _State()
_epoch = time.time  # patched in tests


def reset_state() -> None:
    """Forget caches, cooldowns and the rotation cursor (tests)."""
    _STATE.reset()


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------


def discovery_queries(settings: Any) -> list[str]:
    configured = [
        " ".join(_CONTROL.sub(" ", query).split())[:480]
        for query in split_list(text_setting(settings, "x_discovery_queries"), "||")
    ]
    queries = [query for query in configured if query][:MAX_QUERIES]
    return queries or list(DEFAULT_QUERIES)


def _search_ttl(settings: Any) -> int:
    return max(MIN_CACHE_TTL, int_setting(settings, "x_search_cache_ttl_seconds", 900, minimum=0, maximum=86_400))


def _timeline_ttl(settings: Any) -> int:
    return max(MIN_CACHE_TTL, int_setting(settings, "x_timeline_cache_ttl_seconds", 600, minimum=0, maximum=86_400))


def handle_candidates(entries: list[str]) -> list[str]:
    """Watchlist entries that look like exact X handles (names with spaces are not looked up)."""
    handles: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        value = str(entry or "").strip().lstrip("@")
        key = value.lower()
        if _HANDLE.match(value) and key not in seen:
            seen.add(key)
            handles.append(value)
    return handles


def _search_text_query(query: str) -> str:
    words = " ".join(_QUERY_UNSAFE.sub(" ", query).split())[:80]
    return f"({words}) has:media -is:retweet -is:reply" if words else ""


# ---------------------------------------------------------------------------
# Mapping (pure functions)
# ---------------------------------------------------------------------------


def _valid_username(value: Any) -> str:
    username = str(value or "").strip()
    return username if _HANDLE.match(username) else ""


def upgrade_avatar(url: str) -> str:
    return _AVATAR.sub(r"_400x400\1", url) if url else url


def best_mp4_variants(variants: Any, limit: int = 2) -> list[tuple[str, int, int]]:
    """Best progressive mp4s on video.twimg.com, short side <= 1080, highest first.

    Returns (url, width, height); width/height are 0 when the path has no WxH.
    """
    ranked: list[tuple[int, int, str, int, int]] = []
    for variant in variants if isinstance(variants, list) else []:
        if not isinstance(variant, dict) or variant.get("content_type") != "video/mp4":
            continue
        url = safe_https_any(variant.get("url"), ("video.twimg.com",))
        if not url:
            continue
        match = _RES_IN_PATH.search(url)
        width, height = (int(match.group(1)), int(match.group(2))) if match else (0, 0)
        short_side = min(width, height) if match else 0
        if short_side > MAX_VIDEO_SHORT_SIDE:
            continue
        ranked.append((short_side, clean_int(variant.get("bit_rate")), url, width, height))
    ranked.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return [(url, width, height) for _, _, url, width, height in ranked[:limit]]


def _user_is_unsafe(user: dict[str, Any]) -> bool:
    return is_unsafe_identifier(user.get("username")) or is_unsafe_text(user.get("name"), user.get("description"))


def build_lead(user: dict[str, Any], *, observed: str = "", confidence: int = 62, exact: bool = False) -> dict[str, Any] | None:
    username = _valid_username(user.get("username"))
    if not username or _user_is_unsafe(user):
        return None
    key = canonical(username)
    lead: dict[str, Any] = {
        "id": f"x-{key}",
        "name": clean_text(user.get("name") or username)[:60] or username,
        "username": username,
        "platform": "X",
        "profileUrl": f"https://x.com/{quote(username)}",
        "avatar": upgrade_avatar(safe_https_any(user.get("profile_image_url"), ("twimg.com",))) or None,
        "tags": ["official api", "public post"],
        "observedAt": observed or now_iso(),
        "sourceAttribution": "Official X API public post metadata; media remains on X",
        "confidence": confidence,
        "exactWatchMatch": exact,
    }
    metrics = user.get("public_metrics")
    if isinstance(metrics, dict) and "followers_count" in metrics:
        lead["followers"] = clean_int(metrics.get("followers_count"))
    description = clean_text(user.get("description"))[:200]
    if description:
        lead["description"] = description
    return lead


def map_x_payload(
    body: Any,
    *,
    extra_users: tuple[dict[str, Any], ...] = (),
    require_relevance: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Map a v2 tweets payload (timeline or search) to media items and creator leads."""
    if not isinstance(body, dict):
        return [], {}
    includes = body.get("includes") if isinstance(body.get("includes"), dict) else {}
    users: dict[str, dict[str, Any]] = {}
    for user in [*(includes.get("users") or []), *extra_users]:
        if isinstance(user, dict) and user.get("id"):
            users.setdefault(str(user["id"]), user)
    assets = {
        asset.get("media_key"): asset
        for asset in (includes.get("media") or [])
        if isinstance(asset, dict) and asset.get("media_key")
    }
    items: list[dict[str, Any]] = []
    leads: dict[str, dict[str, Any]] = {}

    for tweet in body.get("data") or []:
        if not isinstance(tweet, dict) or not tweet.get("id"):
            continue
        user = users.get(str(tweet.get("author_id")))
        username = _valid_username((user or {}).get("username"))
        if not user or not username or _user_is_unsafe(user):
            continue
        text = clean_text(strip_shortlinks(tweet.get("text")))
        if is_unsafe_text(text):
            continue
        sensitive = bool(tweet.get("possibly_sensitive"))
        if require_relevance and not (sensitive or looks_like_adult_promo(text, user.get("description"))):
            continue
        keys = ((tweet.get("attachments") or {}).get("media_keys") or [])[:4]
        emitted = 0
        profile_url = f"https://x.com/{quote(username)}"
        metrics = tweet.get("public_metrics") or {}
        created = str(tweet.get("created_at") or "")
        tags = ["x", "public post"] + (["adult"] if sensitive else []) + [f"#{tag}" for tag in _HASHTAG.findall(text)[:5]]
        for media_key in keys:
            asset = assets.get(media_key)
            if not isinstance(asset, dict):
                continue
            kind = asset.get("type")
            width, height = clean_int(asset.get("width")), clean_int(asset.get("height"))
            duration = clean_int(asset.get("duration_ms")) / 1000
            media_url = ""
            streams: list[str] = []
            is_video = False
            if kind == "photo":
                media_url = safe_https_any(asset.get("url"), ("pbs.twimg.com",))
                thumbnail = media_url
                if not media_url:
                    continue
            elif kind in ("video", "animated_gif"):
                thumbnail = safe_https_any(asset.get("preview_image_url"), ("pbs.twimg.com",))
                variants = best_mp4_variants(asset.get("variants"))
                if variants:
                    is_video = True
                    streams = [url for url, _, _ in variants]
                    media_url = streams[0]
                    if variants[0][1] and variants[0][2]:
                        width, height = variants[0][1], variants[0][2]
                elif not thumbnail:
                    continue
                # No playable mp4 variant: keep a still + link-out to the post.
            else:
                continue
            items.append(media_item(
                item_id=f"x-{tweet['id']}-{media_key}",
                title=text,
                thumbnail=thumbnail,
                source="X",
                creator=username,
                page_url=f"{profile_url}/status/{tweet['id']}",
                profile_url=profile_url,
                created_at=created,
                tags=tags,
                description=text,
                media_url=media_url,
                is_video=is_video,
                views=clean_int(metrics.get("impression_count")),
                likes=clean_int(metrics.get("like_count")),
                comments=clean_int(metrics.get("reply_count")),
                stream_candidates=streams if is_video else [],
                reason=f"public X post by @{username}{' (adult-labelled)' if sensitive else ''}",
                width=width,
                height=height,
                duration_seconds=duration if is_video else 0,
            ))
            emitted += 1
        if emitted:
            lead = build_lead(user, observed=created)
            if lead:
                leads.setdefault(lead["id"], lead)
    return items, leads


# ---------------------------------------------------------------------------
# Budgets, cooldowns and the single-call wrapper
# ---------------------------------------------------------------------------


def _group(kind: str) -> str:
    return "search" if kind == "search" else "timeline"


def _blocked(kind: str) -> tuple[str, str] | None:
    now = _epoch()
    with _STATE.lock:
        entry = _STATE.blocked.get(_group(kind))
        if entry and entry[0] > now:
            return entry[1], entry[2]
        if entry:
            _STATE.blocked.pop(_group(kind), None)
    return None


def _block(groups: tuple[str, ...], until: float, problem: str, detail: str) -> None:
    with _STATE.lock:
        for group in groups:
            _STATE.blocked[group] = (until, problem, detail)


def _reserve_search(hourly_cap: int) -> bool:
    now = _epoch()
    with _STATE.lock:
        while _STATE.search_calls and _STATE.search_calls[0] <= now - 3600:
            _STATE.search_calls.popleft()
        if len(_STATE.search_calls) >= hourly_cap:
            return False
        _STATE.search_calls.append(now)
        return True


def _reset_epoch(headers: dict[str, str]) -> float:
    try:
        return float(headers.get("x-rate-limit-reset", "") or 0)
    except ValueError:
        return 0.0


def _when(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _reason_hint(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    haystack = " ".join(str(data.get(key) or "") for key in ("title", "type", "reason")).lower()
    return next((hint for needle, hint in _REASON_HINTS if needle in haystack), "")


def _classify(kind: str, status: int, headers: dict[str, str], data: Any) -> tuple[str, str]:
    """Record a cooldown for an auth/plan/rate failure; returns (problem, detail)."""
    now = _epoch()
    what = "search" if kind == "search" else "reading user timelines"
    hint = _reason_hint(data)
    if status == 401:
        detail = "X rejected the bearer token (HTTP 401); check X_BEARER_TOKEN on Render."
        _block(("search", "timeline"), now + 300, "auth", detail)
        return "auth", detail
    if status in (402, 403):
        detail = f"X API plan/credentials do not allow {what} (HTTP {status})" + (f": {hint}." if hint else ".")
        _block((_group(kind),), now + 900, "forbidden", detail)
        return "forbidden", detail
    if status == 429:
        reset = _reset_epoch(headers)
        until = reset if reset > now else now + 900
        until = min(until, now + 3600)
        detail = f"X API rate limit reached for {what}; resets at {_when(until)} (x-rate-limit-reset)" + (f"; {hint}." if hint else ".")
        _block((_group(kind),), until, "rate", detail)
        return "rate", detail
    return "http", f"X API answered HTTP {status}."


def _call(settings: Any, run: RunCounter, deadline: float, kind: str, path: str, params: dict[str, Any]) -> dict[str, Any] | None:
    """One budget-aware X API GET. Returns the JSON body or None (problem recorded)."""
    cooldown = _blocked(kind)
    if cooldown:
        run.problem(cooldown[0], detail=cooldown[1])
        return None
    timeout = call_timeout(settings, deadline)
    if timeout is None:
        run.problem("timeout", detail="X API calls ran out of time budget.")
        return None
    run.attempt()
    response = api_request(
        "GET",
        f"{X_API}{path}",
        headers={
            "Authorization": f"Bearer {settings.x_bearer_token}",
            "User-Agent": text_setting(settings, "user_agent", "MediaCodex/1.0"),
            "Accept": "application/json",
        },
        params=params,
        timeout=timeout,
    )
    if response.ok and isinstance(response.data, dict):
        run.success()
        if response.headers.get("x-rate-limit-remaining") == "0":
            reset = _reset_epoch(response.headers)
            now = _epoch()
            if reset > now:
                _block((_group(kind),), min(reset, now + 3600), "rate", f"X API rate limit reached; resets at {_when(reset)} (x-rate-limit-reset).")
        return response.data
    if response.error:
        run.problem("network", detail="X API request failed.")
        return None
    problem, detail = _classify(kind, response.status, response.headers, response.data)
    run.problem(problem, status=response.status, detail=detail)
    logger.warning("X API %s request returned HTTP %s", kind, response.status)
    return None


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def _lookup_user(settings: Any, run: RunCounter, deadline: float, handle: str) -> dict[str, Any] | None | bool:
    """User dict, False when the account does not exist, None when the call failed."""
    key = handle.lower()
    cached = _STATE.user_cache.get(key)
    if cached is not None:
        run.hit()
        return cached or False
    body = _call(settings, run, deadline, "timeline", f"/2/users/by/username/{quote(handle)}", {"user.fields": USER_FIELDS})
    if body is None:
        return None
    user = body.get("data") if isinstance(body.get("data"), dict) else None
    if user and user.get("id") and _valid_username(user.get("username")):
        _STATE.user_cache.set(key, user, USER_CACHE_TTL)
        return user
    _STATE.user_cache.set(key, {}, MISSING_USER_TTL)
    return False


def _timeline_job(settings: Any, run: RunCounter, deadline: float, handle: str) -> dict[str, Any] | None:
    user = _lookup_user(settings, run, deadline, handle)
    if user is None:
        return None
    if user is False:
        result: dict[str, Any] = {"media": [], "leads": {}}
        _STATE.timeline_cache.set(f"tl:{handle.lower()}", result, _timeline_ttl(settings))
        return result
    body = _call(
        settings, run, deadline, "timeline", f"/2/users/{quote(str(user['id']))}/tweets",
        {
            "exclude": "retweets,replies",
            "expansions": EXPANSIONS,
            "media.fields": MEDIA_FIELDS,
            "tweet.fields": TWEET_FIELDS,
            "user.fields": USER_FIELDS,
            "max_results": 20,
        },
    )
    if body is None:
        return None
    media, leads = map_x_payload(body, extra_users=(user,))
    own = build_lead(user, confidence=92, exact=True)
    if own:
        leads[own["id"]] = {**leads.get(own["id"], {}), **own}
    result = {"media": media, "leads": leads}
    _STATE.timeline_cache.set(f"tl:{handle.lower()}", result, _timeline_ttl(settings))
    return result


def _search_job(settings: Any, run: RunCounter, deadline: float, query: str) -> dict[str, Any] | None:
    body = _call(
        settings, run, deadline, "search", "/2/tweets/search/recent",
        {
            "query": query,
            "max_results": 20,
            "expansions": EXPANSIONS,
            "media.fields": MEDIA_FIELDS,
            "tweet.fields": TWEET_FIELDS,
            "user.fields": USER_FIELDS,
        },
    )
    if body is None:
        return None
    media, leads = map_x_payload(body, require_relevance=True)
    result = {"media": media, "leads": leads}
    _STATE.search_cache.set(f"q:{query}", result, _search_ttl(settings))
    return result


def _execute(args: tuple[Any, ...]) -> dict[str, Any] | None:
    settings, run, deadline, kind, value = args
    if kind == "timeline":
        return _timeline_job(settings, run, deadline, value)
    return _search_job(settings, run, deadline, value)


# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------


def _rotate(values: list[str], cursor: int) -> list[str]:
    if not values:
        return []
    start = cursor % len(values)
    return values[start:] + values[:start]


def _status(run: RunCounter, mode: str, media: int, leads: int, planned: bool) -> dict[str, Any]:
    severe = [p for p in run.problems if p["kind"] in {"auth", "forbidden", "rate"}]
    served = run.succeeded > 0 or run.cache_hits > 0
    if severe:
        order = {"auth": 0, "forbidden": 1, "rate": 2}
        detail = sorted(severe, key=lambda p: order[p["kind"]])[0]["detail"]
        if served and (media or leads):
            detail += " Showing partial/cached public posts."
        return source_status("x", "X", "stream", "limited", detail, media=media, creators=leads, search_url=X_SEARCH_PAGE)
    if served:
        detail = {
            "feed": "Official X API discovery feed from Render (rotating hashtag queries, cached for at least 10 minutes).",
            "query": "Official X API search from Render (cached for at least 10 minutes).",
        }.get(mode, "Official X API public-post discovery from Render.")
        if run.attempted > run.succeeded:
            detail += f" ({run.succeeded}/{run.attempted} requests succeeded)"
        return source_status("x", "X", "stream", "connected", detail, media=media, creators=leads, search_url=X_SEARCH_PAGE)
    if run.attempted:
        return source_status("x", "X", "stream", "error", "X is configured on Render, but its API request failed.", search_url=X_SEARCH_PAGE)
    detail = (
        "X search budget for this hour is used up; results resume from cache."
        if planned
        else "Official X API is connected on Render and activates for a search, an exact @handle watchlist entry, or the default feed."
    )
    return source_status("x", "X", "stream", "limited", detail, search_url=X_SEARCH_PAGE)


def collect_x(settings: Any, watchlist: list[str], query: str, *, deadline: float | None = None) -> dict[str, Any]:
    if not text_setting(settings, "x_bearer_token"):
        return empty_result(source_status(
            "x", "X", "stream", "not-configured", "Official X API is not configured on Render.", search_url=X_SEARCH_PAGE,
        ))
    deadline = deadline if deadline is not None else time.monotonic() + 10.0
    run = RunCounter()
    watch_set = {canonical(entry) for entry in watchlist if canonical(entry)}
    handles = handle_candidates(watchlist)
    typed = clean_text(query)[:80]
    queries: list[str] = []
    mode = "watchlist"
    if typed and not watchlist:
        mode = "query"
        if typed.startswith("@") and not any(ch.isspace() for ch in typed):
            # An explicit @handle is an exact lookup, never a free-text search.
            handles = handle_candidates([typed])
        else:
            text_query = _search_text_query(typed)
            if text_query:
                queries.append(text_query)
    elif typed:
        # Watchlist + typed text: timelines for the watchlist plus one text search.
        mode = "query"
        text_query = _search_text_query(typed.lstrip("@"))
        if text_query:
            queries.append(text_query)
    if not watchlist and not typed:
        queries = discovery_queries(settings)
        mode = "feed"

    with _STATE.lock:
        cursor = _STATE.cursor
    per_request = int_setting(settings, "x_search_calls_per_request", 2, minimum=0, maximum=10)
    hourly = int_setting(settings, "x_search_max_calls_per_hour", 30, minimum=0, maximum=500)
    handle_cap = int_setting(settings, "x_timeline_handles_per_request", 4, minimum=0, maximum=8)

    results: list[dict[str, Any]] = []
    jobs: list[tuple[Any, ...]] = []
    live_searches = live_handles = 0
    budget_blocked = False
    for handle in _rotate(handles, cursor):
        cached = _STATE.timeline_cache.get(f"tl:{handle.lower()}")
        if cached is not None:
            run.hit()
            results.append(cached)
        elif live_handles < handle_cap:
            jobs.append((settings, run, deadline, "timeline", handle))
            live_handles += 1
    for search in _rotate(queries, cursor):
        cached = _STATE.search_cache.get(f"q:{search}")
        if cached is not None:
            run.hit()
            results.append(cached)
            continue
        cooldown = _blocked("search")
        if cooldown:
            run.problem(cooldown[0], detail=cooldown[1])
        elif live_searches < per_request:
            if _reserve_search(hourly):
                jobs.append((settings, run, deadline, "search", search))
                live_searches += 1
            else:
                budget_blocked = True
    with _STATE.lock:
        _STATE.cursor = cursor + max(1, live_searches + live_handles)

    for outcome in run_parallel(_execute, jobs, deadline=deadline, max_workers=6):
        if isinstance(outcome, dict):
            results.append(outcome)

    media_by_id: dict[str, dict[str, Any]] = {}
    leads: dict[str, dict[str, Any]] = {}
    for result in results:
        for item in result.get("media", []):
            if item["id"] not in media_by_id:
                media_by_id[item["id"]] = mark_watched(item, canonical(item["creator"]) in watch_set)
        for key, lead in result.get("leads", {}).items():
            exact = canonical(lead["username"]) in watch_set
            merged = {**leads.get(key, {}), **lead, "exactWatchMatch": exact}
            if exact:
                merged["confidence"] = max(int(merged.get("confidence", 0)), 92)
            leads[key] = merged
    media = sorted(media_by_id.values(), key=lambda item: item["createdAt"], reverse=True)[:MAX_MEDIA]
    lead_list = list(leads.values())
    return {
        "media": media,
        "leads": lead_list,
        "status": _status(run, mode, len(media), len(lead_list), budget_blocked),
        "attempted": run.attempted,
        "succeeded": run.succeeded,
    }
