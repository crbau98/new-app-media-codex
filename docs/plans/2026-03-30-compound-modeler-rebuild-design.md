# Compound Receptor Modeler — Architecture Rebuild Design

**Date**: 2026-03-30
**Status**: Approved
**Source**: /tmp/crm-source/compound-modeler/

## Goal

Rebuild the Compound Receptor Modeler from source with a redesigned architecture that removes accumulated tech debt from 14 upgrade specs while preserving all existing features. The rebuild targets real pharmacology data models, interactive D3 visualizations, modular AI, and multi-source enrichment.

## Stack (preserved)

- Frontend: React 18, Wouter, TanStack Query, Tailwind 3.4, Radix/shadcn, Framer Motion
- Backend: Express 5, TypeScript, SQLite + Drizzle ORM, Zod
- Build: Vite 7, TSX, ESBuild
- Added: D3 v7, Zustand, cmdk (command palette)
- Removed: Recharts (replaced by D3)

---

## 1. Data Model

### compounds

Core identity + molecular properties. Same concept, cleaner columns.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | auto-increment |
| slug | text unique | URL-safe identifier |
| name | text | display name |
| category | text | pharmaceutical, research-chemical, botanical, endogenous |
| aliases | text (JSON array) | alternate names |
| origin | text | freeform origin note |
| summary | text | mechanism summary |
| source_type | text | curated, pubchem, chembl, drugbank |
| source_url | text | nullable |
| pubchem_cid | integer | nullable |
| chembl_id | text | nullable |
| molecular_formula | text | nullable |
| molecular_weight | real | nullable |
| canonical_smiles | text | nullable |
| inchi_key | text | nullable |
| xlogp | real | nullable |
| complexity | real | nullable |
| hba | integer | nullable, H-bond acceptors |
| hbd | integer | nullable, H-bond donors |
| created_at | text | ISO timestamp |
| updated_at | text | ISO timestamp |

### binding_activities (replaces receptorProfiles)

Real pharmacology units with provenance.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| compound_id | integer FK | compounds.id |
| target_name | text | e.g., "5-HT2A", "D2", "GABA-A" |
| target_family | text | e.g., "serotonin", "dopamine", "GABA" |
| target_chembl_id | text | nullable, for cross-reference |
| target_uniprot_id | text | nullable |
| activity_type | text | Ki, IC50, Kd, EC50, pChEMBL |
| activity_value | real | in nM (or unitless for pChEMBL) |
| activity_units | text | nM, uM, unitless |
| pchembl_value | real | nullable, standardized -log10(molar) |
| action_type | text | agonist, antagonist, PAM, NAM, inhibitor, modulator, partial-agonist |
| confidence | text | measured, literature, inferred |
| source | text | chembl, drugbank, pubchem, manual |
| source_id | text | nullable, e.g., ChEMBL assay ID |
| assay_description | text | nullable |

### effect_profiles

Same concept, normalized with provenance.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| compound_id | integer FK | |
| domain | text | CNS, peripheral, metabolic, endocrine |
| system | text | e.g., mood, cognition, cardiovascular |
| effect | text | e.g., anxiolysis, tachycardia |
| magnitude | real | 0-100 |
| direction | text | positive, negative, bidirectional |
| confidence | text | measured, literature, inferred |
| evidence_source | text | |

### pk_profiles

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| compound_id | integer FK | |
| route | text | oral, IV, sublingual, inhaled, etc. |
| bioavailability_pct | real | nullable |
| onset_minutes | real | nullable |
| peak_minutes | real | nullable |
| half_life_hours | real | nullable |
| duration_hours | real | nullable |
| metabolism | text | nullable |
| active_metabolites | text (JSON) | nullable |
| notes | text | nullable |
| confidence | text | curated, literature, inferred |
| source | text | |

### dose_profiles

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| compound_id | integer FK | |
| route | text | |
| threshold_mg | real | nullable |
| light_mg | real | nullable |
| common_mg | real | nullable |
| strong_mg | real | nullable |
| heavy_mg | real | nullable |
| confidence | text | curated, literature, inferred |
| source | text | |

### compound_embeddings (NEW)

Precomputed vectors for similarity search.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| compound_id | integer FK unique per type | |
| embedding_type | text | receptor_profile, effect_profile, combined |
| vector | text (JSON float array) | unit vector |
| updated_at | text | |

### model_runs, compare_presets

Same as current, no changes needed.

---

## 2. Frontend Architecture

### Layout

App shell: collapsible sidebar (left) + main content area + command palette overlay (Cmd+K).

### Pages (9 routes)

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | DashboardPage | Library stats, recent activity, quick actions, top compounds |
| `/library` | LibraryPage | Paginated compound table, column sort, inline filters, bulk select, virtual scroll |
| `/compound/:id` | CompoundDetailPage | Tabbed: binding data (real Ki/IC50), effects, PK/PD, doses, quality, similar, provenance |
| `/compare` | ComparePage | D3 heatmaps, parallel coordinates PK, divergence highlights, intelligence cards |
| `/dose-sim/:id` | DoseSimPage | Interactive Hill curve (draggable EC50/Emax/n), multi-route overlay, dose bands |
| `/explore` | ExplorePage | Full-page AI query builder, ranked result cards, expandable rationale |
| `/network` | NetworkPage | D3 force-directed graph: compounds→targets→effects, pan/zoom/filter, SVG export |
| `/landscape` | LandscapePage | D3 sunburst: families→receptors→compounds, click-to-zoom |
| `/quality` | QualityPage | Per-data-point provenance, quality grading, one-click enrich action |

### Command Palette (Cmd+K)

- Search compounds by name
- Navigate to any page
- Quick actions: "Compare X and Y", "Dose sim for X", "Import from PubChem"

### State Management

Zustand store for:
- Selected compounds (for compare, model runs)
- Active filters (family, action type, confidence)
- UI state (sidebar collapsed, command palette open)

TanStack Query for all server data.

### Component Structure

```
client/src/
  components/
    layout/          AppShell, Sidebar, CommandPalette, PageHeader
    compounds/       CompoundCard, CompoundTable, ImportModal, SearchBar
    visualizations/  ForceGraph, HillCurve, Heatmap, RadarChart, Sunburst
    compare/         CompareBuilder, ReceptorMatrix, EffectMatrix, PKParallel
    explore/         ExploreQuery, RankedResults, RationaleCard
    quality/         QualityGrid, ProvenanceBadge, EnrichAction
    ui/              shadcn components (kept as-is)
  pages/             9 page components
  hooks/             useCompounds, useSimilarity, useNetwork, useDebounce, etc.
  lib/               api.ts, colors.ts, embeddings.ts, formatting.ts, utils.ts
  store.ts           Zustand store
```

---

## 3. Backend Architecture

### File Structure

```
server/
  db/
    schema.ts        Drizzle table definitions (all tables above)
    seed.ts          Initial compound data loader
  services/
    enrichment.ts    Multi-source pipeline orchestrator
    pubchem.ts       PubChem API client (existing, upgraded)
    chembl.ts        ChEMBL API client (existing, upgraded to extract real Ki/IC50)
    uniprot.ts       UniProt API client (NEW — target protein info)
    embeddings.ts    Vector computation + cosine similarity
    ai.ts            Modular LLM provider (OpenAI | Anthropic | none)
    scoring.ts       Rule-based compound scoring for explore
    modeling.ts      Model run builder (network output)
    dosesim.ts       Hill equation dose-response computation
  routes/
    compounds.ts     CRUD, search, pagination
    analysis.ts      Compare, dose-sim, network, landscape
    explore.ts       AI explore + discovery
    enrichment.ts    Import + enrich endpoints
  index.ts           Express app setup
  config.ts          Environment config
  static.ts          Production static file serving
  vite.ts            Dev server setup
```

### API Endpoints

All list endpoints support `?limit=N&offset=N` pagination.

**Compounds**:
- `GET /api/compounds` — paginated list
- `GET /api/compounds/:id` — full detail with all profiles
- `GET /api/compounds/:id/provenance` — data lineage per field
- `GET /api/compounds/:id/similar` — embedding-based nearest neighbors
- `GET /api/search?q=&category=` — search with filters
- `POST /api/compounds` — manual import
- `DELETE /api/compounds/:id` — remove compound

**External Import**:
- `GET /api/pubchem/search?q=` — search PubChem
- `POST /api/pubchem/import` — import by CID
- `GET /api/chembl/search?q=` — search ChEMBL
- `POST /api/chembl/import` — import by ChEMBL ID
- `POST /api/enrich/:id` — run enrichment pipeline for compound

**Analysis**:
- `POST /api/compare` — multi-compound comparison
- `GET /api/compare-presets` — saved presets
- `POST /api/compare-presets` — save preset
- `POST /api/dose-sim` — dose-response simulation
- `GET /api/network` — force graph data (nodes + weighted edges)
- `GET /api/landscape` — target families with compounds and binding data
- `GET /api/quality` — evidence quality dashboard data

**AI Explore**:
- `POST /api/explore` — semantic search + ranking
- `POST /api/discovery/run` — auto-discovery trigger
- `GET /api/discovery/status` — discovery state

**Model**:
- `POST /api/model-runs` — create model
- `GET /api/model-runs` — list models

**System**:
- `GET /api/health` — liveness
- `GET /api/config` — public config

### Enrichment Pipeline

When a compound is imported or enriched:

1. **PubChem** → molecular identity, properties, synonyms
2. **ChEMBL** → binding activities with real Ki/IC50/EC50 values, mechanisms, targets
3. **UniProt** → target protein info, gene symbols, family classification
4. **Compute** → receptor embedding vector, effect embedding vector, combined vector
5. **Store** → all data written to normalized tables with source provenance

### AI Provider Interface

```typescript
interface LLMProvider {
  generateNarrative(prompt: string, context: string): Promise<string>;
  rankCandidates(query: string, candidates: ScoredCandidate[]): Promise<RankedResult[]>;
}
```

Implementations: OpenAIProvider, AnthropicProvider, NoopProvider (rule-based fallback).

Config: `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` in .env.

---

## 4. Visualization System

All visualizations use D3 v7 with consistent interaction patterns.

### Force-Directed Network Graph (NetworkPage)

- Three node types: compounds (circles), targets (diamonds), effects (rounded rects)
- Edge weight = pChEMBL value (thicker = stronger binding)
- Edge color = action type (agonist=teal, antagonist=rose, PAM=amber, inhibitor=slate)
- Node color = family (serotonin=violet, dopamine=amber, glutamate=rose, GABA=emerald, opioid=sky, cannabinoid=green)
- Interactions: pan, zoom, drag, click-to-focus, hover tooltip
- Filter panel: toggle families, action types, binding threshold slider
- Export: SVG download

### Interactive Hill Curve (DoseSimPage)

- D3 line chart with draggable control points for EC50, Emax, Hill coefficient (n)
- Formula: Occ = Emax * [C]^n / (EC50^n + [C]^n)
- Real-time update on drag
- Multi-compound overlay (up to 4)
- Dose band shading behind curves

### Heatmap (ComparePage, DetailPage)

- D3 heatmap with real values on hover (e.g., "Ki = 4.2 nM, source: CHEMBL12345")
- Sequential color scale for single-compound, diverging for compare
- Row grouping by receptor family with collapsible headers
- Column sorting options

### Radar Chart (DetailPage)

- D3 polar plot: axes = top receptor families or effect domains
- Filled area shows profile shape
- Overlay mode in compare view

### Sunburst (LandscapePage)

- D3 sunburst: center → families → receptors → compounds
- Click to zoom into family, click center to zoom out
- Arc width = compound count, color intensity = mean binding strength

### Consistent Patterns

- Hover: tooltip with source provenance
- Click: navigate to detail page
- Right-click: context menu (compare, dose-sim, enrich)
- Transitions: 300ms ease-out

---

## 5. Color System

### Family Colors (fixed across all views)

| Family | Color | Tailwind |
|--------|-------|----------|
| Serotonin | Violet | violet-500 |
| Dopamine | Amber | amber-500 |
| Glutamate | Rose | rose-500 |
| GABA | Emerald | emerald-500 |
| Opioid | Sky | sky-500 |
| Cannabinoid | Green | green-500 |
| Adrenergic | Orange | orange-500 |
| Cholinergic | Cyan | cyan-500 |
| Histamine | Pink | pink-500 |
| Sigma | Slate | slate-500 |

### Action Type Colors

| Action | Color |
|--------|-------|
| Agonist | Teal |
| Antagonist | Rose |
| PAM | Amber |
| NAM | Indigo |
| Inhibitor | Slate |
| Modulator | Purple |

### Provenance Badges

| Source | Badge |
|--------|-------|
| Measured (ChEMBL assay) | Green "Measured" |
| Literature | Blue "Literature" |
| Inferred | Yellow "Inferred" |
| Manual | Gray "Manual" |

---

## 6. Out of Scope

- Multi-user auth / collaboration
- PostgreSQL migration
- 3D molecular viewer (RDKit.js)
- Mobile responsiveness
- Real-time WebSocket updates
- Code splitting / lazy loading (can add later)

---

## 7. Migration Strategy

The rebuild creates a new project directory. Existing seed data is migrated:
1. Export current compounds from SQLite → JSON
2. Transform: map 0-100 affinity scores to estimated pChEMBL values
3. Import into new schema
4. Run enrichment pipeline to backfill real ChEMBL binding data

No data loss. Old app remains functional alongside new build.
