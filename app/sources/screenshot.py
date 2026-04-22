"""Image and short-video collector for explicit terms using DDG image API + Redgifs."""
from __future__ import annotations

import logging
import re
import shutil
import time
import uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse
from typing import Generator

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Maps display term (stored in DB) → actual DDG search query (male-specific)
TERM_QUERIES: dict[str, str] = {
    # Anatomy
    "penis":             "gay male penis",
    "cock":              "gay cock male",
    "dick":              "gay dick male",
    "hung penis":        "hung gay male penis",
    "big cock gay":      "big cock gay male hung",
    "uncut cock":        "uncut cock gay male foreskin",
    "foreskin":          "uncut male foreskin gay",
    "balls":             "gay male balls scrotum",
    "perineum":          "male perineum anatomy gay",
    "gay ass":           "gay male ass butt nude",
    "gay nipples":       "gay male nipples erect",
    # Ejaculation / orgasm
    "hyperspermia":      "hyperspermia male semen",
    "ejaculate":         "male ejaculation gay",
    "precum":            "male precum gay",
    "gay cum":           "gay cum male",
    "hands free cum":    "hands free cum gay male",
    "hands free orgasm": "hands free orgasm gay",
    "cum shot":          "gay cum shot male",
    "edging":            "male edging gay orgasm",
    "ruined orgasm":     "ruined orgasm gay male",
    "gay creampie":      "gay creampie male anal",
    "cum eating gay":    "cum eating gay male",
    "gay facial":        "gay facial male cum",
    # Orgasm types
    "gay orgasm":        "gay male orgasm",
    "prostate orgasm":   "prostate orgasm gay male",
    "gay multiple orgasm": "gay multiple orgasm male",
    # Sex acts
    "blowjob":           "gay blowjob male",
    "gay deepthroat":    "gay deepthroat male",
    "anal":              "gay anal sex male",
    "rimjob":            "gay rimjob male",
    "bareback":          "bareback gay male",
    "frottage":          "frottage gay male",
    "men docking":       "men docking gay",
    "69":                "69 gay male oral",
    "mutual masturbation": "mutual masturbation gay male",
    "gay threesome":     "gay threesome male sex",
    "glory hole":        "glory hole gay male",
    "gay breeding":      "gay breeding male anal",
    # Solo / masturbation
    "gay solo":          "gay solo masturbation male nude",
    "gay shower":        "gay male shower nude erotic",
    "gay sauna":         "gay sauna male nude",
    # Body types / aesthetics
    "twink":             "twink gay male",
    "twunk":             "twunk gay male",
    "muscle gay":        "muscle gay male nude",
    "daddy":             "gay daddy male",
    "bear":              "bear gay male",
    "otter gay":         "otter gay male nude",
    "chub gay":          "chub gay male nude",
    # Fashion / gear
    "jockstrap":         "jockstrap gay male",
    "gay underwear":     "gay male underwear bulge",
    "gay speedo":        "gay male speedo bulge",
    "gay leather":       "gay leather male fetish",
    # Kink / fetish
    "cock ring":         "cock ring gay male",
    "chastity gay":      "chastity cage male gay",
    "gay bondage":       "gay bondage male bdsm",
    "gay massage":       "gay massage male erotic",
    # Intimacy
    "gay kissing":       "gay kissing male nude",
}

# Maps display term → Redgifs search query for short video clips
TERM_VIDEO_QUERIES: dict[str, str] = {
    "penis":             "gay penis",
    "cock":              "gay cock",
    "dick":              "gay dick",
    "hung penis":        "hung gay",
    "big cock gay":      "big cock gay",
    "uncut cock":        "uncut foreskin gay",
    "foreskin":          "uncut foreskin gay",
    "balls":             "gay balls",
    "perineum":          "perineum gay male",
    "gay ass":           "gay ass male",
    "gay nipples":       "gay nipples male",
    "hyperspermia":      "hyperspermia cum",
    "ejaculate":         "gay ejaculation",
    "precum":            "male precum",
    "gay cum":           "gay cum",
    "hands free cum":    "handsfree cum gay",
    "hands free orgasm": "handsfree orgasm gay",
    "cum shot":          "gay cumshot",
    "edging":            "edging gay male",
    "ruined orgasm":     "ruined orgasm gay",
    "gay creampie":      "gay creampie anal",
    "cum eating gay":    "cum eating gay",
    "gay facial":        "gay facial cum",
    "gay orgasm":        "gay orgasm",
    "prostate orgasm":   "prostate orgasm",
    "gay multiple orgasm": "gay multiple orgasm",
    "blowjob":           "gay blowjob",
    "gay deepthroat":    "gay deepthroat",
    "anal":              "gay anal",
    "rimjob":            "gay rimjob",
    "bareback":          "bareback gay",
    "frottage":          "frottage gay",
    "men docking":       "men docking",
    "69":                "69 gay",
    "mutual masturbation": "mutual masturbation gay",
    "gay threesome":     "gay threesome",
    "glory hole":        "glory hole gay",
    "gay breeding":      "gay breeding anal",
    "gay solo":          "gay solo masturbation",
    "gay shower":        "gay shower nude",
    "gay sauna":         "gay sauna nude",
    "twink":             "twink gay",
    "twunk":             "twunk gay",
    "muscle gay":        "muscle gay",
    "daddy":             "gay daddy",
    "bear":              "bear gay",
    "otter gay":         "otter gay nude",
    "chub gay":          "chub gay",
    "jockstrap":         "jockstrap gay",
    "gay underwear":     "gay underwear bulge",
    "gay speedo":        "gay speedo bulge",
    "gay leather":       "gay leather fetish",
    "cock ring":         "cock ring gay",
    "chastity gay":      "chastity cage gay",
    "gay bondage":       "gay bondage bdsm",
    "gay massage":       "gay massage erotic",
    "gay kissing":       "gay kissing nude",
}

# Maps display term → Redgifs usernames to search (known performers/uploaders)
# Add usernames here when a good creator is discovered for a category
TERM_REDGIFS_USERS: dict[str, list[str]] = {
    # Populated as good creators are discovered — kept empty initially
    # Example: "edging": ["someuser123"],
}

# Creator-specific capture queries — known gay male content creators
# Format: display_name → DDG search query
# These run after the main TERM_QUERIES loop in capture_screenshots()
CREATOR_QUERIES: dict[str, str] = {
    # Explicitly mentioned by user
    "jakipz":              '"jakipz" gay onlyfans nude',
    "hoguesdirtylaundry":  '"hoguesdirtylaundry" gay nude twitter',
    "michael yerger":      '"michael yerger" gay onlyfans nude',
    "sebastian cox":       '"sebastian cox" gay onlyfans nude',
    # Well-known gay adult performers / OnlyFans creators
    "ryan bones":          '"ryan bones" gay nude onlyfans',
    "drew valentino":      '"drew valentino" gay nude onlyfans',
    "blake mitchell":      '"blake mitchell" gay nude',
    "colby keller":        '"colby keller" gay nude artist',
    "austin wolf":         '"austin wolf" gay nude onlyfans',
    "cade maddox":         '"cade maddox" gay nude',
    "levi charming":       '"levi charming" gay onlyfans nude',
    "brent everett":       '"brent everett" gay nude',
    "tanner of miami":     '"tanner of miami" gay nude onlyfans',
    "alex mecum":          '"alex mecum" gay nude',
    "jacob black":         '"jacob black" gay nude onlyfans',
    "grayson lange":       '"grayson lange" gay nude onlyfans',
    "nick fitt":           '"nick fitt" gay nude onlyfans',
    "pierre fitch":        '"pierre fitch" gay nude',
    "jj knight":           '"jj knight" gay nude onlyfans',
    "max carter":          '"max carter" gay nude onlyfans',
    "troye dean":          '"troye dean" gay nude onlyfans',
    "johnny rapid":        '"johnny rapid" gay nude',
    "scott demarco":       '"scott demarco" gay nude',
    "marcus orelias":      '"marcus orelias" gay onlyfans nude',
    "devin franco":        '"devin franco" gay nude onlyfans',
    "manuel skye":         '"manuel skye" gay nude',
    "bareback bastian":    '"bareback bastian" gay nude onlyfans',
    "josh moore":          '"josh moore" gay nude onlyfans',
    "phenix saint":        '"phenix saint" gay nude',
    "samuel o toole":      '"samuel o toole" gay nude',
    "boomer banks":        '"boomer banks" gay nude hung',
    "landon mycles":       '"landon mycles" gay nude hung',
    "adam ramzi":          '"adam ramzi" gay nude',
    "skyy knox":           '"skyy knox" gay nude onlyfans',
    "vincent ocock":       '"vincent ocock" gay nude onlyfans',
    "theo brady":          '"theo brady" gay nude onlyfans',
    "ricky roman":         '"ricky roman" gay nude',
    "rafael alencar":      '"rafael alencar" gay nude hung',
    # Additional Fansly / newer creators
    "vincenzo ortiz":      '"vincenzo ortiz" gay onlyfans fansly nude',
    "tanner myers":        '"tanner myers" gay nude onlyfans fansly',
    "max konnor":          '"max konnor" gay nude onlyfans hung',
    "gabriel cross":       '"gabriel cross" gay nude onlyfans',
    "elijah zayne":        '"elijah zayne" gay nude onlyfans',
    "wolf hudson":         '"wolf hudson" gay nude onlyfans',
    "dakota payne":        '"dakota payne" gay nude onlyfans',
    "tom of finland":      '"tom of finland" gay nude art',
    "felix fox":           '"felix fox" gay nude onlyfans',
    "sean xavier":         '"sean xavier" gay nude hung',
    "osiris blade":        '"osiris blade" gay nude onlyfans hung',
    "luca del rey":        '"luca del rey" gay nude onlyfans',
    "jace jenson":         '"jace jenson" gay nude onlyfans',
    "beaux banks":         '"beaux banks" gay nude onlyfans twink',
    "ashton summers":      '"ashton summers" gay nude onlyfans twink',
    "dylan hayes":         '"dylan hayes" gay nude onlyfans twink',
    "will braun":          '"will braun" gay nude',
    "billy santoro":       '"billy santoro" gay nude onlyfans daddy',
    "matthieu paris":      '"matthieu paris" gay nude onlyfans',
    "leo forte":           '"leo forte" gay nude onlyfans hung',
}

# Appended to every DDG query to exclude female/straight content
_DDG_EXCLUDE = (
    "-woman -women -female -girl -girls -lesbian -straight -hetero "
    "-pussy -vagina -transgender -trans -shemale -ladyboy -femboy "
    "-couples -couple -wife -girlfriend -bikini"
)

# Max results per term per pass
MAX_RESULTS_PER_TERM = 30       # per DDG page; fetched across 2 pages = up to 60 images
MAX_GIFS_PER_TERM = 15          # per DDG page; fetched across 2 pages = up to 30 GIFs
MAX_VIDEOS_PER_TERM = 20        # Redgifs clips per term
MAX_VIDEO_DURATION_S = 600.0    # keep clips ≤ 10 minutes
MIN_IMAGE_PX = 300              # skip images smaller than this on either dimension

_DDG_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://duckduckgo.com/",
}
_REDGIFS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}

_DOWNLOAD_HEADERS = {
    "User-Agent": _DDG_HEADERS["User-Agent"],
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
}
_DOWNLOAD_FAILURE_TTL_S = 30 * 60
_HOST_BLOCK_TTL_S = 60 * 60
_FAILURE_LOG_TTL_S = 2 * 60
_HOST_FAILURE_COUNTS: dict[str, int] = {}
_HOST_BLOCKED_UNTIL: dict[str, float] = {}
_URL_FAILED_UNTIL: dict[str, float] = {}
_FAILURE_LOGGED_AT: dict[str, float] = {}


def _build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(_DOWNLOAD_HEADERS)
    retry = Retry(
        total=1,
        connect=1,
        read=1,
        status=1,
        backoff_factor=0.15,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "HEAD", "POST"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(pool_connections=24, pool_maxsize=24, max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _prune_timed_cache(cache: dict[str, float], now: float) -> None:
    expired = [key for key, expires_at in cache.items() if expires_at <= now]
    for key in expired:
        cache.pop(key, None)


def _should_skip_download(url: str) -> bool:
    now = time.time()
    _prune_timed_cache(_HOST_BLOCKED_UNTIL, now)
    _prune_timed_cache(_URL_FAILED_UNTIL, now)
    host = (urlparse(url).hostname or "").lower()
    return _HOST_BLOCKED_UNTIL.get(host, 0) > now or _URL_FAILED_UNTIL.get(url, 0) > now


def _log_download_failure(url: str, detail: str) -> None:
    now = time.time()
    _prune_timed_cache(_FAILURE_LOGGED_AT, now)
    host = (urlparse(url).hostname or "").lower() or url
    last_logged = _FAILURE_LOGGED_AT.get(host, 0.0)
    if now - last_logged < _FAILURE_LOG_TTL_S:
        return
    _FAILURE_LOGGED_AT[host] = now
    print(f"[screenshot] download failed {url}: {detail}")


def _record_download_failure(url: str, status_code: int | None = None) -> None:
    now = time.time()
    host = (urlparse(url).hostname or "").lower()
    _URL_FAILED_UNTIL[url] = now + _DOWNLOAD_FAILURE_TTL_S
    if not host:
        return
    if status_code in {401, 403, 404, 410, 429}:
        count = _HOST_FAILURE_COUNTS.get(host, 0) + 1
        _HOST_FAILURE_COUNTS[host] = count
        if count >= 3:
            _HOST_BLOCKED_UNTIL[host] = now + _HOST_BLOCK_TTL_S


def _record_download_success(url: str) -> None:
    host = (urlparse(url).hostname or "").lower()
    _URL_FAILED_UNTIL.pop(url, None)
    if host:
        _HOST_FAILURE_COUNTS.pop(host, None)
        _HOST_BLOCKED_UNTIL.pop(host, None)


# ── DDG image helpers ─────────────────────────────────────────────────────────

def _get_vqd(session: requests.Session, term: str) -> str | None:
    """Fetch the vqd token DDG requires for its image API."""
    try:
        r = session.post(
            "https://duckduckgo.com/",
            data={"q": term},
            headers=_DDG_HEADERS,
            timeout=10,
        )
        m = re.search(r'vqd="([^"]+)"', r.text) or re.search(r'vqd=([0-9\-]+)', r.text)
        return m.group(1) if m else None
    except Exception as e:
        print(f"[screenshot] vqd fetch failed for '{term}': {e}")
        return None


def _search_ddg_images(
    session: requests.Session,
    term: str,
    limit: int,
    gif_only: bool = False,
    start: int = 0,
) -> list[dict]:
    """Return up to `limit` image result dicts from DDG image API.
    Pass gif_only=True to use DDG's animated GIF type filter (f=,,gif,,,).
    Use start=50 for the second page.
    """
    vqd = _get_vqd(session, term)
    if not vqd:
        return []
    f_param = ",,gif,,," if gif_only else ",,,,,"
    try:
        r = session.get(
            "https://duckduckgo.com/i.js",
            params={"q": term, "vqd": vqd, "o": "json", "p": "-1", "s": str(start), "f": f_param},
            headers=_DDG_HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        # Filter out small images (thumbnails / low-quality)
        results = [
            row for row in results
            if (row.get("width") or 0) >= MIN_IMAGE_PX and (row.get("height") or 0) >= MIN_IMAGE_PX
        ]
        return results[:limit]
    except Exception as e:
        print(f"[screenshot] DDG image search failed for '{term}': {e}")
        return []


_dl_logger = logging.getLogger(__name__)


def _disk_has_space(path: str, min_free_mb: int = 500) -> bool:
    """Return True if *path*'s filesystem has at least *min_free_mb* MB free."""
    try:
        usage = shutil.disk_usage(path)
        return usage.free >= min_free_mb * 1024 * 1024
    except Exception:
        return True  # Don't block on check failure


def _download_file(session: requests.Session, url: str, dest: Path, allowed_prefixes: tuple[str, ...]) -> bool:
    """Download a file to dest if its content-type starts with one of allowed_prefixes."""
    import os
    if os.getenv("SKIP_MEDIA_DOWNLOADS", "").lower() in ("1", "true", "yes"):
        return False
    if _should_skip_download(url):
        return False
    if not _disk_has_space(str(dest.parent)):
        _dl_logger.warning("Skipping download of %s: disk space below 500 MB", url)
        return False
    try:
        with session.get(url, timeout=(4, 15), stream=True, headers=_DOWNLOAD_HEADERS) as r:
            r.raise_for_status()
            ct = r.headers.get("content-type", "")
            if not any(ct.startswith(p) for p in allowed_prefixes):
                _record_download_failure(url)
                return False
            with dest.open("wb") as fh:
                for chunk in r.iter_content(chunk_size=65536):
                    if chunk:
                        fh.write(chunk)
        _record_download_success(url)
        return True
    except requests.HTTPError as e:
        status_code = getattr(e.response, "status_code", None)
        _record_download_failure(url, status_code=status_code)
        _log_download_failure(url, str(e))
        return False
    except Exception as e:
        _record_download_failure(url)
        _log_download_failure(url, str(e))
        return False


# ── Redgifs video helpers ─────────────────────────────────────────────────────

_REDGIFS_RATE_DELAY = 0.5       # seconds between API calls
_REDGIFS_PAGES = 3              # max pages to paginate per strategy
_REDGIFS_PAGE_SIZE = 80         # results per page (API max)
_REDGIFS_MIN_DURATION = 5.0     # skip clips shorter than 5s
_REDGIFS_HD_WIDTH = 720         # minimum width to count as HD
_REDGIFS_BACKOFF_S = 5 * 60
_REDGIFS_BACKOFF_UNTIL = 0.0

# Gender filtering lists (shared across all Redgifs helpers)
_RG_FEMALE_KEYWORDS = [
    "female", "woman", "women", "girl", "lesbian", "straight",
    "pussy", "vagina", "vulva", "transgender", "shemale", "ladyboy",
    "femboy", "bisexual", "bisex", "hetero", "heterosexual",
    "girlfriend", "wife", "b/g", "m/f", "ftm",
]
_RG_MALE_KEYWORDS = [
    "gay", "male", "man", "men", "boy", "twink", "bear", "otter",
    "daddy", "jock", "muscle", "cock", "dick", "penis", "blowjob",
    "bareback", "anal", "m/m", "yaoi", "hunk",
]


def _get_redgifs_token(session: requests.Session) -> str | None:
    try:
        r = session.get("https://api.redgifs.com/v2/auth/temporary",
                        headers=_REDGIFS_HEADERS, timeout=10)
        return r.json().get("token")
    except Exception as e:
        print(f"[redgifs] auth failed: {e}")
        return None


def _redgifs_request(
    session: requests.Session,
    headers: dict,
    url: str,
    params: dict,
    label: str = "",
) -> list[dict]:
    """Make a Redgifs API request with retry logic and rate limiting."""
    global _REDGIFS_BACKOFF_UNTIL
    now = time.time()
    if _REDGIFS_BACKOFF_UNTIL > now:
        return []
    for attempt in range(2):
        try:
            r = session.get(url, params=params, headers=headers, timeout=15)
            r.raise_for_status()
            time.sleep(_REDGIFS_RATE_DELAY)
            return r.json().get("gifs", [])
        except requests.HTTPError as e:
            status_code = getattr(e.response, "status_code", None)
            if status_code == 429:
                _REDGIFS_BACKOFF_UNTIL = time.time() + _REDGIFS_BACKOFF_S
                print(f"[redgifs] rate limited ({label}); backing off for {_REDGIFS_BACKOFF_S}s")
                return []
            if attempt == 0:
                print(f"[redgifs] request failed ({label}), retrying in 2s: {e}")
                time.sleep(2)
            else:
                print(f"[redgifs] request failed ({label}) after retry: {e}")
        except Exception as e:
            if attempt == 0:
                print(f"[redgifs] request failed ({label}), retrying in 2s: {e}")
                time.sleep(2)
            else:
                print(f"[redgifs] request failed ({label}) after retry: {e}")
    return []


def _redgifs_quality_score(g: dict) -> float:
    """Score a clip: higher is better. Used for sorting results by quality."""
    score = 0.0
    width = g.get("width") or 0
    duration = g.get("duration") or 0
    has_audio = g.get("hasAudio", True)

    # HD bonus
    if width >= _REDGIFS_HD_WIDTH:
        score += 20.0
    # Optimal duration bonus (15-120s is the sweet spot)
    if 15 <= duration <= 120:
        score += 15.0
    elif 5 <= duration <= 15:
        score += 5.0
    # Popularity signals
    score += min(10.0, (g.get("likes") or 0) / 50.0)
    score += min(5.0, (g.get("views") or 0) / 10000.0)
    # Penalize long clips with no audio (likely compilations)
    if duration > 30 and not has_audio:
        score -= 10.0
    return score


def _filter_redgifs_gender(gifs: list[dict]) -> list[dict]:
    """Apply gender filtering: reject female content, require male indicators."""
    filtered = []
    for g in gifs:
        all_tags = " ".join(t.lower() for t in (g.get("tags") or []))
        all_niches = " ".join(n.lower() for n in (g.get("niches") or []))
        combined = f"{all_tags} {all_niches}"
        # Hard reject if any female keyword appears anywhere in tags/niches
        if any(kw in combined for kw in _RG_FEMALE_KEYWORDS):
            continue
        # Require at least one male-indicative keyword
        if not any(kw in combined for kw in _RG_MALE_KEYWORDS):
            continue
        filtered.append(g)
    return filtered


def _filter_redgifs_quality(gifs: list[dict], max_duration: float) -> list[dict]:
    """Apply quality filters: duration range, skip bad compilations."""
    filtered = []
    for g in gifs:
        duration = g.get("duration") or 999
        has_audio = g.get("hasAudio", True)
        # Skip too short
        if duration < _REDGIFS_MIN_DURATION:
            continue
        # Skip too long
        if duration > max_duration:
            continue
        # Skip long clips with no audio (likely compilations)
        if duration > 30 and not has_audio:
            continue
        filtered.append(g)
    return filtered


def _search_redgifs_videos(
    session: requests.Session,
    query: str,
    limit: int,
    max_duration: float,
    order: str = "trending",
) -> list[dict]:
    """Return up to `limit` Redgifs clips with quality + gender filtering.

    Paginates up to _REDGIFS_PAGES pages to get more variety.
    """
    token = _get_redgifs_token(session)
    if not token:
        return []
    headers = {**_REDGIFS_HEADERS, "Authorization": f"Bearer {token}"}

    all_gifs: list[dict] = []
    for page in range(_REDGIFS_PAGES):
        gifs = _redgifs_request(
            session, headers,
            "https://api.redgifs.com/v2/gifs/search",
            params={
                "search_text": query,
                "count": _REDGIFS_PAGE_SIZE,
                "page": page + 1,
                "order": order,
                "niches": "gay",
            },
            label=f"search '{query}' order={order} page={page + 1}",
        )
        if not gifs:
            break
        all_gifs.extend(gifs)
        print(f"[redgifs] search '{query}' order={order} page {page + 1}: got {len(gifs)} raw")

    # Apply filters
    all_gifs = _filter_redgifs_gender(all_gifs)
    all_gifs = _filter_redgifs_quality(all_gifs, max_duration)

    # Sort by quality score descending, take top results
    all_gifs.sort(key=_redgifs_quality_score, reverse=True)
    return all_gifs[:limit]


def _search_redgifs_by_tags(
    session: requests.Session,
    tags: list[str],
    limit: int,
    max_duration: float,
    order: str = "trending",
) -> list[dict]:
    """Search Redgifs by tag list (e.g. ['gay', 'blowjob']). Paginates."""
    token = _get_redgifs_token(session)
    if not token:
        return []
    headers = {**_REDGIFS_HEADERS, "Authorization": f"Bearer {token}"}
    tag_str = ",".join(tags)

    all_gifs: list[dict] = []
    for page in range(_REDGIFS_PAGES):
        gifs = _redgifs_request(
            session, headers,
            "https://api.redgifs.com/v2/gifs/search",
            params={
                "tags": tag_str,
                "count": _REDGIFS_PAGE_SIZE,
                "page": page + 1,
                "order": order,
                "type": "g",
            },
            label=f"tags={tag_str} order={order} page={page + 1}",
        )
        if not gifs:
            break
        all_gifs.extend(gifs)
        print(f"[redgifs] tags={tag_str} order={order} page {page + 1}: got {len(gifs)} raw")

    all_gifs = _filter_redgifs_gender(all_gifs)
    all_gifs = _filter_redgifs_quality(all_gifs, max_duration)
    all_gifs.sort(key=_redgifs_quality_score, reverse=True)
    return all_gifs[:limit]


def _browse_redgifs_trending(
    session: requests.Session,
    tags: list[str],
    limit: int,
    max_duration: float,
) -> list[dict]:
    """Browse trending gay/male content on Redgifs, optionally filtered by tags."""
    token = _get_redgifs_token(session)
    if not token:
        return []
    headers = {**_REDGIFS_HEADERS, "Authorization": f"Bearer {token}"}
    tag_str = ",".join(tags) if tags else "gay"

    all_gifs: list[dict] = []
    for page in range(_REDGIFS_PAGES):
        gifs = _redgifs_request(
            session, headers,
            "https://api.redgifs.com/v2/gifs/trending",
            params={
                "tags": tag_str,
                "count": _REDGIFS_PAGE_SIZE,
                "page": page + 1,
                "type": "g",
            },
            label=f"trending tags={tag_str} page={page + 1}",
        )
        if not gifs:
            break
        all_gifs.extend(gifs)
        print(f"[redgifs] trending tags={tag_str} page {page + 1}: got {len(gifs)} raw")

    all_gifs = _filter_redgifs_gender(all_gifs)
    all_gifs = _filter_redgifs_quality(all_gifs, max_duration)
    all_gifs.sort(key=_redgifs_quality_score, reverse=True)
    return all_gifs[:limit]


def _search_redgifs_user(
    session: requests.Session,
    username: str,
    limit: int,
    max_duration: float,
) -> list[dict]:
    """Fetch clips from a specific Redgifs user profile."""
    token = _get_redgifs_token(session)
    if not token:
        return []
    headers = {**_REDGIFS_HEADERS, "Authorization": f"Bearer {token}"}

    all_gifs: list[dict] = []
    for page in range(_REDGIFS_PAGES):
        gifs = _redgifs_request(
            session, headers,
            f"https://api.redgifs.com/v2/users/{username}/search",
            params={
                "count": _REDGIFS_PAGE_SIZE,
                "page": page + 1,
                "order": "best",
            },
            label=f"user={username} page={page + 1}",
        )
        if not gifs:
            break
        all_gifs.extend(gifs)
        print(f"[redgifs] user={username} page {page + 1}: got {len(gifs)} raw")

    all_gifs = _filter_redgifs_gender(all_gifs)
    all_gifs = _filter_redgifs_quality(all_gifs, max_duration)
    all_gifs.sort(key=_redgifs_quality_score, reverse=True)
    return all_gifs[:limit]


# ── yt-dlp full-length video downloader ──────────────────────────────────────

_YTDLP_FEMALE_KEYWORDS = {
    "female", "woman", "women", "girl", "girls", "lesbian", "straight",
    "pussy", "vagina", "trans", "shemale", "ladyboy", "femboy", "hetero",
    "couple", "bisex", "bisexual", "wife", "girlfriend",
}

# Gay-specific search URLs — ordered by reliability (tested working sources first)
def _ytdlp_search_urls(query: str) -> list[str]:
    encoded_plus = query.replace(" ", "+")
    encoded_dash = query.replace(" ", "-")
    return [
        # Pornhub gay category search — primary working source with yt-dlp native support
        f"https://www.pornhub.com/gay/video/search?search={encoded_plus}",
        # Pornhub model/straight search fallback (broader results)
        f"https://www.pornhub.com/video/search?search={encoded_plus}+gay",
        # xhamster gay — try multiple URL formats
        f"https://xhamster.com/search/{encoded_dash}?category=gay",
        # RedTube gay category
        f"https://www.redtube.com/?search={encoded_plus}+gay&amp;category=gay",
        # xvideos with gay tag
        f"https://www.xvideos.com/tags/gay?k={encoded_plus}",
    ]


def _check_thumbnail_vision(session: requests.Session, thumbnail_url: str, settings) -> bool:
    """Run the vision filter against a remote thumbnail URL without downloading it locally."""
    if not thumbnail_url or settings is None:
        return True
    if not thumbnail_url.startswith(("http://", "https://")):
        return True
    from app.vision_filter import passes_strict_content_filter_url

    return passes_strict_content_filter_url(settings, thumbnail_url)


def _check_downloaded_video_vision(local_path: Path, settings) -> bool:
    """Extract a representative frame and require a strict male-only pass."""
    if settings is None:
        return True
    from app.video_utils import extract_video_frame
    from app.vision_filter import passes_strict_content_filter

    frame_path = extract_video_frame(str(local_path), time_offset=2.0)
    if not frame_path:
        return False
    try:
        return passes_strict_content_filter(settings, frame_path)
    finally:
        Path(frame_path).unlink(missing_ok=True)


def _search_ytdlp_videos(
    query: str,
    image_dir: Path,
    slug_base: str,
    db,
    max_count: int = 3,
    settings=None,
) -> list[dict]:
    """Search gay-category pages and extract direct streaming URLs (no download) for up to max_count videos."""
    try:
        import yt_dlp
    except ImportError:
        return []

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "playlistend": max_count * 6,
    }

    candidates: list[dict] = []
    for search_url in _ytdlp_search_urls(query):
        if len(candidates) >= max_count * 2:
            break
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(search_url, download=False)
                entries = (info or {}).get("entries") or []
                for e in entries:
                    title = (e.get("title") or "").lower()
                    desc = (e.get("description") or "").lower()
                    combined = f"{title} {desc}"
                    # Hard reject on female/straight keywords in title or description
                    if any(kw in combined for kw in _YTDLP_FEMALE_KEYWORDS):
                        continue
                    candidates.append(e)
                    if len(candidates) >= max_count * 2:
                        break
        except Exception as exc:
            print(f"[ytdlp] search failed for '{search_url}': {exc}")
            continue

    # Extract streaming URLs (no download) for up to max_count candidates
    extract_opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
    }

    session = requests.Session()
    results: list[dict] = []
    extracted = 0
    for entry in candidates:
        if extracted >= max_count:
            break
        url = entry.get("url") or entry.get("webpage_url") or ""
        if not url:
            continue
        if db and db.screenshot_page_url_exists(url):
            continue
        # Vision-filter thumbnail before committing to extraction
        thumbnail_url = entry.get("thumbnail") or ""
        if settings is not None and thumbnail_url:
            if not _check_thumbnail_vision(session, thumbnail_url, settings):
                print(f"[ytdlp] vision rejected thumbnail for: {entry.get('title', url)}")
                continue
        try:
            with yt_dlp.YoutubeDL(extract_opts) as ydl:
                info = ydl.extract_info(url, download=False)
            if not info:
                continue
            # Extract the best direct streaming URL
            stream_url = info.get("url")
            if not stream_url:
                formats = info.get("formats") or []
                # Prefer mp4 at <=720p
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
                    # Fallback: pick the last format with a URL (typically best quality)
                    for fmt in reversed(formats):
                        if fmt.get("url"):
                            best = fmt
                            break
                if best:
                    stream_url = best["url"]
            if not stream_url:
                continue
            results.append({
                "term": slug_base.replace("_", " "),
                "source": "ytdlp",
                "page_url": url,
                "local_path": None,
                "ok": True,
                "source_url": stream_url,
                "thumbnail_url": info.get("thumbnail") or entry.get("thumbnail") or "",
                "title": info.get("title") or entry.get("title") or "",
                "description": info.get("description") or entry.get("description") or "",
                "uploader": info.get("uploader") or entry.get("uploader") or "",
                "channel": info.get("channel") or entry.get("channel") or "",
            })
            extracted += 1
            print(f"[ytdlp] extracted stream URL for: {entry.get('title', url)[:60]}")
        except Exception as exc:
            print(f"[ytdlp] extract failed for {url}: {exc}")

    return results


# ── Main capture loop ─────────────────────────────────────────────────────────

def capture_screenshots(
    image_dir: Path,
    progress_cb=None,
    db=None,
    settings=None,
) -> Generator[dict, None, None]:
    """
    Yield result dicts: {"term", "source", "page_url", "local_path", "ok": bool}.
    progress_cb(term, source, done, total) called after each download.
    """
    image_dir.mkdir(parents=True, exist_ok=True)
    session = _build_session()
    seen_page_urls: dict[str, bool] = {}

    def _page_url_exists(page_url: str) -> bool:
        cached = seen_page_urls.get(page_url)
        if cached is not None:
            return cached
        exists = bool(db and db.screenshot_page_url_exists(page_url))
        seen_page_urls[page_url] = exists
        return exists

    def _mark_page_url(page_url: str) -> None:
        seen_page_urls[page_url] = True

    def _download_job(candidate: dict) -> dict:
        with _build_session() as worker_session:
            ok = _download_file(worker_session, candidate["url"], candidate["out_path"], candidate["accept"])
        candidate = dict(candidate)
        candidate["ok"] = ok
        return candidate

    for term in TERM_QUERIES:
        ddg_query = TERM_QUERIES[term]
        video_query = TERM_VIDEO_QUERIES[term]
        slug_base = term.replace(" ", "_")

        filtered_query = f"{ddg_query} {_DDG_EXCLUDE}"

        # ── Pass 1a + 1b: DDG regular images (2 pages) ───────────────────────
        results = (
            _search_ddg_images(session, filtered_query, MAX_RESULTS_PER_TERM, start=0)
            + _search_ddg_images(session, filtered_query, MAX_RESULTS_PER_TERM, start=50)
        )
        # Deduplicate by image URL within this batch
        seen_urls: set[str] = set()
        unique_results = []
        for row in results:
            u = row.get("image") or ""
            if u and u not in seen_urls:
                seen_urls.add(u)
                unique_results.append(row)
        results = unique_results
        print(f"[screenshot] {term!r} images: found {len(results)}")
        image_candidates: list[dict] = []
        for i, row in enumerate(results):
            image_url = row.get("image") or ""
            page_url = row.get("url") or image_url
            if not image_url:
                continue
            if _page_url_exists(page_url):
                continue
            image_candidates.append({
                "term": term,
                "source": "ddg",
                "page_url": page_url,
                "url": image_url,
            })
        for done, cand in enumerate(image_candidates, 1):
            image_url = cand["url"]
            ok = True
            if settings is not None:
                from app.vision_filter import passes_strict_content_filter_url
                if not passes_strict_content_filter_url(settings, image_url):
                    ok = False
            if ok:
                _mark_page_url(cand["page_url"])
            if progress_cb:
                progress_cb(term, "ddg", done, len(image_candidates))
            yield {"term": term, "source": "ddg", "page_url": cand["page_url"],
                   "local_path": None, "ok": ok,
                   "source_url": image_url}

        # ── Pass 2: DDG animated GIFs (2 pages) ───────────────────────────────
        gif_results = (
            _search_ddg_images(session, filtered_query, MAX_GIFS_PER_TERM, gif_only=True, start=0)
            + _search_ddg_images(session, filtered_query, MAX_GIFS_PER_TERM, gif_only=True, start=50)
        )
        seen_gif_urls: set[str] = set()
        gif_results = [
            row for row in gif_results
            if (u := row.get("image") or "") and u not in seen_gif_urls and not seen_gif_urls.add(u)  # type: ignore[func-returns-value]
        ]
        gif_results = gif_results  # already filtered above — keep variable for loop below
        print(f"[screenshot] {term!r} gifs: found {len(gif_results)}")
        gif_candidates: list[dict] = []
        for i, row in enumerate(gif_results):
            image_url = row.get("image") or ""
            page_url = row.get("url") or image_url
            if not image_url:
                continue
            if _page_url_exists(page_url):
                continue
            gif_candidates.append({
                "term": term,
                "source": "ddg",
                "page_url": page_url,
                "url": image_url,
            })
        for done, cand in enumerate(gif_candidates, 1):
            image_url = cand["url"]
            ok = True
            if settings is not None:
                from app.vision_filter import passes_strict_content_filter_url
                if not passes_strict_content_filter_url(settings, image_url):
                    ok = False
            if ok:
                _mark_page_url(cand["page_url"])
            if progress_cb:
                progress_cb(term, "ddg", done, len(gif_candidates))
            yield {"term": term, "source": "ddg", "page_url": cand["page_url"],
                   "local_path": None, "ok": ok,
                   "source_url": image_url}

        # ── Pass 3: yt-dlp full-length videos from tube sites ────────────────
        ytdlp_results = _search_ytdlp_videos(
            video_query,
            image_dir, slug_base, db, max_count=5, settings=settings
        )
        for result in ytdlp_results:
            if progress_cb:
                progress_cb(term, "ytdlp", 0, 0)
            yield result

        # ── Pass 4: Redgifs short video clips — multiple strategies ────────
        #   Strategy 1: text search (trending + top)
        #   Strategy 2: tag-based search
        #   Strategy 3: browse trending with tags
        print(f"[redgifs] {term!r}: starting multi-strategy collection")

        rg_trending = _search_redgifs_videos(session, video_query, MAX_VIDEOS_PER_TERM, MAX_VIDEO_DURATION_S, order="trending")
        rg_top = _search_redgifs_videos(session, video_query, MAX_VIDEOS_PER_TERM, MAX_VIDEO_DURATION_S, order="top")

        # Build tag list from the video query words
        rg_tags = [w.strip() for w in video_query.split() if len(w.strip()) >= 3]
        rg_by_tags = _search_redgifs_by_tags(session, rg_tags, MAX_VIDEOS_PER_TERM, MAX_VIDEO_DURATION_S, order="trending") if rg_tags else []

        # Browse trending with the first meaningful tag + "gay"
        trend_tags = ["gay"] + rg_tags[:1]
        rg_browse = _browse_redgifs_trending(session, trend_tags, MAX_VIDEOS_PER_TERM, MAX_VIDEO_DURATION_S)

        # Strategy 4: user profile search (if usernames configured for this term)
        rg_user_clips: list[dict] = []
        for uname in TERM_REDGIFS_USERS.get(term, []):
            rg_user_clips.extend(_search_redgifs_user(session, uname, 10, MAX_VIDEO_DURATION_S))

        # Merge and deduplicate all strategies
        seen_vid_ids: set[str] = set()
        videos: list[dict] = []
        for g in rg_trending + rg_top + rg_by_tags + rg_browse + rg_user_clips:
            gid = g.get("id") or ""
            if not gid or gid in seen_vid_ids:
                continue
            # Check if already in database
            page_url_check = f"https://redgifs.com/watch/{gid}"
            if db and db.screenshot_page_url_exists(page_url_check):
                continue
            seen_vid_ids.add(gid)
            videos.append(g)

        # Re-sort merged pool by quality score and cap
        videos.sort(key=_redgifs_quality_score, reverse=True)
        videos = videos[:MAX_VIDEOS_PER_TERM * 3]
        print(f"[redgifs] {term!r}: {len(videos)} unique clips after merge+dedup (≤{MAX_VIDEO_DURATION_S}s)")
        redgifs_jobs: list[dict] = []
        for i, gif in enumerate(videos):
            # Prefer HD URL, fall back to SD
            urls = gif.get("urls") or {}
            mp4_url = urls.get("hd") or urls.get("sd") or ""
            page_url = f"https://redgifs.com/watch/{gif.get('id', '')}"
            if not mp4_url:
                continue
            # Vision-filter poster thumbnail before downloading the full video
            poster_url = urls.get("poster") or ""
            if settings is not None and poster_url:
                if not _check_thumbnail_vision(session, poster_url, settings):
                    print(f"[redgifs] vision rejected: {gif.get('id', '')}")
                    continue
            if _page_url_exists(page_url):
                continue
            redgifs_jobs.append({
                "term": term,
                "source": "redgifs",
                "page_url": page_url,
                "url": mp4_url,
                "poster_url": poster_url,
            })
        for done, job in enumerate(redgifs_jobs, 1):
            ok = True
            _mark_page_url(job["page_url"])
            if progress_cb:
                progress_cb(term, "redgifs", done, len(redgifs_jobs))
            yield {"term": term, "source": "redgifs", "page_url": job["page_url"],
                   "local_path": None, "ok": ok,
                   "source_url": job["url"],
                   "thumbnail_url": job.get("poster_url") or None}

    # ── Creator-specific DDG image capture ─────────────────────────────────
    for creator_name, creator_query in CREATOR_QUERIES.items():
        slug_base = creator_name.replace(" ", "_")
        filtered_query = f"{creator_query} {_DDG_EXCLUDE}"
        results = (
            _search_ddg_images(session, filtered_query, 15, start=0)
            + _search_ddg_images(session, filtered_query, 15, start=50)
        )
        seen_creator_urls: set[str] = set()
        results = [
            row for row in results
            if (u := row.get("image") or "") and u not in seen_creator_urls and not seen_creator_urls.add(u)  # type: ignore[func-returns-value]
        ]
        print(f"[screenshot] creator '{creator_name}': found {len(results)} images")
        creator_candidates: list[dict] = []
        for i, row in enumerate(results):
            image_url = row.get("image") or ""
            page_url = row.get("url") or image_url
            if not image_url:
                continue
            if _page_url_exists(page_url):
                continue
            creator_candidates.append({
                "term": creator_name,
                "source": "ddg",
                "page_url": page_url,
                "url": image_url,
            })
        for done, cand in enumerate(creator_candidates, 1):
            image_url = cand["url"]
            ok = True
            if settings is not None:
                from app.vision_filter import passes_strict_content_filter_url
                if not passes_strict_content_filter_url(settings, image_url):
                    ok = False
            if ok:
                _mark_page_url(cand["page_url"])
            yield {"term": creator_name, "source": "ddg", "page_url": cand["page_url"],
                   "local_path": None, "ok": ok,
                   "source_url": image_url}


# ── Term → research theme mapping ────────────────────────────────────────────

TERM_TO_THEME: dict[str, str] = {
    # Anatomy
    "penis":               "lpsg_threads",
    "cock":                "lpsg_threads",
    "dick":                "lpsg_threads",
    "hung penis":          "lpsg_threads",
    "big cock gay":        "lpsg_threads",
    "uncut cock":          "lpsg_threads",
    "foreskin":            "lpsg_threads",
    "balls":               "lpsg_threads",
    "perineum":            "lpsg_threads",
    "gay ass":             "lpsg_threads",
    "gay nipples":         "lpsg_threads",
    # Ejaculation / orgasm
    "ejaculate":           "lpsg_threads",
    "precum":              "lpsg_threads",
    "hyperspermia":        "lpsg_threads",
    "gay cum":             "lpsg_threads",
    "hands free cum":      "lpsg_threads",
    "hands free orgasm":   "lpsg_threads",
    "cum shot":            "lpsg_threads",
    "edging":              "lpsg_threads",
    "gay creampie":        "lpsg_threads",
    "cum eating gay":      "lpsg_threads",
    "gay facial":          "lpsg_threads",
    "gay orgasm":          "lpsg_threads",
    "prostate orgasm":     "lpsg_threads",
    "ruined orgasm":       "lpsg_threads",
    "gay multiple orgasm": "lpsg_threads",
    # Sex acts
    "blowjob":             "lpsg_threads",
    "gay deepthroat":      "lpsg_threads",
    "men docking":         "fetish_kink",
    "anal":                "lpsg_threads",
    "rimjob":              "lpsg_threads",
    "bareback":            "lpsg_threads",
    "frottage":            "lpsg_threads",
    "69":                  "lpsg_threads",
    "mutual masturbation": "lpsg_threads",
    "gay threesome":       "lpsg_threads",
    "glory hole":          "fetish_kink",
    "gay breeding":        "lpsg_threads",
    # Solo / intimate
    "gay solo":            "reddit_gay",
    "gay shower":          "reddit_gay",
    "gay sauna":           "reddit_gay",
    "gay kissing":         "reddit_gay",
    "gay massage":         "reddit_gay",
    # Body types
    "twink":               "twinks",
    "twunk":               "twinks",
    "muscle gay":          "muscle_bears",
    "daddy":               "muscle_bears",
    "bear":                "muscle_bears",
    "otter gay":           "muscle_bears",
    "chub gay":            "muscle_bears",
    # Fashion / gear / kink
    "jockstrap":           "fetish_kink",
    "gay underwear":       "fetish_kink",
    "gay speedo":          "fetish_kink",
    "gay leather":         "fetish_kink",
    "cock ring":           "fetish_kink",
    "chastity gay":        "fetish_kink",
    "gay bondage":         "fetish_kink",
}


def ingest_screenshots_as_items(db) -> int:
    """
    Summarise screenshot counts per (term, source) and upsert them as
    source_type='visual_capture' items so the hypothesis engine can reason
    across visual and textual evidence.

    Returns the number of items upserted.
    """
    # Read aggregated counts from the screenshots table
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT term, source, COUNT(*) as cnt FROM screenshots GROUP BY term, source"
        ).fetchall()

    if not rows:
        return 0

    count = 0
    for row in rows:
        term = row["term"]
        source = row["source"]
        cnt = row["cnt"]

        theme = TERM_TO_THEME.get(term, "reddit_gay")
        density = "High" if cnt >= 15 else "Moderate" if cnt >= 8 else "Low"
        source_label = "DuckDuckGo" if source == "ddg" else "Redgifs" if source == "redgifs" else source
        media_type = "images" if source == "ddg" else "video clips"

        item = {
            "source_type": "visual_capture",
            "theme": theme,
            "query": f"visual://{source}/{term}",
            "title": f"Visual evidence: {term} ({source_label})",
            "url": f"visual://{source}/{term}",
            "summary": (
                f"{cnt} {media_type} collected for '{term}' via {source_label}. "
                f"Gay male content. {density} visual documentation density."
            ),
            "domain": f"visual.{source}",
            "score": min(1.0, cnt / 20.0),
        }
        db.upsert_visual_capture_item(item)
        count += 1

    return count
