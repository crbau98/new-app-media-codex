"""Content + perceptual hashing and near-duplicate clustering.

Nothing here deletes or merges anything: it only produces hashes, distances
and cluster ids so callers can *flag* near-duplicates.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from pathlib import Path

DEFAULT_PHASH_THRESHOLD = 6  # of 64 bits: visually the same image
DEFAULT_DHASH_THRESHOLD = 8


def sha256_file(path: str | Path, chunk: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def perceptual_hashes(image) -> tuple[str, str]:
    """(pHash, dHash) hex strings for a PIL image (64 bit each)."""
    import imagehash

    rgb = image.convert("RGB")
    return str(imagehash.phash(rgb)), str(imagehash.dhash(rgb))


def hamming_hex(a: str | None, b: str | None) -> int | None:
    """Hamming distance between two equal-length hex hashes; None if not comparable."""
    if not a or not b or len(a) != len(b):
        return None
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return None


def find_near_duplicates(
    target: str | None,
    candidates: Iterable[tuple[object, str | None]],
    threshold: int = DEFAULT_PHASH_THRESHOLD,
) -> list[tuple[object, int]]:
    """[(id, distance)] for every candidate within `threshold`, closest first.
    Exact-hash matches (distance 0) are included."""
    if not target:
        return []
    matches: list[tuple[object, int]] = []
    for ident, value in candidates:
        d = hamming_hex(target, value)
        if d is not None and d <= threshold:
            matches.append((ident, d))
    matches.sort(key=lambda m: m[1])
    return matches


def cluster_hashes(items: Iterable[tuple[object, str | None]], threshold: int = DEFAULT_PHASH_THRESHOLD) -> list[list[object]]:
    """Single-linkage clustering by hamming distance (union-find). Returns only
    clusters with more than one member."""
    pool = [(i, h) for i, h in items if h]
    parent = list(range(len(pool)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(len(pool)):
        for j in range(i + 1, len(pool)):
            d = hamming_hex(pool[i][1], pool[j][1])
            if d is not None and d <= threshold:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[rb] = ra
    groups: dict[int, list[object]] = {}
    for idx, (ident, _h) in enumerate(pool):
        groups.setdefault(find(idx), []).append(ident)
    return [g for g in groups.values() if len(g) > 1]
