"""Boot-validated application settings (v2).

Replaces ``app/config.py`` incrementally: same environment variable names,
but every value is parsed and validated *once at boot* — a typo fails the
deploy, not the first request. Secrets are wrapped in ``SecretStr`` so they
can never leak into logs or reprs.

Uses pydantic v2 only (already a FastAPI dependency); no additional packages.
Adoption: Phase 1 of docs/architecture/migration-plan.md — ``config.py``
becomes a re-export shim and is deleted in Phase 3.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return int(raw.strip())  # ValueError propagates -> boot fails fast


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class SettingsError(ValueError):
    """Raised at boot when the environment is misconfigured."""


class CoreSettings(BaseModel):
    """Platform-level settings shared by all bounded contexts.

    Domain/source-specific knobs (per-provider result limits, provider API
    keys) remain in the legacy config until their context migrates; this
    model intentionally covers only what the v2 spine needs.
    """

    app_name: str = "Media Codex"
    environment: str = "development"
    database_path: Path = Path("data/research.db")
    image_dir: Path = Path("data/images")

    admin_token: SecretStr = SecretStr("")
    served_public: bool = False

    cors_allow_origins: list[str] = Field(default_factory=list)
    cors_allow_origin_regex: str | None = (
        r"^https://new-app-media-codex(-[a-z0-9-]+)?\.vercel\.app$"
    )

    # Optional shared infrastructure (ADR-0002: inert until multi-instance).
    redis_url: str | None = None

    rate_limit_capacity: int = 60
    rate_limit_refill_per_second: float = 30.0
    idempotency_window_hours: int = 24
    outbox_poll_interval_seconds: float = 1.0
    outbox_max_attempts: int = 8

    log_level: str = "INFO"

    @field_validator("environment")
    @classmethod
    def _normalize_environment(cls, value: str) -> str:
        value = value.strip().lower()
        if value not in {"development", "staging", "production", "test"}:
            raise SettingsError(f"ENVIRONMENT must be development|staging|production|test, got {value!r}")
        return value

    @model_validator(mode="after")
    def _validate_production_safety(self) -> "CoreSettings":
        problems: list[str] = []
        if self.environment == "production":
            if not self.admin_token.get_secret_value() or self.admin_token.get_secret_value() == "change-me":
                problems.append("ADMIN_TOKEN must be set to a non-default value in production")
            if not self.cors_allow_origins and not self.cors_allow_origin_regex:
                problems.append("CORS_ALLOW_ORIGINS or CORS_ALLOW_ORIGIN_REGEX must be set in production")
        if self.rate_limit_capacity <= 0:
            problems.append("RATE_LIMIT_CAPACITY must be positive")
        if problems:
            raise SettingsError("Invalid configuration: " + "; ".join(problems))
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @classmethod
    def from_env(cls) -> "CoreSettings":
        """Parse the process environment. Raises SettingsError at boot on any problem."""
        origins_raw = _env("CORS_ALLOW_ORIGINS")
        regex_raw = os.environ.get("CORS_ALLOW_ORIGIN_REGEX")
        return cls(
            app_name=_env("APP_NAME", "Media Codex") or "Media Codex",
            environment=_env("ENVIRONMENT", "development") or "development",
            database_path=Path(_env("DATABASE_PATH", "data/research.db")).expanduser(),
            image_dir=Path(_env("IMAGE_DIR", "data/images")).expanduser(),
            admin_token=SecretStr(_env("ADMIN_TOKEN")),
            served_public=_env_flag("SERVED_PUBLIC", False),
            cors_allow_origins=[o.strip() for o in origins_raw.split(",") if o.strip()],
            cors_allow_origin_regex=(regex_raw.strip() or None) if regex_raw is not None else cls.model_fields["cors_allow_origin_regex"].default,
            redis_url=_env("REDIS_URL") or _env("VALKEY_URL") or None,
            rate_limit_capacity=_env_int("RATE_LIMIT_CAPACITY", 60),
            rate_limit_refill_per_second=float(_env("RATE_LIMIT_REFILL_PER_SECOND", "30") or 30),
            idempotency_window_hours=_env_int("IDEMPOTENCY_WINDOW_HOURS", 24),
            outbox_poll_interval_seconds=float(_env("OUTBOX_POLL_INTERVAL_SECONDS", "1") or 1),
            outbox_max_attempts=_env_int("OUTBOX_MAX_ATTEMPTS", 8),
            log_level=_env("LOG_LEVEL", "INFO") or "INFO",
        )


@lru_cache(maxsize=1)
def get_core_settings() -> CoreSettings:
    """Process-wide settings singleton, validated on first access (app boot)."""
    return CoreSettings.from_env()
