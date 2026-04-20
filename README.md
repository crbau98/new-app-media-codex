# Desire Research Radar

Desire Research Radar is a FastAPI app that continuously searches for public literature, public anecdotes, and related imagery across a set of male sexual-function research themes.

It is built as a research-monitoring system, not a treatment recommender. The dashboard stores sources, extracts candidate compounds and mechanisms mentioned in those sources, and generates source-grounded research hypotheses for human review.

## What it does

- Continuously collects:
- recent biomedical literature from Europe PMC
- public web anecdotes via DuckDuckGo search plus page scraping
- targeted Reddit thread scraping via Reddit's public JSON thread endpoint
  - extracts thread-associated preview/gallery images when present
- targeted X post ingestion
  - official X API recent search when `X_BEARER_TOKEN` is configured
  - public-page fallback from indexed `x.com` results otherwise
  - X media/image extraction is strongest through the official API path
- targeted LPSG forum thread scraping from public pages
  - extracts thread-embedded images when public thread pages expose them
- targeted coomer.su post scraping via the public `/api/v1/posts` search API
  - image attachments rewritten through the archiver proxy for direct display
  - video attachments (`.mp4/.webm/.mov`) written into the `screenshots` table
    with `source="coomer"` so the existing `scripts/precache_coomer.py` flow
    can pre-cache them on a residential IP and stream them from server disk
- targeted kemono.su/.cr post scraping via the public `/api/v1/posts` search API
  - images and videos handled the same way as coomer (videos use `source="kemono"`)
- related imagery via DuckDuckGo image search
- Persists results in SQLite
- Deduplicates by URL and tracks first/last seen timestamps
- Generates research hypotheses
  - Uses an OpenAI-compatible chat API if `OPENAI_API_KEY` is configured
  - Falls back to a deterministic local hypothesis generator if no model key is set
- Exposes:
  - dashboard UI at `/`
  - JSON API at `/api/dashboard`, `/api/items`, `/api/images`, `/api/hypotheses`, `/api/runs`
  - detail and update APIs at `/api/items/{id}`, `/api/runs/{id}`, `/api/hypotheses/{id}`
  - manual crawl trigger at `POST /api/run`

## Dashboard UX

The dashboard includes:

- searchable and sortable source cards
- theme/source/image filters
- saved-only and review-state filters
- run history with item, image, and error counts
- source coverage and top mechanism summaries
- saved review queue and analyst notes
- hypothesis triage with saved states, review states, and analyst notes
- item detail and image preview dialogs
- run detail modal with full source breakdown and error inspection
- sticky section navigation for faster movement around the dashboard
- workspace modes for overview, topics, review, and media
- command palette for keyboard-driven navigation and quick actions
- topic explorer that pivots related items, hypotheses, and images from clickable themes, sources, compounds, and mechanisms
- saved topic workspace with recent pivots for repeated review flows
- topic boards with board-level notes and tracked topic sets
- baseline-aware topic diffing for new vs updated signals
- manual item triage with save/archive/shortlist workflow
- bulk multi-select review actions
- JSON export for filtered items and hypotheses
- load-more controls for deeper browsing without leaving the dashboard
- shareable URL-synced views and quick keyboard search
- local saved view presets and item deep links
- server-side browse queries with totals and incremental loading
- local browser storage for the admin token so protected manual runs work from the UI

## Safety boundary

The app intentionally stays on the research side:

- no dose calculators
- no cycle planning
- no procurement guidance
- no “best compound” ranking for unsupervised use

The hypothesis output is framed as research leads requiring expert review.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

For the Vite frontend in a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend proxies to `VITE_BACKEND_URL`, which defaults to `http://127.0.0.1:8000`.

## Docker

Build and run a persistent containerized deployment target:

```bash
docker compose up --build -d
```

The container serves on port `8080` and persists SQLite plus cached images in the Docker volume `app_data`.

## Configuration

Environment variables:

- `OPENAI_API_KEY`: optional, enables model-backed hypothesis generation
- `OPENAI_BASE_URL`: defaults to OpenAI-compatible `/v1`
- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`
- `CRAWL_INTERVAL_MINUTES`: scheduler interval
- `PER_QUERY_LIMIT`: literature results per query
- `ANECDOTE_RESULTS`: anecdote search results per query
- `IMAGE_RESULTS`: image results per query
- `REQUEST_TIMEOUT_SECONDS`: outbound HTTP timeout
- `SQLITE_TIMEOUT_SECONDS`: SQLite connection timeout in seconds
- `SQLITE_BUSY_TIMEOUT_MS`: SQLite busy timeout used during lock contention
- `RUN_STARTUP_CRAWL`: when `true`, queues an immediate crawl on app startup
- `ENABLE_IMAGE_DOWNLOADS`: when `true`, caches image files under `data/images/`
- `X_BEARER_TOKEN`: optional, enables official X recent-search ingestion
- `REDDIT_RESULTS`: targeted Reddit results per theme
- `X_RESULTS`: targeted X results per theme
- `LPSG_RESULTS`: targeted LPSG results per theme
- `COOMER_RESULTS`: targeted coomer.su results per theme (via `/api/v1/posts`)
- `KEMONO_RESULTS`: targeted kemono.su/.cr results per theme (via `/api/v1/posts`)
- `ADMIN_TOKEN`: protects `POST /api/run` when the app is exposed publicly
- `VITE_BACKEND_URL`: optional dev proxy target for the Vite frontend

## Pre-caching coomer videos from your residential network

Coomer's video shards (`n*.coomer.st`, `n*.kemono.cr`) block datacenter IP ranges
(Render, Vercel Edge, etc.) at the TCP or TLS layer. Images are handled by rewriting
to `img.coomer.st/thumbnail/…`, which IS datacenter-reachable. Videos have no
equivalent mirror, so the server cannot download them on its own.

The fix is to download videos from a computer with a **residential IP** (your
home laptop, a phone hotspot, etc.) and upload them into the server's video
cache via an admin-authenticated endpoint. After that, every visitor to the app
gets instant playback from the server's disk cache.

### One-time setup

On the server, set `ADMIN_TOKEN` to a non-empty value (see `render.yaml` or your
hosting provider's env-var UI). Optionally set `UPLOAD_VIDEO_MAX_MB` to raise
the per-file size limit (default 500 MB).

On your laptop:

```bash
pip install "yt-dlp>=2026.3.0" "requests>=2.32"
```

### Run it

```bash
export ADMIN_TOKEN=<your admin token>
python3 scripts/precache_coomer.py                 # cache every missing coomer video
python3 scripts/precache_coomer.py --limit 25      # cache the 25 newest
python3 scripts/precache_coomer.py --concurrency 2 # fewer parallel downloads
python3 scripts/precache_coomer.py --dry-run       # see what would run
```

The script:

1. Calls `GET /api/screenshots/cache-status?source=coomer&missing_only=true`.
2. For each missing video, downloads with yt-dlp (falls back to a plain HTTP GET
   for direct `.mp4` URLs).
3. Uploads the file to `POST /api/screenshots/{id}/upload-cached-video` with the
   admin token, which streams it to disk at `video_cache/{id}.mp4`.
4. Deletes the local temp file and moves on.

Interruptions are safe — rerunning just resumes from whatever is still missing.
The server's cache is a 5 GB rolling LRU (configurable via `VIDEO_CACHE_DIR` and
the constant `_VIDEO_CACHE_MAX_MB` in `app/api/screenshots.py`); older videos
are evicted automatically when you upload new ones.

### What about brand-new crawls?

Rerun the script after each crawl (or on a weekly cadence). Until then, the UI
shows a friendly "video unavailable" message with an **Open original post** link
so viewers can still watch the video on coomer directly.

## Notes

- The scheduler starts automatically on app startup. Immediate startup crawls are disabled by default and can be re-enabled with `RUN_STARTUP_CRAWL=true`.
- Some anecdote sources may block scraping; those failures are tolerated and surfaced in run notes.
- If image downloads are disabled, the dashboard still renders external image URLs directly.
- `.env` is loaded automatically on startup via `python-dotenv`.
- `GET /healthz` is available for container health checks and load balancer probes and now verifies basic DB responsiveness.
