"""Content-safety text screens for provider discovery.

This is an 18+ app: adult-labelled content is kept. Anything that signals a
minor, non-consent, privacy-violating capture or an illegal act is dropped
before it ever reaches a response. The screens are deliberately conservative
(false positives only cost a post; false negatives are unacceptable).
"""

from __future__ import annotations

import re

_MINOR = re.compile(
    r"""
    \b(?:
        under\s?-?\s?age(?:d)? | under\s?-?\s?18 |
        minors? | juvenile | jail\s?bait | pre\s?-?teens? | pre\s?-?pubescent | pubescent |
        teen(?:s|age|ager|agers)? | tween(?:s)? |
        loli(?:con)? | shota(?:con)? | pedo\w* | child(?:ren)? | kids? | little\s+(?:boy|boys) |
        school\s?-?(?:boy|boys|kid|kids) | (?:high|middle|junior)\s?-?school |
        (?:1[0-7])\s?-?\s?(?:y\s?/?\s?o|yo|yrs?|years?)(?:\s?-?\s?old)? |
        cp
    )\b
    """,
    re.I | re.X,
)

_NON_CONSENT = re.compile(
    r"""
    \b(?:
        non\s?-?\s?con(?:sent|sensual)?(?:ual)? | without\s+(?:his\s+|their\s+)?(?:consent|knowing|knowledge|permission) |
        rap(?:e|ed|es|ing|ist) | forced | drugged | roofie[sd]? | passed\s+out | unconscious |
        blackmail(?:ed)? | revenge\s?-?\s?porn | hidden\s?-?\s?cam(?:era)? | spy\s?-?\s?cam |
        voyeur(?:ism)? | upskirt | leak(?:ed|s)? | stolen\s+(?:nudes|video|videos|content) | doxx?(?:ed|ing)?
    )\b
    """,
    re.I | re.X,
)

_ILLEGAL = re.compile(r"\b(?:bestiality|zoophil\w*|beastiality|necrophil\w*|snuff|human\s+trafficking|trafficked)\b", re.I)

# Handles and subreddit names have no word boundaries (TeenBoys, nineteen_x), so
# they are screened by substring. Over-blocking an account is the safe failure.
_MINOR_COMPACT = re.compile(r"teen|underage|under18|jailbait|preteen|pubescent|loli|shota|pedo|child|schoolboy|schoolkid|minor|kiddie", re.I)

# Platforms whose content is subscription-only. A post that merely *links* to
# one is promotion (fine); we never fetch or mirror anything from these hosts.
PAYWALL_HOSTS = (
    "onlyfans.com",
    "fansly.com",
    "justfor.fans",
    "justforfans.com",
    "patreon.com",
    "manyvids.com",
    "fanvue.com",
    "coomer.su",
    "coomer.party",
    "kemono.su",
    "kemono.party",
)

# Creator-promotion vocabulary: in broad hashtag searches we keep a post only
# when it is author-flagged sensitive or reads like adult creator marketing.
_ADULT_HINT = re.compile(
    r"""
    (?:
        only\s?fans | fansly | just\s?for\s?fans | \bjff\b | \bnsfw\b | \b18\s?\+ | \badults?\s+only\b |
        \bporn\w* | \bxxx\b | \bnaked\b | \bnude[sd]?\b | \bcum(?:shot|ming)?\b | \bsolo\b | \bthirst\w* |
        link\s+in\s+(?:bio|profile) | \bsubscribe\b | \bnew\s+(?:video|set|scene|content)\b | \bexclusive\b |
        \bcontent\s+creator\b | \bleather\b | \bjock(?:strap)?\b | \bbulge\b | \bhairy\b
    )
    """,
    re.I | re.X,
)


def is_unsafe_text(*values: object) -> bool:
    """True when any value signals a minor, non-consent, privacy abuse or illegality."""
    for value in values:
        text = str(value or "")
        if not text:
            continue
        if _MINOR.search(text) or _NON_CONSENT.search(text) or _ILLEGAL.search(text):
            return True
    return False


def is_unsafe_identifier(*values: object) -> bool:
    """Like :func:`is_unsafe_text` for handles / subreddit names (substring based)."""
    return is_unsafe_text(*values) or any(_MINOR_COMPACT.search(str(value or "")) for value in values)


def looks_like_adult_promo(*values: object) -> bool:
    """True when text reads like adult-creator marketing."""
    return any(_ADULT_HINT.search(str(value or "")) for value in values)


def is_paywall_host(host: str) -> bool:
    host = (host or "").lower().removeprefix("www.")
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in PAYWALL_HOSTS)
