# Item Drawer — Click Fixes, oEmbed Preview & Summary Enhancement

**Date:** 2026-03-12
**Status:** Approved

## Problem

1. Clicking the card title navigates away (the `<a>` tag calls `stopPropagation`, blocking the drawer).
2. Cards lack visual affordance — users don't know they're clickable.
3. The drawer shows summary and raw content but no source-native preview (no embedded tweets, Reddit posts, etc.).
4. The summary is plain text with no formatting or inline highlighting.

## Goals

- Fix both click bugs (title navigation, visual affordance).
- Add oEmbed-powered preview for X/Twitter and Reddit.
- Add source-aware formatted content display for LPSG, literature, and web articles.
- Richer summary display: inline compound/mechanism highlighting, better typography.
- Wider, resizable drawer (default 480px, drag to resize, persisted in localStorage).
- Tabbed interface: **Summary** | **Preview**.

## Architecture

### Backend: `/api/items/{id}/oembed`

New GET endpoint. Given an item's URL and source type, fetches oEmbed JSON from:
- Twitter/X: `https://publish.twitter.com/oembed?url={url}&omit_script=false`
- Reddit: `https://www.reddit.com/oembed?url={url}`

Returns `{ html: string }` on success, `{ error: string }` on failure or unsupported source.
Called server-side to avoid CORS. Only fetches for `x`/`twitter`/`reddit` source types.

### Frontend: `ItemDrawer.tsx` — enhanced

**Tabs:** `Summary` | `Preview` (state: `activeTab`)

**Summary tab** (existing content, improved):
- AI summary with left-accent border, `text-sm` readable typography
- Inline highlighting of compound/mechanism terms using their existing tag colors
- Full `content` field (remove 20-line clamp), with source-aware formatting
- Action bar + NoteEditor + SeeAlso + RelatedItems remain at bottom

**Preview tab** (new, lazy-loaded on first switch):
- Source `x`/`twitter`/`reddit`: fetches `/api/items/{id}/oembed`, sanitizes HTML with DOMPurify before rendering, loads widget scripts
- Source `lpsg`: Forum-style card (avatar placeholder, username, date, body text)
- Source `literature`/`pubmed`/`arxiv`/`biorxiv`: Structured abstract view with DOI/citation block
- Any other / failure: "Open original" button + `content` field

**Security:** oEmbed HTML is sanitized with DOMPurify before injection to prevent XSS.

**Resizable drawer:**
- Default width 480px, stored in `localStorage('drawerWidth')`
- Left-edge drag handle (`mousedown` on document, `mousemove`, `mouseup`)
- Clamp: min 340px, max 720px

**Card click fixes (SourceCard.tsx):**
- Remove `<a>` from title; make it a plain `<span>` (click already handled on parent div)
- Add subtle `ChevronRight` icon on card right edge (visible on hover)
- Strengthen hover: `hover:shadow-md hover:border-accent/50`

**Keyboard hint:**
- Bottom of drawer: `<- -> navigate, Esc close` in `text-[10px] text-text-muted font-mono`

## Files Changed

| File | Change |
|------|--------|
| `app/api/items.py` | Add `GET /api/items/{id}/oembed` endpoint |
| `frontend/src/lib/api.ts` | Add `api.itemOembed(id)` |
| `frontend/src/features/items/ItemDrawer.tsx` | Tabs, resizable drawer, oEmbed preview, richer summary |
| `frontend/src/features/items/SourceCard.tsx` | Fix title click, add chevron, stronger hover |

## Dependencies

- `dompurify` + `@types/dompurify` — sanitize oEmbed HTML before rendering

## Non-goals

- No on-demand AI re-analysis (existing `summary` field is the AI summary)
- No iframe embedding (oEmbed only for X/Reddit)
- No backend caching of oEmbed results (acceptable latency for now)
