from __future__ import annotations

import re
from collections.abc import Mapping
from urllib.parse import urlparse

_COMMON_URL_SEGMENTS = {
    "api",
    "cdn",
    "content",
    "data",
    "embed",
    "img",
    "image",
    "images",
    "media",
    "photo",
    "photos",
    "post",
    "posts",
    "profile",
    "profiles",
    "static",
    "u",
    "user",
    "users",
    "video",
    "videos",
    "watch",
}
_HANDLE_FIELDS = (
    "username",
    "userName",
    "uploader",
    "uploader_id",
    "channel",
    "channel_id",
    "author",
    "account",
    "twitter_username",
    "reddit_username",
)
_TITLE_FIELDS = ("title", "name", "display_name", "term")
_TEXT_FIELDS = ("description", "caption", "summary", "text", "bio")
_URL_FIELDS = ("page_url", "url", "image", "source_url", "thumbnail_url", "profile_url")


def normalize_identity_alias(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def _dedupe_aliases(values: list[str]) -> list[str]:
    seen: set[str] = set()
    aliases: list[str] = []
    for value in values:
        alias = normalize_identity_alias(value)
        if len(alias) < 3 or alias in seen:
            continue
        seen.add(alias)
        aliases.append(alias)
    return aliases


def _extract_url_aliases(url: str | None) -> set[str]:
    if not url:
        return set()
    try:
        parsed = urlparse(url)
    except Exception:
        return set()
    aliases: set[str] = set()
    for segment in parsed.path.split("/"):
        cleaned = normalize_identity_alias(segment)
        if len(cleaned) < 3 or cleaned in _COMMON_URL_SEGMENTS:
            continue
        aliases.add(cleaned)
    return aliases


def performer_identity_signature(performer: Mapping[str, object]) -> dict[str, object]:
    strong_values = [
        str(performer.get("username") or ""),
        str(performer.get("twitter_username") or ""),
        str(performer.get("reddit_username") or ""),
    ]
    weak_values = [str(performer.get("display_name") or "")]
    strong_values.extend(_extract_url_aliases(str(performer.get("profile_url") or "")))
    return {
        "id": performer.get("id"),
        "platform": str(performer.get("platform") or "").strip().lower(),
        "strong_aliases": _dedupe_aliases(strong_values),
        "weak_aliases": _dedupe_aliases(weak_values),
    }


def performer_identity_signatures(performers: list[Mapping[str, object]]) -> list[dict[str, object]]:
    return [performer_identity_signature(performer) for performer in performers]


def _candidate_context(candidate: Mapping[str, object] | object) -> dict[str, object]:
    if isinstance(candidate, Mapping):
        handle_values = [str(candidate.get(field) or "") for field in _HANDLE_FIELDS]
        title_values = [str(candidate.get(field) or "") for field in _TITLE_FIELDS]
        text_values = [str(candidate.get(field) or "") for field in _TEXT_FIELDS]
        url_values = [str(candidate.get(field) or "") for field in _URL_FIELDS]
    else:
        handle_values = []
        title_values = []
        text_values = [str(candidate)]
        url_values = []

    handle_aliases = {
        alias
        for alias in (normalize_identity_alias(value) for value in handle_values)
        if len(alias) >= 3
    }
    url_aliases: set[str] = set()
    for value in url_values:
        url_aliases.update(_extract_url_aliases(value))

    return {
        "handle_aliases": handle_aliases,
        "url_aliases": url_aliases,
        "title_compact": normalize_identity_alias(" ".join(value for value in title_values if value)),
        "text_compact": normalize_identity_alias(" ".join(value for value in text_values if value)),
    }


def score_candidate_identity(
    candidate: Mapping[str, object] | object,
    signature: Mapping[str, object],
    *,
    minimum_score: float = 5.0,
) -> dict[str, object]:
    strong_aliases = [str(alias) for alias in signature.get("strong_aliases", []) if str(alias)]
    weak_aliases = [str(alias) for alias in signature.get("weak_aliases", []) if str(alias)]
    if not strong_aliases and not weak_aliases:
        return {"score": 0.0, "accepted": False, "hard_match": False, "matched_aliases": []}

    context = _candidate_context(candidate)
    handle_aliases = set(context["handle_aliases"])
    url_aliases = set(context["url_aliases"])
    title_compact = str(context["title_compact"])
    text_compact = str(context["text_compact"])

    score = 0.0
    hard_match = False
    matched_aliases: list[str] = []
    strong_hits = 0
    weak_hits = 0

    for alias in strong_aliases:
        if alias in handle_aliases:
            score += 7.0
            hard_match = True
            strong_hits += 1
            matched_aliases.append(alias)
        elif alias in url_aliases:
            score += 6.0
            hard_match = True
            strong_hits += 1
            matched_aliases.append(alias)
        elif alias and alias in title_compact:
            score += 5.0
            hard_match = True
            strong_hits += 1
            matched_aliases.append(alias)
        elif alias and alias in text_compact:
            score += 1.5

    for alias in weak_aliases:
        if alias and alias in title_compact:
            score += 2.5
            weak_hits += 1
            matched_aliases.append(alias)
        elif alias and alias in text_compact:
            score += 0.75

    if strong_hits > 1:
        score += min(3.0, (strong_hits - 1) * 1.5)
    if strong_hits and weak_hits:
        score += 1.0

    accepted = (hard_match and score >= minimum_score) or score >= (minimum_score + 1.5)
    return {
        "score": score,
        "accepted": accepted,
        "hard_match": hard_match,
        "matched_aliases": matched_aliases,
    }


def find_best_identity_match(
    candidate: Mapping[str, object] | object,
    signatures: list[Mapping[str, object]],
    *,
    minimum_score: float = 5.0,
    minimum_gap: float = 2.0,
) -> dict[str, object] | None:
    scored: list[tuple[float, dict[str, object], Mapping[str, object]]] = []
    for signature in signatures:
        result = score_candidate_identity(candidate, signature, minimum_score=minimum_score)
        if float(result["score"]) <= 0:
            continue
        scored.append((float(result["score"]), result, signature))
    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    best_score, best_result, best_signature = scored[0]
    if not bool(best_result["accepted"]):
        return None
    if len(scored) > 1 and scored[1][0] >= best_score - minimum_gap:
        return None

    return {
        "performer_id": best_signature.get("id"),
        "score": best_score,
        "matched_aliases": best_result.get("matched_aliases", []),
    }
