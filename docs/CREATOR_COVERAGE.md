# Creator coverage — contracts

Goal: every public male adult creator is discoverable (by name, alias or handle) and
their whole public catalog is reachable. Public, source-attributed metadata only;
no scraping of paywalled/leaked libraries; no identification of private individuals.

## Endpoints (Vercel edge, `frontend/api/`)

### `GET /api/creator-resolve?q=<name|handle>&limit=8`
Resolve a free-text name or handle to public creator profiles.
```
{ "query": "christian hogue",
  "candidates": [ { "handle": "hoguesdirtylaundry", "displayName": "Christian Hogue",
      "platform": "Redgifs", "profileUrl": "https://www.redgifs.com/users/hoguesdirtylaundry",
      "avatar": "/api/archiver-proxy?url=…", "followers": 1234|null, "mediaCount": 87|null,
      "confidence": 0.98, "matchedBy": "alias", "sourceAttribution": "…" } ],
  "tried": ["christianhogue","christian_hogue","hoguesdirtylaundry", …],
  "updatedAt": "ISO" }
```
Owner: resolver stream. Uses `api/_lib/creator-registry.ts` (curated aliases → handles),
name→handle variant generation, Redgifs user lookup + text search, and
`searchSourceCreators` (sources stream).

### `GET /api/creator-directory?cursor=<opaque>&limit=48&tag=<optional>&sort=smart|newest|popular`
Paged enumeration of creators discovered across many gay/male niche lanes and depths.
```
{ "creators": Creator[]  /* src/lib/types.ts Creator; media ≤ 6 items */,
  "nextCursor": "opaque"|null, "total": number|null,
  "lanes": [ { "tag": "Twink", "pagesScanned": 3 } ], "updatedAt": "ISO" }
```
Owner: directory stream.

### `GET /api/creator-media?creator=<handle>&page=1&count=40[&strict=0]`
Existing. `strict=0` (explicit creator lookups) skips the broad-search text exclusion so a
creator the user asked for is never partially hidden.

## Client contracts (`frontend/src/lib/api.ts`, `src/features/creators/`)
`resolveCreators(q, limit)`, `fetchCreatorDirectory({cursor, limit, tag, sort})`.

## Seed registry
`api/_lib/creator-registry.ts`: `{ canonicalName, aliases[], handles: { redgifs?: string[] } }`.
Only handles supplied by the product owner or verified against the provider are seeded — never guessed.
Seed entries: Christian Hogue → redgifs `hoguesdirtylaundry`; Michael Yerger; Jakipz (handles to be resolved live).

---

## Round 2 — wider sources, persistent index, related creators

Legitimate, public, unauthenticated/official APIs only (Bluesky AT Protocol public AppView,
Mastodon-compatible public timelines, Lemmy public API, PeerTube, Redgifs). No scraping of
paywalled or leaked-content mirrors, no login bypass, no identification of private individuals.
Every source is attributed and links back to the original post/profile.

### Stream A — federated public sources (edge)
`api/_lib/sources/bluesky.ts`, `mastodon-tags.ts`, `lemmy.ts`: each exports
`collectX(opts) → { media: UnifiedMediaItem[]; leads: CreatorLead[]; status: SourceStatus; attempted; succeeded }`
(same shape `multi-source.ts` already consumes) and is wired into `collectAdditionalSources`.
`searchSourceCreators` additionally searches Bluesky actors (`app.bsky.actor.searchActors`).
`SourceStatus.id` union is extended additively (`'bluesky' | 'mastodon' | 'lemmy'`).

### Stream B — persistent creator index (Render backend + edge reader)
Backend (FastAPI/SQLite, `app/creator_index/`): a scheduled crawler walks public sources
(Redgifs lanes deep, Bluesky, Lemmy, Mastodon tags, PeerTube), upserts creators and sample media,
and serves them:
`GET /api/v1/creators/index?cursor=&limit=48&tag=&q=&sort=smart|newest|popular|count`
→ `{ creators: Creator[], nextCursor, total, sources: [{platform,count}], updatedAt }`
`GET /api/v1/creators/index/stats` → `{ total, byPlatform, lastCrawlAt, crawlRunning }`.
Admin-only: `POST /api/v1/creators/index/crawl` (run now), `POST .../observe` (bulk upsert).
Edge: `api/_lib/index-client.ts` reads the index through `api/render-gateway.ts`
(`/api/render/api/v1/creators/index…`, read-only GET allow-listed) and `api/creator-directory.ts`
merges index creators with the live lanes (dedupe by platform+handle), degrading silently to
live-only if the backend is unreachable. `total` becomes real when the index answers.

### Stream C — related creators & elsewhere links
`GET /api/creator-related?creator=<handle>&platform=redgifs&limit=12`
→ `{ creator, related: [{ handle, displayName, platform, avatar?, score, reason, sharedTags[] }],
     elsewhere: [{ platform, handle, url, label, verified, source: 'bio'|'registry' }], updatedAt }`
`related` = tag co-occurrence over the creator's catalog sample + directory/feed pool.
`elsewhere` = links the creator PUBLISHED themselves (Bluesky/Mastodon bio & verified fields,
registry) — never inferred. UI: CreatorDrawer gets "Related creators" and "Elsewhere" sections.
