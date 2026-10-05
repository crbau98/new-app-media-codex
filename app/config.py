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
    crawl_interval_minutes: int = field(default_factory=lambda: _int_env("CRAWL_INTERVAL_MINUTES", 30))
    per_query_limit: int = field(default_factory=lambda: _int_env("PER_QUERY_LIMIT", 5))
    anecdote_results: int = field(default_factory=lambda: _int_env("ANECDOTE_RESULTS", 6))
    image_results: int = field(default_factory=lambda: _int_env("IMAGE_RESULTS", 8))
    request_timeout_seconds: int = field(default_factory=lambda: _int_env("REQUEST_TIMEOUT_SECONDS", 20))
    sqlite_timeout_seconds: int = field(default_factory=lambda: _int_env("SQLITE_TIMEOUT_SECONDS", 10))
    sqlite_busy_timeout_ms: int = field(default_factory=lambda: _int_env("SQLITE_BUSY_TIMEOUT_MS", 10000))
    run_startup_crawl: bool = field(default_factory=lambda: _flag("RUN_STARTUP_CRAWL", False))
    # External scraping is disabled by default. A creator directory should be
    # built from public provider APIs or direct, rights-authorized submissions,
    # not from subscription archives.
    enable_external_crawls: bool = field(default_factory=lambda: _flag("ENABLE_EXTERNAL_CRAWLS", False))
    openai_api_key: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", "").strip())
    openai_base_url: str = field(default_factory=lambda: os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"))
    openai_model: str = field(default_factory=lambda: os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip())
    x_bearer_token: str = field(default_factory=lambda: os.getenv("X_BEARER_TOKEN", "").strip())
    # X official API v2 discovery (timelines + rotating recent-search queries).
    # Queries are separated by "||". Search calls are budgeted per backend
    # request and per hour, and cached in memory (never below 10 minutes).
    x_discovery_queries: str = field(default_factory=lambda: os.getenv("X_DISCOVERY_QUERIES", "").strip())
    x_search_calls_per_request: int = field(default_factory=lambda: _int_env("X_SEARCH_CALLS_PER_REQUEST", 2))
    x_search_max_calls_per_hour: int = field(default_factory=lambda: _int_env("X_SEARCH_MAX_CALLS_PER_HOUR", 30))
    x_search_cache_ttl_seconds: int = field(default_factory=lambda: _int_env("X_SEARCH_CACHE_TTL_SECONDS", 900))
    x_timeline_handles_per_request: int = field(default_factory=lambda: _int_env("X_TIMELINE_HANDLES_PER_REQUEST", 4))
    x_timeline_cache_ttl_seconds: int = field(default_factory=lambda: _int_env("X_TIMELINE_CACHE_TTL_SECONDS", 600))
    # Reddit official OAuth2 app-only discovery (client_credentials grant).
    reddit_client_id: str = field(default_factory=lambda: os.getenv("REDDIT_CLIENT_ID", "").strip())
    reddit_client_secret: str = field(default_factory=lambda: os.getenv("REDDIT_CLIENT_SECRET", "").strip())
    reddit_user_agent: str = field(
        default_factory=lambda: os.getenv("REDDIT_USER_AGENT", "").strip()
        or "web:media-codex-discovery:1.0 (official API client; operator contact via Reddit app profile)"
    )
    reddit_subreddits: str = field(default_factory=lambda: os.getenv("REDDIT_SUBREDDITS", "").strip())
    reddit_calls_per_request: int = field(default_factory=lambda: _int_env("REDDIT_CALLS_PER_REQUEST", 8))
    reddit_cache_ttl_seconds: int = field(default_factory=lambda: _int_env("REDDIT_CACHE_TTL_SECONDS", 600))
    tumblr_api_key: str = field(default_factory=lambda: os.getenv("TUMBLR_API_KEY", "").strip())
    google_cse_api_key: str = field(default_factory=lambda: os.getenv("GOOGLE_CSE_API_KEY", "").strip())
    google_cse_id: str = field(default_factory=lambda: os.getenv("GOOGLE_CSE_ID", "").strip())
    admin_token: str = field(default_factory=lambda: os.getenv("ADMIN_TOKEN", "").strip())
    stream_only_media: bool = field(default_factory=lambda: _flag("STREAM_ONLY_MEDIA", True))
    enable_image_downloads: bool = field(default_factory=lambda: _flag("ENABLE_IMAGE_DOWNLOADS", False))
    reddit_results: int = field(default_factory=lambda: _int_env("REDDIT_RESULTS", 4))
    x_results: int = field(default_factory=lambda: _int_env("X_RESULTS", 4))
    lpsg_results: int = field(default_factory=lambda: _int_env("LPSG_RESULTS", 4))
    kemono_results: int = field(default_factory=lambda: _int_env("KEMONO_RESULTS", 4))
    coomer_results: int = field(default_factory=lambda: _int_env("COOMER_RESULTS", 4))
    redgifs_results: int = field(default_factory=lambda: _int_env("REDGIFS_RESULTS", 30))
    ytdlp_results: int = field(default_factory=lambda: _int_env("YTDLP_RESULTS", 8))
    pubmed_api_key: str = field(default_factory=lambda: os.getenv("PUBMED_API_KEY", "").strip())
    pubmed_results: int = field(default_factory=lambda: _int_env("PUBMED_RESULTS", 6))
    biorxiv_results: int = field(default_factory=lambda: _int_env("BIORXIV_RESULTS", 4))
    arxiv_results: int   = field(default_factory=lambda: _int_env("ARXIV_RESULTS", 4))
    firecrawl_api_key: str = field(default_factory=lambda: os.getenv("FIRECRAWL_API_KEY", "").strip())
    firecrawl_results: int = field(default_factory=lambda: _int_env("FIRECRAWL_RESULTS", 5))
    instagram_results: int = field(default_factory=lambda: _int_env("INSTAGRAM_RESULTS", 8))
    fansly_results: int = field(default_factory=lambda: _int_env("FANSLY_RESULTS", 8))
    justforfans_results: int = field(default_factory=lambda: _int_env("JUSTFORFANS_RESULTS", 8))
    spankbang_results: int = field(default_factory=lambda: _int_env("SPANKBANG_RESULTS", 8))
    boyfriendtv_results: int = field(default_factory=lambda: _int_env("BOYFRIENDTV_RESULTS", 8))
    male_video_archiver_results: int = field(default_factory=lambda: _int_env("MALE_VIDEO_ARCHIVER_RESULTS", 24))
    proxy_list: str = field(default_factory=lambda: os.getenv("PROXY_LIST", "").strip())
    telegram_api_id: int = field(default_factory=lambda: _int_env("TELEGRAM_API_ID", 0))
    telegram_api_hash: str = field(default_factory=lambda: os.getenv("TELEGRAM_API_HASH", "").strip())
    telegram_session: str = field(default_factory=lambda: os.getenv("TELEGRAM_SESSION", "").strip())
    telegram_scan_limit: int = field(default_factory=lambda: _int_env("TELEGRAM_SCAN_LIMIT", 200))
    user_agent: str = "DesireResearchRadar/1.0 (+https://localhost)"
    themes: list[Theme] = field(
        default_factory=lambda: [
            Theme(
                slug="public_creator_discovery",
                label="Public Gay Male Creator Discovery",
                queries=[
                    "public gay male creator profile",
                    "gay male creator public posts",
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
