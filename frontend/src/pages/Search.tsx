import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Clock3, RefreshCw, Search as SearchIcon, SlidersHorizontal, TrendingUp, Wand2, X } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { fetchLiveDiscovery, searchMedia } from '@/lib/api'
import { filterMedia, parseProQuery } from '@/lib/proSearch'
import { useAppStore } from '@/store'
import MediaDetail from '@/components/MediaDetail'
import UpdatedChip from '@/components/UpdatedChip'
import MediaBrowser from '@/components/discovery/MediaBrowser'
import StatePanel from '@/components/discovery/StatePanel'
import { DensityToggle, FacetToggle, LayoutToggle, type MediaFacet } from '@/components/discovery/Controls'
import { useLayoutMode } from '@/components/discovery/prefs'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

const MAX_HISTORY = 8

type SortKey = 'relevance' | 'newest' | 'views' | 'rating'
type DurationKey = 'any' | 'short' | 'medium' | 'long'

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'views', label: 'Most viewed' },
  { value: 'rating', label: 'Top rated' },
]
const DURATIONS: Array<{ value: DurationKey; label: string }> = [
  { value: 'any', label: 'Any length' },
  { value: 'short', label: 'Under 2 min' },
  { value: 'medium', label: '2–10 min' },
  { value: 'long', label: '10+ min' },
]
const VIEW_STEPS = [0, 1000, 10000, 100000]
const SYNTAX_TIPS = ['tag:studio', 'duration:>2m', 'views:>1000', 'source:redgifs', 'creator:name']

function durationSeconds(value: string): number {
  const parts = value.split(':').map(Number)
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function isSortKey(value: string | null): value is SortKey {
  return SORTS.some((entry) => entry.value === value)
}
function isDurationKey(value: string | null): value is DurationKey {
  return DURATIONS.some((entry) => entry.value === value)
}
function formatViews(value: number): string {
  return value >= 1000 ? `${value / 1000}k+` : 'Any'
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''
  const typeParam = searchParams.get('type')
  const facet: MediaFacet = typeParam === 'video' || typeParam === 'photo' ? typeParam : 'all'
  const sourceFilter = searchParams.get('source')
  const sortParam = searchParams.get('sort')
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'relevance'
  const durParam = searchParams.get('dur')
  const duration: DurationKey = isDurationKey(durParam) ? durParam : 'any'
  const minViews = Number(searchParams.get('views')) || 0

  const [draft, setDraft] = useState(urlQuery)
  const [panelOpen, setPanelOpen] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [layout, setLayout] = useLayoutMode()

  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const setAppSearchQuery = useAppStore((s) => s.setSearchQuery)
  const gridDensity = useAppStore((s) => s.gridDensity)
  const setGridDensity = useAppStore((s) => s.setGridDensity)

  // URL is the source of truth for the active query (deep links work).
  // Render-phase state adjustment keeps draft/history in sync.
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery)
  if (prevUrlQuery !== urlQuery) {
    setPrevUrlQuery(urlQuery)
    setDraft(urlQuery)
    if (urlQuery.trim()) {
      const needle = urlQuery.trim()
      setHistory((prev) => [needle, ...prev.filter((entry) => entry.toLowerCase() !== needle.toLowerCase())].slice(0, MAX_HISTORY))
    }
  }

  // Mirror the active query into the persisted search field (external store).
  useEffect(() => {
    if (urlQuery.trim()) setAppSearchQuery(urlQuery.trim())
  }, [urlQuery, setAppSearchQuery])

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value && value.trim()) next.set(key, value.trim())
          else next.delete(key)
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )
  const setQuery = useCallback((value: string) => setParam('q', value), [setParam])

  // Pro syntax: operators (tag:, creator:, source:, duration:, views:, quality:)
  // are parsed out of the query. The free-text remainder goes to the server;
  // structured filters apply client-side. Operator-only queries filter the
  // already-loaded live feed instead of issuing a server search.
  const structured = useMemo(() => parseProQuery(urlQuery), [urlQuery])
  const hasOperators = Boolean(
    structured.source ||
      structured.creator ||
      structured.tag ||
      structured.minDuration !== undefined ||
      structured.maxDuration !== undefined ||
      structured.minViews !== undefined ||
      structured.quality
  )
  const serverTerm = hasOperators ? structured.text : urlQuery.trim().toLowerCase()

  // Server-side search: the free-text term is sent to the edge function.
  const searchQuery = useQuery({
    queryKey: ['search-media', serverTerm, creatorWatchlist],
    queryFn: () => searchMedia(serverTerm, { watchlist: creatorWatchlist }),
    enabled: serverTerm.length > 1,
    placeholderData: (previous) => previous,
  })

  // Trending tags from the live feed for the idle state.
  const discoveryQuery = useQuery({
    queryKey: ['live-discovery', creatorWatchlist],
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
  })

  const trendingTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of discoveryQuery.data?.items ?? []) {
      for (const tag of item.tags.slice(0, 4)) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag)
  }, [discoveryQuery.data])

  // Base results before the panel filters, so facet counts and source chips stay meaningful.
  const baseResults = useMemo(() => {
    let items = serverTerm.length > 1
      ? (searchQuery.data?.items ?? [])
      : hasOperators
        ? (discoveryQuery.data?.items ?? [])
        : []
    if (hasOperators) items = filterMedia(items, structured)
    return items
  }, [discoveryQuery.data, hasOperators, searchQuery.data, serverTerm, structured])

  const sources = useMemo(() => {
    const names = new Set<string>()
    for (const item of baseResults) names.add(item.source)
    return [...names]
  }, [baseResults])

  const afterPanel = useMemo(() => {
    let items = baseResults
    if (sourceFilter) items = items.filter((item) => item.source.toLowerCase() === sourceFilter.toLowerCase())
    if (duration !== 'any') {
      items = items.filter((item) => {
        if (!item.isVideo) return false
        const seconds = durationSeconds(item.duration)
        if (duration === 'short') return seconds < 120
        if (duration === 'medium') return seconds >= 120 && seconds <= 600
        return seconds > 600
      })
    }
    if (minViews > 0) items = items.filter((item) => item.views >= minViews)
    return items
  }, [baseResults, duration, minViews, sourceFilter])

  const facetCounts = useMemo(() => {
    const video = afterPanel.filter((item) => item.isVideo).length
    return { all: afterPanel.length, video, photo: afterPanel.length - video }
  }, [afterPanel])

  const results = useMemo(() => {
    let items = afterPanel
    if (facet === 'video') items = items.filter((item) => item.isVideo)
    else if (facet === 'photo') items = items.filter((item) => !item.isVideo)
    if (sort === 'relevance') return items
    const copy = [...items]
    if (sort === 'newest') copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    else if (sort === 'views') copy.sort((a, b) => b.views - a.views)
    else copy.sort((a, b) => b.rating - a.rating)
    return copy
  }, [afterPanel, facet, sort])

  const removeOperator = (prefix: string) => {
    const next = urlQuery
      .split(/\s+/)
      .filter((token) => !token.toLowerCase().startsWith(prefix))
      .join(' ')
    setDraft(next)
    setQuery(next)
  }

  const operatorChips = useMemo(() => {
    const chips: Array<{ label: string; prefix: string }> = []
    if (structured.source) chips.push({ label: `source:${structured.source}`, prefix: 'source:' })
    if (structured.creator) chips.push({ label: `creator:${structured.creator}`, prefix: 'creator:' })
    if (structured.tag) chips.push({ label: `tag:${structured.tag}`, prefix: 'tag:' })
    if (structured.minDuration !== undefined || structured.maxDuration !== undefined) chips.push({ label: 'duration filter', prefix: 'duration:' })
    if (structured.minViews !== undefined) chips.push({ label: `views:>${structured.minViews}`, prefix: 'views:' })
    if (structured.quality) chips.push({ label: `quality:${structured.quality}`, prefix: 'quality:' })
    return chips
  }, [structured])

  const panelFilterCount =
    (sourceFilter ? 1 : 0) + (duration !== 'any' ? 1 : 0) + (minViews > 0 ? 1 : 0) + (sort !== 'relevance' ? 1 : 0)
  const activeCount = panelFilterCount + (facet !== 'all' ? 1 : 0)

  const clearPanelFilters = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const key of ['type', 'source', 'sort', 'dur', 'views']) next.delete(key)
        return next
      },
      { replace: true }
    )
  }

  const searching = urlQuery.trim().length > 1
  const searchingServer = serverTerm.length > 1
  const loading = searchingServer ? searchQuery.isLoading : discoveryQuery.isLoading && hasOperators
  const openById = useCallback((id: string) => setSelectedItem(results.find((entry) => entry.id === id) ?? null), [results])
  const resetKey = `${urlQuery}|${facet}|${sourceFilter}|${sort}|${duration}|${minViews}`

  const submit = () => setQuery(draft)

  return (
    <div className="animate-page-enter d-page">
      <div className="d-hero">
        <p className="d-eyebrow">Search</p>
        <h1 className="d-page-title">Search the live archive</h1>
        <p className="d-hero-desc">Queries run against connected public sources — titles, creators, and tags.</p>

        <div className="d-field d-field-lg mt-6" style={{ maxWidth: 760 }}>
          <SearchIcon size={18} strokeWidth={1.75} aria-hidden="true" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            enterKeyHint="search"
            placeholder="Search — or filter: tag:jock duration:>2m views:>1000"
            aria-label="Search media and creators"
            className="d-input d-input-lg"
          />
          {draft && (
            <button
              onClick={() => {
                setDraft('')
                setQuery('')
              }}
              className="d-field-clear"
              aria-label="Clear search"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>

        <div className="d-chips mt-4" aria-label="Search operators">
          {SYNTAX_TIPS.map((tip) => (
            <button key={tip} className="chip" onClick={() => setDraft((value) => `${value.trim()} ${tip}`.trim())}>
              <Wand2 size={11} strokeWidth={1.75} aria-hidden="true" /> {tip}
            </button>
          ))}
        </div>
      </div>

      {!searching ? (
        <div className="space-y-8">
          {history.length > 0 && (
            <section>
              <div className="d-sec-head">
                <h2 className="d-eyebrow"><Clock3 size={12} strokeWidth={1.75} aria-hidden="true" /> Recent</h2>
                <button
                  onClick={() => {
                    setHistory([])
                    setAppSearchQuery('')
                  }}
                  className="d-link"
                >
                  <X size={12} strokeWidth={1.75} aria-hidden="true" /> Clear history
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((entry) => (
                  <button key={entry} onClick={() => setQuery(entry)} className="chip">
                    {entry}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <div className="d-sec-head">
              <h2 className="d-eyebrow"><TrendingUp size={12} strokeWidth={1.75} aria-hidden="true" /> Trending on the feed</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {trendingTags.length ? (
                trendingTags.map((tag) => (
                  <button key={tag} onClick={() => setQuery(tag)} className="chip">
                    #{tag}
                  </button>
                ))
              ) : (
                <p className="text-[13px] text-ink-3">Trends appear once the live feed connects.</p>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="d-toolbar" style={{ marginBottom: 0 }}>
            <button
              onClick={() => setPanelOpen((value) => !value)}
              className={cn('chip', panelOpen && 'chip-active')}
              aria-expanded={panelOpen}
              aria-controls="search-filter-panel"
            >
              <SlidersHorizontal size={13} strokeWidth={1.75} aria-hidden="true" /> Filters
              {panelFilterCount > 0 && <span className="d-badge-count">{panelFilterCount}</span>}
            </button>
            <FacetToggle
              value={facet}
              onChange={(value) => setParam('type', value === 'all' ? null : value)}
              counts={facetCounts}
            />
            <span className="d-toolbar-spacer" />
            <LayoutToggle value={layout} onChange={setLayout} />
            {layout !== 'list' && <DensityToggle value={gridDensity} onChange={setGridDensity} />}
          </div>

          {/* Advanced filters: glass panel, URL-synced */}
          <div className="d-fp" data-open={panelOpen} id="search-filter-panel" aria-hidden={!panelOpen} inert={!panelOpen}>
            <div>
              <div className="d-fp-inner">
                <div className="d-fp-group">
                  <h3>Sort by</h3>
                  <div className="d-chips">
                    {SORTS.map((entry) => (
                      <button
                        key={entry.value}
                        className={cn('chip', sort === entry.value && 'chip-active')}
                        aria-pressed={sort === entry.value}
                        onClick={() => setParam('sort', entry.value === 'relevance' ? null : entry.value)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="d-fp-group">
                  <h3>Duration</h3>
                  <div className="d-chips">
                    {DURATIONS.map((entry) => (
                      <button
                        key={entry.value}
                        className={cn('chip', duration === entry.value && 'chip-active')}
                        aria-pressed={duration === entry.value}
                        onClick={() => setParam('dur', entry.value === 'any' ? null : entry.value)}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="d-fp-group">
                  <h3>Minimum views</h3>
                  <div className="d-chips">
                    {VIEW_STEPS.map((step) => (
                      <button
                        key={step}
                        className={cn('chip', minViews === step && 'chip-active')}
                        aria-pressed={minViews === step}
                        onClick={() => setParam('views', step ? String(step) : null)}
                      >
                        {formatViews(step)}
                      </button>
                    ))}
                  </div>
                </div>
                {sources.length > 1 && (
                  <div className="d-fp-group">
                    <h3>Source</h3>
                    <div className="d-chips">
                      <button className={cn('chip', !sourceFilter && 'chip-active')} aria-pressed={!sourceFilter} onClick={() => setParam('source', null)}>
                        All sources
                      </button>
                      {sources.map((source) => (
                        <button
                          key={source}
                          className={cn('chip', sourceFilter?.toLowerCase() === source.toLowerCase() && 'chip-active')}
                          aria-pressed={sourceFilter?.toLowerCase() === source.toLowerCase()}
                          onClick={() => setParam('source', sourceFilter?.toLowerCase() === source.toLowerCase() ? null : source)}
                        >
                          {source}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Result summary + active filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2">
              {loading ? 'Searching…' : `${results.length} results for "${urlQuery}"`}
            </span>
            {operatorChips.map((chip) => (
              <button
                key={chip.prefix}
                onClick={() => removeOperator(chip.prefix)}
                className="chip chip-active"
                aria-label={`Remove ${chip.label} filter`}
                title="Remove filter"
              >
                {chip.label} <X size={11} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ))}
            {sourceFilter && (
              <button onClick={() => setParam('source', null)} className="chip chip-active" aria-label={`Remove source ${sourceFilter} filter`}>
                {sourceFilter} <X size={11} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            {duration !== 'any' && (
              <button onClick={() => setParam('dur', null)} className="chip chip-active" aria-label="Remove duration filter">
                {DURATIONS.find((entry) => entry.value === duration)?.label} <X size={11} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            {minViews > 0 && (
              <button onClick={() => setParam('views', null)} className="chip chip-active" aria-label="Remove minimum views filter">
                {formatViews(minViews)} views <X size={11} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
            {activeCount > 0 && (
              <button onClick={clearPanelFilters} className="d-link">
                Reset filters
              </button>
            )}
            <span className="ml-auto">
              <UpdatedChip updatedAt={discoveryQuery.data?.updatedAt ?? null} />
            </span>
          </div>

          {searchingServer && searchQuery.error ? (
            <StatePanel
              tone="error"
              icon={RefreshCw}
              title="Search failed"
              description="The live sources could not be reached. Try again."
              actionLabel="Retry"
              onAction={() => searchQuery.refetch()}
            />
          ) : !loading && results.length === 0 ? (
            <StatePanel
              icon={SearchIcon}
              title="No results"
              description={
                activeCount > 0
                  ? `Nothing matched "${urlQuery}" with these filters. Loosen a filter or broaden the term.`
                  : `Nothing matched "${urlQuery}" across the connected sources. Try a broader term.`
              }
              actionLabel={activeCount > 0 ? 'Reset filters' : 'Clear search'}
              onAction={() => {
                if (activeCount > 0) clearPanelFilters()
                else {
                  setDraft('')
                  setQuery('')
                }
              }}
              secondaryLabel={activeCount > 0 ? 'Clear search' : undefined}
              onSecondary={() => {
                setDraft('')
                setQuery('')
              }}
            />
          ) : (
            <MediaBrowser
              items={results}
              layout={layout}
              density={gridDensity}
              onSelect={openById}
              loading={loading}
              resetKey={resetKey}
              ariaLabel="Search results"
            />
          )}
        </div>
      )}

      <MediaDetail
        item={selectedItem}
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        items={results}
        onNavigate={setSelectedItem}
      />
    </div>
  )
}
