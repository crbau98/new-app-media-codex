# Media Codex

Media Codex is a private, responsive media-library and discovery app. Its primary product is a React/Vite client paired with Vercel edge APIs for browsing, playback, search, creator discovery, collections, and review. A FastAPI service remains available for legacy archived-item recovery.

The repository began as a research-radar prototype. Some research ingestion modules remain available for future, separately labelled work, but the shipped product contract is Media Codex; captured media is not presented as clinical evidence.

## Product principles

- Real API data and real playback are preferred over simulated UI.
- Source provenance is preserved and original posts remain reachable.
- Viewing history and preferences stay local by default.
- The installable app shell may be cached, but private media is not cached offline by the service worker.
- Content is intended only for adults and must be sourced, reviewed, and operated in accordance with applicable consent, rights, and takedown requirements.

## Stack

- Vercel edge APIs for live source aggregation, imports, federated search, and media delivery
- FastAPI backend with SQLite persistence for legacy archived-item recovery
- React 19, TypeScript, Vite, TanStack Query, Zustand, Tailwind, and Framer Motion
- Vercel deployment for the client and live edge APIs; Render deployment for the legacy backend
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

The live frontend routes use same-origin Vercel edge APIs. `VITE_BACKEND_ORIGIN` only selects the legacy FastAPI origin for archived-item operations.

## Production configuration

Required:

- `ADMIN_TOKEN`: protects administrative crawl and upload operations; Render generates this automatically from `render.yaml`.
- `DATABASE_PATH`: persistent SQLite path.
- `IMAGE_DIR`: persistent image-cache path.

Optional integrations include Vercel AI Gateway, `X_BEARER_TOKEN`, `TUMBLR_API_KEY`, existing-customer Google Programmable Search credentials, `OPENAI_API_KEY`, and Telegram credentials. Never commit secrets or place provider keys in `VITE_*` variables.

### Public discovery operation

The Vercel live endpoint refreshes public, source-attributed discovery media on demand with a short edge cache. Redgifs works without credentials; X and Tumblr activate through their official API credentials. PeerTube contributes publisher-labelled federated results, Google licensed-image search contributes canonical profile leads, and web discovery provides attributed source shortcuts.

`Scan now` asks Vercel AI Gateway to rerank cross-source creator candidates using public metadata only. The default is `openai/gpt-5.6-luna`, configurable through `AI_DISCOVERY_MODEL`. The model receives no images and is instructed not to infer appearance or sensitive traits. If Gateway is unavailable, deterministic TF-IDF tag similarity remains active.

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
npm run test:unit

cd ..
python -m pytest -q
```

The primary health endpoint is `GET /healthz`. The combined Docker image serves the built frontend and API from the same origin on port `8080`.
