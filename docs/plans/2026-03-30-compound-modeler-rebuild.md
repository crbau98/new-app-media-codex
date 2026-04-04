# Compound Receptor Modeler — Architecture Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Compound Receptor Modeler with normalized data model (real Ki/IC50 units), D3 force-directed visualizations, modular AI backend, multi-source enrichment pipeline, and app shell with command palette.

**Architecture:** Express 5 + React 18 SPA. SQLite via Drizzle ORM. D3 v7 for all visualizations. Zustand for client state. Hash-based routing via Wouter. Multi-source enrichment (PubChem + ChEMBL + UniProt). Modular LLM provider (OpenAI / Anthropic / none).

**Tech Stack:** TypeScript, Express 5, React 18, Vite 7, Tailwind 3.4, shadcn/ui, D3 v7, Zustand, TanStack Query 5, Drizzle ORM, better-sqlite3, Zod, Framer Motion, cmdk, Wouter

**Source reference:** /tmp/crm-source/compound-modeler/ (original app to port from)

---

## Phase 1: Project Scaffold & Data Model

### Task 1: Initialize project structure

**Files:**
- Create: `compound-modeler-v2/package.json`
- Create: `compound-modeler-v2/tsconfig.json`
- Create: `compound-modeler-v2/vite.config.ts`
- Create: `compound-modeler-v2/tailwind.config.ts`
- Create: `compound-modeler-v2/postcss.config.js`
- Create: `compound-modeler-v2/drizzle.config.ts`
- Create: `compound-modeler-v2/.env.example`
- Create: `compound-modeler-v2/.gitignore`
- Create: `compound-modeler-v2/client/index.html`
- Create: `compound-modeler-v2/client/src/main.tsx`
- Create: `compound-modeler-v2/client/src/index.css`

**Step 1: Create project directory and package.json**

Create `compound-modeler-v2/` at `/Users/chasebauman/Documents/compound-modeler-v2/`.

`package.json` — same dependencies as original with additions:
- Add: `d3` (^7.9.0), `@types/d3`, `zustand` (^5.0.0), `cmdk` (^1.1.1)
- Keep: all existing deps (react, wouter, tanstack-query, radix-ui, recharts removal optional — keep for now, phase out later)
- Keep: all devDeps (tailwindcss, vite, tsx, typescript, drizzle-kit, esbuild)

**Step 2: Copy config files from original, modify as needed**

- `tsconfig.json` — copy from original, same path aliases (`@` → client/src, `@shared` → shared/)
- `vite.config.ts` — copy from original verbatim
- `tailwind.config.ts` — copy from original verbatim
- `postcss.config.js` — copy from original verbatim
- `drizzle.config.ts` — copy from original, change schema path to `./shared/schema.ts`
- `.gitignore` — copy from original, add `data.db*`

**Step 3: Create .env.example**

```env
PORT=5000
NODE_ENV=development

# AI provider: openai | anthropic | none
AI_PROVIDER=none
AI_MODEL=
AI_API_KEY=

# Optional: OpenAI-specific (legacy compat)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
```

**Step 4: Create client entry files**

- `client/index.html` — copy from original verbatim
- `client/src/main.tsx` — copy from original verbatim
- `client/src/index.css` — copy from original verbatim (all theme variables, custom utilities)

**Step 5: Install dependencies**

Run: `cd /Users/chasebauman/Documents/compound-modeler-v2 && npm install`

**Step 6: Commit**

```bash
git init && git add -A && git commit -m "scaffold: initialize project with deps and config"
```

---

### Task 2: Define shared schema (Drizzle tables + Zod types)

**Files:**
- Create: `shared/schema.ts`

This is the most critical file. It defines the normalized data model.

**Step 1: Write Drizzle table definitions**

Tables to define (per design doc):
- `compounds` — identity + molecular properties + provenance
- `bindingActivities` — real Ki/IC50/EC50 values with units and source
- `effectProfiles` — CNS/peripheral effects with provenance
- `pkProfiles` — pharmacokinetics per route
- `pdProfiles` — pharmacodynamics (JSON fields for targets/effects lists)
- `doseProfiles` — dose bands per route with confidence
- `compoundEmbeddings` — precomputed vectors for similarity
- `modelRuns` — saved blend analyses
- `comparePresets` — saved comparison sets

Key differences from original:
- `bindingActivities` replaces `receptorProfiles`: has `activityValue` (real nM), `activityUnits`, `pchemblValue`, `actionType`, `source`, `sourceId`, `assayDescription`
- `effectProfiles`: adds `confidence` as text (measured/literature/inferred), `evidenceSource`
- `pkProfiles`: adds `confidence`, `source`
- `doseProfiles`: adds `source`
- `compoundEmbeddings`: entirely new table
- `compounds`: drops `discoverySourcesJson`, `discoverySeed` fields (simplify discovery), keeps all molecular descriptor columns

**Step 2: Write Zod validation schemas**

Port all input schemas from original (`runModelInputSchema`, `compareInputSchema`, `doseSimInputSchema`, `importCompoundInputSchema`, `pubchemSearchInputSchema`, `pubchemImportInputSchema`, `searchCompoundsInputSchema`, `saveComparePresetInputSchema`, `aiExploreInputSchema`, `discoveryRunInputSchema`).

Add new schemas:
- `enrichCompoundInputSchema` — `{ compoundId: number }`
- `paginationSchema` — `{ limit?: number (1-200, default 50), offset?: number (min 0, default 0) }`

**Step 3: Write TypeScript types for API responses**

Port all complex types from original: `CompoundRecord`, `ModelOutput`, `DoseSimResult`, `CompareResult`, `CompareIntelligence`, `TargetLandscape`, `SystemsMap`, `EvidenceQualityDashboard`, `PharmacologyExplorer`, `AiExploreResult`, `DiscoveryDashboard`.

Modify `CompoundRecord` to use new binding_activities shape:
```typescript
type BindingActivity = {
  id: number;
  targetName: string;
  targetFamily: string;
  targetChemblId: string | null;
  targetUniprotId: string | null;
  activityType: "Ki" | "IC50" | "Kd" | "EC50" | "pChEMBL";
  activityValue: number;
  activityUnits: string;
  pchemblValue: number | null;
  actionType: string;
  confidence: "measured" | "literature" | "inferred";
  source: string;
  sourceId: string | null;
  assayDescription: string | null;
};
```

**Step 4: Commit**

```bash
git add shared/schema.ts && git commit -m "feat: define normalized data model with real pharmacology units"
```

---

### Task 3: Server foundation — Express app + config + database

**Files:**
- Create: `server/index.ts`
- Create: `server/config.ts`
- Create: `server/static.ts`
- Create: `server/vite.ts`
- Create: `server/db/schema.ts` (re-export from shared)
- Create: `server/db/seed.ts`

**Step 1: Copy server/index.ts from original verbatim**

Same Express setup, middleware, error handler, Vite dev mode.

**Step 2: Write server/config.ts with multi-provider support**

Extend original config to support `AI_PROVIDER` env var:
```typescript
type AiProvider = "openai" | "anthropic" | "none";

export function getServerConfig() {
  const provider = (process.env.AI_PROVIDER || "none") as AiProvider;
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "";
  return {
    ai: { provider, model, apiKey, enabled: provider !== "none" && !!apiKey },
    environment: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 5000),
  };
}
```

**Step 3: Copy server/static.ts and server/vite.ts from original verbatim**

**Step 4: Write server/db/seed.ts**

Port the 10 seed compounds from original storage.ts. Transform to new schema:
- Map `affinity` (0-100) → estimated `pchemblValue` using: `pchembl = 5 + (affinity / 100) * 4` (maps 0→5.0, 100→9.0)
- Map `activityType` string → `actionType` enum value
- Set `confidence: "literature"` for seeds, `source: "curated"`
- Keep all effect profiles, PK, PD, dose profiles as-is

**Step 5: Create server/db/schema.ts as re-export**

```typescript
export * from "../../shared/schema";
```

**Step 6: Commit**

```bash
git add server/ && git commit -m "feat: server foundation with multi-provider AI config and seed data"
```

---

### Task 4: Storage layer — database operations

**Files:**
- Create: `server/services/storage.ts`

**Step 1: Write core CRUD operations**

Port from original `storage.ts` but using new table shapes:
- `listCompounds(limit, offset)` — paginated, returns compounds with binding activities + effect profiles joined
- `getCompound(id)` — full compound with all related data
- `createCompound(data)` — insert compound + profiles
- `updateCompound(id, data)` — update compound fields
- `deleteCompound(id)` — cascade delete compound and all profiles
- `searchCompounds(query, category, limit, offset)` — text search on name/aliases
- `getCompoundBySlug(slug)` — lookup by slug

**Step 2: Write analysis operations**

Port from original:
- `buildModelOutput(compoundIds, receptorWeights)` — adapted to use binding_activities with real values
- `buildCompareResult(ids)` — adapted for new data shape
- `buildDoseSim(compoundId, doses, route)` — Hill equation using pChEMBL-derived EC50
- `buildTargetLandscape()` — group by target_family from binding_activities
- `buildEvidenceQuality()` — quality scoring based on confidence + source fields
- `buildSystemsMap()` — network from binding_activities + effect_profiles
- `buildPharmacologyExplorer()` — selectivity from binding_activities real values

Key algorithm change: selectivity index computed from real Ki values instead of arbitrary scores:
```
SI = Ki(secondary) / Ki(primary)  // higher = more selective
```

**Step 3: Write embedding operations**

- `computeEmbedding(compoundId)` — build receptor vector from binding_activities, normalize to unit vector
- `findSimilar(compoundId, limit)` — cosine similarity against all other embeddings
- `recomputeAllEmbeddings()` — batch recompute (call after enrichment)

**Step 4: Write seed loader**

- `populateSeeds()` — check if compounds table empty, insert seed data from db/seed.ts

**Step 5: Commit**

```bash
git add server/services/storage.ts && git commit -m "feat: storage layer with normalized queries and embedding similarity"
```

---

### Task 5: External API services

**Files:**
- Create: `server/services/pubchem.ts`
- Create: `server/services/chembl.ts`
- Create: `server/services/uniprot.ts`
- Create: `server/services/ai.ts`
- Create: `server/services/enrichment.ts`
- Create: `server/services/embeddings.ts`

**Step 1: Port pubchem.ts from original**

Same API calls, same structure. No changes needed.

**Step 2: Port and upgrade chembl.ts**

Key upgrade: extract real binding values instead of mapping to 0-100.

Original maps ChEMBL pChEMBL values to 0-100 affinity. New version keeps raw data:
- `searchChEMBL(query)` — same search logic
- `getChEMBLCompoundData(chemblId)` — returns binding activities with:
  - `activityType`: "Ki" | "IC50" | "Kd" | "EC50"
  - `activityValue`: real nM value from `standard_value`
  - `activityUnits`: from `standard_units`
  - `pchemblValue`: from `pchembl_value`
  - `actionType`: from mechanism data
  - `sourceId`: ChEMBL assay ID
  - `assayDescription`: from assay data

**Step 3: Write uniprot.ts (NEW)**

Simple UniProt REST API client:
- `searchUniProt(geneName)` → `{ accession, proteinName, geneName, organism, family }`
- `getUniProtEntry(accession)` → full protein record
- Used to enrich target family classification and get UniProt IDs for binding_activities

**Step 4: Write ai.ts — modular LLM provider**

```typescript
interface LLMProvider {
  generateNarrative(system: string, prompt: string): Promise<string>;
}

class OpenAIProvider implements LLMProvider { ... }
class AnthropicProvider implements LLMProvider { ... }
class NoopProvider implements LLMProvider {
  async generateNarrative(_s: string, _p: string) { return ""; }
}

export function createAIProvider(config: ServerConfig["ai"]): LLMProvider { ... }
```

**Step 5: Write enrichment.ts — pipeline orchestrator**

```typescript
export async function enrichCompound(compoundId: number): Promise<void> {
  const compound = await storage.getCompound(compoundId);
  // 1. PubChem: molecular properties
  if (!compound.pubchemCid) { /* search + fetch */ }
  // 2. ChEMBL: binding activities
  if (!compound.chemblId) { /* search + fetch real Ki/IC50 data */ }
  // 3. UniProt: target protein info
  for (const activity of compound.bindingActivities) {
    if (!activity.targetUniprotId) { /* lookup + update */ }
  }
  // 4. Compute embeddings
  await computeAndStoreEmbedding(compoundId);
}
```

**Step 6: Write embeddings.ts**

```typescript
export function computeReceptorVector(activities: BindingActivity[]): number[] {
  // Fixed dimension order (all known targets)
  // Value = pChEMBL score (0 if no data)
  // Normalize to unit vector
}

export function cosineSimilarity(a: number[], b: number[]): number { ... }
```

**Step 7: Commit**

```bash
git add server/services/ && git commit -m "feat: external API services with real ChEMBL binding data and modular AI"
```

---

### Task 6: API routes

**Files:**
- Create: `server/routes/compounds.ts`
- Create: `server/routes/analysis.ts`
- Create: `server/routes/explore.ts`
- Create: `server/routes/enrichment.ts`
- Create: `server/routes.ts` (main router that combines all)

**Step 1: Write compounds.ts**

Endpoints:
- `GET /api/compounds` — paginated list (query params: limit, offset, category)
- `GET /api/compounds/:id` — full compound detail
- `GET /api/compounds/:id/provenance` — data lineage
- `GET /api/compounds/:id/similar` — embedding-based neighbors
- `GET /api/search` — text search with filters
- `POST /api/compounds` — manual create
- `DELETE /api/compounds/:id` — remove

Port search logic from original routes.ts. Add pagination params to list endpoint.

**Step 2: Write analysis.ts**

Endpoints:
- `POST /api/compare` — multi-compound comparison
- `GET /api/compare-presets` — saved presets
- `POST /api/compare-presets` — save preset
- `DELETE /api/compare-presets/:id` — remove preset
- `POST /api/dose-sim` — dose-response simulation
- `GET /api/network` — force graph data (nodes + weighted edges)
- `GET /api/landscape` — target families
- `GET /api/quality` — evidence quality dashboard
- `GET /api/pharmacology-explorer` — selectivity/ranking

Port all analysis logic from original routes.ts, adapted for new data shapes.

**Step 3: Write explore.ts**

Endpoints:
- `POST /api/explore` — AI-powered semantic search + ranking
- `POST /api/discovery/run` — auto-discovery trigger
- `GET /api/discovery/status` — discovery state
- `GET /api/discovery/feed` — recent discoveries

Port AI explore scoring logic from original routes.ts. Adapt scoring to use pChEMBL values instead of 0-100 affinity.

**Step 4: Write enrichment.ts**

Endpoints:
- `GET /api/pubchem/search` — search PubChem
- `POST /api/pubchem/import` — import by CID
- `GET /api/chembl/search` — search ChEMBL
- `POST /api/chembl/import` — import by ChEMBL ID
- `POST /api/enrich/:id` — run full enrichment pipeline
- `GET /api/compounds/:id/import-quality` — enrichment report

**Step 5: Write routes.ts main router**

```typescript
import { registerCompoundRoutes } from "./routes/compounds";
import { registerAnalysisRoutes } from "./routes/analysis";
import { registerExploreRoutes } from "./routes/explore";
import { registerEnrichmentRoutes } from "./routes/enrichment";

export async function registerRoutes(server: Server, app: Express) {
  registerCompoundRoutes(app);
  registerAnalysisRoutes(app);
  registerExploreRoutes(app);
  registerEnrichmentRoutes(app);
}
```

**Step 6: Verify server starts**

Run: `cd /Users/chasebauman/Documents/compound-modeler-v2 && npm run dev`
Expected: Server starts on port 5000, seeds 10 compounds, API responds to GET /api/compounds

**Step 7: Commit**

```bash
git add server/ && git commit -m "feat: all API routes with pagination, enrichment, and network endpoints"
```

---

## Phase 2: Client Foundation

### Task 7: Copy shadcn/ui components and hooks

**Files:**
- Create: `client/src/components/ui/` — copy ALL 48 components from original
- Create: `client/src/hooks/` — copy use-mobile.tsx, use-toast.ts
- Create: `client/src/lib/utils.ts` — copy from original
- Create: `client/src/lib/queryClient.ts` — copy from original

**Step 1: Copy all UI components verbatim**

These are standard shadcn/ui components — no modifications needed. Copy entire `client/src/components/ui/` directory.

**Step 2: Copy hooks and lib files**

**Step 3: Commit**

```bash
git add client/src/components/ui/ client/src/hooks/ client/src/lib/ && git commit -m "feat: copy shadcn/ui components and utility libraries"
```

---

### Task 8: Zustand store + API client + color system

**Files:**
- Create: `client/src/store.ts`
- Create: `client/src/lib/api.ts`
- Create: `client/src/lib/colors.ts`
- Create: `client/src/lib/formatting.ts`

**Step 1: Write Zustand store**

```typescript
import { create } from "zustand";

interface AppState {
  // Selection
  selectedCompoundIds: number[];
  toggleCompound: (id: number) => void;
  clearSelection: () => void;

  // UI
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Filters
  familyFilter: string[];
  confidenceFilter: string[];
  setFamilyFilter: (families: string[]) => void;
  setConfidenceFilter: (levels: string[]) => void;
}
```

**Step 2: Write API client**

Typed fetch wrapper for all endpoints. Each function returns typed data matching shared schema types.

```typescript
export async function fetchCompounds(limit = 50, offset = 0) { ... }
export async function fetchCompound(id: number) { ... }
export async function searchCompounds(q: string, category?: string) { ... }
export async function runCompare(ids: number[]) { ... }
export async function runDoseSim(compoundId: number, doses: number[], route?: string) { ... }
export async function fetchNetwork() { ... }
// ... etc for all endpoints
```

**Step 3: Write color system**

```typescript
export const FAMILY_COLORS: Record<string, string> = {
  serotonin: "#8b5cf6",    // violet-500
  dopamine: "#f59e0b",     // amber-500
  glutamate: "#f43f5e",    // rose-500
  gaba: "#10b981",         // emerald-500
  opioid: "#0ea5e9",       // sky-500
  cannabinoid: "#22c55e",  // green-500
  adrenergic: "#f97316",   // orange-500
  cholinergic: "#06b6d4",  // cyan-500
  histamine: "#ec4899",    // pink-500
  sigma: "#64748b",        // slate-500
};

export const ACTION_COLORS: Record<string, string> = {
  agonist: "#14b8a6",      // teal-500
  antagonist: "#f43f5e",   // rose-500
  PAM: "#f59e0b",          // amber-500
  NAM: "#6366f1",          // indigo-500
  inhibitor: "#64748b",    // slate-500
  modulator: "#a855f7",    // purple-500
};

export const CONFIDENCE_COLORS = {
  measured: "#22c55e",     // green
  literature: "#3b82f6",   // blue
  inferred: "#eab308",     // yellow
  manual: "#9ca3af",       // gray
};

export function getFamilyColor(family: string): string { ... }
```

**Step 4: Write formatting utilities**

```typescript
export function formatActivity(value: number, units: string): string { ... }
export function formatPChEMBL(value: number): string { ... }
export function formatConfidence(level: string): string { ... }
// Provenance badge helper, Ki/IC50 display, etc.
```

**Step 5: Commit**

```bash
git add client/src/store.ts client/src/lib/ && git commit -m "feat: Zustand store, typed API client, color system"
```

---

### Task 9: App shell — Sidebar + Layout + Command Palette + Routing

**Files:**
- Create: `client/src/components/layout/AppShell.tsx`
- Create: `client/src/components/layout/Sidebar.tsx`
- Create: `client/src/components/layout/CommandPalette.tsx`
- Create: `client/src/components/layout/PageHeader.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Write Sidebar**

Collapsible sidebar with navigation links. Uses Wouter `useLocation` for active state.

Links:
- Dashboard (/) — LayoutDashboard icon
- Library (/library) — Database icon
- Network (/network) — GitBranch icon
- Compare (/compare) — GitCompare icon
- Explore (/explore) — Search icon
- Landscape (/landscape) — Target icon
- Quality (/quality) — ShieldCheck icon
- Separator
- Settings section: AI provider status indicator

Collapse behavior: icon-only when collapsed, full labels when expanded. Store collapsed state in Zustand.

**Step 2: Write CommandPalette**

Use `cmdk` library (already in deps). Triggered by Cmd+K.

Groups:
- "Navigate" — all page links
- "Compounds" — dynamically loaded compound names, click navigates to /compound/:id
- "Actions" — "Import from PubChem", "Compare selected", "Run dose sim"

```tsx
import { Command } from "cmdk";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen);
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen);
  // ... Cmd+K listener, compound search via API
}
```

**Step 3: Write AppShell**

```tsx
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <CommandPalette />
    </div>
  );
}
```

**Step 4: Write PageHeader**

Reusable header with title, description, optional actions slot.

**Step 5: Update App.tsx**

Wrap router in AppShell. Add new routes:
```tsx
<AppShell>
  <Switch>
    <Route path="/" component={DashboardPage} />
    <Route path="/library" component={LibraryPage} />
    <Route path="/compound/:id" component={CompoundDetailPage} />
    <Route path="/compare" component={ComparePage} />
    <Route path="/dose-sim/:id" component={DoseSimPage} />
    <Route path="/explore" component={ExplorePage} />
    <Route path="/network" component={NetworkPage} />
    <Route path="/landscape" component={LandscapePage} />
    <Route path="/quality" component={QualityPage} />
    <Route component={NotFound} />
  </Switch>
</AppShell>
```

**Step 6: Verify app shell renders**

Run dev server, check sidebar appears, navigation works, Cmd+K opens palette.

**Step 7: Commit**

```bash
git add client/src/ && git commit -m "feat: app shell with sidebar navigation and command palette"
```

---

## Phase 3: Core Pages

### Task 10: Dashboard page

**Files:**
- Create: `client/src/pages/DashboardPage.tsx`

Quick overview: compound count, avg quality score, recent activity, quick action cards.
Fetches: `GET /api/compounds?limit=5`, `GET /api/config`

4 quick-action cards:
- Import from PubChem → navigate to /library (import modal)
- Compare Compounds → navigate to /compare
- Explore AI → navigate to /explore
- View Network → navigate to /network

Top compounds section: 5 highest-quality compounds with badges.

**Commit:** `git commit -m "feat: dashboard page with stats and quick actions"`

---

### Task 11: Library page (replaces workbench)

**Files:**
- Create: `client/src/pages/LibraryPage.tsx`
- Create: `client/src/components/compounds/CompoundTable.tsx`
- Create: `client/src/components/compounds/CompoundCard.tsx`
- Create: `client/src/components/compounds/ImportModal.tsx`
- Create: `client/src/components/compounds/SearchBar.tsx`

Port from original compound-workbench.tsx (2189 lines) but restructured:

**CompoundTable**: Paginated table with columns: name, category, source, targets (count), quality grade, actions. Column sorting. Checkbox selection for bulk compare.

**SearchBar**: Debounced search input + category filter dropdown. Calls `GET /api/search`.

**ImportModal**: Tabs for PubChem import and manual import. Port from original workbench modal.

**CompoundCard**: Compact card variant for grid view toggle.

Key difference from original: this page is ONLY the library browser. AI explore, model running, and network visualization are separate pages now.

**Commit:** `git commit -m "feat: library page with paginated table, search, and import"`

---

### Task 12: Compound detail page

**Files:**
- Create: `client/src/pages/CompoundDetailPage.tsx`

Port from original compound-detail.tsx (1421 lines). Restructured as tabbed layout:

**Tab 1: Overview** — name, category, provenance badge, summary, molecular properties
**Tab 2: Binding Data** — table of binding_activities with real Ki/IC50 values, units, source, assay description. Color-coded by confidence (measured=green, literature=blue, inferred=yellow). Group by target family.
**Tab 3: Effects** — brain vs peripheral effect profiles. Radar chart (D3, built in Task 16).
**Tab 4: Pharmacokinetics** — PK table per route. Dose profiles with band indicators.
**Tab 5: Similar** — embedding-based nearest neighbors. Shared/unique targets comparison.
**Tab 6: Evidence** — data quality score, grade, issues, enrichment status. "Enrich" button.

ProvenanceBadge component: shows source (Curated/ChEMBL/PubChem/Inferred) with color.

**Commit:** `git commit -m "feat: compound detail page with tabbed binding data and provenance"`

---

### Task 13: Compare page

**Files:**
- Create: `client/src/pages/ComparePage.tsx`
- Create: `client/src/components/compare/CompareBuilder.tsx`
- Create: `client/src/components/compare/ReceptorMatrix.tsx`
- Create: `client/src/components/compare/EffectMatrix.tsx`

Port from original compare-page.tsx (1206 lines).

**CompareBuilder**: Compound selector (search + select up to 6). Preset save/load.

**ReceptorMatrix**: Heatmap of binding activities across compounds. Shows real Ki values on hover. Grouped by family. Built with D3 (Task 17).

**EffectMatrix**: Heatmap of effects across compounds. Brain vs peripheral domains.

Intelligence section: shared targets, differentiating targets, similarity matrix (cosine from embeddings), duration/load tradeoffs.

**Commit:** `git commit -m "feat: compare page with receptor matrix and effect heatmap"`

---

### Task 14: Dose simulation page

**Files:**
- Create: `client/src/pages/DoseSimPage.tsx`

Port from original dose-sim-page.tsx (1175 lines).

Key upgrade: Interactive Hill curve built with D3 (Task 18). Draggable EC50/Emax/n parameters. Multi-route overlay.

Dose input: array of dose values (mg). Route selector. Bioavailability note.
Results: receptor occupancy heatmap, effect intensity per dose, dose band badges.
Route comparison sidebar.

**Commit:** `git commit -m "feat: dose simulation page with Hill curve parameters"`

---

### Task 15: Explore page (AI discovery — replaces modal)

**Files:**
- Create: `client/src/pages/ExplorePage.tsx`
- Create: `client/src/components/explore/ExploreQuery.tsx`
- Create: `client/src/components/explore/RankedResults.tsx`
- Create: `client/src/components/explore/RationaleCard.tsx`

Port AI explore from original workbench (was a panel, now full page).

**ExploreQuery**: Full-width query builder with:
- Natural language prompt input
- Mode chips: receptor-targeted, effect-targeted, balanced
- Bias toggle: CNS-heavy, peripheral-light, balanced
- Optional receptor query input
- Optional effect query input
- Preset query buttons (from original: "D2 agonism", "anxiolytic", "antidepressant", etc.)

**RankedResults**: Card list of scored compounds with:
- Relevance score + fit label
- Matched receptors (highlighted)
- Matched effects (highlighted)
- Tradeoffs (warnings)
- Actions: view detail, add to compare, dose sim

**RationaleCard**: Expandable card showing scoring breakdown — why this compound ranked here.

**Commit:** `git commit -m "feat: AI explore page with query builder and ranked results"`

---

## Phase 4: D3 Visualizations

### Task 16: D3 Radar Chart component

**Files:**
- Create: `client/src/components/visualizations/RadarChart.tsx`

D3 polar plot for compound effect profiles. Used in CompoundDetailPage (effects tab) and ComparePage (overlay mode).

Props: `{ data: { axis: string; value: number }[]; compounds?: { name: string; data: ... }[]; size?: number }`

SVG rendered via D3 inside a React ref. Axes = effect domains or receptor families. Fill area shows profile shape. Multiple compounds = overlaid semi-transparent fills.

**Commit:** `git commit -m "feat: D3 radar chart for compound effect profiles"`

---

### Task 17: D3 Heatmap component

**Files:**
- Create: `client/src/components/visualizations/Heatmap.tsx`

Reusable heatmap for receptor binding and effect comparison.

Props: `{ rows: string[]; columns: string[]; values: number[][]; labels?: string[][]; colorScale: "sequential" | "diverging"; onCellHover?: (row, col, value) => void }`

Features:
- Row grouping with collapsible family headers
- Hover tooltip showing real value + source
- Sequential scale (white→teal) for single-compound
- Diverging scale (rose←white→teal) for compare
- Column sorting (click header)

**Commit:** `git commit -m "feat: D3 heatmap with grouping, tooltips, and real values"`

---

### Task 18: D3 Hill Curve component

**Files:**
- Create: `client/src/components/visualizations/HillCurve.tsx`

Interactive dose-response curve.

Props: `{ ec50: number; emax: number; n: number; doses?: number[]; onParamChange?: (ec50, emax, n) => void }`

Features:
- D3 line chart: x = log(dose), y = occupancy (0-1)
- Draggable control points: circle on curve at EC50 (drag horizontally), Emax line (drag vertically), steepness handle
- Real-time recalculation on drag
- Multi-compound overlay: up to 4 compounds, different colors
- Dose band shading behind curve
- Hover crosshair with exact value display

Formula: `Occ = Emax * [C]^n / (EC50^n + [C]^n)`

**Commit:** `git commit -m "feat: interactive D3 Hill curve with draggable parameters"`

---

### Task 19: D3 Force-Directed Network Graph

**Files:**
- Create: `client/src/components/visualizations/ForceGraph.tsx`
- Create: `client/src/pages/NetworkPage.tsx`

The centerpiece visualization.

**ForceGraph props:**
```typescript
{
  nodes: { id: string; type: "compound" | "target" | "effect"; family?: string; label: string }[];
  links: { source: string; target: string; weight: number; actionType?: string }[];
  onNodeClick?: (node) => void;
  filters?: { families: string[]; actionTypes: string[]; minWeight: number };
}
```

**D3 force simulation:**
- `forceLink` with distance based on weight (stronger = closer)
- `forceManyBody` with charge -300
- `forceCenter` to center of SVG
- `forceCollide` to prevent overlap

**Node rendering:**
- Compounds: circles, colored by category
- Targets: diamonds, colored by family (using FAMILY_COLORS)
- Effects: rounded rects, colored by domain (brain=teal, peripheral=rose)

**Edge rendering:**
- Width proportional to pChEMBL value
- Color by action type (ACTION_COLORS)
- Dashed for inferred confidence

**Interactions:**
- Drag nodes (d3-drag)
- Pan/zoom (d3-zoom)
- Click node: highlight connected nodes, dim rest
- Hover: tooltip with binding data
- Double-click: navigate to compound detail

**Filter panel (sidebar):**
- Family checkboxes (toggle visibility)
- Action type checkboxes
- Binding threshold slider (min pChEMBL)
- "Reset" button

**Export:** SVG download button (serialize SVG element).

**NetworkPage**: Fetches `GET /api/network`, passes to ForceGraph. Filter controls in sidebar panel.

**Commit:** `git commit -m "feat: D3 force-directed network graph with pan/zoom/filter"`

---

### Task 20: D3 Sunburst for Target Landscape

**Files:**
- Create: `client/src/components/visualizations/Sunburst.tsx`
- Create: `client/src/pages/LandscapePage.tsx`

**Sunburst props:**
```typescript
{
  data: { name: string; children: { name: string; children: { name: string; value: number }[] }[] };
  onArcClick?: (path: string[]) => void;
}
```

Hierarchy: center → families → receptors → compounds
- Arc width = compound count
- Color intensity = mean binding strength (pChEMBL)
- Click to zoom into family, click center to zoom out
- Transition animation: 300ms arc tween

**LandscapePage**: Fetches `GET /api/landscape`, transforms to hierarchy, renders Sunburst + detail panel.

**Commit:** `git commit -m "feat: D3 sunburst for target landscape with zoom"`

---

## Phase 5: Remaining Pages & Polish

### Task 21: Quality page

**Files:**
- Create: `client/src/pages/QualityPage.tsx`
- Create: `client/src/components/quality/QualityGrid.tsx`
- Create: `client/src/components/quality/ProvenanceBadge.tsx`
- Create: `client/src/components/quality/EnrichAction.tsx`

Port from original evidence-quality-dashboard.tsx (349 lines).

Upgrade: per-data-point provenance. Each binding activity shows its source (ChEMBL assay ID, literature ref, or "inferred"). EnrichAction button triggers `POST /api/enrich/:id`.

**Commit:** `git commit -m "feat: evidence quality page with provenance and one-click enrich"`

---

### Task 22: Systems Map page (upgraded)

**Files:**
- Create: `client/src/pages/SystemsMapPage.tsx`

Port from original systems-map.tsx (537 lines). Uses ForceGraph component from Task 19 instead of static SVG.

Tabs: Families, Effects, Compounds (same as original but with interactive graph).

**Commit:** `git commit -m "feat: systems map page using force-directed graph"`

---

### Task 23: Pharmacology Explorer page

**Files:**
- Create: `client/src/pages/PharmacologyExplorerPage.tsx`

Port from original pharmacology-explorer.tsx (390 lines).

Selectivity leaders use real Ki ratios. Ranking board uses normalized scores. Enrichment queue shows missing data gaps.

**Commit:** `git commit -m "feat: pharmacology explorer with real selectivity indices"`

---

### Task 24: Keyboard shortcuts + global polish

**Files:**
- Modify: `client/src/components/layout/AppShell.tsx` — add keyboard listener
- Modify: `client/src/App.tsx` — Framer Motion page transitions

**Keyboard shortcuts:**
- `Cmd+K` — command palette (already wired)
- `j/k` — navigate up/down in lists (library, explore results)
- `Enter` — open selected item
- `Escape` — close modals, go back
- `c` — compare selected (when on library page with selection)

**Page transitions:**
- Framer Motion `AnimatePresence` wrapper around `<Switch>`
- Fade + slight slide for page changes (150ms)

**Commit:** `git commit -m "feat: keyboard shortcuts and page transition animations"`

---

## Phase 6: Data Migration & Integration Test

### Task 25: Seed data migration script

**Files:**
- Create: `server/db/migrate-seeds.ts`

Script that:
1. Reads the 10 seed compounds from original format (in seed.ts)
2. Transforms affinity 0-100 → estimated pChEMBL (5.0 + affinity/100 * 4.0)
3. Creates binding_activities with `confidence: "literature"`, `source: "curated"`
4. Inserts into new database
5. Computes and stores embeddings

Run: `npx tsx server/db/migrate-seeds.ts`

**Commit:** `git commit -m "feat: seed data migration with pChEMBL conversion"`

---

### Task 26: Full integration verification

**Step 1: Start server**

Run: `npm run dev`
Verify: server starts, seeds loaded, all endpoints respond.

**Step 2: Test each page**

- `/` — Dashboard renders with compound count
- `/library` — Table loads with 10 compounds, search works, pagination works
- `/compound/1` — Detail page with binding data tab showing Ki/IC50 values
- `/compare?ids=1,2` — Heatmap renders, intelligence section works
- `/dose-sim/1` — Hill curve renders, draggable parameters work
- `/explore` — Query builder works, returns ranked results
- `/network` — Force graph renders, pan/zoom works, filters work
- `/landscape` — Sunburst renders, click-to-zoom works
- `/quality` — Quality grid renders, enrich button works

**Step 3: Test enrichment pipeline**

1. Import a compound from PubChem (search "aspirin", import)
2. Verify molecular properties populated
3. Click "Enrich" — verify ChEMBL binding data populated with real Ki values
4. Verify embedding computed
5. Check similar compounds updated

**Step 4: Test command palette**

Cmd+K → search "psilocybin" → click → navigates to detail page

**Step 5: Commit final state**

```bash
git add -A && git commit -m "feat: complete Compound Receptor Modeler v2 rebuild"
```

---

## Task Dependency Graph

```
Phase 1 (Foundation):
  Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6

Phase 2 (Client Foundation):
  Task 7 (parallel with Task 6)
  Task 7 → Task 8 → Task 9

Phase 3 (Core Pages):
  Task 9 → Task 10, 11, 12, 13, 14, 15 (can parallelize)

Phase 4 (D3 Visualizations):
  Task 8 → Task 16, 17, 18, 19, 20 (can parallelize)
  Task 19 → integrates into NetworkPage, SystemsMapPage
  Task 17 → integrates into ComparePage, DetailPage
  Task 18 → integrates into DoseSimPage
  Task 16 → integrates into DetailPage

Phase 5 (Remaining + Polish):
  Tasks 21-24 (after Phase 3+4 complete)

Phase 6 (Migration + Verification):
  Task 25 → Task 26
```

**Parallelization opportunities:**
- Tasks 16-20 (all D3 components) can be built in parallel by separate agents
- Tasks 10-15 (core pages) can be built in parallel once Task 9 is done
- Tasks 21-23 can be built in parallel
