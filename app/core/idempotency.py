"""Idempotency-Key support for mutating endpoints (blueprint section 5).

Clients send ``Idempotency-Key: <uuid>`` per intent and reuse it on retry.
The first execution's response is stored for 24 h; replays get the stored
response with ``Idempotency-Replayed: true``. Storage is a protocol —
SQLite implementation in ``app/repositories/idempotency.py``.
"""

from __future__ import annotations

import hashlib
import json
import time
import uuid
from dataclasses import dataclass
from typing import Protocol

from fastapi import Request

from app.core.errors import ApiProblem

HEADER_NAME = "Idempotency-Key"
REPLAYED_HEADER = "Idempotency-Replayed"


@dataclass(frozen=True)
class IdempotencyRecord:
    key: str
    endpoint: str
    request_hash: str
    response_json: str | None
    created_at: float


class IdempotencyStore(Protocol):
    def get(self, key: str, endpoint: str) -> IdempotencyRecord | None: ...
    def save(self, record: IdempotencyRecord) -> None: ...
    def purge_expired(self, window_seconds: int) -> int: ...


class InMemoryIdempotencyStore:
    """Single-instance store; fine until multi-instance (same seam as rate limiting)."""

    def __init__(self) -> None:
        self._records: dict[tuple[str, str], IdempotencyRecord] = {}

    def get(self, key: str, endpoint: str) -> IdempotencyRecord | None:
        return self._records.get((key, endpoint))

    def save(self, record: IdempotencyRecord) -> None:
        self._records[(record.key, record.endpoint)] = record

    def purge_expired(self, window_seconds: int) -> int:
        cutoff = time.time() - window_seconds
        stale = [k for k, r in self._records.items() if r.created_at < cutoff]
        for k in stale:
            del self._records[k]
        return len(stale)


def request_fingerprint(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


async def extract_idempotency_key(request: Request, *, required: bool) -> str | None:
    """Validate the header. UUID-shaped, per RFC 9110 it's opaque to us but
    constraining the shape makes accidental reuse across intents unlikely."""
    key = request.headers.get(HEADER_NAME)
    if key is None:
        if required:
            raise ApiProblem.bad_request(
                "idempotency-key-required",
                f"This endpoint requires an {HEADER_NAME} header (uuid v4).",
            )
        return None
    try:
        uuid.UUID(key)
    except ValueError as exc:
        raise ApiProblem.bad_request(
            "invalid-idempotency-key",
            f"{HEADER_NAME} must be a uuid (e.g. {uuid.uuid4()}).",
        ) from exc
    return key


def check_replay(store: IdempotencyStore, key: str, endpoint: str, body: bytes) -> IdempotencyRecord | None:
    """Return the stored record if this is a replay. Conflicting reuse (same
    key, different body) is a 409 — silent double-execution's evil twin."""
    record = store.get(key, endpoint)
    if record is None:
        return None
    if record.request_hash != request_fingerprint(body):
        raise ApiProblem.conflict(
            "Idempotency-Key was already used with a different request body.",
        )
    return record


def store_result(
    store: IdempotencyStore,
    *,
    key: str,
    endpoint: str,
    body: bytes,
    response_payload: dict,
) -> None:
    store.save(
        IdempotencyRecord(
            key=key,
            endpoint=endpoint,
            request_hash=request_fingerprint(body),
            response_json=json.dumps(response_payload, separators=(",", ":")),
            created_at=time.time(),
        )
    )
