# Media Codex — Architecture Redesign

This directory contains the elite-grade redesign blueprint for the Media Codex
backend and frontend, plus the scaffolding that begins the migration.

| Document | Contents |
|---|---|
| [backend-redesign.md](./backend-redesign.md) | Complete backend architecture spec: stack, architecture, domain model, API design, auth, schema, caching, jobs, security, scaling, observability, deployment, bottlenecks (14 sections) |
| [frontend-redesign.md](./frontend-redesign.md) | Frontend architecture spec: feature-sliced structure, design tokens, data layer, state, performance budgets, accessibility |
| [migration-plan.md](./migration-plan.md) | Phased, non-breaking migration from the current codebase to the target architecture |
| [adr/](./adr/) | Architecture Decision Records |

## Scaffolding shipped in this branch

The redesign is delivered as **additive, non-breaking code**. Nothing in the
existing application is removed or rewired; new modules live alongside the
current ones and are adopted route-by-route per the migration plan.

Backend (Python/FastAPI):

- `app/core/` — settings (validated), RFC 9457 errors, cursor pagination, rate limiting, idempotency, security dependencies
- `app/domain/` — framework-free domain entities and value objects
- `app/repositories/` — repository protocols + SQLite implementations (Postgres-ready)
- `app/api/v1/` — versioned API surface with response models, cursor pagination, ETags
- `app/api/deps.py` — dependency-injection wiring
- `app/workers/` — transactional outbox + relay
- `app/observability/` — Prometheus metrics, request instrumentation

Frontend (React/TypeScript):

- `frontend/src/design-system/tokens.css` — design-token foundation
- `frontend/src/lib/api/` — typed API client (problem-details errors, request IDs, idempotency), query-key factory, shared API types
- `frontend/src/features/media/` — reference feature slice (types, API hooks, query options)
