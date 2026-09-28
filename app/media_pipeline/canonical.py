"""Canonical URL normalisation + safe shortener resolution."""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

from app.media_pipeline.netsafe import FetchError, UnsafeUrlError, safe_fetch, validate_url

TRACKING_PARAMS = frozenset(
    {
        "fbclid", "gclid", "gclsrc", "dclid", "msclkid", "yclid", "igshid", "igsh", "mc_cid", "mc_eid",
        "ref", "ref_src", "ref_url", "referrer", "feature", "si", "spm", "cmpid", "s_cid",
        "_hsenc", "_hsmi", "mkt_tok", "twclid", "ttclid", "wt_mc", "share", "sharetype", "amp", "amp_js_v",
        "xmt", "trk", "trkid", "ncid",
    }
)
TRACKING_PREFIXES = ("utm_", "pk_", "hsa_", "vero_", "oly_", "__s")

SHORTENER_HOSTS = frozenset(
    {
        "t.co", "bit.ly", "bitly.com", "tinyurl.com", "goo.gl", "ow.ly", "is.gd", "buff.ly", "lnkd.in",
        "rb.gy", "cutt.ly", "t.ly", "shorturl.at", "v.gd", "youtu.be", "redd.it", "fb.watch", "vm.tiktok.com",
    }
)

_HOST_ALIASES = {
    "mobile.twitter.com": "x.com",
    "twitter.com": "x.com",
    "mobile.x.com": "x.com",
    "old.reddit.com": "reddit.com",
    "np.reddit.com": "reddit.com",
    "i.reddit.com": "reddit.com",
    "m.youtube.com": "youtube.com",
    "music.youtube.com": "youtube.com",
    "youtube-nocookie.com": "youtube.com",
    "vxtwitter.com": "x.com",
    "fxtwitter.com": "x.com",
    "fixupx.com": "x.com",
}
_MOBILE_PREFIXES = ("m.", "mobile.", "amp.", "touch.")


def _strip_tracking(pairs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    kept = []
    for key, value in pairs:
        lk = key.lower()
        if lk in TRACKING_PARAMS or lk.startswith(TRACKING_PREFIXES):
            continue
        kept.append((key, value))
    return kept


def canonical_host(host: str) -> str:
    host = host.lower().rstrip(".")
    if host in _HOST_ALIASES:
        return _HOST_ALIASES[host]
    for prefix in ("www.", *_MOBILE_PREFIXES):
        if host.startswith(prefix) and host.count(".") >= 2:
            candidate = host[len(prefix) :]
            return _HOST_ALIASES.get(candidate, candidate)
    return host


def canonicalize_url(raw: str) -> str:
    """Stable identity for a URL: tracking params/fragments stripped, hosts
    unified (www/mobile/twitter->x), default ports removed, query sorted and a
    handful of site-specific share forms rewritten to their canonical form."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    if "://" not in raw and not raw.startswith("//"):
        raw = "https://" + raw
    parts = urlsplit(raw)
    scheme = (parts.scheme or "https").lower()
    host = canonical_host(parts.hostname or "")
    port = parts.port
    if port and ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        port = None
    path = re.sub(r"/{2,}", "/", parts.path or "/")
    pairs = _strip_tracking(parse_qsl(parts.query, keep_blank_values=False))

    if host == "youtu.be":
        vid = path.strip("/").split("/")[0]
        if vid:
            host, path = "youtube.com", "/watch"
            pairs = [("v", vid)] + [(k, v) for k, v in pairs if k == "list" or k == "t"]
    elif host == "youtube.com":
        if path.startswith(("/shorts/", "/embed/", "/live/")):
            vid = path.split("/")[2] if len(path.split("/")) > 2 else ""
            if vid:
                path = "/watch"
                pairs = [("v", vid)]
        elif path == "/watch":
            pairs = [(k, v) for k, v in pairs if k in {"v", "list", "t"}]
    elif host == "x.com":
        pairs = []
        path = re.sub(r"/(photo|video)/\d+$", "", path)
    elif host == "redgifs.com":
        m = re.match(r"^/(?:ifr|watch)/([A-Za-z0-9]+)", path)
        if m:
            path = f"/watch/{m.group(1).lower()}"
            pairs = []
    elif host == "reddit.com":
        pairs = []
    elif host in {"instagram.com", "tiktok.com", "facebook.com", "vimeo.com"}:
        pairs = [(k, v) for k, v in pairs if k in {"v", "story_fbid", "id"}]

    pairs.sort()
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/") or "/"
    netloc = host + (f":{port}" if port else "")
    query = urlencode(pairs, quote_via=quote)
    return urlunsplit((scheme, netloc, quote(unquote(path), safe="/:@!$&'()*+,;=-._~%"), query, ""))


def is_shortener(url: str) -> bool:
    try:
        host = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return False
    return host in SHORTENER_HOSTS


def resolve_shortener(url: str, *, fetcher=safe_fetch) -> str:
    """Follow a known shortener through the SSRF-safe fetcher (each hop
    validated). Returns the original URL if resolution fails."""
    if not is_shortener(url):
        return url
    try:
        result = fetcher(url, method="HEAD", timeout=5.0, total_timeout=10.0, max_redirects=5)
    except (UnsafeUrlError, FetchError):
        return url
    final = getattr(result, "url", url) or url
    try:
        validate_url(final)
    except UnsafeUrlError:
        return url
    return final


def canonical_key(url: str) -> str:
    """Compact identity key (host + path + query) usable for dedupe."""
    return canonicalize_url(url)
