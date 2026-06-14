import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, type Filters } from '@/store'
import { api, type Tag } from '@/lib/api'
import { useDashboard } from '@/hooks/useDashboard'
import { cn } from '@/lib/cn'

const SOURCE_LABELS: Record<string, string> = {
  pubmed: 'PubMed',
  biorxiv: 'bioRxiv',
  arxiv: 'arXiv',
  reddit: 'Reddit',
  x: 'X / Twitter',
  lpsg: 'LPSG',
  coomer: 'Coomer',
  kemono: 'Kemono',
  web: 'Web',
  visual_capture: 'Visual Capture',
  ddg: 'DDG Images',
  redgifs: 'Redgifs',
}
const STATUSES = ['new', 'reviewing', 'shortlisted', 'archived']
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'score', label: 'Top score' },
  { value: 'saved', label: 'Saved first' },
  { value: 'queue', label: 'Queue order' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'source', label: 'By source' },
]

function loadPresets(): Record<string, Partial<Filters>> {
  return {}
}

const controlClass =
  'px-3 py-2 bg-bg-subtle border border-border rounded-lg text-xs text-text-secondary focus:outline-none focus:border-accent/50 transition-colors hover:border-border/80'

// ── Inline preset save row ────────────────────────────────────────────────────
function SavePresetInline({
  filters: _filters,
  onSaved,
}: {
  filters: Filters
  onSaved: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const addToast = useAppStore((s) => s.addToast)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function commit() {
    const trimmed = name.trim()
    if (!trimmed) return
    onSaved(trimmed)
    addToast(`Preset "${trimmed}" saved`)
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] text-text-muted hover:text-accent transition-colors px-1.5 py-0.5 rounded hover:bg-accent/10"
      >
        + save preset
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Preset name…"
        className="px-2 py-1 rounded-lg border border-accent/40 bg-bg-subtle text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/70 w-36"
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setOpen(false); setName('') }
        }}
      />
      <button
        onClick={commit}
        disabled={!name.trim()}
        className="px-2 py-1 rounded-lg bg-accent text-white text-[11px] font-medium hover:bg-accent/80 transition-colors disabled:opacity-40"
      >
        Save
      </button>
      <button
        onClick={() => { setOpen(false); setName('') }}
        className="text-text-muted hover:text-text-primary text-xs px-1"
      >
        ✕
      </button>
    </div>
  )
}

// ── ThemeQuickFilter ──────────────────────────────────────────────────────────
function ThemeQuickFilter({
  activeTheme,
  onSelect,
}: {
  activeTheme: string
  onSelect: (slug: string) => void
}) {
  const { data: dashboard } = useDashboard()
  const themes = (dashboard?.themes ?? []) as { slug: string; label: string }[]
  if (themes.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider shrink-0">Theme</span>
      {themes.map((t) => (
        <button
          key={t.slug}
          onClick={() => onSelect(t.slug)}
          aria-pressed={activeTheme === t.slug}
          className={cn(
            'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors',
            activeTheme === t.slug
              ? 'border-accent/60 bg-accent/15 text-accent'
              : 'border-border bg-bg-subtle text-text-secondary hover:border-accent/30 hover:text-text-primary',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── TagFilterChips ────────────────────────────────────────────────────────────
function TagFilterChips({
  activeTag,
  onSelect,
}: {
  activeTag: string
  onSelect: (name: string) => void
}) {
  const { data: tags = [] } = useQuery({
    queryKey: ['all-tags'],
    queryFn: () => api.tags(),
    staleTime: 60_000,
  })

  if (tags.length === 0) return null

  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-widest font-mono text-text-muted">Tags</label>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag: Tag) => {
          const isActive = activeTag === tag.name
          return (
            <button
              key={tag.id}
              onClick={() => onSelect(tag.name)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                isActive
                  ? ''
                  : 'border-border bg-bg-subtle text-text-secondary hover:text-text-primary hover:border-border/80'
              }`}
              style={isActive ? {
                backgroundColor: `${tag.color}25`,
                borderColor: `${tag.color}60`,
                color: tag.color,
              } : undefined}
              aria-pressed={isActive}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
              {tag.usage_count != null && tag.usage_count > 0 && (
                <span className="text-[10px] opacity-60">{tag.usage_count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── FiltersBar ────────────────────────────────────────────────────────────────
export function FiltersBar() {
  const filters = useAppStore((s) => s.filters)
  const setFilter = useAppStore((s) => s.setFilter)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const addToast = useAppStore((s) => s.addToast)

  const [presets, setPresets] = useState<Record<string, Partial<Filters>>>(() => loadPresets())
  const [showAdvanced, setShowAdvanced] = useState(false)

  function deletePreset(name: string) {
    setPresets((prev) => {
      const p = { ...prev }
      delete p[name]
      return p
    })
  }

  // Active filter chips (excluding search which is displayed inline)
  const activeFilters: { key: keyof Filters; label: string; value: string }[] = []
  if (filters.sourceType) activeFilters.push({ key: 'sourceType', label: 'source', value: SOURCE_LABELS[filters.sourceType] ?? filters.sourceType })
  if (filters.theme) activeFilters.push({ key: 'theme', label: 'theme', value: filters.theme })
  if (filters.reviewStatus) activeFilters.push({ key: 'reviewStatus', label: 'status', value: filters.reviewStatus })
  if (filters.savedOnly) activeFilters.push({ key: 'savedOnly', label: 'saved', value: 'only' })
  if (filters.queuedOnly) activeFilters.push({ key: 'queuedOnly', label: 'queue', value: 'only' })
  if (filters.compound) activeFilters.push({ key: 'compound', label: 'compound', value: filters.compound })
  if (filters.mechanism) activeFilters.push({ key: 'mechanism', label: 'mechanism', value: filters.mechanism })
  if (filters.dateFrom) activeFilters.push({ key: 'dateFrom', label: 'from', value: filters.dateFrom })
  if (filters.dateTo) activeFilters.push({ key: 'dateTo', label: 'to', value: filters.dateTo })
  if (filters.tag) activeFilters.push({ key: 'tag', label: 'tag', value: filters.tag })
  if (filters.minScore) activeFilters.push({ key: 'minScore', label: 'score ≥', value: filters.minScore })

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.collections(),
    staleTime: 60_000,
  })

  if (filters.collectionId) {
    const collName = collections.find((c) => String(c.id) === filters.collectionId)?.name ?? filters.collectionId
    activeFilters.push({ key: 'collectionId', label: 'collection', value: collName })
  }

  const hasAnyActive = !!(filters.search || activeFilters.length)
  const hasPresets = Object.keys(presets).length > 0

  return (
    <div className="space-y-2">
      {/* ── Primary row: search + quick toggles ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="search"
            placeholder="Search items…"
            value={filters.search}
            onChange={(e) => setFilter('search', e.target.value)}
            className="w-full rounded-lg border border-border bg-bg-subtle pl-8 pr-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
          />
          {filters.search && (
            <button
              onClick={() => setFilter('search', '')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
              aria-label="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>

        {/* Sort */}
        <select
          aria-label="Sort order"
          value={filters.sort}
          onChange={(e) => setFilter('sort', e.target.value)}
          className={controlClass}
        >
          {SORTS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        {/* Saved toggle */}
        <button
          onClick={() => setFilter('savedOnly', !filters.savedOnly)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
            filters.savedOnly
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-border bg-bg-subtle text-text-secondary hover:border-border/80 hover:text-text-primary'
          }`}
          aria-pressed={filters.savedOnly}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={filters.savedOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
          Saved
        </button>

        {/* Queue toggle */}
        <button
          onClick={() => setFilter('queuedOnly', !filters.queuedOnly)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
            filters.queuedOnly
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-border bg-bg-subtle text-text-secondary hover:border-border/80 hover:text-text-primary'
          }`}
          aria-pressed={filters.queuedOnly}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Queue
        </button>

        {/* Advanced toggle */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs transition-colors ${
            showAdvanced || activeFilters.length > 0
              ? 'border-accent/30 bg-accent/5 text-accent'
              : 'border-border bg-bg-subtle text-text-secondary hover:text-text-primary'
          }`}
          aria-expanded={showAdvanced}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
          Filters
          {activeFilters.length > 0 && (
            <span className="inline-flex items-center justify-center h-4 min-w-4 rounded-full bg-accent text-white text-[10px] font-bold px-1">
              {activeFilters.length}
            </span>
          )}
        </button>

        {/* Clear all */}
        {hasAnyActive && (
          <button
            onClick={resetFilters}
            className="text-xs text-text-muted hover:text-red transition-colors px-1"
            title="Clear all filters"
          >
            Clear all
          </button>
        )}
      </div>

      {/* ── Theme quick-filter strip ── */}
      <ThemeQuickFilter
        activeTheme={filters.theme}
        onSelect={(slug) => setFilter('theme', slug === filters.theme ? '' : slug)}
      />

      {/* ── Advanced panel ── */}
      {showAdvanced && (
        <div className="rounded-xl border border-border bg-bg-surface p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {/* Source */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-mono text-text-muted">Source</label>
              <select
                aria-label="Source filter"
                value={filters.sourceType}
                onChange={(e) => setFilter('sourceType', e.target.value)}
                className={`${controlClass} w-full`}
              >
                <option value="">All sources</option>
                {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-mono text-text-muted">Status</label>
              <select
                aria-label="Status filter"
                value={filters.reviewStatus}
                onChange={(e) => setFilter('reviewStatus', e.target.value)}
                className={`${controlClass} w-full`}
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-mono text-text-muted">From date</label>
              <input
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilter('dateFrom', e.target.value)}
                className={`${controlClass} w-full`}
                aria-label="Date from"
                style={{ colorScheme: 'dark' }}
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-mono text-text-muted">To date</label>
              <input
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e) => setFilter('dateTo', e.target.value)}
                className={`${controlClass} w-full`}
                aria-label="Date to"
                style={{ colorScheme: 'dark' }}
              />
            </div>

            {/* Min score */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-mono text-text-muted">Min score</label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                placeholder="e.g. 3"
                value={filters.minScore ?? ''}
                onChange={(e) => setFilter('minScore', e.target.value)}
                className={`${controlClass} w-full`}
                aria-label="Minimum score filter"
              />
            </div>

            {/* Collection */}
            {collections.length > 0 && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-widest font-mono text-text-muted">Collection</label>
                <select
                  aria-label="Collection filter"
                  value={filters.collectionId}
                  onChange={(e) => setFilter('collectionId', e.target.value)}
                  className={`${controlClass} w-full`}
                >
                  <option value="">All collections</option>
                  {collections.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.icon} {c.name} ({c.item_count})</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Tags */}
          <TagFilterChips
            activeTag={filters.tag}
            onSelect={(name) => setFilter('tag', name === filters.tag ? '' : name)}
          />
        </div>
      )}

      {/* ── Active filter chips ── */}
      {(activeFilters.length > 0 || filters.search) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.search && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-elevated border border-border text-[11px] text-text-secondary">
              <span className="text-text-muted">search:</span>
              <span className="font-medium text-text-primary truncate max-w-[120px]">{filters.search}</span>
              <button
                onClick={() => setFilter('search', '')}
                className="ml-0.5 text-text-muted hover:text-red transition-colors"
                aria-label="Remove search filter"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </span>
          )}
          {activeFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key, (f.key === 'savedOnly' ? false : '') as never)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/25 text-accent text-[11px] hover:bg-accent/20 transition-colors"
            >
              <span className="text-accent/60">{f.label}:</span>
              <span className="font-medium">{f.value}</span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          ))}
        </div>
      )}

      {/* ── Presets row ── */}
      {(hasPresets || hasAnyActive) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasPresets && (
            <>
              <span className="text-[10px] font-mono text-text-muted uppercase tracking-wider">Presets</span>
              {Object.entries(presets).map(([name, saved]) => (
                <div
                  key={name}
                  className="group/preset flex items-center gap-0 rounded-full bg-bg-elevated border border-border overflow-hidden transition-all hover:border-accent/40"
                >
                  <button
                    onClick={() => {
                      resetFilters()
                      Object.entries(saved).forEach(([k, v]) => {
                        if (v !== undefined && v !== '' && v !== false) {
                          setFilter(k as keyof Filters, v as never)
                        }
                      })
                      addToast(`Applied "${name}"`)
                    }}
                    className="px-3 py-1 text-[11px] text-text-secondary group-hover/preset:text-text-primary transition-colors font-mono"
                  >
                    {name}
                  </button>
                  <button
                    onClick={() => { deletePreset(name); addToast(`Deleted "${name}"`) }}
                    className="px-1.5 py-1 text-text-muted hover:text-red hover:bg-red/10 transition-colors text-[10px]"
                    title={`Delete preset "${name}"`}
                    aria-label={`Delete preset ${name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          )}
          {hasAnyActive && (
            <SavePresetInline
              filters={filters}
              onSaved={(name) => setPresets((prev) => ({ ...prev, [name]: filters }))}
            />
          )}
        </div>
      )}
    </div>
  )
}
