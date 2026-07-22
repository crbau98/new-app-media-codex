# Media Codex

Media Codex is a private, responsive media-library and discovery app. Its React/Vite client and public aggregation run on Vercel; its persistent, credential-backed API runs on Render behind a same-origin Vercel gateway.

The repository began as a research-radar prototype. Some research ingestion modules remain available for future, separately labelled work, but the shipped product contract is Media Codex; captured media is not presented as clinical evidence.

## Product principles

- Real API data and real playback are preferred over simulated UI.
- Source provenance is preserved and original posts remain reachable.
- Viewing history and preferences stay local by default.
- The installable app shell may be cached, but private media is not cached offline by the service worker.
- Content is intended only for adults and must be sourced, reviewed, and operated in accordance with applicable consent, rights, and takedown requirements.

## Stack

- Vercel edge APIs for live source aggregation, imports, federated search, and browser-to-Render API forwarding
- FastAPI backend with SQLite persistence and secret-backed provider integrations
- React 19, TypeScript, Vite, TanStack Query, Zustand, Tailwind, and Framer Motion
- Vercel deployment for the client/gateway; Render deployment for the canonical persistent backend
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

The browser uses same-origin Vercel routes. `/api/render/*` forwards safe API requests to Render, while `/api/live-media` combines public edge sources with normalized credential-backed results from Render. `VITE_BACKEND_ORIGIN` is only an override for non-Vercel split deployments.

## Production configuration

Required:

- `ADMIN_TOKEN`: protects administrative crawl and upload operations; Render generates this automatically from `render.yaml`.
- `DATABASE_PATH`: persistent SQLite path.
- `IMAGE_DIR`: persistent image-cache path.

Optional integrations include Vercel AI Gateway plus Render-side `X_BEARER_TOKEN`, `TUMBLR_API_KEY`, existing-customer Google Programmable Search credentials, `OPENAI_API_KEY`, and Telegram credentials. Never commit secrets, duplicate provider keys into Vercel, or place them in `VITE_*` variables.

### Public discovery operation

The Vercel live endpoint refreshes public, source-attributed discovery media on demand with a short edge cache. Redgifs works without credentials. X, Tumblr, and Google activate through Render's provider gateway using the keys already stored there; only normalized public metadata crosses to Vercel. PeerTube and web discovery remain keyless edge sources.

`Scan now` asks Vercel AI Gateway to rerank cross-source creator candidates using public metadata only. The default is `openai/gpt-5.6-luna`, configurable through `AI_DISCOVERY_MODEL`. The model receives no images and is instructed not to infer appearance or sensitive traits. If Gateway is unavailable, deterministic TF-IDF tag similarity remains active.

Media playback is source-attributed and linked back to the originating public post. The edge proxy supports range requests but does not persist media.

Operational checks:

```text
GET /healthz
GET /api/live-media
POST /api/discovery/providers
```

Source availability, creator permission, rights, and takedown obligations remain the operator's responsibility.

## Verification

```bash
cd frontend
npm run build
npm run lint
npm run test:unit

cd ..
python -m pytest -q
```

The primary health endpoint is `GET /healthz`. The combined Docker image serves the built frontend and API from the same origin on port `8080`.
