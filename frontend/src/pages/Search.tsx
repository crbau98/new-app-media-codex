import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Clock3, Grid3X3, List, RefreshCw, Search as SearchIcon, TrendingUp, X } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { fetchLiveDiscovery, searchMedia } from '@/lib/api'
import { relativeTime } from '@/lib/discovery'
import { filterMedia, parseProQuery } from '@/lib/proSearch'
import { useAppStore, type GridDensity } from '@/store'
import MediaCard from '@/components/MediaCard'
import MediaDetail from '@/components/MediaDetail'
import MediaImage from '@/components/MediaImage'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import UpdatedChip from '@/components/UpdatedChip'
import { cn } from '@/lib/utils'

const VISIBLE_INCREMENT = 24
const MAX_HISTORY = 8

const densityCols: Record<GridDensity, string> = {
  compact: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7',
  normal: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
  spacious: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5',
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''
  const [draft, setDraft] = useState(urlQuery)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [visibleCount, setVisibleCount] = useState(VISIBLE_INCREMENT)
  const [history, setHistory] = useState<string[]>([])
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)

  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const setAppSearchQuery = useAppStore((s) => s.setSearchQuery)
  const gridDensity = useAppStore((s) => s.gridDensity)

  // URL is the source of truth for the active query (deep links work).
  // Render-phase state adjustment keeps draft/pagination/history in sync.
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery)
  if (prevUrlQuery !== urlQuery) {
    setPrevUrlQuery(urlQuery)
    setDraft(urlQuery)
    setVisibleCount(VISIBLE_INCREMENT)
    if (urlQuery.trim()) {
      const needle = urlQuery.trim()
      setHistory((prev) => [needle, ...prev.filter((entry) => entry.toLowerCase() !== needle.toLowerCase())].slice(0, MAX_HISTORY))
    }
  }

  // Mirror the active query into the persisted search field (external store).
  useEffect(() => {
    if (urlQuery.trim()) setAppSearchQuery(urlQuery.trim())
  }, [urlQuery, setAppSearchQuery])

  const setQuery = (value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value.trim()) next.set('q', value.trim())
        else next.delete('q')
        return next
      },
      { replace: true }
    )
  }

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
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag)
  }, [discoveryQuery.data])

  const sources = useMemo(() => {
    const names = new Set<string>()
    for (const item of searchQuery.data?.items ?? []) names.add(item.source)
    return [...names]
  }, [searchQuery.data])

  const results = useMemo(() => {
    let items = serverTerm.length > 1
      ? (searchQuery.data?.items ?? [])
      : hasOperators
        ? (discoveryQuery.data?.items ?? [])
        : []
    if (hasOperators) items = filterMedia(items, structured)
    if (sourceFilter) items = items.filter((item) => item.source.toLowerCase() === sourceFilter.toLowerCase())
    return items
  }, [discoveryQuery.data, hasOperators, searchQuery.data, serverTerm, sourceFilter, structured])

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

  const visibleItems = results.slice(0, visibleCount)
  const hasMore = visibleCount < results.length

  const searching = urlQuery.trim().length > 1
  const searchingServer = serverTerm.length > 1
  const loading = searchingServer ? searchQuery.isLoading : discoveryQuery.isLoading

  return (
    <div className="animate-page-enter space-y-6">
      <div className="border-b border-line pb-5">
        <p className="eyebrow">Search</p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-ink">Search the live archive</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          Queries run against connected public sources — titles, creators, and tags.
        </p>
      </div>

      {/* Input */}
      <div className="relative max-w-2xl">
        <SearchIcon size={16} strokeWidth={1.75} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setQuery(draft)
          }}
          placeholder="Search — or filter: tag:jock duration:>2m views:>1000"
          aria-label="Search media and creators"
          className="h-12 w-full rounded-md border border-line bg-elevated pl-11 pr-12 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
        />
        {draft && (
          <button
            onClick={() => {
              setDraft('')
              setQuery('')
            }}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-ink-3 hover:text-ink"
            aria-label="Clear search"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {!searching ? (
        <div className="space-y-6">
          {history.length > 0 && (
            <section>
              <h2 className="eyebrow flex items-center gap-1.5"><Clock3 size={12} strokeWidth={1.75} aria-hidden="true" /> Recent</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {history.map((entry) => (
                  <button key={entry} onClick={() => setQuery(entry)} className="chip">
                    {entry}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setHistory([])
                    setAppSearchQuery('')
                  }}
                  className="inline-flex min-h-10 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink"
                >
                  <X size={12} strokeWidth={1.75} aria-hidden="true" /> Clear history
                </button>
              </div>
            </section>
          )}
          <section>
            <h2 className="eyebrow flex items-center gap-1.5"><TrendingUp size={12} strokeWidth={1.75} aria-hidden="true" /> Trending on the feed</h2>
            <div className="mt-3 flex flex-wrap gap-2">
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
          {/* Meta + filters */}
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
            <UpdatedChip updatedAt={discoveryQuery.data?.updatedAt ?? null} />
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setViewMode('grid')}
                className={cn('grid h-10 w-10 place-items-center rounded-md', viewMode === 'grid' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink')}
                aria-label="Grid view"
                aria-pressed={viewMode === 'grid'}
              >
                <Grid3X3 size={16} strokeWidth={1.75} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn('grid h-10 w-10 place-items-center rounded-md', viewMode === 'list' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink')}
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
              >
                <List size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          {sources.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSourceFilter(null)}
                className={cn('chip', !sourceFilter && 'chip-active')}
                aria-pressed={!sourceFilter}
              >
                All sources
              </button>
              {sources.map((source) => (
                <button
                  key={source}
                  onClick={() => setSourceFilter(sourceFilter === source ? null : source)}
                  className={cn('chip', sourceFilter === source && 'chip-active')}
                  aria-pressed={sourceFilter === source}
                >
                  {source}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <SkeletonGrid count={8} />
          ) : searchingServer && searchQuery.error ? (
            <EmptyState
              icon={RefreshCw}
              title="Search failed"
              description="The live sources could not be reached. Try again."
              actionLabel="Retry"
              onAction={() => searchQuery.refetch()}
            />
          ) : results.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No results"
              description={`Nothing matched "${urlQuery}" across the connected sources. Try a broader term.`}
              actionLabel="Clear search"
              onAction={() => {
                setDraft('')
                setQuery('')
              }}
            />
          ) : viewMode === 'grid' ? (
            <>
              <div className={cn('media-grid grid gap-4', densityCols[gridDensity])}>
                {visibleItems.map((item) => (
                  <MediaCard key={item.id} item={item} aspectRatio="2/3" onSelect={(id) => setSelectedItem(results.find((entry) => entry.id === id) ?? null)} />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <button onClick={() => setVisibleCount((count) => count + VISIBLE_INCREMENT)} className="btn-secondary">
                    Show more ({results.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="divide-y divide-line border-y border-line">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="flex w-full items-center gap-4 py-3 text-left transition-colors hover:bg-sunken/50"
                  aria-label={`Open ${item.title}`}
                >
                  <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded-sm bg-sunken">
                    <MediaImage
                      sources={item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      skeletonClassName="absolute inset-0"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                    <span className="mono-meta mt-0.5 block uppercase">
                      {item.source} · {relativeTime(item.createdAt)} · {item.isVideo ? item.duration || 'video' : 'photo'}
                    </span>
                  </span>
                  <span className="mono-meta hidden shrink-0 sm:block">@{item.creator}</span>
                </button>
              ))}
              {hasMore && (
                <div className="flex justify-center py-5">
                  <button onClick={() => setVisibleCount((count) => count + VISIBLE_INCREMENT)} className="btn-secondary">
                    Show more ({results.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </div>
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
