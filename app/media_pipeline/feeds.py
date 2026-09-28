"""RSS/Atom/JSON Feed, PeerTube and ActivityPub media extraction."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from urllib.parse import urljoin

from app.media_pipeline.manifests import _local, parse_iso_duration, safe_xml_root


@dataclass
class FeedItem:
    id: str
    title: str
    url: str
    published_at: str | None = None
    media_url: str | None = None
    media_mime: str | None = None
    thumbnail: str | None = None
    duration_seconds: float | None = None
    kind: str = "link"  # video | image | link


@dataclass
class FeedInfo:
    title: str
    items: list[FeedItem] = field(default_factory=list)
    format: str = "rss"


def _kind(url: str | None, mime: str | None) -> str:
    v = f"{mime or ''} {(url or '').split('?', 1)[0]}".lower()
    if "video" in v or any(v.endswith(e) or f"{e} " in v for e in (".mp4", ".webm", ".mov", ".m3u8", ".m4v")):
        return "video"
    if "image" in v or any(e in v for e in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")):
        return "image"
    return "link"


def _text(elem) -> str:
    return (elem.text or "").strip() if elem is not None else ""


def parse_xml_feed(text: str, feed_url: str, limit: int = 60) -> FeedInfo:
    root = safe_xml_root(text)
    channel_title = ""
    for child in root.iter():
        if _local(child.tag) == "title":
            channel_title = _text(child)
            break
    info = FeedInfo(title=channel_title or "Feed", format="atom" if _local(root.tag) == "feed" else "rss")
    entries = [e for e in root.iter() if _local(e.tag) in {"item", "entry"}][:limit]
    for index, entry in enumerate(entries):
        title = link = pub = guid = thumb = None
        media_url = media_mime = None
        duration = None
        for child in entry.iter():
            name = _local(child.tag)
            if child is entry:
                continue
            if name == "title" and title is None:
                title = _text(child)
            elif name == "link":
                href = child.attrib.get("href")
                rel = child.attrib.get("rel", "alternate")
                if href and rel == "enclosure":
                    media_url, media_mime = media_url or href, media_mime or child.attrib.get("type")
                elif href and link is None and rel in {"alternate", ""}:
                    link = href
                elif not href and link is None and _text(child):
                    link = _text(child)
            elif name in {"pubdate", "published", "updated"} and pub is None:
                pub = _text(child)
            elif name == "guid":
                guid = _text(child)
            elif name == "enclosure" and child.attrib.get("url"):
                media_url = media_url or child.attrib["url"]
                media_mime = media_mime or child.attrib.get("type")
            elif name == "content" and child.attrib.get("url"):
                mt = child.attrib.get("type") or child.attrib.get("medium")
                if media_url is None or (mt and "video" in mt):
                    media_url, media_mime = child.attrib["url"], mt
                if child.attrib.get("duration"):
                    try:
                        duration = float(child.attrib["duration"])
                    except ValueError:
                        pass
            elif name == "thumbnail" and child.attrib.get("url") and thumb is None:
                thumb = child.attrib["url"]
            elif name == "duration" and duration is None:
                raw = _text(child)
                try:
                    duration = float(raw)
                except ValueError:
                    duration = parse_iso_duration(raw)
        url = urljoin(feed_url, link or guid or feed_url)
        info.items.append(
            FeedItem(
                id=guid or f"{url}#{index}",
                title=title or f"Feed item {index + 1}",
                url=url,
                published_at=pub,
                media_url=urljoin(feed_url, media_url) if media_url else None,
                media_mime=media_mime,
                thumbnail=urljoin(feed_url, thumb) if thumb else None,
                duration_seconds=duration,
                kind=_kind(media_url, media_mime),
            )
        )
    return info


def parse_json_feed(text: str, feed_url: str, limit: int = 60) -> FeedInfo:
    data = json.loads(text)
    info = FeedInfo(title=str(data.get("title") or "JSON Feed"), format="jsonfeed")
    for index, item in enumerate((data.get("items") or [])[:limit]):
        att = next((a for a in item.get("attachments") or [] if a.get("url")), None)
        media = (att or {}).get("url") or item.get("image")
        mime = (att or {}).get("mime_type")
        url = item.get("url") or item.get("external_url") or feed_url
        info.items.append(
            FeedItem(
                id=str(item.get("id") or f"{url}#{index}"),
                title=str(item.get("title") or (att or {}).get("title") or "Feed item"),
                url=urljoin(feed_url, url),
                published_at=item.get("date_published"),
                media_url=urljoin(feed_url, media) if media else None,
                media_mime=mime,
                thumbnail=item.get("image"),
                duration_seconds=(att or {}).get("duration_in_seconds"),
                kind=_kind(media, mime),
            )
        )
    return info


def parse_activitypub_object(data: dict, page_url: str) -> FeedInfo | None:
    """ActivityPub / PeerTube object (Video, Note, Image, or an OrderedCollection
    page of them). Returns None when the payload is not ActivityStreams."""
    ctx = data.get("@context")
    if ctx is None and "type" not in data:
        return None
    objs = []
    kind = data.get("type")
    if kind in {"OrderedCollection", "OrderedCollectionPage", "Collection", "CollectionPage"}:
        objs = data.get("orderedItems") or data.get("items") or []
    else:
        objs = [data]
    info = FeedInfo(title=str(data.get("name") or "ActivityPub"), format="activitypub")
    for index, obj in enumerate(objs[:60]):
        if not isinstance(obj, dict):
            continue
        if obj.get("type") == "Create" and isinstance(obj.get("object"), dict):
            obj = obj["object"]
        if obj.get("type") not in {"Video", "Note", "Image", "Document", "Article", "Page"}:
            continue
        media_url = media_mime = thumb = None
        duration = parse_iso_duration(obj.get("duration")) if isinstance(obj.get("duration"), str) else None
        urls = obj.get("url") if isinstance(obj.get("url"), list) else [obj.get("url")]
        best_h = -1
        for link in urls:
            if isinstance(link, dict) and link.get("href"):
                mt = str(link.get("mediaType") or "")
                if mt.startswith("video/") or "mpegurl" in mt:
                    h = int(link.get("height") or 0)
                    prefer_mp4 = 10_000 if mt == "video/mp4" else 0
                    if h + prefer_mp4 > best_h:
                        best_h, media_url, media_mime = h + prefer_mp4, link["href"], mt
                # PeerTube nests HLS playlists / files in tag[]
                for tag in link.get("tag") or []:
                    if isinstance(tag, dict) and tag.get("type") == "Link" and str(tag.get("mediaType", "")).startswith("video/"):
                        h = int(tag.get("height") or 0) + (10_000 if tag.get("mediaType") == "video/mp4" else 0)
                        if h > best_h:
                            best_h, media_url, media_mime = h, tag.get("href"), tag.get("mediaType")
        for att in obj.get("attachment") or []:
            if isinstance(att, dict) and att.get("url") and not media_url:
                media_url = att["url"] if isinstance(att["url"], str) else _first_href(att["url"])
                media_mime = att.get("mediaType")
        icon = obj.get("icon")
        if isinstance(icon, list):
            icon = icon[0] if icon else None
        if isinstance(icon, dict):
            thumb = icon.get("url")
        page = obj.get("id") or page_url
        info.items.append(
            FeedItem(
                id=str(obj.get("id") or f"{page_url}#{index}"),
                title=str(obj.get("name") or "Post"),
                url=str(page),
                published_at=obj.get("published"),
                media_url=media_url,
                media_mime=media_mime,
                thumbnail=thumb,
                duration_seconds=duration,
                kind=_kind(media_url, media_mime),
            )
        )
    return info if info.items else None


def _first_href(value) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        for v in value:
            got = _first_href(v)
            if got:
                return got
    if isinstance(value, dict):
        return value.get("href") or value.get("url")
    return None
