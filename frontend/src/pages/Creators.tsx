import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink,
  FileText,
  Globe,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Search,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import type { Creator, LiveDiscoveryPayload } from '@/lib/types'
import { fetchLiveDiscovery } from '@/lib/api'
import { creatorFollowId, creatorKey } from '@/lib/discovery'
import { useAppStore } from '@/store'
import CreatorDrawer from '@/components/CreatorDrawer'
import { prefetchCreatorMedia } from '@/features/creators/useCreatorMedia'
import UpdatedChip from '@/components/UpdatedChip'
import Rail from '@/components/discovery/Rail'
import SectionHeader from '@/components/discovery/SectionHeader'
import StatePanel from '@/components/discovery/StatePanel'
import { Segmented } from '@/components/discovery/Controls'
import { CreatorCard, StoryRing } from '@/components/discovery/CreatorParts'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

type CreatorSort = 'smart' | 'newest' | 'engagement' | 'az'

const sortLabels: Record<CreatorSort, string> = {
  smart: 'Smart',
  newest: 'Newest',
  engagement: 'Top engagement',
  az: 'A–Z',
}

function creatorPlatforms(creator: Creator): string[] {
  const set = new Set<string>()
  if (creator.platform) set.add(creator.platform.toLowerCase())
  for (const platform of creator.platforms ?? []) set.add(platform.toLowerCase())
  if (creator.sourceAttribution) set.add(creator.sourceAttribution.toLowerCase())
  return [...set]
}

function scanPhase(elapsedSeconds: number): string {
  if (elapsedSeconds < 3) return 'Contacting sources'
  if (elapsedSeconds < 8) return 'Ranking matches'
  return 'Checking AI suggestions'
}

export default function Creators() {
  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const addCreatorToWatchlist = useAppStore((s) => s.addCreatorToWatchlist)
  const removeCreatorFromWatchlist = useAppStore((s) => s.removeCreatorFromWatchlist)
  const followCache = useAppStore((s) => s.followCache)
  const toggleFollow = useAppStore((s) => s.toggleFollow)
  const addToast = useAppStore((s) => s.addToast)

  const [handleDraft, setHandleDraft] = useState('')
  const [searchText, setSearchText] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [platformFilter, setPlatformFilter] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<CreatorSort>('smart')
  const [activeCreator, setActiveCreator] = useState<Creator | null>(null)
  const [scanBanner, setScanBanner] = useState<string | null>(null)

  const queryClient = useQueryClient()

  // Debounce the backend query term (400ms)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchText.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const queryKey = useMemo(
    () => ['live-discovery', 'creators', creatorWatchlist, debouncedQuery] as const,
    [creatorWatchlist, debouncedQuery]
  )

  const discoveryQuery = useQuery({
    queryKey,
    queryFn: () => fetchLiveDiscovery(creatorWatchlist, { query: debouncedQuery }),
  })
  const discovery = discoveryQuery.data

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
        query: debouncedQuery,
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
  }, [addToast, creatorWatchlist, debouncedQuery, discovery, queryClient, queryKey, scanning])

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) window.clearInterval(scanTimerRef.current)
    }
  }, [])

  /* ── Derived filter data ── */
  const performers = useMemo(() => discovery?.performers ?? [], [discovery])

  const platforms = useMemo(() => {
    const set = new Set<string>()
    for (const creator of performers) for (const platform of creatorPlatforms(creator)) set.add(platform)
    return [...set].sort()
  }, [performers])

  const payloadTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const creator of performers) {
      for (const tag of creator.discoveryTags ?? []) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag)
  }, [performers])

  const filteredCreators = useMemo(() => {
    let result = [...performers]
    if (platformFilter) result = result.filter((creator) => creatorPlatforms(creator).includes(platformFilter))
    if (tagFilter) result = result.filter((creator) => (creator.discoveryTags ?? []).includes(tagFilter))
    const needle = debouncedQuery.toLowerCase()
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
  }, [performers, platformFilter, tagFilter, debouncedQuery, sort])

  const activeSources = useMemo(
    () => (discovery?.sources ?? []).filter((source) => source.state === 'connected'),
    [discovery]
  )

  const addHandle = useCallback(() => {
    const value = handleDraft.trim()
    if (!value) return
    addCreatorToWatchlist(value)
    setHandleDraft('')
  }, [addCreatorToWatchlist, handleDraft])

  const follow = useCallback(
    (creator: Creator) => {
      const id = creatorFollowId(creator.name)
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
  const followedFor = (creator: Creator) => Boolean(followCache[creatorFollowId(creator.name)])

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

      {/* Radar watchlist */}
      {creatorWatchlist.length === 0 ? (
        <section className="d-state" style={{ alignItems: 'center' }}>
          <span className="d-state-halo" aria-hidden="true">
            <Radar size={22} strokeWidth={1.5} />
          </span>
          <h2 className="d-state-title">Your radar is empty</h2>
          <p className="d-state-desc">
            Add up to 8 creator handles or names and the radar will scan active public sources for
            matching posts — with evidence for every match. Nothing is pre-seeded:
            this list is yours alone.
          </p>
          <div className="flex w-full max-w-sm items-center gap-2">
            <input
              value={handleDraft}
              onChange={(event) => setHandleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addHandle()
              }}
              placeholder="Add a handle to scan for"
              aria-label="Creator handle to add to the radar"
              className="d-input"
              style={{ paddingLeft: 18, paddingRight: 18 }}
            />
            <button onClick={addHandle} className="btn-secondary" aria-label="Add handle">
              <Plus size={14} strokeWidth={1.75} />
            </button>
          </div>
          <button onClick={runScan} disabled={scanning} className="btn-primary mt-1">
            Run a starter scan
          </button>
          <p className="font-mono text-[10px] text-ink-3">
            Without watchlist entries the scan returns the general public feed.
          </p>
        </section>
      ) : (
        <section className="d-panel">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="d-eyebrow">
              <Radar size={12} strokeWidth={1.75} aria-hidden="true" />
              Radar watchlist · {creatorWatchlist.length}/8
            </h2>
            <div className="flex items-center gap-2">
              <input
                value={handleDraft}
                onChange={(event) => setHandleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addHandle()
                }}
                placeholder="Add handle"
                aria-label="Creator handle to add to the radar"
                className="d-input"
                style={{ width: 180, paddingLeft: 16, paddingRight: 16 }}
              />
              <button onClick={addHandle} className="btn-secondary" aria-label="Add handle">
                <Plus size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {creatorWatchlist.map((handle) => (
              <span key={handle} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-sunken/50 pl-4 pr-1 font-mono text-[11px] text-ink">
                {handle}
                <button
                  onClick={() => removeCreatorFromWatchlist(handle)}
                  className="grid h-9 w-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                  aria-label={`Remove ${handle} from the radar`}
                >
                  <X size={12} strokeWidth={1.75} />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

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
            <a href={ddg.searchUrl} target="_blank" rel="noreferrer" className="d-link">
              Open this search on DuckDuckGo <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </SectionHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {ddg.leads.map((lead) => {
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
                  href={lead.url}
                  target="_blank"
                  rel="noreferrer"
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

      {/* Directory */}
      <section aria-label="Creator directory">
        <div className="d-toolbar" role="search" aria-label="Creator filters">
          <div className="d-field">
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search creators (queries the sources)"
              aria-label="Search creators"
              className="d-input"
            />
            {searchText && (
              <button onClick={() => setSearchText('')} className="d-field-clear" aria-label="Clear creator search">
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
          {(platforms.length > 0 || payloadTags.length > 0) && (
            <div className="d-chips" style={{ flexBasis: '100%' }}>
              {platforms.map((platform) => (
                <button
                  key={platform}
                  onClick={() => setPlatformFilter(platformFilter === platform ? null : platform)}
                  className={cn('chip', platformFilter === platform && 'chip-active')}
                  aria-pressed={platformFilter === platform}
                >
                  {platform}
                </button>
              ))}
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

        {discoveryQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="d-skel d-skel-block" style={{ height: 260 }} />
            ))}
          </div>
        ) : discoveryQuery.error ? (
          <StatePanel
            tone="error"
            icon={RefreshCw}
            title="Creator scan failed"
            description="The discovery service could not be reached. Try again."
            actionLabel="Retry"
            onAction={() => discoveryQuery.refetch()}
          />
        ) : filteredCreators.length === 0 ? (
          <StatePanel
            icon={Users}
            title="No creators match"
            description="Loosen the platform or tag filters, or run a fresh scan for new matches."
            actionLabel="Clear filters"
            onAction={() => {
              setPlatformFilter(null)
              setTagFilter(null)
              setSearchText('')
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCreators.map((creator, index) => (
              <div key={creator.id} className="d-reveal" style={{ ['--d' as string]: Math.min(index, 8) }}>
                <CreatorCard creator={creator} followed={followedFor(creator)} aiOk={aiOk} onOpen={openCreator} onFollow={follow} />
              </div>
            ))}
          </div>
        )}
      </section>

      <CreatorDrawer creator={activeCreator} onClose={() => setActiveCreator(null)} />
    </div>
  )
}
