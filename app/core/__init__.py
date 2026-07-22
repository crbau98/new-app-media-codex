"""Core platform primitives for Media Codex v2.

Framework-agnostic building blocks shared by every bounded context:
validated settings, RFC 9457 errors, cursor pagination, rate limiting,
idempotency, security dependencies, and time. Nothing in this package may
import from ``app.domain``, ``app.services``, ``app.repositories`` or
``app.api`` — the dependency rule is one-way, inward.

See docs/architecture/backend-redesign.md, section 3.
"""

from app.core.errors import ApiProblem, ProblemDetails, register_error_handlers
from app.core.pagination import Page, PageInfo, decode_cursor, encode_cursor
from app.core.security import Principal, get_principal, require_admin
from app.core.settings import CoreSettings, get_core_settings
from app.core.time import utcnow

__all__ = [
    "ApiProblem",
    "CoreSettings",
    "Page",
    "PageInfo",
    "Principal",
    "ProblemDetails",
    "decode_cursor",
    "encode_cursor",
    "get_core_settings",
    "get_principal",
    "register_error_handlers",
    "require_admin",
    "utcnow",
]
