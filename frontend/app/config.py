from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class Theme:
    slug: str
    label: str
    queries: list[str]


def _flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _path_env(name: str, default: Path) -> Path:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    path = Path(value.strip()).expanduser()
    return path if path.is_absolute() else Path.cwd() / path


@dataclass
class Settings:
    app_name: str = field(default_factory=lambda: os.getenv("APP_NAME", "Codex Research Radar").strip() or "Codex Research Radar")
    base_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent.parent)
    database_path: Path = field(init=False)
    image_dir: Path = field(init=False)
    environment: str = field(default_factory=lambda: os.getenv("ENVIRONMENT", "development").strip().lower())
    crawl_interval_minutes: int = field(default_factory=lambda: _int_env("CRAWL_INTERVAL_MINUTES", 180))
    per_query_limit: int = field(default_factory=lambda: _int_env("PER_QUERY_LIMIT", 5))
    anecdote_results: int = field(default_factory=lambda: _int_env("ANECDOTE_RESULTS", 6))
    image_results: int = field(default_factory=lambda: _int_env("IMAGE_RESULTS", 8))
    request_timeout_seconds: int = field(default_factory=lambda: _int_env("REQUEST_TIMEOUT_SECONDS", 20))
    sqlite_timeout_seconds: int = field(default_factory=lambda: _int_env("SQLITE_TIMEOUT_SECONDS", 10))
    sqlite_busy_timeout_ms: int = field(default_factory=lambda: _int_env("SQLITE_BUSY_TIMEOUT_MS", 10000))
    run_startup_crawl: bool = field(default_factory=lambda: _flag("RUN_STARTUP_CRAWL", False))
    openai_api_key: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", "").strip())
    openai_base_url: str = field(default_factory=lambda: os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"))
    openai_model: str = field(default_factory=lambda: os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip())
    x_bearer_token: str = field(default_factory=lambda: os.getenv("X_BEARER_TOKEN", "").strip())
    admin_token: str = field(default_factory=lambda: os.getenv("ADMIN_TOKEN", "").strip())
    stream_only_media: bool = field(default_factory=lambda: _flag("STREAM_ONLY_MEDIA", True))
    enable_image_downloads: bool = field(default_factory=lambda: _flag("ENABLE_IMAGE_DOWNLOADS", False))
    reddit_results: int = field(default_factory=lambda: _int_env("REDDIT_RESULTS", 4))
    x_results: int = field(default_factory=lambda: _int_env("X_RESULTS", 4))
    lpsg_results: int = field(default_factory=lambda: _int_env("LPSG_RESULTS", 4))
    pubmed_api_key: str = field(default_factory=lambda: os.getenv("PUBMED_API_KEY", "").strip())
    pubmed_results: int = field(default_factory=lambda: _int_env("PUBMED_RESULTS", 6))
    biorxiv_results: int = field(default_factory=lambda: _int_env("BIORXIV_RESULTS", 4))
    arxiv_results: int   = field(default_factory=lambda: _int_env("ARXIV_RESULTS", 4))
    firecrawl_api_key: str = field(default_factory=lambda: os.getenv("FIRECRAWL_API_KEY", "").strip())
    firecrawl_results: int = field(default_factory=lambda: _int_env("FIRECRAWL_RESULTS", 5))
    telegram_api_id: int = field(default_factory=lambda: _int_env("TELEGRAM_API_ID", 0))
    telegram_api_hash: str = field(default_factory=lambda: os.getenv("TELEGRAM_API_HASH", "").strip())
    telegram_session: str = field(default_factory=lambda: os.getenv("TELEGRAM_SESSION", "").strip())
    telegram_scan_limit: int = field(default_factory=lambda: _int_env("TELEGRAM_SCAN_LIMIT", 200))
    user_agent: str = "DesireResearchRadar/1.0 (+https://localhost)"
    themes: list[Theme] = field(
        default_factory=lambda: [
            Theme(
                slug="onlyfans_creators",
                label="OnlyFans Gay Male Creators",
                queries=[
                    "gay onlyfans creator nude male",
                    "gay onlyfans male performer leaked",
                ],
            ),
            Theme(
                slug="fansly_creators",
                label="Fansly Gay Male Creators",
                queries=[
                    "gay fansly creator nude male",
                    "gay fansly male performer explicit",
                ],
            ),
            Theme(
                slug="reddit_gay",
                label="Gay Reddit NSFW",
                queries=[
                    "gay reddit nsfw nude male r/GayNSFW",
                    "gay porn reddit nude male r/gayporn",
                ],
            ),
            Theme(
                slug="x_gay_creators",
                label="Gay X/Twitter Creators",
                queries=[
                    "gay nude creator twitter male explicit",
                    "gay explicit content x.com male onlyfans",
                ],
            ),
            Theme(
                slug="lpsg_threads",
                label="LPSG Gay Content",
                queries=[
                    "lpsg gay male nude hung cock",
                    "lpsg gay porn content bareback",
                ],
            ),
            Theme(
                slug="twinks",
                label="Gay Twinks",
                queries=[
                    "gay twink nude male",
                    "twink gay porn onlyfans male",
                ],
            ),
            Theme(
                slug="muscle_bears",
                label="Gay Muscle & Bears",
                queries=[
                    "gay muscle nude male bodybuilder",
                    "gay bear hairy nude male",
                ],
            ),
            Theme(
                slug="fetish_kink",
                label="Gay Fetish & Kink",
                queries=[
                    "gay fetish nude male bdsm leather",
                    "gay kink bareback nude male bondage",
                ],
            ),
        ]
    )

    def __post_init__(self) -> None:
        self.database_path = _path_env("DATABASE_PATH", self.base_dir / "data" / "research.db")
        self.image_dir = _path_env("IMAGE_DIR", self.base_dir / "data" / "images")
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.image_dir.mkdir(parents=True, exist_ok=True)
        if self.environment == "production" and self.admin_token in {"", "change-me"}:
            raise ValueError("ADMIN_TOKEN must be set to a non-default value in production")


settings = Settings()
