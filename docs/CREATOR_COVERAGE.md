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
