import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBrowseItems, useUpdateItem } from '@/hooks/useItems'
import { useAppStore } from '@/store'
import type { Filters } from '@/store'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { SkeletonCard } from '@/components/Skeleton'
import { SwipeableCard } from '@/components/SwipeableCard'
import { api } from '@/lib/api'
import type { BrowseItemsPayload } from '@/lib/api'
import { cn } from '@/lib/cn'
import { SourceCard } from './SourceCard'
import type { Density } from './SourceCard'
import { FiltersBar } from './FiltersBar'
import { BulkBar } from './BulkBar'
import { ComparisonView } from './ComparisonView'
import { ItemDrawer } from './ItemDrawer'
import { DuplicateReview } from './DuplicateReview'
import { TimelineView } from './TimelineView'

type ViewMode = 'grid' | 'timeline'

function getStoredViewMode(): ViewMode {
  const v = localStorage.getItem('items-view-mode')
  return v === 'timeline' ? 'timeline' : 'grid'
}

const PAGE_SIZE = 25

function ExportMenu({ filters }: { filters: Filters }) {
  const [open, setOpen] = useState(false)
  const params: Record<string, string | number | boolean> = {}
  if (filters.theme) params.theme = filters.theme
  if (filters.sourceType) params.source_type = filters.sourceType
  if (filters.reviewStatus) params.review_status = filters.reviewStatus
  if (filters.savedOnly) params.saved_only = true
  if (filters.queuedOnly) params.queued_only = true
  if (filters.search) params.search = filters.search
  if (filters.sort) params.sort = filters.sort
  if (filters.compound) params.compound = filters.compound
  if (filters.mechanism) params.mechanism = filters.mechanism
  if (filters.dateFrom) params.date_from = filters.dateFrom
  if (filters.dateTo) params.date_to = filters.dateTo
  if (filters.tag) params.tag = filters.tag
  if (filters.minScore) params.min_score = filters.minScore

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-bg-subtle border border-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors"
        aria-label="Export items"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[130px] rounded-lg border border-border bg-bg-surface shadow-lg py-1">
            <a
              href={api.exportItemsUrl('csv', params)}
              download
              className="block px-4 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors"
              onClick={() => setOpen(false)}
            >
              Export CSV
            </a>
            <a
              href={api.exportItemsUrl('json', params)}
              download
              className="block px-4 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors"
              onClick={() => setOpen(false)}
            >
              Export JSON
            </a>
          </div>
        </>
      )}
    </div>
  )
}

export function ItemsPage() {
  const filters = useAppStore((s) => s.filters)
  const selectedItemId = useAppStore((s) => s.selectedItemId)
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const addToast = useAppStore((s) => s.addToast)
  const [page, setPage] = useState(0)
  const [density, setDensity] = useState<Density>('comfortable')
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [viewMode, setViewModeState] = useState<ViewMode>(getStoredViewMode)

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    localStorage.setItem('items-view-mode', mode)
  }, [])

  // Track which item IDs the user has clicked (visited), purely client-side
  const [visitedIds, setVisitedIds] = useState<Set<number>>(new Set())

  const qc = useQueryClient()

  // Reset to first page whenever filters change to avoid stale offsets
  useEffect(() => {
    setPage(0)
    setFocusedIdx(0)
  }, [filters])

  // Reset focused item whenever the page changes
  useEffect(() => {
    setFocusedIdx(0)
  }, [page])

  // Record lastVisit so SourceCard can highlight items added since the previous visit
  useEffect(() => {
    localStorage.setItem('lastVisit', new Date().toISOString())
  }, [])

  // Build params for the API, stripping empty/default values (memoized to avoid query key churn)
  const params = useMemo(() => {
    const p: Record<string, string | number | boolean> = {
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }
    if (filters.search) p.search = filters.search
    if (filters.sourceType) p.source_type = filters.sourceType
    if (filters.reviewStatus) p.review_status = filters.reviewStatus
    if (filters.savedOnly) p.saved_only = true
    if (filters.queuedOnly) { p.queued_only = true; p.sort = 'queue' }
    if (filters.sort && filters.sort !== 'newest' && !filters.queuedOnly) p.sort = filters.sort
    if (filters.theme) p.theme = filters.theme
    if (filters.compound) p.compound = filters.compound
    if (filters.mechanism) p.mechanism = filters.mechanism
    if (filters.dateFrom) p.date_from = filters.dateFrom
    if (filters.dateTo) p.date_to = filters.dateTo
    if (filters.tag) p.tag = filters.tag
    if (filters.minScore) p.min_score = parseFloat(filters.minScore)
    return p
  }, [filters, page])

  const collectionId = filters.collectionId ? Number(filters.collectionId) : null
  const browseQuery = useBrowseItems(params)
  const collectionQuery = useQuery({
    queryKey: ['collection-items', collectionId, page],
    queryFn: () => api.collectionItems(collectionId!, { offset: page * PAGE_SIZE, limit: PAGE_SIZE }),
    enabled: collectionId != null,
    placeholderData: (prev: BrowseItemsPayload | undefined) => prev,
  })
  const { data, isLoading, isFetching } = collectionId ? collectionQuery : browseQuery

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [compareIds, setCompareIds] = useState<number[] | null>(null)
  const [showDuplicates, setShowDuplicates] = useState(false)

  const dupQuery = useQuery({
    queryKey: ['duplicates'],
    queryFn: () => api.duplicates(),
    staleTime: 60_000,
  })
  const dupCount = dupQuery.data?.total_groups ?? 0

  const toggleSelect = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const update = useUpdateItem()
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  // hasNextPage: if the server returned a full page, there might be more
  const hasNextPage = items.length === PAGE_SIZE
  const hasMore = page * PAGE_SIZE + items.length < total
  const itemIds = items.map((i) => i.id)
  const currentIndex = items.findIndex((i) => i.id === selectedItemId)

  const hasActiveFilters = !!(
    filters.search ||
    filters.theme ||
    filters.sourceType ||
    filters.reviewStatus ||
    filters.compound ||
    filters.mechanism ||
    filters.savedOnly ||
    filters.queuedOnly ||
    filters.tag ||
    filters.collectionId ||
    filters.minScore
  )

  // Intersection observer sentinel ref for auto load-more
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetching && hasNextPage) {
          setPage((p) => p + 1)
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isFetching, hasNextPage])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't fire if user is typing in an input
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (commandPaletteOpen) return
      // Don't fire if the drawer is open — let ItemDrawer handle keyboard
      if (selectedItemId != null) return
      const currentItems = data?.items ?? []
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIdx((i) => Math.min(i + 1, currentItems.length - 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        const item = currentItems[focusedIdx]
        if (item) setSelectedItemId(item.id)
      } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
        const item = currentItems[focusedIdx]
        if (item) {
          api.updateItem(item.id, { is_saved: !item.is_saved }).then(() => {
            qc.invalidateQueries({ queryKey: ['items'] })
            addToast(item.is_saved ? 'Unsaved' : 'Saved')
          })
        }
      } else if (e.key === 'e') {
        const item = currentItems[focusedIdx]
        if (item) {
          api.updateItem(item.id, { review_status: 'archived' }).then(() => {
            qc.invalidateQueries({ queryKey: ['items'] })
            addToast('Archived')
          })
        }
      } else if (e.key === 'q') {
        const item = currentItems[focusedIdx]
        if (item) {
          const isQueued = !!item.queued_at
          api.updateItem(item.id, { queued_at: isQueued ? null : new Date().toISOString() }).then(() => {
            qc.invalidateQueries({ queryKey: ['items'] })
            qc.invalidateQueries({ queryKey: ['queue-count'] })
            addToast(isQueued ? 'Removed from queue' : 'Added to queue')
          })
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [focusedIdx, data, setSelectedItemId, selectedItemId, commandPaletteOpen, qc, addToast])

  // Auto-scroll focused card into view when focusedIdx changes
  useEffect(() => {
    const currentItems = data?.items ?? []
    const item = currentItems[focusedIdx]
    if (item == null) return
    const el = document.querySelector(`[data-item-id="${item.id}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIdx, data])

  const handleCardClick = useCallback((itemId: number, idx: number) => {
    setFocusedIdx(idx)
    setSelectedItemId(itemId)
    setVisitedIds((prev) => {
      if (prev.has(itemId)) return prev
      const next = new Set(prev)
      next.add(itemId)
      return next
    })
  }, [setSelectedItemId])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <FiltersBar />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* View mode toggle: Grid | Timeline */}
          <div className="flex items-center rounded-lg border border-border bg-bg-subtle overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'px-2.5 py-2 transition-colors',
                viewMode === 'grid'
                  ? 'text-accent bg-accent/10'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
              )}
              title="Grid view"
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="2" width="14" height="5" rx="1.5"/><rect x="1" y="9" width="14" height="5" rx="1.5"/></svg>
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={cn(
                'px-2.5 py-2 transition-colors',
                viewMode === 'timeline'
                  ? 'text-accent bg-accent/10'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
              )}
              title="Timeline view"
              aria-label="Timeline view"
              aria-pressed={viewMode === 'timeline'}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="4" y1="2" x2="4" y2="14"/><circle cx="4" cy="4" r="1.5"/><line x1="5.5" y1="4" x2="14" y2="4"/><circle cx="4" cy="9" r="1.5"/><line x1="5.5" y1="9" x2="12" y2="9"/><circle cx="4" cy="13" r="1.5" fill="none"/></svg>
            </button>
          </div>
          {/* Density switcher with SVG icons */}
          <div className="flex items-center rounded-lg border border-border bg-bg-subtle overflow-hidden">
            {([
              { d: 'compact', title: 'Compact', icon: (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="1" y1="4" x2="15" y2="4"/><line x1="1" y1="8" x2="15" y2="8"/><line x1="1" y1="12" x2="15" y2="12"/></svg>
              )},
              { d: 'comfortable', title: 'Comfortable', icon: (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="2" width="14" height="5" rx="1.5"/><rect x="1" y="9" width="14" height="5" rx="1.5"/></svg>
              )},
              { d: 'spacious', title: 'Spacious', icon: (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="1" width="14" height="6" rx="1.5"/><rect x="1" y="9" width="14" height="6" rx="1.5"/></svg>
              )},
            ] as { d: Density; title: string; icon: React.ReactNode }[]).map(({ d, title, icon }) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={cn(
                  'px-2.5 py-2 transition-colors',
                  density === d
                    ? 'text-accent bg-accent/10'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-elevated',
                )}
                title={title}
                aria-label={`Card density: ${d}`}
                aria-pressed={density === d}
              >
                {icon}
              </button>
            ))}
          </div>
          {dupCount > 0 && (
            <button
              onClick={() => setShowDuplicates(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="8" y="2" width="13" height="13" rx="2"/><path d="M3 9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2"/></svg>
              Duplicates ({dupCount})
            </button>
          )}
          <ExportMenu filters={filters} />
        </div>
      </div>

      {selected.size > 0 && (
        <BulkBar
          selected={selected}
          items={items}
          onClear={() => setSelected(new Set())}
          onCompare={selected.size >= 2 && selected.size <= 4 ? () => setCompareIds([...selected]) : undefined}
        />
      )}

      {isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center px-8">
          <div className="text-5xl mb-4 opacity-30">{'\u{1F4C4}'}</div>
          <h3 className="text-base font-semibold text-text-primary mb-2">No items found</h3>
          <p className="text-sm text-text-muted max-w-xs mb-6">
            {hasActiveFilters ? 'Try adjusting your filters.' : 'Run a crawl to start gathering research.'}
          </p>
          {!hasActiveFilters && (
            <button
              onClick={() => { api.triggerCrawl().catch(() => {}); addToast('Crawl started') }}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors"
            >
              Run Crawl
            </button>
          )}
        </div>
      ) : viewMode === 'timeline' ? (
        <TimelineView
          items={items}
          total={total}
          isFetching={isFetching}
          isLoading={isLoading}
          hasNextPage={hasNextPage}
          onLoadMore={() => setPage((p) => p + 1)}
          onItemClick={(id) => {
            setSelectedItemId(id)
            setVisitedIds((prev) => {
              if (prev.has(id)) return prev
              const next = new Set(prev)
              next.add(id)
              return next
            })
          }}
        />
      ) : (
        <>
          <div className="grid gap-3">
            {items.map((item, idx) => {
              const isVisited = visitedIds.has(item.id)
              return (
                <SwipeableCard
                  key={item.id}
                  onSwipeRight={() => {
                    update.mutate({ id: item.id, patch: { is_saved: !item.is_saved } })
                    addToast(item.is_saved ? 'Unsaved' : 'Saved')
                  }}
                  onSwipeLeft={() => {
                    if (item.review_status !== 'reviewing') {
                      const prev = item.review_status
                      update.mutate({ id: item.id, patch: { review_status: 'reviewing' } })
                      addToast('Marked as reviewed', 'success', {
                        label: 'Undo',
                        onClick: () => update.mutate({ id: item.id, patch: { review_status: prev } }),
                      })
                    }
                  }}
                  rightLabel={item.is_saved ? 'Unsave' : 'Save'}
                  leftLabel="Reviewed"
                >
                  <div
                    className={cn(
                      'transition-all duration-200 card-glass',
                      idx === focusedIdx && 'ring-1 ring-accent/40 rounded-xl',
                      isVisited && 'opacity-70',
                    )}
                    onClick={() => handleCardClick(item.id, idx)}
                  >
                    <SourceCard
                      density={density}
                      item={item}
                      selected={selected.has(item.id)}
                      index={idx}
                      visited={isVisited}
                      onSelect={(id) => {
                        // stop propagation to prevent drawer from opening when selecting
                        toggleSelect(id)
                      }}
                    />
                  </div>
                </SwipeableCard>
              )
            })}
          </div>

          {/* Intersection observer sentinel — triggers next page load when visible */}
          <div ref={sentinelRef} className="h-1" aria-hidden />
          {isFetching && !isLoading && (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          )}

          {/* Fallback pagination: page label + manual Prev/Next buttons */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-text-muted font-mono">
              {total} item{total !== 1 ? 's' : ''}
              {total > 0 && ` · page ${page + 1}`}
            </span>
            <div className="flex gap-2">
              {page > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
              )}
              {hasMore && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={isFetching && !isLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              )}
            </div>
          </div>

          {/* Fixed bottom progress bar while fetching subsequent pages */}
          {isFetching && !isLoading && (
            <div className="fixed bottom-0 left-0 right-0 h-0.5 z-50">
              <div
                className="h-full bg-accent animate-[shimmer_1.5s_ease_infinite]"
                style={{ width: '60%' }}
              />
            </div>
          )}
        </>
      )}

      <ItemDrawer itemIds={itemIds} currentIndex={currentIndex} />

      {showDuplicates && (
        <DuplicateReview onClose={() => setShowDuplicates(false)} />
      )}

      {compareIds && compareIds.length >= 2 && (
        <ComparisonView
          itemIds={compareIds}
          onClose={() => setCompareIds(null)}
          onRemove={(id) => {
            const next = compareIds.filter((cid) => cid !== id)
            if (next.length < 2) {
              setCompareIds(null)
            } else {
              setCompareIds(next)
            }
            setSelected((s) => {
              const ns = new Set(s)
              ns.delete(id)
              return ns
            })
          }}
        />
      )}
    </div>
  )
}
