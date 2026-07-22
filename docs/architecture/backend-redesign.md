# Media Codex — Backend Redesign Blueprint

**Status:** proposed · **Audience:** engineering · **Scope:** entire backend (`app/`, deployment, data layer)

This document is the complete backend design for Media Codex, written against
the current codebase (`crbau98/new-app-media-codex @ main`). It is deliberately
opinionated and prefers boring, proven technology.

---

## 0. Current-state audit (what we are fixing)

The audit below grounds every recommendation in the code as it exists today.

| Finding | Evidence | Consequence |
|---|---|---|
| God-object data layer | `app/db.py` is a single ~153 KB `Database` class holding SQL for every domain (items, images, screenshots, performers, playlists, collections, engagement, analytics, notifications, compounds…) | Untestable in isolation; any change risks regressing unrelated domains; no ownership boundaries |
| God-routers | `app/api/screenshots.py` (~167 KB) and `app/api/performers.py` (~99 KB) mix HTTP transport, business rules, SQL invocation, and external-HTTP calls in one file | No separation of concerns; handlers cannot be unit-tested without the DB and network |
| Blocking calls on the event loop | sync `sqlite3` and `requests` are invoked from `async` handlers in several routers (e.g. `compound_detail` in `main.py` uses `requests.Session` inline) | p99 latency spikes under concurrency; one slow query stalls the loop |
| Per-process rate limiter | token bucket in `main.py` (`_RL_BUCKETS` dict) | Breaks with >1 instance or restart; 8 192-bucket eviction is unbounded-ish memory |
| No API versioning | all routes are unversioned `/api/<noun>` | Any breaking change breaks the deployed SPA and the PWA shell |
| Liveness/readiness conflated | single `/healthz` reports db + disk + scheduler | Orchestrator cannot distinguish "restart me" from "don't route to me yet" |
| In-process scheduler | `ResearchService.start()` runs crawl/scan loops as asyncio tasks inside the web process | Web pods are not interchangeable; jobs die on deploy; no retry/DLQ semantics |
| No transactional outbox | notification fan-out via `run_coroutine_threadsafe` from inside sync DB methods | Events lost on crash between commit and send; tight coupling DB→WS |
| Config without validation | `app/config.py` dataclass reads env lazily; typos surface at first use, not boot | Misconfigurations reach production |
| Inconsistent errors | mix of `HTTPException`, bare dicts (`{"error": ...}`), and framework defaults | Clients cannot handle errors programmatically |
| No idempotency | mutating endpoints (crawl triggers, uploads, captures) have no idempotency keys | Retried requests double-execute |
| No metrics/tracing | optional Sentry only; no Prometheus, no OpenTelemetry | SLIs/SLOs are unmeasurable |

None of this is fatal — the app works and ships. The redesign keeps what works
(FastAPI, SQLite-for-now, the source/proxy layer, the SPA) and restructures
around it **incrementally** (see `migration-plan.md`).

---

## 1. Recommended tech stack

| Layer | Choice | Justification |
|---|---|---|
| Language/runtime | **Python 3.12** | Already in use; mature async ecosystem |
| Web framework | **FastAPI** (keep) | Async-native, Pydantic v2 validation, free OpenAPI 3.1, huge ecosystem. Rewriting in Go/Rust buys latency we don't need at this scale and costs all existing code |
| ASGI server | **uvicorn** (workers) or **granian** | granian (RSG) gives ~20-30% better throughput; uvicorn remains the boring default |
| Validation/DTOs | **Pydantic v2** | Already the FastAPI standard; `pydantic-settings` for config |
| Primary DB (now) | **SQLite (WAL)** behind repository interfaces | Single-operator private app; SQLite in WAL handles 100s of concurrent readers and is operationally free |
| Primary DB (at scale) | **PostgreSQL 16** | The migration path is designed in from day one via repositories + Alembic; switch when: >1 backend instance, >~50 concurrent writers, or managed backups/point-in-time recovery become requirements |
| ORM/query | **SQLAlchemy 2.0 (async)** only at Postgres cutover; raw parameterised SQL in repositories until then | The current raw-SQL layer is fine once isolated in repositories; don't add an ORM before it's needed |
| Migrations | **Alembic** (introduced in this redesign) | Versioned, reversible, works for SQLite and Postgres |
| Cache / rate-limit / queue broker | **Valkey (Redis-compatible)** — optional until multi-instance | Single binary covers cache, distributed rate limiting, and the job broker; `valkey-glide` or `redis-py` client. Until then: in-process adapters behind the same protocols |
| Background jobs | **In-process job runner now → ARQ (or Dramatiq) at multi-instance** | ARQ is async-native and Redis-backed; the outbox table (shipped in this branch) makes the cutover safe |
| DB pool (Postgres era) | **asyncpg via SQLAlchemy pool** + **PgBouncer** (transaction pooling) | PgBouncer keeps connection count flat as web pods scale |
| Observability | **Prometheus + Grafana + OpenTelemetry traces + structlog JSON logs + Sentry** (kept) | OTel is vendor-neutral; Prometheus metrics are free to self-host on Render/Grafana Cloud free tier |
| Media storage | Source-attributed streaming proxy (current design, kept); poster/preview cache on disk now, **S3-compatible object store** at scale | The app intentionally does not persist private media — that principle is preserved |
| Auth | Single-operator **admin token** now (kept, hardened); **OIDC-ready** dependency seam if multi-user ever lands | No auth framework is added before a second user role exists — YAGNI, but the seam costs nothing |

**Explicitly rejected:** GraphQL (one consumer — our own SPA — REST+OpenAPI is strictly simpler), microservices (see ADR-0001), Kafka (outbox + Redis streams cover our event volume), Elasticsearch (SQLite FTS5 / Postgres `tsvector` cover search at this scale).

---

## 2. High-level architecture

**Decision: modular monolith** (ADR-0001). One deployable, internally divided
into strictly bounded modules with enforced import direction. Microservices are
rejected: one operator, no independent scaling pressure between modules, and
the operational cost (service mesh, distributed tracing necessity, deployment
coordination) would dwarf the entire app's current complexity budget.

```mermaid
flowchart LR
    subgraph Edge
        V[Vercel edge<br/>static SPA + edge cache]
    end

    subgraph Backend[Backend — modular monolith (FastAPI)]
        direction TB
        API[app.api.v1<br/>routers — transport only]
        MW[app.middleware<br/>request-id · rate-limit · security headers · gzip]
        SVC[app.services<br/>application services / use-cases]
        DOM[app.domain<br/>entities · value objects · domain events]
        REP[app.repositories<br/>persistence protocols + impls]
        SRC[app.sources<br/>provider clients redgifs/x/tumblr/…]
        OB[app.workers<br/>outbox relay · job runner]
        API --> SVC --> DOM
        SVC --> REP
        SVC --> SRC
        SVC -->|writes + outbox row| REP
        OB -->|reads outbox| REP
    end

    DB[(SQLite WAL now<br/>PostgreSQL 16 at scale)]
    CACHE[(Valkey/Redis<br/>optional until multi-instance)]
    EXT[External APIs<br/>redgifs · X · Tumblr · AI Gateway]
    WS[WebSocket<br/>notifications]

    V -->|HTTPS /api/v1| MW --> API
    REP --> DB
    MW --> CACHE
    SVC --> CACHE
    SRC --> EXT
    OB --> WS
    OB --> EXT
```

**Import rule (enforced in CI via `import-linter`):**
`api → services → domain`, `services → repositories (protocols only)`,
`repositories → db drivers`. Nothing imports upward. `app.main` only composes.

---

## 3. Project / folder structure

```
app/
├── main.py                    # composition root ONLY: build app, mount, wire lifespan
├── core/                      # SHIPPED in this branch
│   ├── settings.py            # pydantic-settings, validated at boot, secrets segregated
│   ├── errors.py              # RFC 9457 problem-details + exception handlers
│   ├── pagination.py          # cursor encode/decode, Page[T] model
│   ├── rate_limit.py          # RateLimiter protocol + memory/Redis impls
│   ├── idempotency.py         # Idempotency-Key dependency + storage protocol
│   ├── security.py            # admin-token dependency (constant-time), principal model
│   └── time.py                # utcnow() seam — never call datetime.now() in domain code
├── domain/                    # SHIPPED — pure Python, zero framework imports
│   ├── media.py               # MediaItem, MediaKind, SourceRef, PreviewRef
│   ├── performers.py          # Performer, CreatorCandidate, CaptureRequest
│   ├── collections.py         # Collection, Playlist, PlaylistEntry
│   ├── engagement.py          # Reaction, ViewEvent, Bookmark
│   └── events.py              # DomainEvent base + concrete events
├── repositories/              # SHIPPED — protocols + SQLite impls
│   ├── base.py                # UnitOfWork protocol
│   ├── media.py
│   ├── performers.py
│   └── outbox.py
├── services/                  # application use-cases (one file per bounded context)
│   ├── media_service.py
│   ├── discovery_service.py
│   └── …
├── api/
│   ├── deps.py                # SHIPPED — DI providers (settings, uow, principal, limiter)
│   ├── v1/                    # SHIPPED — versioned surface
│   │   ├── router.py          # aggregates v1 routers
│   │   ├── health.py          # /healthz (liveness) + /readyz (readiness)
│   │   └── media.py           # reference implementation of the v1 conventions
│   └── (legacy routers — frozen, deleted route-by-route per migration plan)
├── workers/                   # SHIPPED
│   ├── outbox.py              # transactional outbox relay
│   └── runner.py              # job runner protocol (ARQ adapter later)
├── observability/             # SHIPPED
│   ├── metrics.py             # Prometheus middleware + /metrics
│   └── logging.py             # structlog JSON, request-id binding
├── sources/                   # provider clients — RETAINED, wrapped by SourceGateway protocol
├── middleware/                # safe_gzip retained; rate-limit/headers move to core
└── db/                        # (replaces db.py) connection management only — no domain SQL
tests/
├── unit/                      # domain + services with fake repositories
├── integration/               # repositories against real SQLite (tmp_path)
├── contract/                  # Schemathesis against generated OpenAPI
└── load/                      # k6 scripts
docs/architecture/             # this blueprint + ADRs
```

---

## 4. Core domain models and key entities

Bounded contexts and their aggregates (full definitions shipped in `app/domain/`):

**Media context**
- `MediaItem` (aggregate): `id`, `kind: image|video|gif`, `source: SourceRef`, `title`, `tags[]`, `preview: PreviewRef`, `attribution_url`, `captured_at`, `checksum`. Invariant: every item must carry a reachable `attribution_url` (product principle: provenance is preserved).
- `SourceRef`: `provider` (redgifs|x|tumblr|telegram|direct), `external_id`, `canonical_url`.

**Performer context**
- `Performer` (aggregate): `id`, `display_name`, `aliases[]`, `profile_links[]`, `avatar`, `confidence`, `source_attribution[]`, `status: directory|candidate|archived`.
- `CaptureRequest`: `id`, `performer_id`, `rights_basis: creator_authorized|public_api`, `state: queued|active|paused|blocked`. Invariant: `state=active` requires documented `rights_basis` (mirrors the `ENABLE_EXTERNAL_CRAWLS` policy).

**Collection context**
- `Collection`, `Playlist` (aggregates): ordered `PlaylistEntry[]`, `owner_scope` (local-by-default).

**Engagement context**
- `ViewEvent`, `Reaction`, `Bookmark` — append-only, the analytics read model's source of truth.

**Events** (`domain/events.py`): `MediaCaptured`, `PerformerAdded`, `PerformerCandidateScored`, `CaptureRequested`, `TakedownRequested`. All flow through the outbox.

---

## 5. API endpoint design (key routes)

Conventions (applied by every v1 route — reference implementation in `app/api/v1/media.py`):

- **Base path** `/api/v1`. Legacy unversioned routes keep working until the SPA is fully migrated, then are removed in v2.
- **Errors:** RFC 9457 `application/problem+json` everywhere (`core/errors.py`).
- **Pagination:** cursor-based on list endpoints — `?cursor=&limit=` (1–200, default 50). Response envelope: `{ "data": [...], "page": { "next_cursor": "…", "has_more": true } }`. Offset pagination is banned for unbounded tables.
- **Filtering/sorting:** allow-listed fields only, e.g. `?kind=video&tag=…&sort=-captured_at`. Unknown fields → `400` with a problem detail naming the field. This is the primary SQL-injection and index-miss defence.
- **Idempotency:** all `POST` mutations accept (and crawl/upload require) `Idempotency-Key: <uuid>` header; 24 h dedupe window (`core/idempotency.py`).
- **Conditional GET:** heavy list endpoints emit `ETag`; honour `If-None-Match` → `304`.
- **Rate limiting:** `429` + `Retry-After`, with `RateLimit-*` headers.
- **OpenAPI:** FastAPI-native 3.1, tags per context, `operationId` in `camelCase` — the frontend types are generated from this schema (see frontend blueprint).

Key routes:

| Method | Route | Purpose | Notes |
|---|---|---|---|
| GET | `/api/v1/healthz` | liveness | no dependencies touched |
| GET | `/api/v1/readyz` | readiness | db ping + outbox lag + disk |
| GET | `/api/v1/media` | browse media | cursor, `kind`, `tag`, `provider`, `q` (FTS) |
| GET | `/api/v1/media/{id}` | item detail | ETag |
| GET | `/api/v1/media/{id}/stream` | range-capable proxy | keeps current no-persist policy; `206` support |
| GET | `/api/v1/performers` | directory | cursor, `status`, confidence threshold |
| POST | `/api/v1/performers/scan` | "Scan now" rerank | idempotency-key required; 202 + job handle |
| GET | `/api/v1/jobs/{id}` | job status | polled by SPA; WS push when connected |
| GET | `/api/v1/collections` / `/playlists` | CRUD | standard REST, idempotent PUT |
| POST | `/api/v1/engagement/views` | record view | batch accepted, 202 |
| GET | `/api/v1/search` | unified search | FTS5 now, tsvector at Postgres |
| GET | `/api/v1/stats/summary` | app-shell summary | 60 s cache, stale-while-revalidate (current behaviour formalised) |
| POST | `/api/v1/admin/crawls` | operator crawl trigger | admin token + idempotency-key; rights basis asserted in body |
| GET | `/api/v1/admin/outbox` | outbox lag/depth | admin only |

---

## 6. Authentication & authorization flow

Current reality: single private operator. The design hardens that and leaves a
zero-cost seam for OIDC.

```
Request ──► PrincipalResolver (api/deps.py)
              ├─ /api/v1/admin/*  → require_admin: X-Admin-Token header,
              │                     hmac.compare_digest, 401 problem on fail,
              │                     token from env, never logged, rotated via deploy
              ├─ /api/v1/*        → public-but-private: app is single-tenant;
              │                     optional same-origin token when SERVED_PUBLIC=true
              └─ future: OIDC bearer → JWKS validation → Principal(sub, roles)
```

Rules:
- No endpoint reaches for `os.environ` directly — all auth via the `Principal` dependency, so the OIDC swap touches one file.
- Admin tokens compared with `hmac.compare_digest`; failures are logged with request-id and rate-limited harder (10/min per IP).
- Authorization is per-context policy functions (`services/policies.py`), e.g. `capture_request` requires `rights_basis != None` — a domain rule enforced in the service layer, not in routers.

---

## 7. Database schema outline

Managed by **Alembic** from this branch forward (`alembic/` + `alembic.ini`;
the legacy `CREATE TABLE IF NOT EXISTS` calls in `db.py` are frozen).

Core tables (SQLite now; types map 1:1 to Postgres):

```sql
media_items(
  id TEXT PRIMARY KEY,                 -- ulid
  kind TEXT NOT NULL CHECK (kind IN ('image','video','gif')),
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
  preview_url TEXT, checksum TEXT,
  captured_at TEXT NOT NULL,           -- ISO-8601 UTC
  UNIQUE(provider, external_id)
);
CREATE INDEX idx_media_captured ON media_items(captured_at DESC, id DESC);  -- cursor index
CREATE INDEX idx_media_kind     ON media_items(kind, captured_at DESC);

performers(id PK, display_name, aliases_json, confidence REAL,
           status TEXT, created_at, updated_at);
performer_sources(performer_id FK, provider, external_id, canonical_url,
                  UNIQUE(provider, external_id));
capture_requests(id PK, performer_id FK, rights_basis TEXT NOT NULL,
                 state TEXT, created_at, UNIQUE(performer_id, state) WHERE state='active');

collections(id PK, name, created_at);
playlists(id PK, name, created_at);
playlist_entries(playlist_id FK, media_id FK, position INT,
                 UNIQUE(playlist_id, position));

view_events(id PK, media_id FK, ts, session_id, meta_json);   -- append-only

outbox(                                  -- SHIPPED with workers/outbox.py
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  published_at TEXT,                     -- NULL = pending
  attempts INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_outbox_pending ON outbox(published_at) WHERE published_at IS NULL;

idempotency_keys(                        -- SHIPPED with core/idempotency.py
  key TEXT PRIMARY KEY, endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL, response_json TEXT,
  created_at TEXT NOT NULL
);
```

Consistency model: **single-writer transactions**; domain state + outbox row
commit in the *same* transaction (that's the point of the outbox). Read model
(stats, analytics) is eventually consistent by ≤ a few seconds via the relay.

---

## 8. Caching strategy

| Layer | What | TTL / invalidation | Now vs scale |
|---|---|---|---|
| CDN/edge (Vercel) | static assets (immutable), `/api/v1/stats/summary` via `stale-while-revalidate` | assets ∞; summary 60 s | already in place — formalised |
| Application cache | hot reads: app-shell summary, performer directory pages, tag lists | 60–300 s, event-invalidated on `MediaCaptured`/`PerformerAdded` via outbox | in-process `cache.py` retained → swap to `ValkeyCache` implementing the same protocol when >1 instance |
| Query results | FTS search results per normalized query hash | 120 s | Valkey only |
| Media bytes | **never cached server-side** (policy); poster/preview thumbnails on disk | LRU by dir size | disk now → S3 + CDN at scale |
| Rate-limit counters | token bucket per IP | sliding | memory now → Valkey `INCR`/Lua at multi-instance (`core/rate_limit.py` already protocols this) |

Stampede protection: single-flight (request coalescing) on summary/directory
recompute — one worker rebuilds, others serve stale.

---

## 9. Background jobs / event system

**Pattern: transactional outbox + relay** (shipped: `workers/outbox.py`).

1. Service writes domain rows + `outbox` row in one transaction.
2. Relay loop (async task, one per deployment — guarded by an advisory lock)
   reads `WHERE published_at IS NULL ORDER BY occurred_at LIMIT 100`, publishes
   to subscribers (WebSocket fan-out, cache invalidation, analytics rollups),
   marks `published_at`, retries with exponential backoff (1 s → 5 min, max 8
   attempts → dead-lettered, surfaced at `/api/v1/admin/outbox`).
3. At multi-instance, the relay moves to an ARQ worker process with Redis
   streams; the outbox table and semantics do not change.

Job classes: `performer_scan` (Scan-now rerank), `crawl_run` (rights-gated),
`poster_warm`, `takedown_purge`. Long jobs report progress rows readable at
`/api/v1/jobs/{id}` — replaces today's `app.state.screenshot_progress` globals.

---

## 10. Security checklist

- [x] Zero-trust inputs: Pydantic v2 validation on every body/query; allow-listed sort/filter fields
- [x] Parameterised SQL only (repository rule; `import-linter` blocks `sqlite3` imports outside `repositories/` and `db/`)
- [x] Secrets: env-only, segregated in `core/settings.py` (`SecretStr`), never logged (structlog processor redacts `*token*`, `*key*`)
- [x] Admin endpoints: constant-time token compare + stricter rate limit + audit log line with request-id
- [x] Security headers (kept from current `main.py`, moved to middleware module): CSP, `nosniff`, `DENY`, `no-referrer`, Permissions-Policy
- [x] CORS: explicit allow-list + project-alias regex (current behaviour), credentials off
- [x] Rate limiting on all non-exempt paths; auth-failure path extra-limited
- [x] SSRF guard on the media proxy: scheme allow-list (`https`), host deny-list (RFC-1918, loopback, link-local, metadata IPs), redirect re-validation, 10 MB cap
- [x] Dependency scanning: `pip-audit` in CI; Dependabot on
- [x] Rights/takedown: `TakedownRequested` event → purge media rows + previews + cache keys; domain rule blocks crawls without rights basis
- [x] `Idempotency-Key` on mutations (replay protection for double-submit)
- [x] No secrets in `VITE_*` (frontend blueprint re-states this)

---

## 11. Performance & scaling strategy

Targets: **p99 < 50 ms** for cached/list endpoints at 100 RPS single instance;
proxy/streaming endpoints excluded (bounded by upstream).

- **Async honesty:** no blocking I/O in handlers. sync sqlite3 calls run via the
  repository's `asyncio.to_thread` bridge (measurable, bounded); `requests` →
  `httpx.AsyncClient` (already pooled in lifespan — providers migrate to it).
- **N+1 ban:** list endpoints join/batch; repositories return fully-hydrated
  aggregates. Contract tests assert query counts.
- **Indexes match cursors:** every sortable field has a matching composite index
  (see schema); `EXPLAIN QUERY PLAN` snapshot-tested for hot queries.
- **Single-flight + cache** on the three hot reads (summary, directory, feed).
- **Pagination is cursor-based** — O(1) at any depth vs offset's O(n) scan.
- **gzip** (kept) + `ETag`/`304` + tiny JSON (`separators=(",",":")` on hot paths).
- **Horizontal path:** stateless pods → N instances behind Render/CF; SQLite →
  Postgres + PgBouncer; memory limiter/cache → Valkey; relay → ARQ workers.
  Each step is independently shippable and none requires a rewrite.
- **Cost:** stays on a single ~$7/mo Render instance + Vercel free tier until
  the Postgres trigger conditions in §1 are met. Valkey/ARQ are *never* paid
  for before multi-instance exists.

---

## 12. Observability stack

| Signal | Tooling | Shipped? |
|---|---|---|
| Metrics | Prometheus: `http_requests_total{route,method,status}`, `http_request_duration_seconds` histogram, outbox depth/lag gauges, job counters | `observability/metrics.py` in this branch; `/metrics` endpoint |
| Logs | structlog JSON: `ts, level, msg, request_id, route, duration_ms, principal`; secrets redaction processor | `observability/logging.py`; replaces `logging_config.py` at cutover |
| Traces | OpenTelemetry SDK → OTLP (Grafana Cloud/Tempo free tier); auto-instrument FastAPI, httpx, sqlite | wiring documented in migration plan phase 3 |
| Errors | Sentry (kept), `traces_sample_rate=0.1`, request-id attached as tag | existing, retained |

**SLIs/SLOs** (alerted in Grafana):
- Availability: 99.5% monthly on `/api/v1/*` (5xx rate)
- Latency: p99 < 50 ms on `GET /api/v1/media`, p99 < 300 ms on search
- Freshness: outbox p99 lag < 5 s; alert at 60 s
- Job success: `performer_scan` success ≥ 95% over 7 d

Health: `/healthz` = process alive (liveness); `/readyz` = db ping + outbox
lag < threshold + disk headroom (readiness). Orchestrators route on ready,
restart on live.

---

## 13. Deployment & infrastructure

**Now (kept, hardened):** Render single Docker service (combined SPA+API,
port 8080) + Vercel static frontend. Additions in this branch: Alembic runs at
container start (`alembic upgrade head` in the entrypoint, idempotent);
`/healthz`/`/readyz` wired to Render health checks; deploy = `git push` → CI →
Render deploy hook.

**CI (GitHub Actions, proposed `.github/workflows/ci.yml` upgrade):**
`ruff` + `mypy --strict` on `core|domain|repositories|api/v1|workers` →
`pytest unit` → `pytest integration` → `pip-audit` → build Docker →
Schemathesis contract run against the ephemeral app. Frontend: `typecheck`,
`lint`, `build:budget`, Playwright smoke.

**Scale-out target (documented, not built):** Render/Fly N× web pods (stateless)
+ Render Key Value (Valkey) + Neon/Render Postgres + PgBouncer sidecar + 1 ARQ
worker pod. Media proxy stays origin-shielded behind Cloudflare for range
caching of *public* thumbnails only.

**Backup/DR:** SQLite — Litestream-style snapshot to S3 daily (script in
`scripts/`), RPO 24 h / RTO < 1 h acceptable for a private app. Postgres era:
managed PITR, RPO ≤ 5 min. Restore is rehearsed: `scripts/restore-drill.sh`
runs in CI monthly.

**Local dev:** unchanged one-command flow (`dev.sh`); new modules are pure
Python and need no services. `make test` runs unit+integration without Docker.

---

## 14. Potential bottlenecks & mitigations

| Bottleneck | When it bites | Mitigation (in order) |
|---|---|---|
| SQLite single writer | concurrent captures + engagement writes | WAL + busy_timeout (have); batch `view_events` inserts; write queue in service; Postgres cutover |
| God-routers (`screenshots.py`, `performers.py`) | every change | migration plan phases 1–2 split them behind services; route freeze on legacy files |
| Blocking provider HTTP on the loop | slow upstream (redgifs/X) | all provider calls via shared `httpx.AsyncClient` with per-provider timeouts, retries (3, exp backoff + jitter), and **circuit breaker** (`pybreaker`) — open after 5 failures/30 s, half-open probe |
| In-process scheduler dies on deploy | any deploy | jobs become outbox-driven + resumable (`CaptureRequest.state`); runner re-queues `active` jobs on boot |
| Memory rate limiter | >1 instance or restart | `core/rate_limit.py` protocol; drop in `ValkeyRateLimiter` (Lua token bucket) — one-line DI change |
| FTS search cost | >~1 M media rows | SQLite FTS5 covers ~10⁶ rows fine; then Postgres `tsvector` + `pg_trgm`; external search engine only beyond that |
| Poster/preview disk growth | long-running instance | size-capped LRU (have policy hooks); S3 + CDN at scale; takedown purge wired to outbox event |
| Proxy bandwidth | heavy streaming | keep no-persist policy; range requests (have); optional CF origin shield; per-IP concurrency cap on `/stream` |
| Vercel↔Render cold-start latency | free/standard tiers | keep-alive ping from edge cron on `/healthz`; granian workers; app-shell summary cached at edge (have) |

---

## Appendix — what this branch ships vs. documents

**Shipped as working code** (additive; see `docs/architecture/README.md`):
`app/core/*`, `app/domain/*`, `app/repositories/*` (protocols + SQLite impl for
media/outbox/idempotency), `app/api/v1/*` (health + media reference router),
`app/api/deps.py`, `app/workers/outbox.py`, `app/observability/*`.

**Documented only** (adopt per `migration-plan.md`): Alembic cutover, ARQ,
Valkey, Postgres, OTel traces, CI workflow upgrades.
