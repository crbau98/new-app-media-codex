# Creators Section — Capture Queue & UX Overhaul Design

**Date:** 2026-03-29
**Status:** Approved

---

## Goal

Make the creators section fully functional end-to-end: adding a creator automatically pulls all their content from across the web, capture progress is visible in real time, and the list page supports bulk operations.

## Problems Being Solved

1. **Discovery** — hard to find and add creators; no avatar or profile data pre-populated
2. **Triggering capture** — must open each creator's profile individually to click Capture
3. **Progress visibility** — captures are fire-and-forget with no progress feedback
4. **Content quality** — no change here; existing DDG + Coomer + Redgifs + yt-dlp pipeline stays

## Architecture

### Backend: Capture Queue

New SQLite table `capture_queue`:

```sql
CREATE TABLE IF NOT EXISTS capture_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  performer_id INTEGER NOT NULL REFERENCES performers(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  started_at   TEXT,
  finished_at  TEXT,
  captured_count INTEGER NOT NULL DEFAULT 0,
  error_msg    TEXT
);
```

A single background worker thread (started at app startup) polls the queue every 2s, picks the oldest `queued` item, marks it `running`, calls `_run_performer_capture`, then marks it `done` or `failed`. One item runs at a time to avoid rate-limit hammering.

### Auto-capture on add

Every code path that creates a performer record calls a shared `_enqueue_capture(db, performer_id)` helper immediately after insert. This covers:
- `POST /api/performers` (manual add form)
- `POST /api/performers/import-url`
- `POST /api/performers/bulk-import`
- `POST /api/performers/discover` add flow (already calls `POST /api/performers` under the hood)

### New API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/performers/capture-queue` | Returns all queue entries with performer name/platform joined |
| `DELETE` | `/api/performers/capture-queue/{id}` | Cancel a queued (not running) entry |
| `POST` | `/api/performers/capture-stale` | Enqueue all performers where `last_checked_at` is NULL or >7 days ago |
| `POST` | `/api/performers/enrich/{id}` | Attempt to fill avatar_url + display_name from Redgifs user profile |

### Profile Enrichment

`enrich` tries Redgifs public user API (`https://api.redgifs.com/v1/users/{username}/feeds/search`) to fetch avatar. Falls back to no-op if unavailable. Fast, non-blocking, best-effort. Called automatically after adding a creator.

### Stale detection

`last_checked_at` on the `performers` table is updated at the end of `_run_performer_capture`. The existing "Due for Check" stat already counts performers where this is NULL or >7 days — we just add a `POST /api/performers/capture-stale` endpoint that enqueues all of them.

---

## Frontend

### Creator Cards (upgraded)

Each card in the grid shows:
- **Circular avatar** — `avatar_local` → `avatar_url` → initials fallback (colored by platform)
- **Display name + username**
- **Platform badge** (existing)
- **Media count badge** — green pill showing screenshot count
- **Last captured** — relative time ("3d ago", "Never") colored amber if >7 days, red if never
- **Capture queue status** — if this creator is currently queued/running, show a spinner badge on the card
- **Watchlist star** — existing, keep
- **Inline "Capture" button** — enqueues directly, no need to open profile

### List Page Toolbar (new elements)

- **"Select" toggle** — enables checkbox mode on all cards
- **Bulk action bar** — slides in when ≥1 card selected: "Capture N" + "Delete N" buttons
- **"Capture Stale" button** — one click, calls `POST /api/performers/capture-stale`, shows count enqueued in toast

### Capture Queue Panel

Fixed bottom bar, slides up from bottom when queue is non-empty, collapses (with a "Queue complete" flash) when all done.

Each row: avatar initial + creator name + platform badge + status indicator:
- Queued: clock icon, muted
- Running: animated spinner, accent color
- Done: green check + "+ N captured"
- Failed: red X + error snippet

Polls `GET /api/performers/capture-queue` every 3s while any item is queued or running; drops to 30s when all done/empty.

### Discovery Modal (upgraded)

- Suggested creators chips show a green dot if already in library (media count > 0)
- Clicking "Add" enqueues capture automatically — no separate button needed
- AI search results show richer cards (bio + tags)
- "Add All" enqueues all results for capture

### Import Flows (upgraded)

**URL import** — preview step: paste URL → shows parsed platform + username card → confirm → adds + enqueues capture.

**Bulk text import** (new modal) — textarea accepting one username or URL per line → "Preview" shows table of parsed entries with new/exists status → "Import N new" adds all new ones and enqueues capture for each.

---

## Data Flow: Adding a Creator

```
User action (any path)
  → POST /api/performers  (or import-url / bulk-import)
  → DB insert → _enqueue_capture(db, performer_id)
  → POST /api/performers/enrich/{id}  (best-effort avatar fetch)
  → Frontend: queue panel appears, card shows spinner badge
  → Worker thread picks up job → _run_performer_capture runs
  → DDG images + Coomer.st + Redgifs + yt-dlp
  → DB: screenshots inserted with performer_id, last_checked_at updated
  → Queue entry marked done with captured_count
  → Frontend: card shows updated media count + last captured time
```

---

## Out of Scope

- Scheduled auto-capture (APScheduler recurring jobs) — future iteration
- Content quality improvements to the capture pipeline itself
- Per-creator source configuration
