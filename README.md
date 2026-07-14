# Media Codex

Media Codex is a private, responsive media-library and discovery app. It combines a FastAPI ingestion and media API with a React/Vite interface designed for browsing, playback, search, creator discovery, collections, and review.

The repository began as a research-radar prototype. Some research ingestion modules remain available for future, separately labelled work, but the shipped product contract is Media Codex; captured media is not presented as clinical evidence.

## Product principles

- Real API data and real playback are preferred over simulated UI.
- Source provenance is preserved and original posts remain reachable.
- Viewing history and preferences stay local by default.
- The installable app shell may be cached, but private media is not cached offline by the service worker.
- Content is intended only for adults and must be sourced, reviewed, and operated in accordance with applicable consent, rights, and takedown requirements.

## Stack

- FastAPI backend with SQLite persistence
- React 19, TypeScript, Vite, TanStack Query, Zustand, Tailwind, and Framer Motion
- Docker deployment on Render, with an optional separately hosted static frontend
- PWA manifest and privacy-conscious offline shell

## Local development

Backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

The frontend uses `VITE_BACKEND_ORIGIN` when set and otherwise targets the production Render backend outside local development.

## Production configuration

Required:

- `ADMIN_TOKEN`: protects administrative crawl and upload operations; Render generates this automatically from `render.yaml`.
- `DATABASE_PATH`: persistent SQLite path.
- `IMAGE_DIR`: persistent image-cache path.

Optional integrations include `OPENAI_API_KEY`, `X_BEARER_TOKEN`, Telegram credentials, source-specific proxy settings, and ingestion result limits. Never commit secrets or place an OpenAI key in frontend code.

### Live archiver operation

The production blueprint starts a crawl after each deploy and refreshes every 30 minutes. The deep male-performer collector is controlled by:

- `MALE_VIDEO_ARCHIVER_RESULTS` (default `24` per theme)
- `CRAWL_INTERVAL_MINUTES` (default `30`)
- `RUN_STARTUP_CRAWL=true` for an immediate post-deploy refresh
- `ARCHIVER_PROXY_URL` for a residential or clean egress proxy when Coomer/Kemono reject datacenter traffic

Images and video are exposed to the UI through the same-origin `/api/screenshots/proxy-media` endpoint. Uploaded video cache files take precedence and `/api/screenshots/cached-video/{id}` supports browser byte-range requests. Playback then falls back through refreshed proxy and direct-source URLs.

Operational checks:

```text
GET /healthz
GET /api/screenshots/proxy-status
GET /api/screenshots/cache-status?source=coomer&missing_only=true
GET /api/screenshots?source=coomer&media_type=video
```

The server must remain attached to persistent storage for SQLite and cached video. Source availability, consent, rights, and takedown obligations remain the operator's responsibility.

## Verification

```bash
cd frontend
npm run build
npm run lint

cd ..
python -m pytest -q
```

The primary health endpoint is `GET /healthz`. The combined Docker image serves the built frontend and API from the same origin on port `8080`.
