"""Creator-submitted public feeds.

A creator, agency or operator can submit the *public* feed they publish themselves (RSS / Atom / JSON Feed,
a PeerTube channel, a Bluesky or Mastodon profile). Submission is validated and probed, stored as
``pending``, and only an operator-approved feed is crawled by the index crawler (same GuardedFetcher,
budgets and circuit breaker as every other source).

Hard rules enforced here
------------------------
* https only; IP-literal, private, credentialed or non-standard-port hosts are refused (and ``safe_fetch``
  enforces the SSRF policy again at connect time, including on every redirect hop);
* the DENYLIST below (leak / mirror / member-uploaded-forum sites) plus ``FEED_DENYLIST`` is refused,
  as are known paywalled platforms and any URL, title or tag with a leak marker;
* feeds behind a login or paywall (401 / 402 / 403, a redirect to a login page, a login form) are refused;
* hygiene: exclusion markers on structured fields only, contact details redacted, minor / non-consent
  markers drop the item (or refuse the feed when they are in its own title);
* only ``https`` item links are kept; sample media is stored only when the media and thumbnail are on a host
  the edge media proxy can serve, everything else becomes a link-out with attribution to the feed URL.

Contact e-mail and client IP are only ever stored as salted digests (``abuse.hash_value``).
"""

from __future__ import annotations

import asyncio
import hashlib
import html
import json
import re
import sqlite3
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

from app.creator_index import abuse
from app.creator_index.abuse import RateLimited
from app.creator_index.config import env_int, env_list, valid_public_hostname
from app.creator_index.fetcher import Fetcher, SourceError, TextResponse
from app.creator_index.hygiene import (
    canonical,
    canonical_url,
    clean_handle,
    clean_tag,
    has_contact_info,
    has_excluded_marker,
    leak_marker,
    redact,
    safe_media_url,
    safety_marker,
    to_int,
)
from app.creator_index.moderation import ModerationService
from app.creator_index.repository import CreatorIndexRepository, CreatorObservation, now_iso
from app.creator_index.suppression import load_suppression_index
from app.media_pipeline.feeds import FeedItem, parse_json_feed, parse_xml_feed
from app.media_pipeline.manifests import _local, safe_xml_root
from app.media_pipeline.netsafe import UnsafeUrlError, _literal_ip, validate_url

FEED_KINDS = ("rss", "atom", "jsonfeed", "peertube-channel", "bluesky", "mastodon")
DOCUMENT_KINDS = frozenset({"rss", "atom", "jsonfeed"})
STATUSES = ("pending", "approved", "rejected", "paused")
PLATFORM = "feed"
BLUESKY_APPVIEW = "https://public.api.bsky.app"
MAX_ITEMS = 40
MAX_LINKOUTS = 6
MAX_ERRORS_KEPT = 5

# ── Denylist ─────────────────────────────────────────────────────────────────
#
# Patterns: ``name.*`` (that label under any TLD, e.g. coomer.su / www.coomer.party), ``*.example.com`` or
# ``example.com`` (the domain and its subdomains). Extend at runtime with the comma-separated env var
# ``FEED_DENYLIST`` (same syntax). These are leak / mirror / archive sites of paywalled creator content and
# member-uploaded forums: nothing from them is ever submitted, fetched or indexed.
DENYLIST: tuple[str, ...] = (
    "coomer.*", "kemono.*", "lpsg.com", "simpcity.*", "thotsbay.*", "thothub.*", "fapello.*",
    "socialmediagirls.com", "leakedbb.*", "bunkr.*", "cyberdrop.*", "gofile.io",
)
# Any host label containing one of these substrings is refused (catches throw-away mirror domains).
DENY_HOST_SUBSTRINGS: tuple[str, ...] = ("leak", "coomer", "kemono", "simpcity", "thotsbay", "thothub", "fapello")
# First host label / path segments that mark a member-uploaded forum.
FORUM_LABELS = frozenset({"forum", "forums", "board", "boards"})
FORUM_PATH_TOKENS = frozenset({"forum", "forums", "threads", "showthread", "viewtopic", "topic", "topics"})
# Paywalled platforms: a public feed does not exist there, so a submission can only be a scrape/mirror.
PAYWALLED: tuple[str, ...] = (
    "onlyfans.com", "fansly.com", "justfor.fans", "fancentro.com", "loyalfans.com", "admireme.vip",
    "patreon.com", "subscribestar.com", "subscribestar.adult",
)
_LOGIN_TOKENS = frozenset({
    "login", "signin", "sign-in", "log-in", "logon", "auth", "authenticate", "account", "accounts", "subscribe",
    "subscription", "subscriptions", "paywall", "membership", "register", "signup", "sign-up", "checkout",
})
_HTML_LINK = re.compile(r"<link\b[^>]*>", re.I)


class FeedError(Exception):
    """A user-facing, coded failure (validation, probe or policy)."""

    def __init__(self, code: str, message: str | None = None):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


def denylist_patterns() -> list[str]:
    return [*DENYLIST, *env_list("FEED_DENYLIST")]


def _pattern_hit(host: str, pattern: str) -> bool:
    if pattern.endswith(".*"):
        base = pattern[:-2].split(".")
        labels = host.split(".")[:-1]  # never the TLD
        return any(labels[i:i + len(base)] == base for i in range(len(labels) - len(base) + 1))
    if pattern.startswith("*."):
        return host.endswith(pattern[1:])
    return host == pattern or host.endswith("." + pattern)


def host_policy(host: str, patterns: list[str] | None = None) -> str:
    """'' when the host is acceptable, else the refusal code (denylisted | paywalled_platform | forum_content)."""
    host = (host or "").lower().rstrip(".").removeprefix("www.")
    if any(_pattern_hit(host, p) for p in (patterns if patterns is not None else denylist_patterns())):
        return "denylisted"
    labels = host.split(".")
    if any(sub in label for label in labels[:-1] for sub in DENY_HOST_SUBSTRINGS):
        return "denylisted"
    if labels and labels[0] in FORUM_LABELS:
        return "forum_content"
    if any(_pattern_hit(host, p) for p in PAYWALLED):
        return "paywalled_platform"
    return ""


def path_policy(path: str) -> str:
    """Leak markers or forum-thread paths in a URL path."""
    segs = [s for s in unquote(path or "").lower().split("/") if s]
    if FORUM_PATH_TOKENS.intersection(segs):
        return "forum_content"
    return "leak_marker" if leak_marker(" ".join(segs)) else ""


def _public_host(host: str) -> str:
    """Raises FeedError for IP literals, private/internal and malformed hosts."""
    host = (host or "").lower().rstrip(".")
    if _literal_ip(host.strip("[]")) is not None:
        raise FeedError("ip_literal", "IP addresses are not accepted; use the feed's hostname.")
    if not valid_public_hostname(host):
        raise FeedError("invalid_host", "That host name is not valid.")
    return host


MESSAGES = {
    "denylisted": "That site is not accepted (mirror, leak or member-uploaded content).",
    "paywalled_platform": "Paywalled platforms have no public feed; submit a feed you publish yourself.",
    "forum_content": "Forum content is not accepted.",
    "leak_marker": "That URL or feed looks like leaked or mirrored content.",
}


# ── Submission normalisation ─────────────────────────────────────────────────


@dataclass
class Submission:
    kind: str
    canonical_key: str
    url: str           # fetch URL (document feeds) or the public profile / channel URL (handle kinds)
    handle: str = ""   # bluesky: `name.example`; mastodon / peertube: `name@host`
    hint_name: str = ""


_BSKY_HANDLE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")


def _check_domain(host: str) -> None:
    code = host_policy(host)
    if code:
        raise FeedError(code, MESSAGES[code])


def _handle_submission(kind: str, raw: str, hint: str) -> Submission:
    text = raw.strip().lstrip("@").lower()
    if kind == "bluesky":
        if not _BSKY_HANDLE.match(text):
            raise FeedError("invalid_handle", "A Bluesky handle looks like name.bsky.social.")
        _check_domain(text)
        return Submission("bluesky", f"bluesky:{text}", f"https://bsky.app/profile/{text}", text, hint)
    name, _, host = text.partition("@")
    if not name or not host or not re.fullmatch(r"[a-z0-9_.-]{1,60}", name):
        raise FeedError("invalid_handle", "Use the full handle, e.g. name@instance.example.")
    host = _public_host(host)
    _check_domain(host)
    if kind == "mastodon":
        return Submission("mastodon", f"mastodon:{name}@{host}", f"https://{host}/@{name}", f"{name}@{host}", hint)
    return Submission("peertube-channel", f"peertube:{name}@{host}", f"https://{host}/video-channels/{name}",
                      f"{name}@{host}", hint)


def normalize_submission(url: str | None, handle: str | None, kind: str | None, name: str | None = None) -> Submission:
    """Strict, network-free validation. Raises FeedError."""
    hint = redact(name or "")[:80]
    kind = (kind or "").strip().lower() or None
    if kind and kind not in FEED_KINDS:
        raise FeedError("invalid_kind", "kind must be one of: " + ", ".join(FEED_KINDS))
    raw_url = (url or "").strip()
    raw_handle = (handle or "").strip()
    if not raw_url and not raw_handle:
        raise FeedError("target_required", "Provide a feed url, or a handle together with its kind.")
    if not raw_url:
        if kind not in {"bluesky", "mastodon", "peertube-channel"}:
            raise FeedError("kind_required", "A handle needs kind bluesky, mastodon or peertube-channel.")
        return _handle_submission(kind, raw_handle, hint)

    if len(raw_url) > 600 or any(ch in raw_url for ch in "\r\n\t\x00 "):
        raise FeedError("invalid_url", "That URL is not valid.")
    try:
        parts = urlsplit(raw_url)
        port = parts.port
    except ValueError as exc:
        raise FeedError("invalid_url", "That URL is not valid.") from exc
    if parts.scheme.lower() != "https":
        raise FeedError("https_required", "Only https URLs are accepted.")
    if parts.username or parts.password:
        raise FeedError("credentials_not_allowed", "URLs with embedded credentials are not accepted.")
    if port not in (None, 443):
        raise FeedError("port_not_allowed", "Only the standard https port is accepted.")
    host = _public_host(parts.hostname or "")
    try:
        validate_url(raw_url)  # same syntactic SSRF policy the fetcher applies
    except UnsafeUrlError as exc:
        raise FeedError("private_host_blocked" if "private" in exc.code else "invalid_url", "That URL is not accepted.") from exc
    _check_domain(host)
    bare = host.removeprefix("www.")
    segs = [unquote(s) for s in parts.path.split("/") if s]
    code = path_policy(parts.path)
    if code:
        raise FeedError(code, MESSAGES[code])

    # Profile-style URLs become handle kinds (their public APIs are the supported feed).
    if bare == "bsky.app" and len(segs) == 2 and segs[0] == "profile" and kind in (None, "bluesky"):
        return _handle_submission("bluesky", segs[1], hint)
    if len(segs) == 1 and kind in (None, "mastodon") and re.fullmatch(r"@[A-Za-z0-9_]+(?:@[A-Za-z0-9.-]+)?", segs[0]):
        local, _, remote = segs[0][1:].partition("@")
        return _handle_submission("mastodon", f"{local}@{remote or bare}", hint)
    if len(segs) == 2 and (
        (segs[0] == "video-channels" and kind in (None, "peertube-channel")) or (segs[0] == "c" and kind == "peertube-channel")
    ):
        name_, _, remote = segs[1].partition("@")
        return _handle_submission("peertube-channel", f"{name_}@{remote or bare}", hint)
    if kind in {"bluesky", "mastodon", "peertube-channel"}:
        raise FeedError("invalid_url", "That URL is not a profile URL for the chosen kind.")
    fetch_url = urlunsplit(("https", parts.netloc.lower(), parts.path or "/", parts.query, ""))
    return Submission(kind or "rss", f"feed:{canonical_url(raw_url)}", fetch_url, "", hint)


# ── Parsed feed model ────────────────────────────────────────────────────────


@dataclass
class FeedEntry:
    id: str
    title: str
    url: str
    published: str = ""
    media_url: str = ""
    media_kind: str = ""
    thumbnail: str = ""
    tags: list[str] = field(default_factory=list)
    views: int = 0
    likes: int = 0
    duration: int = 0


@dataclass
class ParsedFeed:
    format: str
    title: str
    author: str = ""
    site_url: str = ""
    description: str = ""
    entries: list[FeedEntry] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    followers: int | None = None
    avatar: str = ""
    requests: int = 1
    dropped: int = 0


def plain_text(value: Any, limit: int = 200) -> str:
    text = html.unescape(re.sub(r"<[^>]*>", " ", str(value or "")))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def iso_utc(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    when: datetime | None = None
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError, IndexError):
        try:
            when = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return ""
    if when is None:
        return ""
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _https(value: Any) -> str:
    text = str(value or "").strip()
    try:
        parts = urlsplit(text)
        ok = parts.scheme == "https" and bool(parts.hostname) and not parts.username and not parts.password
    except ValueError:
        return ""
    return text[:600] if ok else ""


def _clean_tags(values: Any) -> list[str]:
    out: list[str] = []
    for v in values or []:
        tag = clean_tag(plain_text(v, 60))
        if tag and tag not in out:
            out.append(tag)
    return out[:12]


# ── Document feeds (RSS / Atom / JSON Feed) ──────────────────────────────────


def _xml_meta(text: str, limit: int) -> tuple[dict[str, Any], list[list[str]]]:
    root = safe_xml_root(text)
    meta: dict[str, Any] = {"author": "", "site": "", "description": "", "categories": []}
    is_atom = _local(root.tag) == "feed"
    container = root
    if not is_atom:
        for child in root:
            if _local(child.tag) == "channel":
                container = child
                break
    for child in container:
        name = _local(child.tag)
        if name in {"item", "entry"}:
            continue
        if name == "link" and not meta["site"]:
            href = child.attrib.get("href") or (child.text or "").strip()
            if href and child.attrib.get("rel", "alternate") in {"alternate", ""}:
                meta["site"] = href
        elif name in {"description", "subtitle"} and not meta["description"]:
            meta["description"] = (child.text or "").strip()
        elif name.lower() in {"managingeditor", "creator", "author"} and not meta["author"]:
            inner = next((g for g in child if _local(g.tag) == "name"), None)
            meta["author"] = ((inner.text if inner is not None else child.text) or "").strip()
        elif name == "category":
            meta["categories"].append(child.attrib.get("term") or (child.text or "").strip())
    per_item: list[list[str]] = []
    for entry in [e for e in root.iter() if _local(e.tag) in {"item", "entry"}][:limit]:
        cats = []
        for child in entry:
            if _local(child.tag) in {"category", "subject"}:
                cats.append(child.attrib.get("term") or (child.text or "").strip())
        per_item.append(cats)
    # RSS managingEditor is "email (Name)": keep only the name part, never the address.
    author = redact(re.sub(r"^.*\((.*)\)\s*$", r"\1", meta["author"]))
    meta["author"] = author
    return meta, per_item


def parse_document(text: str, url: str, limit: int = MAX_ITEMS) -> ParsedFeed | None:
    """Sniff and parse an RSS / Atom / JSON Feed body with the shared pipeline parser. None = not a feed."""
    body = (text or "").lstrip("﻿ \t\r\n")
    try:
        if body.startswith("{"):
            data = json.loads(body)
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                return None
            info = parse_json_feed(body, url, limit)
            authors = data.get("authors") if isinstance(data.get("authors"), list) else [data.get("author")]
            author = next((a.get("name") for a in authors if isinstance(a, dict) and a.get("name")), "")
            raw_items = [i for i in data["items"][:limit] if isinstance(i, dict)]
            cats = [i.get("tags") if isinstance(i.get("tags"), list) else [] for i in raw_items]
            parsed = ParsedFeed(
                "jsonfeed", plain_text(info.title), redact(author)[:120], _https(data.get("home_page_url")),
                plain_text(data.get("description"), 300),
            )
            _fill_entries(parsed, info.items, cats, url)
            return parsed
        if body.startswith("<"):
            root = safe_xml_root(body)
            if _local(root.tag) not in {"rss", "feed", "RDF"}:
                return None
            info = parse_xml_feed(body, url, limit)
            meta, per_item = _xml_meta(body, limit)
            parsed = ParsedFeed(
                info.format, plain_text(info.title), meta["author"][:120], _https(urljoin(url, meta["site"])) if meta["site"] else "",
                plain_text(meta["description"], 300), categories=_clean_tags(meta["categories"]),
            )
            _fill_entries(parsed, info.items, per_item, url)
            return parsed
    except (ElementTree.ParseError, ValueError, TypeError, AttributeError, RecursionError):
        if re.match(r"\s*(?:<!doctype\s+html|<html)", body[:300], re.I):
            return None  # an ordinary web page: the caller may still discover its feed link
        raise FeedError("not_a_feed", "That URL did not return a valid feed.") from None
    return None


def _fill_entries(parsed: ParsedFeed, items: list[FeedItem], cats: list[list[str]], feed_url: str) -> None:
    for index, item in enumerate(items):
        link = _https(item.url)
        if not link or link == _https(feed_url):
            parsed.dropped += 1
            continue
        media = _https(item.media_url)
        kind = item.kind if media and item.kind in {"video", "image"} else ""
        parsed.entries.append(FeedEntry(
            id=str(item.id)[:200], title=plain_text(item.title), url=link, published=iso_utc(item.published_at),
            media_url=media if kind else "", media_kind=kind, thumbnail=_https(item.thumbnail),
            tags=_clean_tags(cats[index] if index < len(cats) else []),
            duration=to_int(item.duration_seconds),
        ))


_FEED_TYPES = ("rss", "atom", "feed+json", "application/json", "xml")


def discover_feed_url(html_text: str, page_url: str) -> str:
    """The first ``<link rel=alternate type=rss|atom|json>`` of an HTML page, resolved, or ''."""
    for tag in _HTML_LINK.findall(html_text[:150_000]):
        attrs = {m.group(1).lower(): html.unescape(m.group(2) or m.group(3) or "")
                 for m in re.finditer(r"([a-zA-Z-]+)\s*=\s*(?:\"([^\"]*)\"|'([^']*)')", tag)}
        if "alternate" in attrs.get("rel", "").lower() and any(t in attrs.get("type", "").lower() for t in _FEED_TYPES):
            href = attrs.get("href", "").strip()
            if href:
                return urljoin(page_url, href)
    return ""


def _has_password_field(text: str) -> bool:
    return bool(re.search(r"type\s*=\s*[\"']?password", text[:200_000], re.I))


def check_response(res: TextResponse, requested: str, *, login_form_check: bool = True) -> None:
    """Policy checks on a fetched document: logins, paywalls, redirects to denied hosts, size."""
    if res.status in (401, 402, 403, 407):
        raise FeedError("login_required", "That feed is behind a login or paywall.")
    if res.status == 404:
        raise FeedError("not_found", "That URL does not exist.")
    if res.status == 410:
        raise FeedError("gone", "That feed has been removed.")
    if not 200 <= res.status < 300:
        raise FeedError("http_error", f"The server answered HTTP {res.status}.")
    final = res.url or requested
    parts = urlsplit(final)
    if parts.scheme != "https":
        raise FeedError("insecure_redirect", "The feed redirects to a non-https URL.")
    host = (parts.hostname or "").lower()
    code = host_policy(host) or (path_policy(parts.path) if final != requested else "")
    if code:
        raise FeedError(code, MESSAGES[code])
    if final != requested and canonical_url(final, keep_query=False) != canonical_url(requested, keep_query=False):
        words = {w for w in re.split(r"[^a-z0-9-]+", (parts.path + " " + parts.query).lower()) if w}
        origin = {w for w in re.split(r"[^a-z0-9-]+", urlsplit(requested).path.lower()) if w}
        if (words & _LOGIN_TOKENS) - origin:
            raise FeedError("login_required", "That feed redirects to a login page.")
    if res.truncated:
        raise FeedError("too_large", "The feed is larger than the 2 MB limit.")
    if login_form_check and "html" in res.content_type and _has_password_field(res.text):
        raise FeedError("login_required", "That page asks for a login.")


async def _get_text(fetcher: Fetcher, url: str) -> tuple[TextResponse, int]:
    getter = getattr(fetcher, "get_text", None)
    if getter is None:
        raise SourceError("unsupported", "fetcher cannot read text bodies")
    return await getter(url), 1


async def read_document_feed(fetcher: Fetcher, url: str) -> ParsedFeed:
    res, requests = await _get_text(fetcher, url)
    check_response(res, url, login_form_check=False)
    parsed = parse_document(res.text, res.url or url)
    if parsed is None and ("html" in res.content_type or res.text.lstrip()[:15].lower().startswith(("<!doctype", "<html"))):
        alt = discover_feed_url(res.text, res.url or url)
        alt_url = _https(alt)
        if not alt_url and _has_password_field(res.text):
            raise FeedError("login_required", "That page asks for a login.")
        if alt_url:
            code = host_policy(urlsplit(alt_url).hostname or "") or path_policy(urlsplit(alt_url).path)
            if code:
                raise FeedError(code, MESSAGES[code])
            res, more = await _get_text(fetcher, alt_url)
            requests += more
            check_response(res, alt_url)
            parsed = parse_document(res.text, res.url or alt_url)
    if parsed is None:
        raise FeedError("not_a_feed", "That URL is not an RSS, Atom or JSON feed.")
    parsed.requests = requests
    return parsed


# ── Handle-based feeds (public APIs) ─────────────────────────────────────────


def _status_error(status: int) -> FeedError | None:
    if status in (401, 402, 403, 407):
        return FeedError("login_required", "That account is not publicly readable.")
    if status in (400, 404):
        return FeedError("not_found", "That account or channel was not found.")
    if status == 410:
        return FeedError("gone", "That feed has been removed.")
    return None


async def _json(fetcher: Fetcher, url: str):
    res = await fetcher.get_json(url)
    err = _status_error(res.status)
    if err:
        raise err
    if not res.ok:
        raise FeedError("http_error", f"The server answered HTTP {res.status}.")
    return res.data


async def read_peertube(fetcher: Fetcher, handle: str) -> ParsedFeed:
    name, _, host = handle.partition("@")
    base = f"https://{host}/api/v1/video-channels/{quote(name, safe='')}"
    channel = await _json(fetcher, base)
    rows = await _json(fetcher, f"{base}/videos?count=20&sort=-publishedAt&nsfw=both")
    if not isinstance(channel, dict) or not isinstance(rows, dict) or not isinstance(rows.get("data"), list):
        raise FeedError("not_a_feed", "That is not a PeerTube channel.")
    parsed = ParsedFeed(
        "peertube", plain_text(channel.get("displayName") or name, 120), "", _https(channel.get("url")) or f"https://{host}/video-channels/{name}",
        plain_text(channel.get("description"), 300), followers=to_int(channel.get("followersCount")) if "followersCount" in channel else None,
        requests=2,
    )
    for video in rows["data"][:MAX_ITEMS]:
        if not isinstance(video, dict):
            continue
        link = _https(video.get("url")) or (f"https://{host}/w/{quote(str(video['shortUUID']), safe='')}" if video.get("shortUUID") else "")
        privacy = video.get("privacy")
        if not link or (isinstance(privacy, dict) and privacy.get("id") not in (1, None)):  # 1 = public
            parsed.dropped += 1
            continue
        thumb = video.get("thumbnailPath")
        parsed.entries.append(FeedEntry(
            id=str(video.get("uuid") or link)[:200], title=plain_text(video.get("name")), url=link,
            published=iso_utc(video.get("publishedAt")), tags=_clean_tags(video.get("tags")),
            thumbnail=_https(f"https://{host}{thumb}") if isinstance(thumb, str) and thumb.startswith("/") else "",
            views=to_int(video.get("views")), likes=to_int(video.get("likes")), duration=to_int(video.get("duration")),
        ))
    return parsed


_HASHTAG = re.compile(r"#([\w]{2,30})", re.UNICODE)


async def read_bluesky(fetcher: Fetcher, handle: str) -> ParsedFeed:
    actor = quote(handle, safe=".")
    profile = await _json(fetcher, f"{BLUESKY_APPVIEW}/xrpc/app.bsky.actor.getProfile?actor={actor}")
    if not isinstance(profile, dict):
        raise FeedError("not_found", "That account was not found.")
    labels = {str(l.get("val")) for l in (profile.get("labels") or []) if isinstance(l, dict)}
    if "!no-unauthenticated" in labels:
        raise FeedError("login_required", "That account is not visible to signed-out readers.")
    feed = await _json(fetcher, f"{BLUESKY_APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor={actor}&limit=30&filter=posts_no_replies")
    rows = feed.get("feed") if isinstance(feed, dict) else None
    if not isinstance(rows, list):
        raise FeedError("not_a_feed", "That account has no readable feed.")
    parsed = ParsedFeed(
        "bluesky", plain_text(profile.get("displayName") or handle, 120), "", f"https://bsky.app/profile/{handle}",
        plain_text(profile.get("description"), 300),
        followers=to_int(profile.get("followersCount")) if "followersCount" in profile else None, requests=2,
    )
    for row in rows[:MAX_ITEMS]:
        post = row.get("post") if isinstance(row, dict) else None
        if not isinstance(post, dict) or row.get("reason"):  # skip reposts
            continue
        author = post.get("author") if isinstance(post.get("author"), dict) else {}
        record = post.get("record") if isinstance(post.get("record"), dict) else {}
        rkey = str(post.get("uri") or "").rsplit("/", 1)[-1]
        if str(author.get("handle") or "").lower() != handle or not rkey:
            continue
        text = str(record.get("text") or "")
        tags = _clean_tags([*(record.get("tags") or []), *_HASHTAG.findall(text)])
        parsed.entries.append(FeedEntry(
            id=str(post.get("uri"))[:200], title=plain_text(text, 140) or "Post",
            url=f"https://bsky.app/profile/{handle}/post/{quote(rkey, safe='')}", published=iso_utc(record.get("createdAt")),
            tags=tags, likes=to_int(post.get("likeCount")),
        ))
    return parsed


async def read_mastodon(fetcher: Fetcher, handle: str) -> ParsedFeed:
    user, _, host = handle.partition("@")
    acct = await _json(fetcher, f"https://{host}/api/v1/accounts/lookup?acct={quote(user, safe='')}")
    if not isinstance(acct, dict) or not acct.get("id"):
        raise FeedError("not_found", "That account was not found.")
    if acct.get("locked") or acct.get("bot") or acct.get("noindex") or acct.get("discoverable") is False:
        raise FeedError("login_required", "That account is private, a bot, or opted out of discovery.")
    rows = await _json(fetcher, f"https://{host}/api/v1/accounts/{quote(str(acct['id']), safe='')}/statuses?limit=20&exclude_replies=true&exclude_reblogs=true")
    if not isinstance(rows, list):
        raise FeedError("not_a_feed", "That account has no readable timeline.")
    parsed = ParsedFeed(
        "mastodon", plain_text(acct.get("display_name") or user, 120), "", _https(acct.get("url")) or f"https://{host}/@{user}",
        plain_text(acct.get("note"), 300),
        followers=to_int(acct.get("followers_count")) if "followers_count" in acct else None, requests=2,
    )
    for st in rows[:MAX_ITEMS]:
        if not isinstance(st, dict):
            continue
        link = _https(st.get("url"))
        if not link or st.get("visibility") not in (None, "public", "unlisted"):
            parsed.dropped += 1
            continue
        tags = _clean_tags([t.get("name") for t in st.get("tags") or [] if isinstance(t, dict)])
        parsed.entries.append(FeedEntry(
            id=str(st.get("id") or link)[:200], title=plain_text(st.get("spoiler_text") or st.get("content"), 140) or "Post",
            url=link, published=iso_utc(st.get("created_at")), tags=tags, likes=to_int(st.get("favourites_count")),
        ))
    return parsed


async def read_feed(kind: str, url: str, handle: str, fetcher: Fetcher) -> ParsedFeed:
    if kind in DOCUMENT_KINDS:
        return await read_document_feed(fetcher, url)
    if kind == "peertube-channel":
        return await read_peertube(fetcher, handle)
    if kind == "bluesky":
        return await read_bluesky(fetcher, handle)
    if kind == "mastodon":
        return await read_mastodon(fetcher, handle)
    raise FeedError("invalid_kind", "Unknown feed kind.")


# ── Hygiene + mapping ────────────────────────────────────────────────────────


def vet_feed(parsed: ParsedFeed, *, display_name: str, handle: str) -> list[FeedEntry]:
    """Feed-level policy + item filtering. Returns the kept entries or raises FeedError."""
    title_scope = [parsed.title, parsed.author, display_name, *parsed.categories]
    if safety_marker(*title_scope):
        raise FeedError("unsafe_content", "Feeds that reference minors or non-consensual content are not accepted.")
    if leak_marker(parsed.title, display_name) or (parsed.site_url and path_policy(urlsplit(parsed.site_url).path)):
        raise FeedError("leak_marker", MESSAGES["leak_marker"])
    if parsed.site_url:
        code = host_policy(urlsplit(parsed.site_url).hostname or "")
        if code:
            raise FeedError(code, MESSAGES[code])
    if has_excluded_marker([handle, display_name, *parsed.categories]):
        raise FeedError("excluded_content", "This catalogue only covers male / gay creators.")
    kept: list[FeedEntry] = []
    for entry in parsed.entries:
        host = urlsplit(entry.url).hostname or ""
        if host_policy(host) or path_policy(urlsplit(entry.url).path):
            parsed.dropped += 1
            continue
        if has_excluded_marker(entry.tags) or safety_marker(entry.title, *entry.tags) or leak_marker(entry.title, *entry.tags):
            parsed.dropped += 1
            continue
        entry.title = redact(entry.title)[:200] or "Post"
        kept.append(entry)
    if not kept:
        raise FeedError("no_items", "The feed has no usable public items (https links are required).")
    return kept


def choose_display_name(parsed: ParsedFeed, hint: str) -> str:
    """The feed's own author/channel name wins; the submitter's hint is only a fallback."""
    for candidate in (parsed.author, parsed.title, hint):
        name = redact(candidate).strip()
        if name and not has_contact_info(name):
            return name[:120]
    raise FeedError("no_name", "The feed has no usable author or title.")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]


def derive_handle(kind: str, display_name: str, handle: str, site_host: str, canonical_key: str, taken: Callable[[str], bool]) -> str:
    if kind == "bluesky":
        return clean_handle(f"{handle}@bsky.app")
    if kind in {"mastodon", "peertube-channel"}:
        return clean_handle(handle)
    slug = _slug(display_name)
    digest = hashlib.sha1(canonical_key.encode()).hexdigest()[:6]  # noqa: S324 - identity, not security
    candidates = [f"{slug}@{site_host}" if slug else "", f"{slug or 'feed'}-{digest}@{site_host}"]
    for cand in candidates:
        cleaned = clean_handle(cand)
        if cleaned and canonical(cleaned.split("@")[0]) and not taken(cleaned):
            return cleaned
    return clean_handle(f"feed-{digest}@{site_host}")


def _media_item(entry: FeedEntry, creator: str) -> dict[str, Any] | None:
    """Sample media only when the edge media proxy can serve both the media and its thumbnail."""
    media, thumb = safe_media_url(entry.media_url), safe_media_url(entry.thumbnail)
    if not (entry.media_kind and media and thumb):
        return None
    out: dict[str, Any] = {
        "id": "feed-" + hashlib.sha1(entry.url.encode()).hexdigest()[:12],  # noqa: S324
        "title": entry.title or f"Post by {creator}", "thumbnail": thumb, "source": "Creator feed",
        "duration": f"{entry.duration // 60}:{entry.duration % 60:02d}", "isVideo": entry.media_kind == "video",
        "category": entry.tags[0] if entry.tags else "gay male", "creator": creator, "tags": entry.tags[:12], "rating": 0,
        "createdAt": entry.published, "views": entry.views, "mediaUrl": media, "streamCandidates": [media],
        "pageUrl": entry.url, "likes": entry.likes,
    }
    if entry.duration:
        out["durationSeconds"] = entry.duration
    return out


def to_observation(feed: dict[str, Any], parsed: ParsedFeed, entries: list[FeedEntry], display_name: str, handle: str) -> CreatorObservation:
    tags: Counter[str] = Counter()
    for tag in parsed.categories:
        tags[tag] += 1
    for entry in entries:
        tags.update(entry.tags)
    media = [m for m in (_media_item(e, display_name) for e in entries) if m]
    links = [{"label": "Feed", "url": feed["url"]}] + [
        {"label": e.title, "url": e.url} for e in entries[:MAX_LINKOUTS]
    ]
    avatar = safe_media_url(parsed.avatar) or ""
    return CreatorObservation(
        platform=PLATFORM, handle=handle, display_name=display_name, avatar_url=avatar,
        profile_url=parsed.site_url or (feed["url"] if feed["url"].startswith("https://") else ""),
        followers=parsed.followers, media_count=len(entries), view_count=sum(e.views for e in entries),
        like_count=sum(e.likes for e in entries), tags=dict(tags.most_common(20)),
        last_seen_at=max((e.published for e in entries), default=""), source=f"feed:{feed['id']}",
        sample_media=media, attribution=f"Creator-submitted public feed: {feed['url']}", links=links,
    )


# ── Persistence ──────────────────────────────────────────────────────────────


@dataclass
class FeedConfig:
    refresh_minutes: int = 360
    max_per_run: int = 6
    max_failures: int = 6
    max_pending: int = 200
    per_ip_per_hour: int = 5
    global_per_hour: int = 60

    @classmethod
    def from_env(cls) -> "FeedConfig":
        return cls(
            refresh_minutes=env_int("FEED_REFRESH_MINUTES", 360, minimum=15),
            max_per_run=env_int("FEED_MAX_PER_RUN", 6, minimum=0, maximum=50),
            max_failures=env_int("FEED_MAX_FAILURES", 6, minimum=1),
            max_pending=env_int("FEED_MAX_PENDING", 200, minimum=1),
            per_ip_per_hour=env_int("FEED_SUBMIT_PER_HOUR", 5, minimum=1),
            global_per_hour=env_int("FEED_SUBMIT_GLOBAL_PER_HOUR", 60, minimum=1),
        )


PAUSE_CODES = frozenset({
    "login_required", "gone", "leak_marker", "denylisted", "paywalled_platform", "forum_content",
    "unsafe_content", "excluded_content", "insecure_redirect",
})


def _loads(value: str | None, default: Any) -> Any:
    try:
        out = json.loads(value) if value else default
    except ValueError:
        return default
    return out if isinstance(out, type(default)) else default


def admin_view(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "kind": row["kind"], "url": row["url"], "handle": row["handle"],
        "displayName": row["display_name"], "creatorHandle": row["creator_handle"], "siteUrl": row["site_url"],
        "status": row["status"], "reason": row["reason"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        "lastFetchedAt": row["last_fetched_at"], "nextFetchAt": row["next_fetch_at"], "lastStatus": row["last_status"],
        "itemCount": row["item_count"], "failures": row["failures"], "errors": _loads(row["error_json"], []),
        "hasContact": bool(row["contact_email_hash"]),
    }


@dataclass
class FeedCrawlReport:
    fetched: int = 0
    requests: int = 0
    new: int = 0
    upserted: int = 0
    errors: list[str] = field(default_factory=list)


class FeedService:
    def __init__(
        self, repo: CreatorIndexRepository, fetcher_provider: Callable[[], Fetcher], *,
        config: FeedConfig | None = None, clock: Callable[[], float] = time.time,
        limiter_clock: Callable[[], float] = time.monotonic,
    ):
        self.repo = repo
        self._connect = repo.connect
        self._fetcher = fetcher_provider
        self.config = config or FeedConfig.from_env()
        self._clock = clock
        self.moderation = ModerationService(repo.connect)
        self.per_ip = abuse.SlidingWindowLimiter(self.config.per_ip_per_hour, 3600, clock=limiter_clock)
        self.overall = abuse.SlidingWindowLimiter(self.config.global_per_hour, 3600, clock=limiter_clock)
        self._salt: str | None = None

    # ── helpers ──

    @property
    def salt(self) -> str:
        if self._salt is None:
            self._salt = abuse.get_salt(self.repo.get_state, self.repo.set_state)
        return self._salt

    def _stamp(self, offset: float = 0.0) -> str:
        return now_iso(self._clock() + offset)

    def get(self, feed_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM submitted_feeds WHERE id = ?", (feed_id,)).fetchone()
        return dict(row) if row else None

    def list(self, *, status: str | None = None, limit: int = 50, before_id: int | None = None) -> list[dict[str, Any]]:
        clauses, params = ["1=1"], []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if before_id:
            clauses.append("id < ?")
            params.append(before_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM submitted_feeds WHERE {' AND '.join(clauses)} ORDER BY id DESC LIMIT ?",
                [*params, max(1, min(200, limit))],
            ).fetchall()
        return [admin_view(r) for r in rows]

    def count(self, status: str) -> int:
        with self._connect() as conn:
            return int(conn.execute("SELECT COUNT(*) FROM submitted_feeds WHERE status = ?", (status,)).fetchone()[0])

    def _by_key(self, key: str) -> sqlite3.Row | None:
        with self._connect() as conn:
            return conn.execute("SELECT * FROM submitted_feeds WHERE canonical_key = ?", (key,)).fetchone()

    def _handle_taken(self, handle: str) -> bool:
        with self._connect() as conn:
            return conn.execute("SELECT 1 FROM submitted_feeds WHERE creator_handle = ?", (handle,)).fetchone() is not None

    # ── submission ──

    def check_rate(self, client_key: str) -> None:
        ok, retry = self.per_ip.hit(client_key)
        if not ok:
            raise RateLimited(retry, "client")
        ok, retry = self.overall.hit("*")
        if not ok:
            raise RateLimited(retry, "global")

    async def submit(
        self, *, url: str | None, handle: str | None, kind: str | None, name: str | None, email: str | None,
        client_key: str, ip_hash: str = "",
    ) -> tuple[int, dict[str, Any]]:
        """Returns (http_status, body). Raises FeedError / RateLimited."""
        self.check_rate(client_key)
        email_hash = ""
        if email:
            normalised = abuse.normalize_email(email)
            if not normalised:
                raise FeedError("invalid_email", "That e-mail address is not valid.")
            email_hash = abuse.hash_value(normalised, self.salt)
        sub = normalize_submission(url, handle, kind, name)
        if self.moderation.is_feed_suppressed(sub.canonical_key):
            raise FeedError("not_accepted", "This feed cannot be accepted.")
        existing = self._by_key(sub.canonical_key)
        if existing is not None:
            return 200, {"id": existing["id"], "status": existing["status"], "duplicate": True, "kind": existing["kind"],
                         "displayName": existing["display_name"]}
        if self.count("pending") >= self.config.max_pending:
            raise FeedError("queue_full", "The review queue is full; please try again later.")

        try:
            parsed = await read_feed(sub.kind, sub.url, sub.handle, self._fetcher())
        except SourceError as exc:
            if exc.code == "unsafe_url":
                raise FeedError("private_host_blocked", "That URL is not accepted.") from exc
            raise FeedError("fetch_failed", "The feed could not be fetched right now.") from exc
        display = choose_display_name(parsed, sub.hint_name)
        site_host = (urlsplit(parsed.site_url).hostname or urlsplit(sub.url).hostname or "feed.invalid").lower().removeprefix("www.")
        creator_handle = derive_handle(sub.kind, display, sub.handle, site_host, sub.canonical_key, self._handle_taken)
        if not creator_handle:
            raise FeedError("no_name", "The feed has no usable author or title.")
        entries = vet_feed(parsed, display_name=display, handle=creator_handle)
        kind = parsed.format if sub.kind in DOCUMENT_KINDS and parsed.format in DOCUMENT_KINDS else sub.kind
        stamp = self._stamp()
        try:
            with self._connect() as conn:
                cur = conn.execute(
                    "INSERT INTO submitted_feeds (kind, url, canonical_key, handle, display_name, creator_handle, site_url, "
                    "contact_email_hash, status, created_at, updated_at, last_status, item_count, submitted_ip_hash) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (kind, sub.url, sub.canonical_key, sub.handle, display, creator_handle, parsed.site_url, email_hash,
                     "pending", stamp, stamp, "probe_ok", len(entries), ip_hash),
                )
                conn.commit()
                feed_id = int(cur.lastrowid)
        except sqlite3.IntegrityError:
            row = self._by_key(sub.canonical_key)
            return 200, {"id": row["id"] if row else None, "status": row["status"] if row else "pending", "duplicate": True}
        return 201, {"id": feed_id, "status": "pending", "kind": kind, "displayName": display, "itemCount": len(entries),
                     "duplicate": False}

    # ── moderation ──

    def set_status(self, feed_id: int, status: str, reason: str = "") -> str:
        """'ok' | 'not_found' | 'suppressed' (a takedown blocks approval)."""
        if status not in STATUSES:
            raise ValueError("bad status")
        row = self.get(feed_id)
        if row is None:
            return "not_found"
        if status == "approved" and self.moderation.is_feed_suppressed(row["canonical_key"]):
            return "suppressed"
        stamp = self._stamp()
        with self._connect() as conn:
            conn.execute(
                "UPDATE submitted_feeds SET status = ?, reason = ?, updated_at = ?, "
                "next_fetch_at = CASE WHEN ? = 'approved' THEN ? ELSE next_fetch_at END, "
                "failures = CASE WHEN ? = 'approved' THEN 0 ELSE failures END WHERE id = ?",
                (status, redact(reason)[:300], stamp, status, stamp, status, feed_id),
            )
            conn.commit()
        if row["creator_handle"]:
            if status == "rejected":
                self.moderation.set_hidden(PLATFORM, row["creator_handle"], True)
            elif status == "approved":
                self.moderation.set_hidden(PLATFORM, row["creator_handle"], False)  # no-op while suppressed
        return "ok"

    # ── crawling ──

    def due(self, limit: int) -> list[dict[str, Any]]:
        if limit <= 0:
            return []
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM submitted_feeds WHERE status = 'approved' AND (next_fetch_at IS NULL OR next_fetch_at <= ?) "
                "ORDER BY COALESCE(last_fetched_at, '') ASC, id ASC LIMIT ?",
                (self._stamp(), limit),
            ).fetchall()
        return [dict(r) for r in rows]

    async def fetch_feed(self, feed: dict[str, Any], *, ingest: bool = True) -> dict[str, Any]:
        """Fetch one feed. ``ingest=False`` is a dry-run preview (used for pending feeds)."""
        outcome: dict[str, Any] = {"id": feed["id"], "ok": False, "requests": 0, "new": 0, "upserted": 0, "code": "", "items": 0}
        try:
            parsed = await read_feed(feed["kind"], feed["url"], feed["handle"], self._fetcher())
            outcome["requests"] = parsed.requests
            display = choose_display_name(parsed, feed["display_name"])
            handle = feed["creator_handle"] or derive_handle(
                feed["kind"], display, feed["handle"], (urlsplit(parsed.site_url or feed["url"]).hostname or "feed.invalid").removeprefix("www."),
                feed["canonical_key"], self._handle_taken,
            )
            entries = vet_feed(parsed, display_name=display, handle=handle)
        except FeedError as exc:
            outcome["code"] = exc.code
            if ingest:
                self._record_failure(feed, exc.code, exc.message, pause=exc.code in PAUSE_CODES)
            return outcome
        except SourceError as exc:
            outcome["code"] = exc.code
            outcome["requests"] = 0 if exc.code == "circuit_open" else 1
            if ingest:
                self._record_failure(feed, exc.code, str(exc), transient=exc.code == "circuit_open")
            return outcome
        outcome.update(ok=True, items=len(entries), name=display, handle=handle)
        if not ingest:
            return outcome
        observation = to_observation(feed, parsed, entries, display, handle)
        result = await asyncio.to_thread(self.repo.upsert_detailed, [observation])
        outcome["upserted"], outcome["new"] = result.written, len(result.new)
        status = "suppressed" if result.suppressed else "ok"
        stamp = self._stamp()
        with self._connect() as conn:
            conn.execute(
                "UPDATE submitted_feeds SET last_fetched_at = ?, next_fetch_at = ?, last_status = ?, item_count = ?, failures = 0, "
                "display_name = ?, creator_handle = ?, site_url = ?, error_json = '[]', updated_at = ? WHERE id = ?",
                (stamp, self._stamp(self.config.refresh_minutes * 60), status, len(entries), display, handle, parsed.site_url,
                 stamp, feed["id"]),
            )
            conn.commit()
        return outcome

    def _record_failure(self, feed: dict[str, Any], code: str, message: str, *, pause: bool = False, transient: bool = False) -> None:
        stamp = self._stamp()
        failures = feed.get("failures", 0) + (0 if transient else 1)
        errors = _loads(feed.get("error_json"), [])[-(MAX_ERRORS_KEPT - 1):] + [{"at": stamp, "code": code, "message": message[:160]}]
        status, reason = "approved", ""
        if pause:
            status, reason = "paused", code
        elif failures >= self.config.max_failures:
            status, reason = "paused", "repeated_failures"
        delay_minutes = 30 if transient else min(24 * 60, self.config.refresh_minutes * (2 ** min(failures, 6)))
        with self._connect() as conn:
            conn.execute(
                "UPDATE submitted_feeds SET status = ?, reason = CASE WHEN ? != '' THEN ? ELSE reason END, last_fetched_at = ?, "
                "next_fetch_at = ?, last_status = ?, failures = ?, error_json = ?, updated_at = ? WHERE id = ?",
                (status, reason, reason, stamp, self._stamp(delay_minutes * 60), code, failures, json.dumps(errors), stamp, feed["id"]),
            )
            conn.commit()

    async def crawl_due(self, exhausted: Callable[[], bool], max_feeds: int | None = None) -> FeedCrawlReport:
        report = FeedCrawlReport()
        for feed in await asyncio.to_thread(self.due, self.config.max_per_run if max_feeds is None else max_feeds):
            if exhausted():
                break
            outcome = await self.fetch_feed(feed)
            report.fetched += 1
            report.requests += outcome["requests"]
            report.new += outcome["new"]
            report.upserted += outcome["upserted"]
            if outcome["code"]:
                report.errors.append(f"feed:{feed['id']}:{outcome['code']}")
        return report
