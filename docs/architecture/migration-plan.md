# Migration Plan — current `main` → target architecture

**Principle: strangler-fig.** Every phase ships green, is independently
deployable, and never breaks the running product. Legacy code is *frozen*
(bugfixes only) and deleted route-by-route.

## Phase 0 — Foundations (this branch)

- [x] Architecture docs + ADRs (`docs/architecture/`)
- [x] `app/core/` — settings, problem-details errors, cursor pagination,
      rate-limiter protocol, idempotency, security deps
- [x] `app/domain/`, `app/repositories/` (protocols + SQLite impls), `app/api/v1/`
      reference routers, `app/api/deps.py`
- [x] `app/workers/outbox.py` + `idempotency_keys`/`outbox` table DDL
- [x] `app/observability/` metrics + structured logging
- [x] Frontend: design tokens, `lib/api/*`, `features/media` reference slice
- [ ] **Merge gate:** all existing tests pass; nothing legacy is rewired
      (new modules are import-only until Phase 1)

## Phase 1 — Wire the spine (1–2 weeks)

Backend:
1. `main.py` mounts `app.api.v1.router` at `/api/v1` alongside legacy routes;
   swaps inline rate limiter/security-headers/request-id for `core` middleware
   (same behaviour, one code path).
2. Adopt `core/settings.py` at boot (fail-fast validation); keep `config.py`
   as a re-export shim, delete at Phase 3.
3. Introduce Alembic: baseline revision = current schema; new tables
   (`outbox`, `idempotency_keys`) land via migration; entrypoint runs
   `alembic upgrade head`.
4. Start the outbox relay in lifespan; route `MediaCaptured`/notifications
   through it (replaces the `run_coroutine_threadsafe` callback).
5. `/metrics` + structlog in production; Sentry kept.

Frontend:
6. Add `openapi-typescript` generation to CI; point `lib/api/client.ts` at
   `/api/v1` with legacy fallback.
7. Dissolve `store.ts` into per-feature stores; server state moves to
   TanStack Query with `query-keys.ts`.

## Phase 2 — Strangle the god-files (2–4 weeks)

Priority order (highest pain first):
1. `app/api/screenshots.py` (167 KB) → `services/media_service.py` +
   `repositories/media.py` + thin `api/v1/media.py` routes. SPA switches to
   `/api/v1/media*` behind a feature flag.
2. `app/api/performers.py` (99 KB) → performer service + repository;
   "Scan now" becomes `POST /api/v1/performers/scan` (idempotent, 202 + job).
3. `app/db.py` shrinks as each domain's SQL moves into its repository; the
   file is deleted when only connection management remains (`app/db/`).
4. Frontend grids rebuilt on primitives + virtualization; Web-Vitals in.

## Phase 3 — Operate (ongoing)

1. OTel tracing (FastAPI + httpx auto-instrumentation) → Grafana Cloud.
2. Contract tests (Schemathesis) + load tests (k6) in CI.
3. Delete legacy routers, `config.py` shim, `logging_config.py`; enforce
   `import-linter` boundaries.
4. Trigger-based scale-out (only when §1 conditions of the backend blueprint
   are met): Valkey limiter/cache → Postgres + PgBouncer → ARQ worker pod.

## Rollback strategy

Every phase is a separate PR behind the same branch prefix. The legacy routes
stay live until their v1 replacements have served production traffic for
7 days. Database migrations are reversible (`alembic downgrade` tested in CI).
