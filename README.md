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
- `ADMIN_TOKEN`: protects `POST /api/run` when the app is exposed publicly
- `VITE_BACKEND_URL`: optional dev proxy target for the Vite frontend

## Notes

- The scheduler starts automatically on app startup. Immediate startup crawls are disabled by default and can be re-enabled with `RUN_STARTUP_CRAWL=true`.
- Some anecdote sources may block scraping; those failures are tolerated and surfaced in run notes.
- If image downloads are disabled, the dashboard still renders external image URLs directly.
- `.env` is loaded automatically on startup via `python-dotenv`.
- `GET /healthz` is available for container health checks and load balancer probes and now verifies basic DB responsiveness.
