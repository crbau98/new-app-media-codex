"""Principal model and authorization dependencies (blueprint section 6).

Single-operator reality today: admin token for operator routes, open-but-
private for the rest. The seam that matters is that *no endpoint reads
credentials directly* — everything resolves through ``get_principal``, so an
OIDC bearer swap later touches exactly this file.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass, field

from fastapi import Request

from app.core.errors import ApiProblem
from app.core.settings import get_core_settings

ADMIN_ROLE = "admin"
OPERATOR_TOKEN_HEADER = "X-Admin-Token"


@dataclass(frozen=True)
class Principal:
    subject: str
    roles: frozenset[str] = field(default_factory=frozenset)

    @property
    def is_admin(self) -> bool:
        return ADMIN_ROLE in self.roles


ANONYMOUS = Principal(subject="anonymous")


async def get_principal(request: Request) -> Principal:
    """Resolve the caller. Admin token elevates to the admin role; its
    absence yields the anonymous principal (single-tenant private app)."""
    token = request.headers.get(OPERATOR_TOKEN_HEADER)
    if not token:
        return ANONYMOUS
    expected = get_core_settings().admin_token.get_secret_value()
    if expected and hmac.compare_digest(token.encode(), expected.encode()):
        return Principal(subject="operator", roles=frozenset({ADMIN_ROLE}))
    raise ApiProblem.unauthorized("Invalid admin token.")


async def require_admin(principal: Principal | None = None, request: Request | None = None) -> Principal:
    """Dependency for /api/v1/admin/*. Use via ``Depends(require_admin)``.

    FastAPI resolves nested dependencies, so this signature is intentionally
    dependency-shaped: pass through get_principal when wiring.
    """
    if principal is None:
        if request is None:  # pragma: no cover - defensive
            raise ApiProblem.unauthorized()
        principal = await get_principal(request)
    if not principal.is_admin:
        raise ApiProblem.forbidden("This operation requires the operator token.")
    return principal
