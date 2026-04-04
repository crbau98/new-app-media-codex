# Visual Polish + Graph & Media Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Elevate the app's visual quality to professional-designer level and add zoom/pan to the Graph page and dynamic terms + masonry grid to the Media page.

**Architecture:** Five independent workstreams touching separate files — safe to parallelize. All source is `.tsx`; after edits run `cd frontend && npm run build` to compile `.js` outputs. No backend changes needed except Task 5 which reads from existing `/api/browse/screenshots`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, D3 v7, Recharts, Zustand, TanStack Query v5, Lucide React (to install)

---

## Task 1: Install Lucide React + create SourceIcon component

**Files:**
- Modify: `frontend/package.json` (add lucide-react)
- Create: `frontend/src/components/SourceIcon.tsx`
- Modify: `frontend/src/components/index.ts` (re-export SourceIcon)

**Step 1: Install lucide-react**

```bash
cd frontend && npm install lucide-react
```

Expected: lucide-react appears in package.json dependencies.

**Step 2: Create SourceIcon component**

Create `frontend/src/components/SourceIcon.tsx`:

```tsx
import {
  MessageSquare, FlaskConical, FileText, Twitter,
  MessageCircle, Search, Globe, Flame, Camera, Diamond
} from 'lucide-react'

const ICONS: Record<string, React.FC<{ size?: number; className?: string }>> = {
  reddit:       (p) => <MessageSquare {...p} />,
  pubmed:       (p) => <FlaskConical {...p} />,
  arxiv:        (p) => <FileText {...p} />,
  biorxiv:      (p) => <FileText {...p} />,
  x:            (p) => <Twitter {...p} />,
  twitter:      (p) => <Twitter {...p} />,
  lpsg:         (p) => <MessageCircle {...p} />,
  duckduckgo:   (p) => <Search {...p} />,
  ddg:          (p) => <Search {...p} />,
  web:          (p) => <Globe {...p} />,
  firecrawl:    (p) => <Flame {...p} />,
  visual_capture: (p) => <Camera {...p} />,
  literature:   (p) => <FileText {...p} />,
}

export function SourceIcon({ sourceType, size = 12, className }: {
  sourceType: string
  size?: number
  className?: string
}) {
  const Icon = ICONS[sourceType.toLowerCase()]
  if (!Icon) return <Diamond size={size} className={className ?? 'text-text-muted'} />
  return <Icon size={size} className={className ?? 'text-text-muted'} />
}
```

**Step 3: Re-export from components index**

Find `frontend/src/components/index.ts` (or `index.tsx`) and add:
```ts
export { SourceIcon } from './SourceIcon'
```

**Step 4: Build to verify no errors**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

**Step 5: Commit**

```bash
cd frontend && git add src/components/SourceIcon.tsx src/components/index.ts package.json package-lock.json
git commit -m "feat: add SourceIcon component using Lucide icons"
```

---

## Task 2: Create TagChip component

**Files:**
- Create: `frontend/src/components/TagChip.tsx`
- Modify: `frontend/src/components/index.ts`

**Step 1: Create TagChip**

Create `frontend/src/components/TagChip.tsx`:

```tsx
import { cn } from '@/lib/cn'

interface TagChipProps {
  label: string
  variant: 'compound' | 'mechanism'
  onClick?: (e: React.MouseEvent) => void
  size?: 'sm' | 'md'
  showCount?: number
}

export function TagChip({ label, variant, onClick, size = 'sm', showCount }: TagChipProps) {
  const isTeal = variant === 'compound'
  const base = cn(
    'inline-flex items-center gap-1 font-mono rounded border transition-colors',
    size === 'sm' ? 'text-[11px] px-1.5 py-0.5' : 'text-xs px-2 py-1',
    isTeal
      ? 'bg-bg-elevated border-teal/30 text-teal hover:border-teal/60 hover:bg-teal/10'
      : 'bg-bg-elevated border-purple/30 text-purple hover:border-purple/60 hover:bg-purple/10',
    onClick ? 'cursor-pointer' : 'cursor-default',
  )

  if (onClick) {
    return (
      <button onClick={onClick} className={base}>
        {label}
        {showCount != null && (
          <span className={cn('text-[10px]', isTeal ? 'text-teal/60' : 'text-purple/60')}>
            {showCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <span className={base}>
      {label}
      {showCount != null && (
        <span className={cn('text-[10px]', isTeal ? 'text-teal/60' : 'text-purple/60')}>
          {showCount}
        </span>
      )}
    </span>
  )
}
```

**Step 2: Re-export**

Add to `frontend/src/components/index.ts`:
```ts
export { TagChip } from './TagChip'
```

**Step 3: Build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

**Step 4: Commit**

```bash
git add frontend/src/components/TagChip.tsx frontend/src/components/index.ts
git commit -m "feat: add unified TagChip component for compound/mechanism tags"
```

---

## Task 3: Upgrade SourceCard — icon, score pill, action buttons, TagChip

**Files:**
- Modify: `frontend/src/features/items/SourceCard.tsx`

**Step 1: Rewrite SourceCard.tsx**

Replace the full contents of `frontend/src/features/items/SourceCard.tsx` with:

```tsx
import { Bookmark, BookmarkCheck, ChevronRight, Archive } from 'lucide-react'
import { SourceIcon } from '@/components/SourceIcon'
import { TagChip } from '@/components/TagChip'
import { Badge } from '@/components'
import { useUpdateItem } from '@/hooks/useItems'
import type { ResearchItem } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/store'

export type Density = 'compact' | 'comfortable' | 'spacious'
type BadgeVariant = 'default' | 'accent' | 'teal' | 'amber' | 'green' | 'red' | 'purple' | 'muted'

const REVIEW_VARIANT: Record<string, BadgeVariant> = {
  new: 'default',
  reviewing: 'amber',
  shortlisted: 'green',
  archived: 'muted',
}

export function SourceCard({
  item,
  selected,
  onSelect,
  density = 'comfortable',
}: {
  item: ResearchItem
  selected: boolean
  onSelect: (id: number) => void
  density?: Density
}) {
  const update = useUpdateItem()
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const reviewVariant: BadgeVariant = REVIEW_VARIANT[item.review_status] ?? 'default'

  function goTag(type: 'compound' | 'mechanism', value: string) {
    resetFilters()
    setFilter(type, value)
    setActiveView('items')
  }

  const densityClass = density === 'compact' ? 'py-2' : density === 'spacious' ? 'py-4' : 'py-3'

  return (
    <div
      className={cn(
        'relative bg-bg-surface border border-border rounded-xl overflow-hidden transition-all duration-150',
        'hover:border-accent/30 hover:bg-bg-elevated',
        selected && 'border-accent/60 bg-bg-elevated ring-1 ring-accent/20',
      )}
    >
      <div className={cn('pl-4 pr-4', densityClass)}>
        {/* Header row */}
        <div className="flex items-start gap-2 mb-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onSelect(item.id) }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 shrink-0 accent-accent"
            aria-label={`Select ${item.title}`}
          />
          <div className="flex-1 min-w-0">
            {/* Metadata row */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="flex items-center gap-1 text-xs text-text-muted font-mono">
                <SourceIcon sourceType={item.source_type} size={11} />
                <span>{item.source_type}</span>
              </span>
              <Badge variant="muted" mono>{item.theme}</Badge>
              {item.review_status && item.review_status !== 'new' && (
                <Badge variant={reviewVariant}>{item.review_status}</Badge>
              )}
              {item.score > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-accent font-mono bg-accent/8 border border-accent/20 rounded px-1.5 py-0.5">
                  ◆ {item.score.toFixed(1)}
                </span>
              )}
              {item.is_saved && <Badge variant="green">saved</Badge>}
            </div>
            {/* Title */}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[15px] font-semibold text-text-primary hover:text-accent transition-colors line-clamp-2 leading-snug"
            >
              {item.title}
            </a>
          </div>
        </div>

        {/* Summary */}
        {item.summary && (
          <p className="text-xs text-text-secondary line-clamp-2 mb-2.5 ml-6">{item.summary}</p>
        )}

        {/* Compound + mechanism chips */}
        {(item.compounds.length > 0 || item.mechanisms.length > 0) && (
          <div className="flex flex-wrap gap-1 mb-2.5 ml-6">
            {item.compounds.map((c) => (
              <TagChip
                key={c}
                label={c}
                variant="compound"
                onClick={(e) => { e.stopPropagation(); goTag('compound', c) }}
              />
            ))}
            {item.mechanisms.map((m) => (
              <TagChip
                key={m}
                label={m}
                variant="mechanism"
                onClick={(e) => { e.stopPropagation(); goTag('mechanism', m) }}
              />
            ))}
          </div>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between ml-6">
          <span className="text-xs text-text-muted font-mono">
            {item.domain}
            {item.first_seen_at && ` · ${item.first_seen_at.slice(0, 10)}`}
          </span>
          <div className="flex items-center gap-0.5">
            <ActionButton
              title={item.is_saved ? 'Unsave' : 'Save'}
              hoverClass="hover:bg-amber/10 hover:text-amber"
              onClick={() => update.mutate({ id: item.id, patch: { is_saved: !item.is_saved } })}
            >
              {item.is_saved
                ? <BookmarkCheck size={13} className="text-amber" />
                : <Bookmark size={13} />
              }
            </ActionButton>
            <ActionButton
              title="Shortlist"
              hoverClass="hover:bg-green/10 hover:text-green"
              onClick={() => {
                if (item.review_status !== 'shortlisted')
                  update.mutate({ id: item.id, patch: { review_status: 'shortlisted' } })
              }}
            >
              <ChevronRight size={13} />
            </ActionButton>
            <ActionButton
              title="Archive"
              hoverClass="hover:bg-red/10 hover:text-red"
              onClick={() => {
                if (item.review_status !== 'archived')
                  update.mutate({ id: item.id, patch: { review_status: 'archived' } })
              }}
            >
              <Archive size={13} />
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionButton({
  children,
  title,
  onClick,
  hoverClass,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  hoverClass: string
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title}
      aria-label={title}
      className={cn(
        'w-7 h-7 flex items-center justify-center text-text-muted rounded transition-all',
        hoverClass,
      )}
    >
      {children}
    </button>
  )
}
```

**Step 2: Build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

**Step 3: Commit**

```bash
git add frontend/src/features/items/SourceCard.tsx frontend/src/features/items/SourceCard.js
git commit -m "feat: upgrade SourceCard with Lucide icons, score pill, TagChip, color-coded actions"
```

---

## Task 4: Add dot-grid background texture to index.css

**Files:**
- Modify: `frontend/src/index.css`

**Step 1: Add background texture to body**

In `frontend/src/index.css`, replace the `body` block:

```css
body {
  margin: 0;
  background-color: var(--color-bg-base);
  background-image: radial-gradient(circle, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 28px 28px;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.6;
}
```

**Step 2: Add chart theme constants file**

Create `frontend/src/lib/chartTheme.ts`:

```ts
export const CHART_TOOLTIP_STYLE = {
  background: '#161e2e',
  border: '1px solid #1e2d42',
  borderRadius: 8,
  fontSize: 12,
}
export const CHART_LABEL_STYLE = { color: '#e2ecf7' }
export const CHART_ITEM_STYLE  = { color: '#8da4c0' }
export const CHART_AXIS_TICK   = { fontSize: 11, fill: '#4e6582', fontFamily: 'monospace' }
```

**Step 3: Build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

**Step 4: Commit**

```bash
git add frontend/src/index.css frontend/src/lib/chartTheme.ts
git commit -m "feat: add dot-grid background texture; extract chart theme constants"
```

---

## Task 5: Upgrade StatsBar + OverviewPage TopTagsPanel

**Files:**
- Modify: `frontend/src/features/analytics/StatsBar.tsx`
- Modify: `frontend/src/features/overview/OverviewPage.tsx`
- Modify: `frontend/src/features/analytics/ThemeTrendChart.tsx`

**Step 1: Upgrade StatsBar**

Replace `frontend/src/features/analytics/StatsBar.tsx` with:

```tsx
import { useDashboard } from '@/hooks/useDashboard'
import { useAppStore } from '@/store'
import { cn } from '@/lib/cn'

export function StatsBar() {
  const { data } = useDashboard()
  const t = data?.stats.totals
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setFilter = useAppStore((s) => s.setFilter)
  const resetFilters = useAppStore((s) => s.resetFilters)

  function goItems(extra?: { savedOnly?: boolean }) {
    resetFilters()
    if (extra?.savedOnly) setFilter('savedOnly', true)
    setActiveView('items')
  }

  const stats: { label: string; value: string | number; onClick?: () => void; accent?: boolean }[] = [
    { label: 'Total Items', value: t?.item_count ?? '—', onClick: () => goItems(), accent: true },
    { label: 'Saved', value: t?.saved_item_count ?? '—', onClick: () => goItems({ savedOnly: true }) },
    { label: 'Hypotheses', value: t?.hypothesis_count ?? '—', onClick: () => setActiveView('hypotheses') },
    { label: 'Images', value: t?.image_count ?? '—', onClick: () => setActiveView('images') },
    { label: 'Last Run', value: data?.last_run?.started_at?.slice(0, 10) ?? '—' },
  ]

  return (
    <div className="grid grid-cols-5 gap-3 mb-6">
      {stats.map(({ label, value, onClick, accent }) => {
        const Comp = onClick ? 'button' : 'div'
        return (
          <Comp
            key={label}
            onClick={onClick}
            className={cn(
              'group bg-bg-surface border border-border rounded-xl p-4 text-left',
              onClick && 'cursor-pointer hover:border-accent/40 hover:bg-bg-elevated transition-colors',
              accent && 'border-accent/20 bg-bg-elevated',
            )}
          >
            <p className="text-[11px] text-text-muted uppercase tracking-widest font-mono mb-2">{label}</p>
            <div className="flex items-baseline justify-between gap-2">
              <p className={cn(
                'text-3xl font-bold font-mono',
                accent ? 'text-accent' : 'text-text-primary',
              )}>{value}</p>
              {onClick && (
                <span className="text-text-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
              )}
            </div>
          </Comp>
        )
      })}
    </div>
  )
}
```

**Step 2: Upgrade TopTagsPanel inside OverviewPage.tsx**

In `frontend/src/features/overview/OverviewPage.tsx`, replace the `TopTagsPanel` function with:

```tsx
function TopTagsPanel() {
  const { data: dashboard } = useDashboard()
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const compounds = dashboard?.stats.top_compounds ?? []
  const mechanisms = dashboard?.stats.top_mechanisms ?? []
  if (compounds.length === 0 && mechanisms.length === 0) return null

  function goTag(type: 'compound' | 'mechanism', value: string) {
    resetFilters()
    setFilter(type, value)
    setActiveView('items')
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4">
      <p className="text-sm font-semibold text-text-primary mb-3">Top Signals</p>
      <div className="grid grid-cols-2 gap-4">
        {compounds.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-teal/70 font-mono mb-2">Compounds</p>
            <div className="flex flex-wrap gap-1.5">
              {compounds.slice(0, 10).map(({ name, count }) => (
                <TagChip
                  key={name}
                  label={name}
                  variant="compound"
                  showCount={count}
                  size="md"
                  onClick={(e) => { e.stopPropagation(); goTag('compound', name) }}
                />
              ))}
            </div>
          </div>
        )}
        {mechanisms.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-purple/70 font-mono mb-2">Mechanisms</p>
            <div className="flex flex-wrap gap-1.5">
              {mechanisms.slice(0, 10).map(({ name, count }) => (
                <TagChip
                  key={name}
                  label={name}
                  variant="mechanism"
                  showCount={count}
                  size="md"
                  onClick={(e) => { e.stopPropagation(); goTag('mechanism', name) }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

Also add the import at the top of OverviewPage.tsx:
```tsx
import { TagChip } from '@/components/TagChip'
```

**Step 3: Use chart theme constants in ThemeTrendChart.tsx**

In `frontend/src/features/analytics/ThemeTrendChart.tsx`, add import:
```tsx
import { CHART_TOOLTIP_STYLE, CHART_LABEL_STYLE, CHART_ITEM_STYLE, CHART_AXIS_TICK } from '@/lib/chartTheme'
```

Replace the hardcoded `contentStyle`, `labelStyle`, `itemStyle` objects on `<Tooltip>` and the `tick` objects on `<XAxis>`/`<YAxis>` with the imported constants.

**Step 4: Build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

**Step 5: Commit**

```bash
git add frontend/src/features/analytics/StatsBar.tsx frontend/src/features/analytics/StatsBar.js \
        frontend/src/features/overview/OverviewPage.tsx frontend/src/features/overview/OverviewPage.js \
        frontend/src/features/analytics/ThemeTrendChart.tsx frontend/src/features/analytics/ThemeTrendChart.js
git commit -m "feat: upgrade StatsBar, TopTagsPanel two-column layout, extract chart theme"
```

---

## Task 6: Graph — zoom/pan + node type visibility toggles

**Files:**
- Modify: `frontend/src/features/graphs/CompoundGraph.tsx`
- Modify: `frontend/src/features/graphs/GraphPage.tsx`

**Step 1: Add zoom/pan + visibility to CompoundGraph**

Replace `frontend/src/features/graphs/CompoundGraph.tsx` with:

```tsx
import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import { useGraphData, type GraphNode, type GraphLink } from '@/hooks/useGraphData'
import { Spinner } from '@/components'

const NODE_COLOR: Record<string, string> = {
  compound:  '#14b8a6',
  mechanism: '#a855f7',
  theme:     '#22c55e',
}

type SimNode = GraphNode & d3.SimulationNodeDatum
type SimLink = GraphLink & d3.SimulationLinkDatum<SimNode>

export type { GraphNode }

interface CompoundGraphProps {
  onNodeClick?: (node: GraphNode) => void
  hiddenTypes?: Set<string>
}

export function CompoundGraph({ onNodeClick, hiddenTypes = new Set() }: CompoundGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const { data, isLoading } = useGraphData()
  const onNodeClickRef = useRef(onNodeClick)
  useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])

  useEffect(() => {
    if (!data || !svgRef.current) return
    const svgEl = svgRef.current
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    const rect = svgEl.getBoundingClientRect()
    const w = rect.width || 800
    const h = rect.height || 600

    // Container group for zoom/pan transforms
    const container = svg.append('g').attr('class', 'zoom-container')

    // Set up zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform)
      })
    svg.call(zoom)
    zoomRef.current = zoom

    // Filter by hidden types
    const nodes: SimNode[] = data.nodes
      .filter((n) => !hiddenTypes.has(n.type))
      .map((n) => ({ ...n }))
    const nodeIds = new Set(nodes.map((n) => n.id))
    const links: SimLink[] = data.links
      .filter((l) => nodeIds.has(String(l.source)) && nodeIds.has(String(l.target)))
      .map((l) => ({ ...l }))

    const sim = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => (d as SimNode).id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collision', d3.forceCollide((d: SimNode) => 8 + Math.min((d as SimNode).weight * 2, 14) + 6))

    const link = container
      .append('g')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', '#1e2d42')
      .attr('stroke-width', (d) => Math.sqrt(d.weight))

    const node = container
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => onNodeClickRef.current?.(d))
      .call(
        d3.drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    node.append('circle')
      .attr('r', (d) => 6 + Math.min(d.weight * 2, 14))
      .attr('fill', (d) => NODE_COLOR[d.type] ?? '#8da4c0')
      .attr('fill-opacity', 0.85)
      .attr('stroke', '#0a0e13')
      .attr('stroke-width', 1.5)

    // Labels — offset from node, small size
    node.append('text')
      .text((d) => d.label)
      .attr('dy', '0.35em')
      .attr('dx', (d) => 8 + Math.min(d.weight * 2, 14))
      .attr('font-size', 10)
      .attr('font-family', 'monospace')
      .attr('fill', '#8da4c0')
      .attr('pointer-events', 'none')

    sim.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { sim.stop() }
  }, [data, hiddenTypes])

  // Expose zoom controls via imperative methods
  function zoomIn() {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1.4)
  }
  function zoomOut() {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 0.7)
  }
  function zoomReset() {
    if (!svgRef.current || !zoomRef.current) return
    d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.transform, d3.zoomIdentity)
  }

  if (isLoading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>

  if (!data || data.nodes.length === 0) {
    return <div className="flex justify-center py-20"><p className="text-xs text-text-muted font-mono">No graph data yet</p></div>
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        aria-label="Force-directed graph of compounds and mechanisms"
        role="img"
        className="w-full h-[600px] bg-bg-surface border border-border rounded-xl"
      />
      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1">
        {[
          { label: '+', action: zoomIn, title: 'Zoom in' },
          { label: '−', action: zoomOut, title: 'Zoom out' },
          { label: '⌂', action: zoomReset, title: 'Reset zoom' },
        ].map(({ label, action, title }) => (
          <button
            key={label}
            onClick={action}
            title={title}
            className="w-8 h-8 flex items-center justify-center bg-bg-elevated border border-border rounded-lg text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors text-sm font-mono"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Upgrade GraphPage to wire visibility toggles**

Replace `frontend/src/features/graphs/GraphPage.tsx` with:

```tsx
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { CompoundGraph } from './CompoundGraph'
import type { GraphNode } from '@/hooks/useGraphData'

const NODE_TYPES = ['compound', 'mechanism', 'theme'] as const
type NodeType = typeof NODE_TYPES[number]

const TYPE_STYLES: Record<NodeType, { active: string; inactive: string; dot: string }> = {
  compound:  { active: 'border-teal/60 bg-teal/10 text-teal', inactive: 'border-border text-text-muted', dot: 'bg-teal' },
  mechanism: { active: 'border-purple/60 bg-purple/10 text-purple', inactive: 'border-border text-text-muted', dot: 'bg-purple' },
  theme:     { active: 'border-green/60 bg-green/10 text-green', inactive: 'border-border text-text-muted', dot: 'bg-green' },
}

export function GraphPage() {
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set())

  function toggleType(type: NodeType) {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-text-primary">Compound / Mechanism Graph</h1>
        <div className="flex gap-2 text-xs">
          {NODE_TYPES.map((t) => {
            const hidden = hiddenTypes.has(t)
            const s = TYPE_STYLES[t]
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono transition-all',
                  hidden ? s.inactive : s.active,
                )}
                title={hidden ? `Show ${t}s` : `Hide ${t}s`}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', hidden ? 'bg-border' : s.dot)} />
                {t}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-text-muted font-mono ml-auto">scroll to zoom · drag to pan</p>
      </div>

      {selected && (
        <div className="bg-bg-surface border border-border rounded-xl p-3 text-sm text-text-secondary flex items-center gap-2">
          <span className="text-text-muted text-xs font-mono">selected:</span>
          <span className="font-mono text-text-primary font-medium">{selected.label}</span>
          <span className="text-text-muted text-xs">({selected.type}, weight {selected.weight})</span>
        </div>
      )}

      <CompoundGraph onNodeClick={setSelected} hiddenTypes={hiddenTypes} />
    </div>
  )
}
```

**Step 3: Build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

**Step 4: Commit**

```bash
git add frontend/src/features/graphs/CompoundGraph.tsx frontend/src/features/graphs/CompoundGraph.js \
        frontend/src/features/graphs/GraphPage.tsx frontend/src/features/graphs/GraphPage.js
git commit -m "feat: add D3 zoom/pan, node type toggles, zoom controls to Graph page"
```

---

## Task 7: Media page — dynamic terms + masonry grid + slide-up hover

**Files:**
- Modify: `frontend/src/features/images/MediaPage.tsx`
- Modify: `frontend/src/lib/api.ts` (add distinct_terms endpoint if needed, or reuse existing)

**Step 1: Check if API supports distinct terms**

Run:
```bash
curl -s "http://localhost:8000/api/browse/screenshots?limit=0" | python3 -m json.tool | head -30
```

If the response includes a `terms` or `distinct_terms` array, use it. If not, add a backend query or derive terms from the existing screenshots data. The simplest approach: fetch a large batch of screenshots and derive distinct terms client-side on first load.

**Step 2: Add `screenshotTerms` API call**

In `frontend/src/lib/api.ts`, check for an existing endpoint. If no `terms` endpoint exists, add:

```ts
async screenshotTerms(): Promise<string[]> {
  const res = await fetch('/api/browse/screenshots?limit=200&offset=0')
  await checkStatus(res)
  const data: { screenshots: Screenshot[] } = await res.json()
  const terms = [...new Set(data.screenshots.map((s) => s.term).filter(Boolean))].sort()
  return terms
},
```

**Step 3: Rewrite MediaPage.tsx**

Replace `frontend/src/features/images/MediaPage.tsx` with:

```tsx
import { useState, useCallback, useRef, useEffect } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { api, type Screenshot } from "../../lib/api"
import { Spinner } from "../../components/Spinner"
import { cn } from "@/lib/cn"

const SOURCES = ["ddg", "redgifs"]
const isVideo = (src: string) => /\.(mp4|webm|mov)$/i.test(src)

function ScreenshotCard({ shot, onClick }: { shot: Screenshot; onClick: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const src = shot.local_url ?? shot.page_url
  const video = src ? isVideo(src) : false
  const SOURCE_LABEL: Record<string, string> = { ddg: "DDG", redgifs: "Redgifs", tumblr: "Tumblr", x: "𝕏" }

  // Masonry: set grid-row-end span based on natural image height
  function updateSpan() {
    if (!cardRef.current) return
    const el = cardRef.current
    const img = el.querySelector('img, video') as HTMLImageElement | HTMLVideoElement | null
    if (!img) return
    const h = (img as HTMLImageElement).naturalHeight || (img as HTMLVideoElement).videoHeight || 0
    if (!h) return
    const w = (img as HTMLImageElement).naturalWidth || (img as HTMLVideoElement).videoWidth || 1
    const rendered = el.getBoundingClientRect().width
    const aspect = h / w
    const renderedH = rendered * aspect
    const rows = Math.ceil((renderedH + 12) / 10)
    el.style.gridRowEnd = `span ${rows}`
  }

  return (
    <div
      ref={cardRef}
      className="relative group cursor-pointer overflow-hidden rounded-lg bg-bg-elevated border border-border hover:border-accent/30 transition-all"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      aria-label={`${video ? "Video" : "Screenshot"}: ${shot.term} from ${shot.source}`}
    >
      {src ? (
        video ? (
          <video
            src={src}
            autoPlay loop muted playsInline
            className="w-full object-cover"
            onLoadedMetadata={updateSpan}
          />
        ) : (
          <img
            src={src}
            alt={`${shot.term} - ${shot.source}`}
            loading="lazy"
            className="w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            onLoad={updateSpan}
          />
        )
      ) : (
        <div className="w-full h-40 flex items-center justify-center text-text-muted text-xs">No preview</div>
      )}
      {/* Slide-up overlay */}
      <div className="absolute inset-x-0 bottom-0 translate-y-full group-hover:translate-y-0 transition-transform duration-200 bg-gradient-to-t from-black/80 to-transparent p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-white/90 bg-black/40 rounded px-1.5 py-0.5">{shot.term}</span>
          <span className="text-xs text-white/70">{SOURCE_LABEL[shot.source] ?? shot.source}</span>
          {shot.page_url && (
            <a
              href={shot.page_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="ml-auto text-white/60 hover:text-white transition-colors"
              title="View source page"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          )}
        </div>
        <p className="text-[10px] text-white/50 mt-0.5 font-mono">{shot.captured_at.slice(0, 10)}</p>
      </div>
    </div>
  )
}

function Lightbox({ shots, idx, onClose, onPrev, onNext }: {
  shots: Screenshot[]; idx: number
  onClose: () => void; onPrev: () => void; onNext: () => void
}) {
  const shot = shots[idx]
  if (!shot) return null
  const src = shot.local_url ?? shot.page_url
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose} role="dialog" aria-modal aria-label="Screenshot lightbox">
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white" aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <button onClick={(e) => { e.stopPropagation(); onPrev() }} className="absolute left-4 text-white/70 hover:text-white p-2" aria-label="Previous">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {src && (isVideo(src) ? (
          <video src={src} autoPlay loop muted playsInline controls className="max-h-[85vh] max-w-[90vw] rounded-lg" />
        ) : (
          <img src={src} alt={shot.term} className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg" />
        ))}
        {shot.page_url && (
          <a href={shot.page_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/90 transition-colors font-mono truncate max-w-[80vw]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            {shot.page_url}
          </a>
        )}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onNext() }} className="absolute right-4 text-white/70 hover:text-white p-2" aria-label="Next">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    </div>
  )
}

export function MediaPage() {
  const [term, setTerm] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ["screenshot-status"],
    queryFn: api.screenshotStatus,
    refetchInterval: 3000,
  })
  const capturing = statusData?.running ?? false

  // Fetch distinct terms dynamically
  const { data: termsData } = useQuery({
    queryKey: ["screenshot-terms"],
    queryFn: api.screenshotTerms,
    staleTime: 60_000,
  })
  const dynamicTerms = termsData ?? []

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["screenshots", term, source],
    queryFn: ({ pageParam = 0 }) =>
      api.browseScreenshots({
        ...(term ? { term } : {}),
        ...(source ? { source } : {}),
        limit: 40,
        offset: pageParam as number,
      }),
    getNextPageParam: (last) => last.has_more ? last.offset + last.screenshots.length : undefined,
    initialPageParam: 0,
  })

  const allShots = data?.pages.flatMap((p) => p.screenshots) ?? []

  async function handleCapture() {
    await api.triggerCapture()
    refetchStatus()
  }

  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect()
    if (!node) return
    observerRef.current = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
    })
    observerRef.current.observe(node)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text-primary font-bold text-lg">Images</h1>
          <p className="text-text-muted text-xs mt-0.5">Screenshot-based capture for specific terms</p>
        </div>
        <button
          onClick={handleCapture}
          disabled={capturing}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border",
            "bg-bg-elevated border-border text-text-secondary",
            "hover:border-accent/40 hover:text-accent transition-colors",
            capturing && "opacity-50 cursor-not-allowed"
          )}
        >
          {capturing ? (
            <><Spinner size={14} /> Capturing…</>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Capture Now
            </>
          )}
        </button>
      </div>

      {/* Term filters — dynamic */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTerm(null)}
          className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors", term === null ? "bg-accent text-white border-accent" : "border-border text-text-muted hover:border-accent/40")}
        >
          All
        </button>
        {dynamicTerms.map((t) => (
          <button
            key={t}
            onClick={() => setTerm(t === term ? null : t)}
            className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors font-mono", term === t ? "bg-accent text-white border-accent" : "border-border text-text-muted hover:border-accent/40")}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Source filters */}
      <div className="flex gap-2">
        <button
          onClick={() => setSource(null)}
          className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors", source === null ? "bg-bg-elevated text-text-primary border-accent/30" : "border-border text-text-muted hover:border-accent/40")}
        >
          All sources
        </button>
        {SOURCES.map((s) => (
          <button
            key={s}
            onClick={() => setSource(s === source ? null : s)}
            className={cn("px-3 py-1.5 rounded-full text-xs border transition-colors", source === s ? "bg-bg-elevated text-text-primary border-accent/30" : "border-border text-text-muted hover:border-accent/40")}
          >
            {s === "ddg" ? "DDG" : s === "redgifs" ? "Redgifs" : s}
          </button>
        ))}
      </div>

      {/* Gallery — CSS grid masonry */}
      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}

      {!isLoading && allShots.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-4xl mb-3">📸</div>
          <p className="text-text-secondary font-medium">No screenshots yet</p>
          <p className="text-text-muted text-sm mt-1">Click "Capture Now" to start collecting</p>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gridAutoRows: '10px',
          gap: '12px',
        }}
      >
        {allShots.map((shot, idx) => (
          <ScreenshotCard key={shot.id} shot={shot} onClick={() => setLightboxIdx(idx)} />
        ))}
      </div>

      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && <div className="flex justify-center py-4"><Spinner /></div>}

      {lightboxIdx != null && (
        <Lightbox
          shots={allShots}
          idx={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onPrev={() => setLightboxIdx((i) => Math.max(0, (i ?? 0) - 1))}
          onNext={() => setLightboxIdx((i) => Math.min(allShots.length - 1, (i ?? 0) + 1))}
        />
      )}
    </div>
  )
}
```

**Step 4: Build**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

**Step 5: Commit**

```bash
git add frontend/src/features/images/MediaPage.tsx frontend/src/features/images/MediaPage.js \
        frontend/src/lib/api.ts frontend/src/lib/api.js
git commit -m "feat: dynamic terms from API, masonry grid, slide-up hover on Media page"
```

---

## Final Task: Rebuild all compiled .js outputs

After all tasks complete, do a final clean build to ensure all `.js` files are in sync:

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: `✓ built in X.XXs` with 0 errors.

Then commit any remaining `.js` file changes:
```bash
cd "/Users/chasebauman/Documents/App research codex"
git add -u
git commit -m "build: rebuild all compiled outputs after visual polish + graph & media improvements"
```
