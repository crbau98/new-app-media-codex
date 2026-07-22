# ADR 0001: Modular monolith over microservices

**Status:** accepted · **Date:** 2026-07-22

## Context

Media Codex is a private, single-operator media-library app: one FastAPI
backend on a single Render instance, one SPA, SQLite persistence, modest
traffic. The redesign brief asks for horizontal scalability from day one.

## Decision

One deployable **modular monolith**: bounded contexts (`media`, `performers`,
`collections`, `engagement`, `discovery`) as packages with enforced import
direction (`api → services → domain`, repositories behind protocols), one
database, one outbox.

## Rationale

- No module has independent scaling or release cadence pressure — the dominant
  load (browsing + streaming proxy) and the rare writes (captures, scans)
  scale together fine on one pod.
- Microservices would impose service discovery, distributed transactions (or
  saga complexity), per-service CI/CD, and mandatory tracing infrastructure —
  an operational budget larger than the entire current app.
- Horizontal scalability is preserved: pods are stateless (cache/limiter/jobs
  behind protocols), so scaling = adding replicas + swapping adapters
  (Valkey, Postgres, ARQ) — no re-architecture.

## Consequences

- Enforced by `import-linter` in CI (Phase 3); violations fail the build.
- If a context ever needs independent scaling (candidate: the media proxy),
  its protocol boundaries let it peel off as a service without touching
  consumers.
