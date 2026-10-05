import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink,
  FileText,
  Globe,
  Play,
  Radar,
  RefreshCw,
  Search,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import type { Creator, LiveDiscoveryPayload } from '@/lib/types'
import { fetchLiveDiscovery, type DirectorySort } from '@/lib/api'
import { creatorFollowId, creatorKey } from '@/lib/discovery'
import { creatorHandle, followName, handleKey, mergeCreators } from '@/features/creators/creatorLogic'
import { OTHER_PLATFORM, creatorPlatformIds, platformFilterOptions } from '@/features/creators/platformLinks'
import { OUTBOUND_REL, platformById, safeOutboundUrl } from '@/features/creators/platforms'
import { useSavedLinks } from '@/features/creators/useSavedLinks'
import PlatformFilter from '@/features/creators/PlatformFilter'
import SavedProfiles from '@/features/creators/SavedProfiles'
import { useCreatorDirectory } from '@/features/creators/useCreatorDirectory'
import CreatorFinder from '@/features/creators/CreatorFinder'
import RadarPanel from '@/features/creators/RadarPanel'
import { useAppStore } from '@/store'
import CreatorDrawer from '@/components/CreatorDrawer'
import { prefetchCreatorMedia } from '@/features/creators/useCreatorMedia'
import UpdatedChip from '@/components/UpdatedChip'
import Rail from '@/components/discovery/Rail'
import SectionHeader from '@/components/discovery/SectionHeader'
import StatePanel from '@/components/discovery/StatePanel'
import { Segmented } from '@/components/discovery/Controls'
import { StoryRing } from '@/components/discovery/CreatorParts'
import { CreatorCard } from '@/components/discovery/CreatorCard'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

type CreatorSort = 'smart' | 'newest' | 'engagement' | 'az'

const directorySort: Record<CreatorSort, DirectorySort> = { smart: 'smart', newest: 'newest', engagement: 'popular', az: 'smart' }

const sortLabels: Record<CreatorSort, string> = {
  smart: 'Smart',
  newest: 'Newest',
  engagement: 'Top engagement',
  az: 'A–Z',
}

function scanPhase(elapsedSeconds: number): string {
  if (elapsedSeconds < 3) return 'Contacting sources'
  if (elapsedSeconds < 8) return 'Ranking matches'
  return 'Checking AI suggestions'
}

export default function Creators() {
  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const followCache = useAppStore((s) => s.followCache)
  const toggleFollow = useAppStore((s) => s.toggleFollow)
  const addToast = useAppStore((s) => s.addToast)

  const [searchText, setSearchText] = useState('')
  const [laneFilter, setLaneFilter] = useState<string | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<CreatorSort>('smart')
  const [activeCreator, setActiveCreator] = useState<Creator | null>(null)
  const [scanBanner, setScanBanner] = useState<string | null>(null)

  const queryClient = useQueryClient()

  const queryKey = useMemo(
    () => ['live-discovery', 'creators', creatorWatchlist] as const,
    [creatorWatchlist]
  )

  const discoveryQuery = useQuery({
    queryKey,
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
  })
  const discovery = discoveryQuery.data
  const directory = useCreatorDirectory(laneFilter, directorySort[sort])

  /* ── Scan flow with elapsed-time progress ── */
  const [scanning, setScanning] = useState(false)
  const [scanElapsed, setScanElapsed] = useState(0)
  const scanTimerRef = useRef<number | null>(null)

  const runScan = useCallback(async () => {
    if (scanning) return
    const beforeKeys = new Set((discovery?.performers ?? []).map((creator) => creatorKey(creator.name)))
    setScanning(true)
    setScanElapsed(0)
    setScanBanner(null)
    const startedAt = Date.now()
    scanTimerRef.current = window.setInterval(() => {
      setScanElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    try {
      const payload: LiveDiscoveryPayload = await fetchLiveDiscovery(creatorWatchlist, {
        forceFresh: true,
      })
      queryClient.setQueryData(queryKey, payload)
      const newCount = payload.performers.filter((creator) => !beforeKeys.has(creatorKey(creator.name))).length
      const matched = payload.watchlist.matched.length
      const aiCount = payload.aiDiscovery.suggestedCreators
      const aiNote = payload.aiDiscovery.state === 'ok'
        ? `AI: ${aiCount} suggestion${aiCount === 1 ? '' : 's'}`
        : payload.aiDiscovery.state === 'fallback'
          ? `${aiCount} metadata suggestion${aiCount === 1 ? '' : 's'} · AI reranking will retry automatically`
          : 'Metadata matching active'
      const summary = `${newCount} new creator${newCount === 1 ? '' : 's'} found · ${matched} matched your radar · ${aiNote}`
      setScanBanner(summary)
      addToast({ type: 'success', title: 'Scan complete', message: summary })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Scan failed',
        message: error instanceof Error ? error.message : 'The sources could not be reached.',
      })
    } finally {
      if (scanTimerRef.current) window.clearInterval(scanTimerRef.current)
      setScanning(false)
    }
  }, [addToast, creatorWatchlist, discovery, queryClient, queryKey, scanning])

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) window.clearInterval(scanTimerRef.current)
    }
  }, [])

  /* ── Derived filter data ── */
  const performers = useMemo(() => discovery?.performers ?? [], [discovery])
  // Feed creators first, then the paged directory — one card per lowercase handle. With a lane
  // selected only lane-matching feed creators are kept alongside the server-filtered directory.
  const allCreators = useMemo(() => {
    const feed = laneFilter
      ? performers.filter((creator) => (creator.discoveryTags ?? []).some((tag) => tag.toLowerCase() === laneFilter.toLowerCase()))
      : performers
    return mergeCreators(feed, directory.creators)
  }, [performers, directory.creators, laneFilter])

  /* Platform presence: registry ids per directory/feed creator, plus every saved profile link. */
  const { links: savedLinks } = useSavedLinks()
  const creatorPlatformSets = useMemo(() => new Map(allCreators.map((creator) => [creator.id, creatorPlatformIds(creator)] as const)), [allCreators])
  const platformCounts = useMemo(() => {
    const listed = new Set(allCreators.map((creator) => handleKey(creatorHandle(creator))))
    const sets: Set<string>[] = [...creatorPlatformSets.values()]
    // A saved Redgifs handle that is already in the directory is the same creator: count it once.
    for (const link of savedLinks) {
      if (link.platform === 'redgifs' && listed.has(handleKey(link.handle))) continue
      sets.push(new Set([link.platform === 'generic' ? OTHER_PLATFORM : link.platform]))
    }
    return { options: platformFilterOptions(sets), total: sets.length }
  }, [allCreators, creatorPlatformSets, savedLinks])
  const platformLabel = platformFilter ? (platformById(platformFilter)?.label ?? 'Other') : null

  const payloadTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const creator of allCreators) {
      for (const tag of creator.discoveryTags ?? []) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag)
  }, [allCreators])

  const filteredCreators = useMemo(() => {
    let result = [...allCreators]
    if (platformFilter) result = result.filter((creator) => creatorPlatformSets.get(creator.id)?.has(platformFilter))
    if (tagFilter) result = result.filter((creator) => (creator.discoveryTags ?? []).includes(tagFilter))
    const needle = searchText.trim().toLowerCase()
    if (needle) {
      result = result.filter(
        (creator) =>
          creator.name.toLowerCase().includes(needle) ||
          (creator.username ?? '').toLowerCase().includes(needle) ||
          (creator.discoveryTags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      )
    }
    switch (sort) {
      case 'newest':
        result.sort((a, b) => Date.parse(b.lastSeenAt ?? b.observedAt ?? '') - Date.parse(a.lastSeenAt ?? a.observedAt ?? ''))
        break
      case 'engagement':
        result.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
        break
      case 'az':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'smart':
      default:
        result.sort((a, b) => Number(b.aiSuggested ?? false) - Number(a.aiSuggested ?? false) || (b.curationScore ?? 0) - (a.curationScore ?? 0))
        break
    }
    return result
  }, [allCreators, creatorPlatformSets, platformFilter, tagFilter, searchText, sort])

  // Render the directory incrementally: 50+ creator cards (each with a cover and an avatar
  // image) mounted at once is what exhausts memory on phones.
  const PAGE = 12
  const COVER_LIMIT = 36 // covers beyond this render avatar-only to bound mounted images
  const [visibleCount, setVisibleCount] = useState(PAGE)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const filterSignature = `${platformFilter}|${tagFilter}|${laneFilter}|${searchText}|${sort}`
  useEffect(() => setVisibleCount(PAGE), [filterSignature])
  const hasMoreLocal = filteredCreators.length > visibleCount
  const hasMoreCreators = hasMoreLocal || directory.hasMore
  const { fetchMore: fetchMoreDirectory } = directory
  const showMoreCreators = useCallback(() => {
    if (hasMoreLocal) setVisibleCount((count) => count + PAGE)
    else fetchMoreDirectory()
  }, [fetchMoreDirectory, hasMoreLocal])
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMoreCreators || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) showMoreCreators()
    }, { rootMargin: '500px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMoreCreators, showMoreCreators, visibleCount, filteredCreators.length])

  const activeSources = useMemo(
    () => (discovery?.sources ?? []).filter((source) => source.state === 'connected'),
    [discovery]
  )

  const follow = useCallback(
    (creator: Creator) => {
      const id = creatorFollowId(followName(creator))
      const next = !followCache[id]
      toggleFollow(id)
      addToast({
        type: next ? 'success' : 'info',
        title: next ? `Following @${creator.username || creator.name}` : `Unfollowed @${creator.username || creator.name}`,
      })
    },
    [addToast, followCache, toggleFollow]
  )

  const openCreator = useCallback((creator: Creator) => {
    prefetchCreatorMedia(queryClient, creator)
    setActiveCreator(creator)
  }, [queryClient])

  const ddg = discovery?.ddg
  const aiOk = discovery?.aiDiscovery.state === 'ok'
  const followedFor = (creator: Creator) => Boolean(followCache[creatorFollowId(followName(creator))])

  return (
    <div className="animate-page-enter d-page">
      {/* Header */}
      <div className="d-hero">
        <div className="d-hero-row">
          <div className="min-w-0">
            <p className="d-eyebrow">Creator radar</p>
            <h1 className="d-page-title">Find male creators</h1>
            <p className="d-hero-desc">
              Scan public sources for the handles you follow. Results are ranked with specific,
              source-derived evidence — never inflated numbers.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <UpdatedChip updatedAt={discovery?.updatedAt ?? null} />
            <button onClick={runScan} disabled={scanning} className="btn-heat">
              <Radar size={14} strokeWidth={1.75} aria-hidden="true" />
              {scanning ? `Scanning ${scanElapsed}s` : 'Scan now'}
            </button>
          </div>
        </div>
      </div>

      {/* Primary action: find a creator by name, @handle or profile link */}
      <CreatorFinder onOpen={openCreator} />

      {/* Personal, on-device profile links (any platform); link-only cards */}
      <SavedProfiles
        platformFilter={platformFilter}
        platformLabel={platformLabel}
        onClearPlatform={() => setPlatformFilter(null)}
        onOpenCatalog={openCreator}
      />

      {/* Scan progress */}
      {scanning && (
        <div role="status" className="d-panel flex items-center gap-3">
          <RefreshCw size={14} strokeWidth={1.75} className="animate-spin text-heat" aria-hidden="true" />
          <p className="font-mono text-xs text-ink">
            {scanPhase(scanElapsed)}… <span className="text-ink-3">{scanElapsed}s elapsed</span>
          </p>
        </div>
      )}

      {/* Scan diff banner */}
      {scanBanner && !scanning && (
        <div role="status" className="d-panel flex items-start justify-between gap-3">
          <p className="font-mono text-xs leading-5 text-ink">{scanBanner}</p>
          <button
            onClick={() => setScanBanner(null)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink"
            aria-label="Dismiss scan summary"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Story rings: quick access to everyone on the feed */}
      {performers.length > 0 && (
        <section aria-label="Creator stories">
          <SectionHeader title="On the radar now" eyebrow="Hover a ring to flip it" icon={<Users size={12} strokeWidth={1.75} aria-hidden="true" />} />
          <Rail ariaLabel="Creator stories">
            {performers.slice(0, 18).map((creator) => (
              <StoryRing key={creator.id} creator={creator} followed={followedFor(creator)} onOpen={openCreator} />
            ))}
          </Rail>
        </section>
      )}

      <RadarPanel onRunScan={runScan} scanning={scanning} />

      {activeSources.length > 0 && (
        <section aria-label="Live source coverage">
          <div className="d-chips">
            {activeSources.map((source) => {
              const count = source.mediaFound ?? source.items ?? source.creatorsFound ?? source.leads
              return (
                <span key={source.id} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-3 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                  {source.name || source.id}{typeof count === 'number' ? ` · ${count}` : ''}
                </span>
              )
            })}
          </div>
        </section>
      )}

      {/* Web discovery (DuckDuckGo leads) */}
      {ddg && ddg.leads.length > 0 && (
        <section aria-label="Web discovery">
          <SectionHeader title="Web discovery" eyebrow="Leads via DuckDuckGo" icon={<Globe size={12} strokeWidth={1.75} aria-hidden="true" />}>
            <a href={safeOutboundUrl(ddg.searchUrl) ?? undefined} target="_blank" rel={OUTBOUND_REL} className="d-link">
              Open this search on DuckDuckGo <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </SectionHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {ddg.leads.flatMap((lead) => {
              const href = safeOutboundUrl(lead.url)
              return href ? [{ lead, href }] : []
            }).map(({ lead, href }) => {
              let domain = 'web'
              try {
                domain = new URL(lead.url).hostname.replace(/^www\./, '')
              } catch {
                // keep fallback label
              }
              const KindIcon = lead.kind === 'profile' ? UserRound : lead.kind === 'video' ? Play : FileText
              return (
                <a
                  key={lead.url}
                  href={href}
                  target="_blank"
                  rel={OUTBOUND_REL}
                  className="d-panel group flex items-start gap-3 !p-4 transition-colors hover:border-line-strong"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunken text-ink-2" aria-hidden="true">
                    <KindIcon size={15} strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink group-hover:underline">{lead.title}</span>
                    {lead.snippet && (
                      <span className="mt-0.5 line-clamp-2 block text-xs leading-4 text-ink-2">{lead.snippet}</span>
                    )}
                    <span className="mono-meta mt-1 block uppercase">{domain} · {lead.kind}</span>
                  </span>
                  <ExternalLink size={14} strokeWidth={1.75} className="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
                </a>
              )
            })}
          </div>
          <p className="mt-2 font-mono text-[10px] text-ink-3">{ddg.detail}</p>
        </section>
      )}

      {/* Browse all creators */}
      <section aria-label="Browse all creators">
        <SectionHeader
          title="Browse all creators"
          eyebrow={directory.total != null ? `${directory.total.toLocaleString()} creators indexed` : 'Feed + directory'}
          icon={<Users size={12} strokeWidth={1.75} aria-hidden="true" />}
        />
        <div className="d-toolbar" role="search" aria-label="Creator filters">
          <div className="d-field">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Filter loaded creators"
              aria-label="Filter loaded creators"
              className="d-input"
            />
            {searchText && (
              <button onClick={() => setSearchText('')} className="d-field-clear" aria-label="Clear creator filter">
                <X size={14} strokeWidth={1.75} />
              </button>
            )}
          </div>
          <Segmented<CreatorSort>
            ariaLabel="Sort creators"
            value={sort}
            onChange={setSort}
            options={(Object.keys(sortLabels) as CreatorSort[]).map((value) => ({ value, label: sortLabels[value] }))}
          />
          {(directory.lanes.length > 0 || laneFilter) && (
            <div className="d-chips" style={{ flexBasis: '100%' }} role="group" aria-label="Lanes">
              <button onClick={() => setLaneFilter(null)} className={cn('chip', !laneFilter && 'chip-active')} aria-pressed={!laneFilter}>
                All lanes
              </button>
              {(laneFilter && !directory.lanes.some((lane) => lane.tag === laneFilter) ? [{ tag: laneFilter }, ...directory.lanes] : directory.lanes).map((lane) => (
                <button
                  key={lane.tag}
                  onClick={() => setLaneFilter(laneFilter === lane.tag ? null : lane.tag)}
                  className={cn('chip', laneFilter === lane.tag && 'chip-active')}
                  aria-pressed={laneFilter === lane.tag}
                >
                  {lane.tag}
                </button>
              ))}
            </div>
          )}
          <PlatformFilter options={platformCounts.options} total={platformCounts.total} value={platformFilter} onChange={setPlatformFilter} />
          {payloadTags.length > 0 && (
            <div className="d-chips" style={{ flexBasis: '100%' }} role="group" aria-label="Tags">
              {payloadTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                  className={cn('chip', tagFilter === tag && 'chip-active')}
                  aria-pressed={tagFilter === tag}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {(discoveryQuery.isLoading || directory.isLoading) && allCreators.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="d-skel d-skel-block" style={{ height: 260 }} />
            ))}
          </div>
        ) : discoveryQuery.error && directory.error && allCreators.length === 0 ? (
          <StatePanel
            tone="error"
            icon={RefreshCw}
            title="Creator scan failed"
            description="The discovery service could not be reached. Try again."
            actionLabel="Retry"
            onAction={() => {
              void discoveryQuery.refetch()
              directory.retry()
            }}
          />
        ) : filteredCreators.length === 0 && !directory.hasMore ? (
          <StatePanel
            icon={Users}
            title="No creators match"
            description="Loosen the lane, platform or tag filters, or use Find a creator to look someone up by name."
            actionLabel="Clear filters"
            onAction={() => {
              setPlatformFilter(null)
              setTagFilter(null)
              setLaneFilter(null)
              setSearchText('')
            }}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="creator-grid">
              {filteredCreators.slice(0, visibleCount).map((creator, index) => (
                <div key={creator.id} className="d-reveal" style={{ ['--d' as string]: Math.min(index % PAGE, 8) }}>
                  <CreatorCard
                    creator={creator}
                    followed={followedFor(creator)}
                    aiOk={aiOk}
                    onOpen={openCreator}
                    onFollow={follow}
                    showCover={index < COVER_LIMIT}
                  />
                </div>
              ))}
            </div>
            <p className="mono-meta mt-4 text-center" aria-live="polite">
              Showing {Math.min(visibleCount, filteredCreators.length)} of {directory.total != null ? Math.max(directory.total, filteredCreators.length).toLocaleString() : filteredCreators.length.toLocaleString()}
              {directory.hasMore ? '+' : ''} creators
            </p>
            {directory.isFetchingMore && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="d-skel d-skel-block" style={{ height: 200 }} />
                ))}
              </div>
            )}
            {directory.error && (
              <p role="alert" className="mt-4 text-center font-mono text-[11px] text-ink-3">
                Couldn&apos;t load more of the directory.{' '}
                <button type="button" onClick={directory.retry} className="underline">Retry</button>
              </p>
            )}
            {hasMoreCreators && !directory.error && (
              <div ref={sentinelRef} className="mt-4 flex justify-center">
                <button type="button" onClick={showMoreCreators} disabled={directory.isFetchingMore} className="btn-secondary min-h-11">
                  {directory.isFetchingMore ? 'Loading…' : hasMoreLocal ? `Show more creators · ${filteredCreators.length - visibleCount} left` : 'Load more creators'}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <CreatorDrawer creator={activeCreator} onClose={() => setActiveCreator(null)} />
    </div>
  )
}
