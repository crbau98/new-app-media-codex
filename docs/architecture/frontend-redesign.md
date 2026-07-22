# Media Codex — Frontend Redesign Blueprint

**Status:** proposed · **Pairs with:** [backend-redesign.md](./backend-redesign.md)

The frontend already has a solid base (React 19, Vite 7, TanStack Query 5,
Zustand 5, Tailwind, React Router 7, a performance-budget script). This
redesign keeps the stack and restructures *how it's organized, typed, and
measured* — the same bar as the backend spec.

---

## 1. Current-state findings

| Finding | Evidence | Consequence |
|---|---|---|
| Flat component/pages split | `src/components/`, `src/pages/`, `src/hooks/`, one global `store.ts` (~10 KB) | Features sprawl across 4 directories; no ownership; the global store becomes a god-object like `db.py` |
| No typed API boundary | fetch calls scattered; no generated types from the backend | Backend/frontend drift silently; runtime surprises |
| Client state mixed with server state | Zustand holds data TanStack Query should own | Stale duplicates, double source of truth |
| No design tokens | Tailwind classes ad-hoc, `index.css` 16 KB of globals | Inconsistent UI, no theming discipline |
| Budgets exist but narrow | `scripts/check-performance-budget.mjs` | Not wired per-route; no runtime (Web-Vitals) budgets |

## 2. Architecture: feature-sliced design

```
frontend/src/
├── app/                    # composition root
│   ├── main.tsx            # (moved) providers: QueryClient, Router, ErrorBoundary
│   ├── router.tsx          # route table, code-split with React.lazy per feature
│   └── providers.tsx
├── design-system/          # SHIPPED in this branch
│   ├── tokens.css          # color/spacing/type/radius/duration tokens (light+dark)
│   └── primitives/         # Button, Card, Sheet, Skeleton, Badge (clsx + tailwind-merge)
├── lib/                    # SHIPPED — framework-agnostic infrastructure
│   ├── api/
│   │   ├── client.ts       # fetch wrapper: problem-details errors, X-Request-ID,
│   │   │                   # idempotency keys, abort/timeout, base-url resolution
│   │   ├── types.ts        # ProblemDetails, CursorPage<T>, envelope types
│   │   └── query-keys.ts   # single key factory — cache invalidation discipline
│   ├── format.ts           # dates, bytes, durations
│   └── result.ts           # Result<T,E> helpers
├── features/               # one folder per product feature — SHIPPED: media
│   ├── media/
│   │   ├── api.ts          # endpoint functions (uses lib/api/client)
│   │   ├── types.ts        # MediaItem, MediaKind, filters
│   │   ├── hooks.ts        # useMediaQuery / useInfiniteMediaQuery etc.
│   │   └── components/     # MediaGrid, MediaCard, MediaFilters (virtualized)
│   ├── performers/
│   ├── collections/
│   ├── playlists/
│   ├── search/
│   └── settings/
├── pages/                  # thin: compose features into routes, nothing else
└── shared/                 # cross-feature UI (layout shell, EmptyState, ErrorState)
```

**Import rule (enforced by ESLint `boundaries` or `import/no-restricted-paths`):**
`app → pages → features → lib/design-system`. Features never import each other;
cross-feature composition happens in `pages/`.

## 3. Data layer (the heart of the redesign)

**Typed from the backend's OpenAPI 3.1 schema.** Add `openapi-typescript`:
`openapi-typescript http://localhost:8080/openapi.json -o src/lib/api/schema.gen.ts`
(CI step, drift = build failure). Hand-written endpoint functions in
`features/*/api.ts` wrap the client and return schema types.

**Conventions (reference implementation shipped in `features/media/`):**

- **Server state: TanStack Query only.** All keys come from
  `lib/api/query-keys.ts` — e.g. `mediaKeys.list(filters)`. Invalidation is by
  prefix, never ad-hoc strings.
- **Infinite lists:** `useInfiniteQuery` against the backend's cursor envelope
  (`page.next_cursor` → `getNextPageParam`). No offset math on the client.
- **Mutations:** `useMutation` + optimistic update where safe; every mutation
  sends a fresh `Idempotency-Key` (uuid v4) generated *per intent*, reused on
  retry — matching `core/idempotency.py` server-side.
- **Errors:** the client normalizes RFC 9457 problems into a typed
  `ApiProblem` (`lib/api/types.ts`). Components switch on `problem.status`/
  `problem.type`; unknown errors hit the route `ErrorBoundary`.
- **Client state: Zustand, but only for true client state** — UI prefs (theme,
  grid density, player volume), playback session, local viewing history
  (product principle: stays local). One store *per feature* (`features/x/store.ts`),
  the global `store.ts` is dissolved.
- **Local persistence:** IndexedDB (`idb-keyval`) for history/prefs; service
  worker caches the shell only — never private media (product principle,
  restated).

## 4. Design system

`design-system/tokens.css` (shipped) defines the token layer consumed by both
Tailwind (`tailwind.config.js` maps tokens → utilities) and raw CSS:

- **Color:** semantic tokens (`--surface`, `--surface-raised`, `--fg`, `--fg-muted`,
  `--accent`, `--danger`) with `light()`/`dark()` scopes via `prefers-color-scheme`
  + `.dark` class override. Raw palette values never appear in components.
- **Spacing/radius/elevation:** 4-pt scale tokens; 3 elevation levels.
- **Type:** 6-step scale, tabular numerals for stats/durations.
- **Motion:** `--dur-fast|base|slow` + easing tokens; Framer Motion springs
  derive from them; `prefers-reduced-motion` globally collapses durations.

Primitives (`Button`, `Card`, `Skeleton`, `Badge`, `Sheet`) are the only
components allowed to combine tokens; feature components consume primitives.
This kills the "every card is slightly different" failure mode.

## 5. Performance budget (measurable, enforced)

| Budget | Target | Enforced by |
|---|---|---|
| Initial JS (app route) | ≤ 200 KB gzip | `build:budget` (extend existing script per-route) |
| Feature chunks | ≤ 80 KB gzip each, `React.lazy` per feature | Vite `manualChunks` + budget script |
| LCP (app shell) | ≤ 2.0 s on 4G | Web-Vitals reporting to `/api/v1/engagement/vitals` (batch) |
| INP | ≤ 200 ms | Web-Vitals; virtualization for grids > 100 items |
| CLS | ≤ 0.05 | Skeletons with fixed aspect-ratio boxes (media grids) |
| Media grid scroll | 60 fps | `@tanstack/react-virtual` windowing; `content-visibility: auto` on cards |

Media-specific: posters via `loading="lazy"` + `decoding="async"`, srcset from
the preview cache; video elements mount only in the active viewport cell
(intersection observer), `preload="none"` elsewhere.

## 6. Reliability & UX states

- Every feature screen has designed `Loading / Empty / Error / Offline` states
  (`shared/`); no raw thrown promises.
- Route-level `ErrorBoundary` with problem-details rendering + "copy request id"
  (correlates with backend logs — the client sends/echoes `X-Request-ID`).
- Offline: PWA shell (kept) + queued engagement events flushed on reconnect.
- Accessibility: WCAG 2.2 AA — focus-visible rings from tokens, keyboard
  navigation in grids (roving tabindex), `aria-live` for scan/job progress,
  contrast-checked token pairs, reduced-motion support.

## 7. Testing & CI

- **Unit:** Vitest + Testing Library for hooks/primitives (colocated `*.test.ts`).
- **Contract:** generated schema types = compile-time contract; CI regenerates
  and fails on drift.
- **E2E:** Playwright (kept) — critical flows: browse → play → collect → scan-now.
- **CI additions:** `typecheck`, `lint`, budget check, bundle-diff comment on PRs.

## 8. Migration approach (frontend)

1. **Phase 0 (this branch):** tokens, `lib/api/*`, `features/media` reference
   slice — all additive, existing screens untouched.
2. **Phase 1:** dissolve `store.ts` into feature stores; move API calls behind
   the typed client; route-level code splitting.
3. **Phase 2:** rebuild the media grid + player on primitives + virtualization;
   Web-Vitals reporting.
4. **Phase 3:** remaining features sliced; delete `components/` flat dirs;
   enforce import boundaries in CI.

Details + ordering with backend phases: [migration-plan.md](./migration-plan.md).
