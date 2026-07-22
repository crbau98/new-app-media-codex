"""Versioned API surface (blueprint section 5). Import ``v1_router`` and
mount it in the composition root: ``app.include_router(v1_router)``."""

from app.api.v1.router import v1_router

__all__ = ["v1_router"]
