import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Camera, Dice5, Flame, RefreshCw, Search, Sparkles, Users, X } from 'lucide-react'
import type { Creator, MediaItem } from '@/lib/types'
import { fetchLiveDiscovery } from '@/lib/api'
import { creatorFollowId } from '@/lib/discovery'
import { useAppStore } from '@/store'
import Hero from '@/components/Hero'
import UpdatedChip from '@/components/UpdatedChip'
import ForYouRail from '@/components/ForYouRail'
import ContinueWatchingRail from '@/components/ContinueWatchingRail'
import CollectionsRail from '@/components/CollectionsRail'
import MediaBrowser from '@/components/discovery/MediaBrowser'
import MediaRail from '@/components/discovery/MediaRail'
import TopPicksShelf from '@/components/discovery/TopPicksShelf'
import Rail from '@/components/discovery/Rail'
import SectionHeader from '@/components/discovery/SectionHeader'
import StatePanel from '@/components/discovery/StatePanel'
import { StoryRing } from '@/components/discovery/CreatorParts'
import { DensityToggle, FacetToggle, LayoutToggle, type MediaFacet } from '@/components/discovery/Controls'
import { useLayoutMode } from '@/components/discovery/prefs'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

const MediaDetail = lazy(() => import('@/components/MediaDetail'))
const CreatorDrawer = lazy(() => import('@/components/CreatorDrawer'))

export default function Home() {
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [activeCreator, setActiveCreator] = useState<Creator | null>(null)
  const [facet, setFacet] = useState<MediaFacet>('all')
  const [homeQuery, setHomeQuery] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const category = searchParams.get('category')
  const [layout, setLayout] = useLayoutMode()

  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const likeCache = useAppStore((s) => s.likeCache)
  const followCache = useAppStore((s) => s.followCache)
  const gridDensity = useAppStore((s) => s.gridDensity)
  const setGridDensity = useAppStore((s) => s.setGridDensity)
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
      .slice(0, 10)
  }, [allItems])

  const byScore = useMemo(() => [...allItems].sort((a, b) => (b.curationScore || 0) - (a.curationScore || 0)), [allItems])
  const heroItems = useMemo(() => byScore.slice(0, 5), [byScore])
  const topPicks = useMemo(() => (byScore.length >= 12 ? byScore.slice(5, 15) : byScore.slice(0, 10)), [byScore])
  const trending = useMemo(
    () => allItems.filter((item) => item.isTrending).sort((a, b) => b.views - a.views).slice(0, 14),
    [allItems]
  )
  const photoSets = useMemo(() => allItems.filter((item) => !item.isVideo).slice(0, 14), [allItems])

  // Facet counts respect the category + text filters so the numbers match what the grid would show.
  const scopedItems = useMemo(() => {
    let result = allItems.map((item) => (likeCache[item.id] !== undefined ? { ...item, isLiked: likeCache[item.id] } : item))
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
  }, [allItems, category, homeQuery, likeCache])

  const facetCounts = useMemo(() => {
    const video = scopedItems.filter((item) => item.isVideo).length
    return { all: scopedItems.length, video, photo: scopedItems.length - video }
  }, [scopedItems])

  const filteredItems = useMemo(() => {
    if (facet === 'video') return scopedItems.filter((item) => item.isVideo)
    if (facet === 'photo') return scopedItems.filter((item) => !item.isVideo)
    return scopedItems
  }, [facet, scopedItems])

  const openDetail = useCallback(
    (id: string) => {
      const item = allItems.find((entry) => entry.id === id)
      if (item) setSelectedItem(item)
    },
    [allItems]
  )

  const surprise = useCallback(() => {
    if (!filteredItems.length) {
      addToast({ type: 'info', title: 'Nothing to surprise you with yet', message: 'Try clearing filters or check back shortly.' })
      return
    }
    setSelectedItem(filteredItems[Math.floor(Math.random() * filteredItems.length)])
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

  const clearFilters = useCallback(() => {
    setCategory(null)
    setFacet('all')
    setHomeQuery('')
  }, [setCategory])

  const filtersActive = Boolean(category || facet !== 'all' || homeQuery)
  const resetKey = `${facet}|${category ?? ''}|${homeQuery}`
  const selectItem = useCallback((item: MediaItem) => setSelectedItem(item), [])
  const openCreator = useCallback((creator: Creator) => setActiveCreator(creator), [])

  return (
    <div className="animate-page-enter d-page">
      {/* Cinematic hero */}
      <Hero
        items={heroItems}
        loading={discoveryQuery.isLoading}
        error={discoveryQuery.error}
        onRetry={() => discoveryQuery.refetch()}
        onSelect={setSelectedItem}
      />

      {/* Status strip: real counts only */}
      <div className="d-strip" style={{ marginTop: -16 }}>
        <UpdatedChip updatedAt={discovery?.updatedAt ?? null} />
        {discovery && (
          <>
            <span><b>{allItems.length}</b> items</span>
            <span><b>{creators.length}</b> creators</span>
            <span><b>{discovery.sources.filter((s) => s.state === 'connected').length}</b> live sources</span>
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
          <SectionHeader
            title="On the feed"
            eyebrow="Creators"
            icon={<Users size={12} strokeWidth={1.75} aria-hidden="true" />}
            actionLabel="All creators"
            onAction={() => navigate('/creators')}
          />
          <Rail ariaLabel="Creators on the feed">
            {creators.slice(0, 16).map((creator) => (
              <StoryRing
                key={creator.id}
                creator={creator}
                followed={Boolean(followCache[creatorFollowId(creator.name)])}
                onOpen={openCreator}
              />
            ))}
          </Rail>
        </section>
      )}

      {/* 3D depth-stacked shelf */}
      <TopPicksShelf items={topPicks} onSelect={selectItem} />

      {/* Private rails: resume + on-device recommendations. Render nothing without local signals. */}
      <ContinueWatchingRail items={allItems} onSelect={setSelectedItem} />
      <ForYouRail items={allItems} onSelect={setSelectedItem} />
      {trending.length >= 4 && (
        <MediaRail
          title="Trending now"
          eyebrow="Rising on public sources"
          icon={<Flame size={12} strokeWidth={1.75} aria-hidden="true" />}
          items={trending}
          onSelect={selectItem}
          variant="wide"
        />
      )}
      {photoSets.length >= 4 && (
        <MediaRail
          title="Photo sets"
          eyebrow="Stills & galleries"
          icon={<Camera size={12} strokeWidth={1.75} aria-hidden="true" />}
          items={photoSets}
          onSelect={selectItem}
          actionLabel="All photos"
          onAction={() => setFacet('photo')}
        />
      )}
      <CollectionsRail items={allItems} onSelect={setSelectedItem} />

      {/* Library */}
      <section aria-label="Media library">
        <SectionHeader title="Library" eyebrow="Everything, filterable" />

        <div className="d-toolbar">
          <div className="d-field">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <input
              value={homeQuery}
              onChange={(event) => setHomeQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && homeQuery.trim()) navigate(`/search?q=${encodeURIComponent(homeQuery.trim())}`)
              }}
              placeholder="Filter this feed"
              aria-label="Filter media on this page"
              className="d-input"
            />
            {homeQuery && (
              <button onClick={() => setHomeQuery('')} className="d-field-clear" aria-label="Clear filter">
                <X size={14} strokeWidth={1.75} />
              </button>
            )}
          </div>

          <FacetToggle value={facet} onChange={setFacet} counts={facetCounts} />

          <span className="d-toolbar-spacer" />

          <LayoutToggle value={layout} onChange={setLayout} />
          {layout !== 'list' && <DensityToggle value={gridDensity} onChange={setGridDensity} />}
          <button onClick={surprise} className="btn-secondary" aria-label="Surprise me">
            <Dice5 size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="hidden sm:inline">Surprise</span>
          </button>

          {(categories.length > 0 || filtersActive) && (
            <div className="d-chips" style={{ flexBasis: '100%' }}>
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
              {filtersActive && (
                <button onClick={clearFilters} className="chip">
                  <X size={12} strokeWidth={1.75} aria-hidden="true" /> Clear
                </button>
              )}
            </div>
          )}
        </div>

        {discoveryQuery.error && !discovery ? (
          <StatePanel
            tone="error"
            icon={RefreshCw}
            title="The live archive could not be reached"
            description="Check your connection and try again. Nothing here is cached client-side."
            actionLabel="Retry"
            onAction={() => discoveryQuery.refetch()}
          />
        ) : !discoveryQuery.isLoading && filteredItems.length === 0 ? (
          <StatePanel
            icon={Search}
            title="No media matches"
            description="Try removing a filter or category to widen the archive view."
            actionLabel="Clear filters"
            onAction={clearFilters}
          />
        ) : (
          <MediaBrowser
            items={filteredItems}
            layout={layout}
            density={gridDensity}
            onSelect={openDetail}
            loading={discoveryQuery.isLoading}
            resetKey={resetKey}
            ariaLabel="Media library"
          />
        )}

        {/* Why these — explainable ordering */}
        {filteredItems.length > 0 && (
          <div className="d-panel mt-10">
            <p className="d-eyebrow">
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
