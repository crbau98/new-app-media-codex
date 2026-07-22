"""ULID generation without external dependencies.

ULIDs are time-ordered, so B-tree inserts append rather than scatter — and
cursor pagination can use them directly as tiebreakers.
"""

from __future__ import annotations

import os
import time

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        value, remainder = divmod(value, 32)
        chars.append(_CROCKFORD[remainder])
    return "".join(reversed(chars))


def new_ulid() -> str:
    """48-bit millisecond timestamp + 80 bits of randomness, Crockford base32."""
    timestamp_ms = int(time.time() * 1000) & ((1 << 48) - 1)
    randomness = int.from_bytes(os.urandom(10), "big")
    return _encode(timestamp_ms, 10) + _encode(randomness, 16)
