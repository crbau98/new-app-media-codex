import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  Dice5,
  RefreshCw,
  Search,
  Grid3X3,
  List,
  Play,
  Image as ImageIcon,
  X,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import type { Creator, MediaItem } from '@/lib/types'
import { fetchLiveDiscovery } from '@/lib/api'
import { relativeTime } from '@/lib/discovery'
import { useAppStore, type GridDensity } from '@/store'
import MediaCard from '@/components/MediaCard'
import MediaImage from '@/components/MediaImage'
import Hero from '@/components/Hero'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import UpdatedChip from '@/components/UpdatedChip'
import { cn } from '@/lib/utils'

const MediaDetail = lazy(() => import('@/components/MediaDetail'))
const CreatorDrawer = lazy(() => import('@/components/CreatorDrawer'))

const VISIBLE_INCREMENT = 24
const PRIORITY_CARD_COUNT = 4

const densityCols: Record<GridDensity, string> = {
  compact: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7',
  normal: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
  spacious: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5',
}

export default function Home() {
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [activeCreator, setActiveCreator] = useState<Creator | null>(null)
  const [filter, setFilter] = useState<'all' | 'video' | 'photo'>('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [visibleCount, setVisibleCount] = useState(VISIBLE_INCREMENT)
  const [homeQuery, setHomeQuery] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const category = searchParams.get('category')

  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const likeCache = useAppStore((s) => s.likeCache)
  const gridDensity = useAppStore((s) => s.gridDensity)
  const addToast = useAppStore((s) => s.addToast)
  const navigate = useNavigate()

  // Home is the ONLY surface that polls (every 2 minutes). placeholderData keeps
  // the previous result visible while a background refetch is in flight.
  const discoveryQuery = useQuery({
    queryKey: ['live-discovery', creatorWatchlist],
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
    refetchInterval: 120000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  })
  const discovery = discoveryQuery.data

  const allItems = useMemo(() => discovery?.items ?? [], [discovery])
  const creators = useMemo(() => discovery?.performers ?? [], [discovery])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of allItems) {
      if (item.category) counts.set(item.category, (counts.get(item.category) || 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [allItems])

  const heroItems = useMemo(
    () => [...allItems].sort((a, b) => (b.curationScore || 0) - (a.curationScore || 0)).slice(0, 5),
    [allItems]
  )

  const filteredItems = useMemo(() => {
    let result = allItems.map((item) => (likeCache[item.id] !== undefined ? { ...item, isLiked: likeCache[item.id] } : item))
    if (filter === 'video') result = result.filter((item) => item.isVideo)
    else if (filter === 'photo') result = result.filter((item) => !item.isVideo)
    if (category) result = result.filter((item) => item.category === category || item.tags.includes(category))
    const needle = homeQuery.trim().toLowerCase()
    if (needle) {
      result = result.filter(
        (item) =>
          item.title.toLowerCase().includes(needle) ||
          item.creator.toLowerCase().includes(needle) ||
          item.tags.some((tag) => tag.toLowerCase().includes(needle))
      )
    }
    return result
  }, [allItems, category, filter, homeQuery, likeCache])

  // Reset pagination whenever the filter context changes (render-phase adjustment)
  const filterKey = `${filter}|${category ?? ''}|${homeQuery}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (lastFilterKey !== filterKey) {
    setLastFilterKey(filterKey)
    setVisibleCount(VISIBLE_INCREMENT)
  }

  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount])
  const hasMore = visibleCount < filteredItems.length

  const openDetail = useCallback((id: string) => {
    const item = allItems.find((entry) => entry.id === id)
    if (item) setSelectedItem(item)
  }, [allItems])

  const surprise = useCallback(() => {
    if (!filteredItems.length) {
      addToast({ type: 'info', title: 'Nothing to surprise you with yet', message: 'Try clearing filters or check back shortly.' })
      return
    }
    const pick = filteredItems[Math.floor(Math.random() * filteredItems.length)]
    setSelectedItem(pick)
  }, [addToast, filteredItems])

  const setCategory = useCallback(
    (value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (value) next.set('category', value)
          else next.delete('category')
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  return (
    <div className="animate-page-enter space-y-8">
      {/* Cinematic hero */}
      <Hero
        items={heroItems}
        loading={discoveryQuery.isLoading}
        error={discoveryQuery.error}
        onRetry={() => discoveryQuery.refetch()}
        onSelect={setSelectedItem}
      />

      {/* Status strip: real counts only */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
        <UpdatedChip updatedAt={discovery?.updatedAt ?? null} />
        {discovery && (
          <>
            <span>{allItems.length} items</span>
            <span>{creators.length} creators</span>
            <span>{discovery.sources.filter((s) => s.state === 'connected').length}/{discovery.sources.length} sources connected</span>
          </>
        )}
        {discoveryQuery.isFetching && !discoveryQuery.isLoading && (
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <RefreshCw size={11} className="animate-spin" aria-hidden="true" /> Refreshing
          </span>
        )}
      </div>

      {/* Creators rail → opens the creator's drawer */}
      {creators.length > 0 && (
        <section aria-label="Creators on the feed">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="eyebrow">On the feed</h2>
            <button
              onClick={() => navigate('/creators')}
              className="inline-flex min-h-10 items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 hover:text-ink"
            >
              All creators <ArrowRight size={12} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <div className="hide-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
            {creators.slice(0, 14).map((creator) => (
              <button
                key={creator.id}
                onClick={() => setActiveCreator(creator)}
                className="flex w-16 shrink-0 flex-col items-center gap-2 tap-highlight-none"
                aria-label={`Open creator ${creator.name}`}
              >
                <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-full border border-line bg-sunken transition-colors hover:border-line-strong">
                  {creator.avatar ? (
                    <img src={creator.avatar} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="font-mono text-sm text-ink-2">{creator.name.charAt(0).toUpperCase()}</span>
                  )}
                </span>
                <span className="w-full truncate text-center font-mono text-[9px] uppercase tracking-[0.04em] text-ink-3">
                  {creator.username || creator.name}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Library */}
      <section aria-label="Media library">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="eyebrow">Library</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setViewMode('grid')}
              className={cn('grid h-10 w-10 place-items-center rounded-md transition-colors', viewMode === 'grid' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <Grid3X3 size={16} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn('grid h-10 w-10 place-items-center rounded-md transition-colors', viewMode === 'list' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <List size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input
              value={homeQuery}
              onChange={(event) => setHomeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && homeQuery.trim()) navigate(`/search?q=${encodeURIComponent(homeQuery.trim())}`)
              }}
              placeholder="Filter this feed"
              aria-label="Filter media on this page"
              className="h-10 w-52 rounded-md border border-line bg-transparent pl-9 pr-8 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
            />
            {homeQuery && (
              <button
                onClick={() => setHomeQuery('')}
                className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-ink-3 hover:text-ink"
                aria-label="Clear filter"
              >
                <X size={13} strokeWidth={1.75} />
              </button>
            )}
          </div>

          {(['all', 'video', 'photo'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn('chip', filter === value && 'chip-active')}
              aria-pressed={filter === value}
            >
              {value === 'video' && <Play size={12} strokeWidth={1.75} aria-hidden="true" />}
              {value === 'photo' && <ImageIcon size={12} strokeWidth={1.75} aria-hidden="true" />}
              {value}
            </button>
          ))}

          {categories.map(({ name }) => (
            <button
              key={name}
              onClick={() => setCategory(category === name ? null : name)}
              className={cn('chip', category === name && 'chip-active')}
              aria-pressed={category === name}
            >
              {name}
            </button>
          ))}

          {(category || filter !== 'all' || homeQuery) && (
            <button
              onClick={() => {
                setCategory(null)
                setFilter('all')
                setHomeQuery('')
              }}
              className="inline-flex min-h-10 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 hover:text-ink"
            >
              <X size={12} strokeWidth={1.75} aria-hidden="true" /> Clear
            </button>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button onClick={surprise} className="btn-secondary min-h-10 px-3" aria-label="Surprise me">
              <Dice5 size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="hidden sm:inline">Surprise</span>
            </button>
          </div>
        </div>

        {/* Grid / list */}
        {discoveryQuery.isLoading ? (
          <SkeletonGrid count={12} />
        ) : discoveryQuery.error ? (
          <EmptyState
            icon={RefreshCw}
            title="The live archive could not be reached"
            description="Check your connection and try again. Nothing here is cached client-side."
            actionLabel="Retry"
            onAction={() => discoveryQuery.refetch()}
          />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No media matches"
            description="Try removing a filter or category to widen the archive view."
            actionLabel="Clear filters"
            onAction={() => {
              setCategory(null)
              setFilter('all')
              setHomeQuery('')
            }}
          />
        ) : viewMode === 'grid' ? (
          <>
            <div className={cn('media-grid grid gap-4', densityCols[gridDensity])}>
              {visibleItems.map((item, itemIndex) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  aspectRatio="2/3"
                  onSelect={openDetail}
                  priority={itemIndex < PRIORITY_CARD_COUNT}
                />
              ))}
            </div>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button onClick={() => setVisibleCount((count) => count + VISIBLE_INCREMENT)} className="btn-secondary">
                  Show more ({filteredItems.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                onClick={() => openDetail(item.id)}
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
                  Show more ({filteredItems.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Why these — explainable ordering, restyled as a mono strip */}
        {visibleItems.length > 0 && (
          <div className="mt-8 rounded-md border border-line p-4">
            <p className="eyebrow flex items-center gap-1.5">
              <Sparkles size={12} strokeWidth={1.75} aria-hidden="true" /> Why these
            </p>
            <p className="mt-2 text-[13px] leading-5 text-ink-2">
              Ordered by public engagement signals and freshness from connected sources. No private
              data leaves this device — your follows and likes only re-rank items locally.
            </p>
          </div>
        )}
      </section>

      <Suspense fallback={null}>
        {selectedItem && (
          <MediaDetail
            item={selectedItem}
            open={Boolean(selectedItem)}
            onClose={() => setSelectedItem(null)}
            items={filteredItems}
            onNavigate={setSelectedItem}
          />
        )}
        {activeCreator && (
          <CreatorDrawer creator={activeCreator} onClose={() => setActiveCreator(null)} />
        )}
      </Suspense>
    </div>
  )
}
