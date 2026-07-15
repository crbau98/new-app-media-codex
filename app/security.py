from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from app.config import settings


def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    """Fail closed for production mutations and secret-bearing configuration."""
    configured = settings.admin_token
    if not configured:
        if settings.environment == "production":
            raise HTTPException(status_code=503, detail="Admin access is not configured")
        return
    if not x_admin_token or not secrets.compare_digest(x_admin_token, configured):
        raise HTTPException(status_code=401, detail="Missing or invalid admin token")


def redact_settings(values: dict) -> dict:
    secret_markers = (
        "api_key", "token", "secret", "password", "credential", "session",
        "cookie", "authorization", "proxy_url",
    )
    result: dict = {}
    for key, value in values.items():
        lowered = key.lower()
        if any(marker in lowered for marker in secret_markers):
            result[f"{key}_configured"] = bool(value)
        else:
            result[key] = value
    return result
