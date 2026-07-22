# ADR 0002: SQLite-first data layer with a designed Postgres path

**Status:** accepted · **Date:** 2026-07-22

## Context

The app persists to a single SQLite file (`DATABASE_PATH` on a Render disk).
The redesign mandates horizontal scalability and a defensible consistency
model, without paying for infrastructure the current scale doesn't need.

## Decision

1. **Keep SQLite (WAL) as the production store now**, but all persistence
   moves behind repository protocols (`app/repositories/`). Handlers and
   services never see `sqlite3`.
2. **Alembic owns the schema from day one** — migrations written to be valid
   on both SQLite and PostgreSQL (portable types, no SQLite-only DDL outside
   guarded branches).
3. **PostgreSQL 16 + SQLAlchemy 2.0 (async) + PgBouncer** is the documented
   cutover, executed when *any* trigger fires: >1 web instance required, >~50
   concurrent writers, managed PITR/backup requirements, or FTS5 limits
   reached.

## Rationale

- SQLite in WAL mode serves hundreds of concurrent readers and one writer —
  comfortably above this app's private-operator load; it is operationally free
  (no server, no backups daemon, file snapshot = backup).
- The historical failure mode is not SQLite itself but the god-object
  `db.py`; repositories fix that independent of the engine.
- Designing the Postgres path now (protocols, portable migrations, ULID
  primary keys, ISO-8601 UTC timestamps) makes the later cutover a
  configuration change plus data copy, not a rewrite.

## Consequences

- New tables (`outbox`, `idempotency_keys`) use portable DDL (shipped).
- Consistency model (single-writer transactions, domain+outbox atomic commit)
  carries over unchanged to Postgres.
- The `UNIQUE ... WHERE` partial index on `capture_requests` is expressed via
  Alembic dialect branches (SQLite `WHERE` / Postgres `WHERE` both support it).
