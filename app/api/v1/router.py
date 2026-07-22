"""Aggregates every v1 router under /api/v1."""

from fastapi import APIRouter

from app.api.v1.health import router as health_router
from app.api.v1.media import router as media_router

v1_router = APIRouter(prefix="/api/v1")
v1_router.include_router(health_router)
v1_router.include_router(media_router)
