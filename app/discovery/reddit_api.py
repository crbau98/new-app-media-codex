"""Reddit discovery through the official OAuth2 API (application-only token).

Auth: ``POST https://www.reddit.com/api/v1/access_token`` with
``grant_type=client_credentials`` and HTTP basic auth (client id / secret); the
token is cached until it expires. Data endpoints live on https://oauth.reddit.com:

  GET /r/{sub}/new?limit=25&raw_json=1          configurable subreddit list
  GET /search?q=...                              watchlist names / typed queries
  GET /user/{name}/submitted                     exact watchlist handles

Only adult-labelled (``over_18``) posts, or posts from the operator-configured
adult subreddits, with direct media are kept. Removed/deleted/spam posts and
anything signalling minors, non-consent or illegality are dropped. Posts that
only link to a subscription platform are never surfaced. Every item links back
to the Reddit post and author profile. No response is written to disk; the
client secret and bearer token are never logged.
"""

from __future__ import annotations

import logging
import re
import threading
import time
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
    iso_from_epoch,
    mark_watched,
    media_item,
    run_parallel,
    safe_https_any,
    source_status,
    split_list,
    text_setting,
    url_host,
)
from .safety import is_paywall_host, is_unsafe_identifier, is_unsafe_text

logger = logging.getLogger(__name__)

REDDIT_TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
REDDIT_API = "https://oauth.reddit.com"
REDDIT_SEARCH_PAGE = "https://www.reddit.com/search/?q=gay%20creator&include_over_18=on"

# Adult gay/male subreddits that exist; anything private, banned or renamed fails soft.
DEFAULT_SUBREDDITS: tuple[str, ...] = ("gaybrosgonewild", "gaybears", "gaymaletube", "gaybrosgonemild")

MAX_MEDIA = 100
MAX_GALLERY_IMAGES = 4
DEAD_TTL = 3600  # private / banned / missing subreddits and users are not retried for an hour
_IMAGE_HOSTS = ("i.redd.it", "preview.redd.it")
_THUMB_HOSTS = ("redd.it", "redditmedia.com", "redgifs.com", "imgur.com")
_LINKOUT_HOSTS = ("redgifs.com", "imgur.com", "gfycat.com")
_IMAGE_EXT = re.compile(r"\.(?:jpe?g|png|webp|gif)(?:$|\?)", re.I)
_SUB = re.compile(r"^[A-Za-z0-9_]{2,21}$")
_USER = re.compile(r"^[A-Za-z0-9_-]{3,20}$")
_PERMALINK = re.compile(r"^/r/[A-Za-z0-9_]+/comments/[A-Za-z0-9]+(?:/[^\s?#]*)?$")
_SKIP_AUTHORS = {"[deleted]", "automoderator"}


class _State:
    """Per-process token, caches and cooldown (memory only)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.token = ""
        self.expires = 0.0
        self.fingerprint = 0
        self.cache = TTLCache(256)
        self.blocked: tuple[float, str, str] | None = None
        self.cursor = 0

    def reset(self) -> None:
        self.__init__()  # type: ignore[misc]


_STATE = _State()
_epoch = time.time  # patched in tests


def reset_state() -> None:
    """Forget the token, caches, cooldown and rotation cursor (tests)."""
    _STATE.reset()


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------


def configured_subreddits(settings: Any) -> list[str]:
    raw = split_list(text_setting(settings, "reddit_subreddits"))
    names: list[str] = []
    for entry in raw:
        name = re.sub(r"^/?r/", "", entry.strip(), flags=re.I)
        if _SUB.match(name) and not is_unsafe_identifier(name) and name.lower() not in {n.lower() for n in names}:
            names.append(name)
    return names[:12] or list(DEFAULT_SUBREDDITS)


def _ttl(settings: Any) -> int:
    return max(60, int_setting(settings, "reddit_cache_ttl_seconds", 600, minimum=0, maximum=86_400))


def _user_agent(settings: Any) -> str:
    return text_setting(settings, "reddit_user_agent") or text_setting(settings, "user_agent", "MediaCodex/1.0")


def user_candidates(entries: list[str]) -> list[str]:
    users: list[str] = []
    for entry in entries:
        value = re.sub(r"^(?:/?u/|@)", "", str(entry or "").strip(), flags=re.I)
        if _USER.match(value) and value.lower() not in {u.lower() for u in users}:
            users.append(value)
    return users


# ---------------------------------------------------------------------------
# Mapping (pure functions)
# ---------------------------------------------------------------------------


def _first_valid(*urls: Any, hosts: tuple[str, ...]) -> str:
    for url in urls:
        valid = safe_https_any(url, hosts)
        if valid:
            return valid
    return ""


def _preview_thumbnail(post: dict[str, Any]) -> str:
    images = (post.get("preview") or {}).get("images") if isinstance(post.get("preview"), dict) else None
    if isinstance(images, list) and images and isinstance(images[0], dict):
        resolutions = [r for r in (images[0].get("resolutions") or []) if isinstance(r, dict)]
        wide = next((r for r in resolutions if clean_int(r.get("width")) >= 320), None)
        pick = wide or (resolutions[-1] if resolutions else None)
        source = images[0].get("source") if isinstance(images[0].get("source"), dict) else {}
        url = _first_valid((pick or {}).get("url"), source.get("url"), hosts=_THUMB_HOSTS)
        if url:
            return url
    media = post.get("media") if isinstance(post.get("media"), dict) else {}
    oembed = media.get("oembed") if isinstance(media.get("oembed"), dict) else {}
    return _first_valid(oembed.get("thumbnail_url"), post.get("thumbnail"), hosts=_THUMB_HOSTS)


def _source_dims(post: dict[str, Any]) -> tuple[int, int]:
    images = (post.get("preview") or {}).get("images") if isinstance(post.get("preview"), dict) else None
    if isinstance(images, list) and images and isinstance(images[0], dict) and isinstance(images[0].get("source"), dict):
        source = images[0]["source"]
        return clean_int(source.get("width")), clean_int(source.get("height"))
    return 0, 0


def _gallery_parts(post: dict[str, Any]) -> list[dict[str, Any]]:
    gallery = post.get("gallery_data") if isinstance(post.get("gallery_data"), dict) else {}
    metadata = post.get("media_metadata") if isinstance(post.get("media_metadata"), dict) else {}
    parts: list[dict[str, Any]] = []
    for entry in (gallery.get("items") or [])[:MAX_GALLERY_IMAGES]:
        meta = metadata.get(str(entry.get("media_id"))) if isinstance(entry, dict) else None
        if not isinstance(meta, dict) or meta.get("status") != "valid":
            continue
        source = meta.get("s") if isinstance(meta.get("s"), dict) else {}
        full = _first_valid(source.get("u"), source.get("gif"), hosts=_IMAGE_HOSTS)
        if not full:
            continue
        previews = [p for p in (meta.get("p") or []) if isinstance(p, dict)]
        wide = next((p for p in previews if clean_int(p.get("x")) >= 320), None)
        thumb = _first_valid((wide or {}).get("u"), full, hosts=_IMAGE_HOSTS)
        parts.append({"full": full, "thumb": thumb, "width": clean_int(source.get("x")), "height": clean_int(source.get("y"))})
    return parts


def _is_removed(post: dict[str, Any]) -> bool:
    return bool(
        post.get("removed_by_category")
        or post.get("banned_by")
        or post.get("removal_reason")
        or post.get("spam")
        or post.get("quarantine")
        or post.get("stickied")
        or str(post.get("selftext") or "").strip() in {"[removed]", "[deleted]"}
    )


def map_reddit_posts(
    posts: list[Any],
    *,
    nsfw_subs: frozenset[str] = frozenset(),
    require_over18: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Map listing children (t3 data dicts) to media items and creator leads."""
    items: list[dict[str, Any]] = []
    leads: dict[str, dict[str, Any]] = {}
    for post in posts:
        if not isinstance(post, dict):
            continue
        post_id = re.sub(r"[^A-Za-z0-9]", "", str(post.get("id") or ""))
        author = str(post.get("author") or "")
        subreddit = str(post.get("subreddit") or "")
        permalink = str(post.get("permalink") or "")
        if not post_id or not _USER.match(author) or author.lower() in _SKIP_AUTHORS or not _SUB.match(subreddit):
            continue
        if not _PERMALINK.match(permalink) or _is_removed(post):
            continue
        in_nsfw_sub = subreddit.lower() in nsfw_subs
        if require_over18 and not (post.get("over_18") is True or in_nsfw_sub):
            continue
        title = clean_text(post.get("title"))
        flair = clean_text(post.get("link_flair_text"))
        selftext = clean_text(str(post.get("selftext") or "")[:500])
        if is_unsafe_text(title, flair, selftext) or is_unsafe_identifier(subreddit, author):
            continue

        url = str(post.get("url_overridden_by_dest") or post.get("url") or "")
        host = url_host(url)
        if is_paywall_host(host):
            continue  # promotion link to a subscription site: never surfaced
        thumbnail = _preview_thumbnail(post)
        width, height = _source_dims(post)
        reddit_video = None
        for holder in (post.get("secure_media"), post.get("media")):
            if isinstance(holder, dict) and isinstance(holder.get("reddit_video"), dict):
                reddit_video = holder["reddit_video"]
                break
        if reddit_video is None and isinstance(post.get("preview"), dict) and isinstance(post["preview"].get("reddit_video_preview"), dict):
            reddit_video = post["preview"]["reddit_video_preview"]

        parts: list[dict[str, Any]] = []
        reddit_hosted_video = False
        duration = 0.0
        if post.get("is_gallery"):
            parts = _gallery_parts(post)
        elif reddit_video is not None or post.get("is_video") or host == "v.redd.it":
            # v.redd.it is outside the app's media CSP/proxy allow-list: link out with a still.
            reddit_hosted_video = True
            if reddit_video:
                duration = float(clean_int(reddit_video.get("duration")))
                width = width or clean_int(reddit_video.get("width"))
                height = height or clean_int(reddit_video.get("height"))
            if thumbnail:
                parts = [{"full": "", "thumb": thumbnail, "width": width, "height": height}]
        else:
            direct = safe_https_any(url, ("i.redd.it",)) or (
                safe_https_any(url, ("i.imgur.com",)) if _IMAGE_EXT.search(url) else ""
            )
            if direct:
                parts = [{"full": direct, "thumb": thumbnail or direct, "width": width, "height": height}]
            elif any(host == h or host.endswith(f".{h}") for h in _LINKOUT_HOSTS) and thumbnail:
                parts = [{"full": "", "thumb": thumbnail, "width": width, "height": height}]
        if not parts:
            continue

        profile_url = f"https://www.reddit.com/user/{quote(author)}"
        page_url = f"https://www.reddit.com{permalink}"
        tags = ["reddit", f"r/{subreddit}", "adult"] + ([flair[:30]] if flair else []) + (["video"] if reddit_hosted_video else [])
        reason = f"public Reddit post by u/{author} in r/{subreddit} (NSFW)" + (" - video opens on Reddit" if reddit_hosted_video else "")
        for index, part in enumerate(parts):
            items.append(media_item(
                item_id=f"reddit-{post_id}" + (f"-{index}" if len(parts) > 1 else ""),
                title=title,
                thumbnail=part["thumb"],
                source="Reddit",
                creator=author,
                page_url=page_url,
                profile_url=profile_url,
                created_at=iso_from_epoch(post.get("created_utc")),
                tags=tags,
                description=selftext or f"Public post in r/{subreddit}",
                media_url=part["full"],
                is_video=False,
                likes=clean_int(post.get("score")),
                comments=clean_int(post.get("num_comments")),
                stream_candidates=[],
                reason=reason,
                width=part["width"],
                height=part["height"],
                duration_seconds=duration,
            ))
        key = canonical(author)
        leads.setdefault(f"reddit-{key}", {
            "id": f"reddit-{key}",
            "name": author,
            "username": author,
            "platform": "Reddit",
            "profileUrl": profile_url,
            "tags": ["official api", "public post", f"r/{subreddit}"],
            "observedAt": iso_from_epoch(post.get("created_utc")),
            "sourceAttribution": "Official Reddit API public post metadata; media remains on Reddit",
            "confidence": 66,
            "exactWatchMatch": False,
        })
    return items, leads


# ---------------------------------------------------------------------------
# Token + request helpers
# ---------------------------------------------------------------------------


def _block(seconds: float, problem: str, detail: str) -> None:
    with _STATE.lock:
        _STATE.blocked = (_epoch() + seconds, problem, detail)


def _cooldown() -> tuple[str, str] | None:
    with _STATE.lock:
        if _STATE.blocked and _STATE.blocked[0] > _epoch():
            return _STATE.blocked[1], _STATE.blocked[2]
        _STATE.blocked = None
    return None


def _retry_seconds(headers: dict[str, str]) -> float:
    for name in ("retry-after", "x-ratelimit-reset"):
        try:
            value = float(headers.get(name, "") or 0)
        except ValueError:
            continue
        if value > 0:
            return min(value, 900.0)
    return 120.0


def _get_token(settings: Any, run: RunCounter, deadline: float) -> str | None:
    client_id, client_secret = settings.reddit_client_id, settings.reddit_client_secret
    fingerprint = hash((client_id, client_secret))
    with _STATE.lock:
        if _STATE.token and _STATE.fingerprint == fingerprint and _STATE.expires > time.monotonic():
            return _STATE.token
    cooldown = _cooldown()
    if cooldown:
        run.problem(cooldown[0], detail=cooldown[1])
        return None
    timeout = call_timeout(settings, deadline)
    if timeout is None:
        run.problem("timeout", detail="Reddit API calls ran out of time budget.")
        return None
    run.attempt()
    response = api_request(
        "POST",
        REDDIT_TOKEN_URL,
        headers={"User-Agent": _user_agent(settings), "Accept": "application/json"},
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        timeout=timeout,
    )
    data = response.data if isinstance(response.data, dict) else {}
    if response.ok and isinstance(data.get("access_token"), str) and data["access_token"]:
        run.success(data=False)
        lifetime = clean_int(data.get("expires_in")) or 3600
        with _STATE.lock:
            _STATE.token = data["access_token"]
            _STATE.expires = time.monotonic() + max(30, lifetime - 60)
            _STATE.fingerprint = fingerprint
        return data["access_token"]
    if response.error:
        run.problem("network", detail="Reddit token request failed.")
    elif response.status == 429:
        wait = _retry_seconds(response.headers)
        detail = f"Reddit rate limit reached while requesting a token; retry in about {int(wait)}s."
        _block(wait, "rate", detail)
        run.problem("rate", status=429, detail=detail)
    elif response.status in (400, 401, 403) or (response.ok and data.get("error")):
        detail = "Reddit rejected the app credentials (check REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET and the app type)."
        _block(300, "auth", detail)
        run.problem("auth", status=response.status, detail=detail)
    else:
        run.problem("http", status=response.status, detail=f"Reddit token endpoint answered HTTP {response.status}.")
    logger.warning("Reddit token request failed with HTTP %s", response.status)
    return None


def _fetch(settings: Any, run: RunCounter, deadline: float, token: str, job: dict[str, Any]) -> dict[str, Any] | None:
    cooldown = _cooldown()
    if cooldown:
        run.problem(cooldown[0], detail=cooldown[1])
        return None
    timeout = call_timeout(settings, deadline)
    if timeout is None:
        run.problem("timeout", detail="Reddit API calls ran out of time budget.")
        return None
    run.attempt()
    response = api_request(
        "GET",
        f"{REDDIT_API}{job['path']}",
        headers={"Authorization": f"bearer {token}", "User-Agent": _user_agent(settings), "Accept": "application/json"},
        params={**job["params"], "raw_json": 1},
        timeout=timeout,
    )
    ttl = _ttl(settings)
    if response.ok and isinstance(response.data, dict):
        run.success()
        try:
            remaining = float(response.headers.get("x-ratelimit-remaining", "") or 99)
        except ValueError:
            remaining = 99.0
        if remaining < 1:
            _block(_retry_seconds(response.headers), "rate", "Reddit rate limit reached; results resume from cache.")
        children = ((response.data.get("data") or {}).get("children") or []) if isinstance(response.data.get("data"), dict) else []
        posts = [child.get("data") for child in children if isinstance(child, dict) and child.get("kind") == "t3"]
        media, leads = map_reddit_posts(posts, nsfw_subs=job["nsfw_subs"])
        result = {"media": media, "leads": leads}
        _STATE.cache.set(job["key"], result, ttl)
        return result
    if response.error:
        run.problem("network", detail="Reddit API request failed.")
        return None
    if response.status in (403, 404):
        # Private / quarantined / banned / missing: remember so it is not retried every load.
        run.problem("dead", status=response.status, detail=f"{job['label']} is unavailable (HTTP {response.status}).")
        _STATE.cache.set(job["key"], {"media": [], "leads": {}, "dead": response.status}, DEAD_TTL)
        return None
    if response.status == 401:
        with _STATE.lock:
            _STATE.token = ""
        detail = "Reddit rejected the access token; it will be refreshed on the next request."
        run.problem("auth", status=401, detail=detail)
    elif response.status == 429:
        wait = _retry_seconds(response.headers)
        detail = f"Reddit rate limit reached; retry in about {int(wait)}s."
        _block(wait, "rate", detail)
        run.problem("rate", status=429, detail=detail)
    else:
        run.problem("http", status=response.status, detail=f"Reddit API answered HTTP {response.status}.")
    logger.warning("Reddit API request returned HTTP %s", response.status)
    return None


def _execute(args: tuple[Any, ...]) -> dict[str, Any] | None:
    settings, run, deadline, token, job = args
    return _fetch(settings, run, deadline, token, job)


# ---------------------------------------------------------------------------
# Collector
# ---------------------------------------------------------------------------


def _status(run: RunCounter, media: int, leads: int, dead: int, planned: bool) -> dict[str, Any]:
    severe = [p for p in run.problems if p["kind"] in {"auth", "rate"}]
    served = run.data_succeeded > 0 or run.cache_hits > 0
    if severe:
        detail = sorted(severe, key=lambda p: 0 if p["kind"] == "auth" else 1)[0]["detail"]
        if served and (media or leads):
            detail += " Showing partial/cached public posts."
        return source_status("reddit", "Reddit", "stream", "limited", detail, media=media, creators=leads, search_url=REDDIT_SEARCH_PAGE)
    if served:
        detail = "Official Reddit API discovery from Render (adult-labelled posts, cached)."
        if dead:
            detail += f" ({dead} subreddit/user target{'s' if dead != 1 else ''} unavailable and skipped)"
        return source_status("reddit", "Reddit", "stream", "connected", detail, media=media, creators=leads, search_url=REDDIT_SEARCH_PAGE)
    if dead:
        return source_status(
            "reddit", "Reddit", "stream", "limited",
            "The configured Reddit subreddits/users are unavailable (private, banned or missing); adjust REDDIT_SUBREDDITS.",
            search_url=REDDIT_SEARCH_PAGE,
        )
    if run.attempted:
        return source_status("reddit", "Reddit", "stream", "error", "Reddit is configured on Render, but its API request failed.", search_url=REDDIT_SEARCH_PAGE)
    detail = (
        "Reddit call budget for this request was used up; results resume from cache."
        if planned
        else "Official Reddit API is connected on Render and activates for the default feed, a search, or a watchlist."
    )
    return source_status("reddit", "Reddit", "stream", "limited", detail, search_url=REDDIT_SEARCH_PAGE)


def collect_reddit(settings: Any, watchlist: list[str], query: str, *, deadline: float | None = None) -> dict[str, Any]:
    client_id = text_setting(settings, "reddit_client_id")
    client_secret = text_setting(settings, "reddit_client_secret")
    if not client_id or not client_secret:
        return empty_result(source_status(
            "reddit", "Reddit", "stream", "not-configured",
            "Official Reddit API is not configured on Render.", search_url=REDDIT_SEARCH_PAGE,
        ))
    deadline = deadline if deadline is not None else time.monotonic() + 10.0
    run = RunCounter()
    watch_set = {canonical(entry) for entry in watchlist if canonical(entry)}
    typed = clean_text(query)[:80]
    subs = configured_subreddits(settings)
    nsfw_subs = frozenset(sub.lower() for sub in subs)
    calls = int_setting(settings, "reddit_calls_per_request", 8, minimum=1, maximum=30)
    listing_reserve = min(2, calls)
    focused_budget = calls - listing_reserve

    # Priority: exact user handles, then name/typed searches, then subreddit listings.
    jobs: list[dict[str, Any]] = []
    for user in user_candidates(watchlist if watchlist else ([typed] if typed.startswith(("@", "u/", "/u/")) else []))[:4]:
        jobs.append({"key": f"user:{user.lower()}", "path": f"/user/{quote(user)}/submitted", "params": {"sort": "new", "limit": 25}, "label": f"u/{user}", "focused": True})
    search_terms = [typed] if typed and not typed.startswith(("@", "u/", "/u/")) else []
    exact_users = {user.lower() for user in user_candidates(watchlist)}
    # Exact handles are looked up as users; only display names are searched.
    search_terms += [entry for entry in watchlist if clean_text(entry) and str(entry).strip().lstrip("@").lower() not in exact_users]
    search_terms = search_terms[:4]
    seen_terms: set[str] = set()
    for term in search_terms:
        term = " ".join(clean_text(term).split())[:80]
        if len(canonical(term)) < 2 or term.lower() in seen_terms or is_unsafe_text(term):
            continue
        seen_terms.add(term.lower())
        jobs.append({
            "key": f"search:{term.lower()}",
            "path": "/search",
            "params": {"q": term, "sort": "new", "t": "month", "type": "link", "limit": 25, "include_over_18": "on"},
            "label": f"search '{term}'", "focused": True,
        })
    if not typed:
        with _STATE.lock:
            cursor = _STATE.cursor
        for sub in (subs[cursor % len(subs):] + subs[:cursor % len(subs)]):
            jobs.append({"key": f"sub:{sub.lower()}", "path": f"/r/{sub}/new", "params": {"limit": 25}, "label": f"r/{sub}", "focused": False})
    for job in jobs:
        job["nsfw_subs"] = nsfw_subs

    results: list[dict[str, Any]] = []
    live: list[dict[str, Any]] = []
    dead = 0
    focused_live = listing_live = 0
    budget_blocked = False
    for job in jobs:
        cached = _STATE.cache.get(job["key"])
        if cached is not None:
            if cached.get("dead"):
                dead += 1
            else:
                run.hit()
                results.append(cached)
        elif job["focused"] and focused_live < focused_budget:
            live.append(job)
            focused_live += 1
        elif not job["focused"] and listing_live < calls - focused_live:
            live.append(job)
            listing_live += 1
        else:
            budget_blocked = True
    with _STATE.lock:
        _STATE.cursor += max(1, listing_live)

    if live:
        token = _get_token(settings, run, deadline)
        if token:
            outcomes = run_parallel(_execute, [(settings, run, deadline, token, job) for job in live], deadline=deadline, max_workers=5)
            results.extend(outcome for outcome in outcomes if isinstance(outcome, dict))
    dead += sum(1 for problem in run.problems if problem["kind"] == "dead")

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
                merged["confidence"] = max(int(merged.get("confidence", 0)), 90)
            leads[key] = merged
    media = sorted(media_by_id.values(), key=lambda item: item["createdAt"], reverse=True)[:MAX_MEDIA]
    lead_list = list(leads.values())
    return {
        "media": media,
        "leads": lead_list,
        "status": _status(run, len(media), len(lead_list), dead, budget_blocked),
        "attempted": run.attempted,
        "succeeded": run.succeeded,
    }
