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

Optional integrations include `OPENAI_API_KEY`, `X_BEARER_TOKEN`, and Telegram credentials. Never commit secrets or place an OpenAI key in frontend code.

### Public discovery operation

The Vercel live endpoint refreshes public, source-attributed discovery media on demand with a short edge cache. It groups observed public posts into searchable performer cards and ranks them with an explainable combination of public engagement and freshness.

The Render crawler is disabled by default (`ENABLE_EXTERNAL_CRAWLS=false`). It must only be enabled for creator-authorized integrations with a documented rights basis; it is not required for the live public discovery experience.

Media playback is source-attributed and linked back to the originating public post. The edge proxy supports range requests but does not persist media.

Operational checks:

```text
GET /healthz
GET /api/live-media
```

Source availability, creator permission, rights, and takedown obligations remain the operator's responsibility.

## Verification

```bash
cd frontend
npm run build
npm run lint

cd ..
python -m pytest -q
```

The primary health endpoint is `GET /healthz`. The combined Docker image serves the built frontend and API from the same origin on port `8080`.
