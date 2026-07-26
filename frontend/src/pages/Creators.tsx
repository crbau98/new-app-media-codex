import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpDown,
  Check,
  ExternalLink,
  FileText,
  Globe,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import type { Creator, LiveDiscoveryPayload } from '@/lib/types'
import { fetchLiveDiscovery } from '@/lib/api'
import { creatorFollowId, creatorKey, formatMetric, relativeTime } from '@/lib/discovery'
import { useAppStore } from '@/store'
import CreatorDrawer from '@/components/CreatorDrawer'
import EmptyState from '@/components/EmptyState'
import UpdatedChip from '@/components/UpdatedChip'
import { cn } from '@/lib/utils'

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
          ? 'Metadata matching active; AI reranking will retry automatically'
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

  const ddg = discovery?.ddg

  return (
    <div className="animate-page-enter space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="eyebrow">Creator radar</p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-ink">Find male creators</h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-5 text-ink-2">
            Scan public sources for the handles you follow. Results are ranked with specific,
            source-derived evidence — never inflated numbers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <UpdatedChip updatedAt={discovery?.updatedAt ?? null} />
          <button onClick={runScan} disabled={scanning} className="btn-heat">
            <Radar size={14} strokeWidth={1.75} aria-hidden="true" />
            {scanning ? `Scanning ${scanElapsed}s` : 'Scan now'}
          </button>
        </div>
      </div>

      {/* Scan progress */}
      {scanning && (
        <div role="status" className="flex items-center gap-3 rounded-md border border-line p-4">
          <RefreshCw size={14} strokeWidth={1.75} className="animate-spin text-heat" aria-hidden="true" />
          <p className="font-mono text-xs text-ink">
            {scanPhase(scanElapsed)}… <span className="text-ink-3">{scanElapsed}s elapsed</span>
          </p>
        </div>
      )}

      {/* Scan diff banner */}
      {scanBanner && !scanning && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-md border border-line bg-elevated p-4">
          <p className="font-mono text-xs leading-5 text-ink">{scanBanner}</p>
          <button
            onClick={() => setScanBanner(null)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
            aria-label="Dismiss scan summary"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      )}

      {/* Radar watchlist */}
      {creatorWatchlist.length === 0 ? (
        <section className="empty-state-panel">
          <Radar size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden="true" />
          <h2 className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-ink">Your radar is empty</h2>
          <p className="max-w-md text-[13px] leading-5 text-ink-2">
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
              className="h-10 flex-1 rounded-md border border-line bg-transparent px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
            />
            <button onClick={addHandle} className="btn-secondary min-h-10 px-3" aria-label="Add handle">
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
        <section className="rounded-md border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow flex items-center gap-1.5">
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
                className="h-10 w-44 rounded-md border border-line bg-transparent px-3 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
              />
              <button onClick={addHandle} className="btn-secondary min-h-10 px-3" aria-label="Add handle">
                <Plus size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {creatorWatchlist.map((handle) => (
              <span key={handle} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 font-mono text-[11px] text-ink">
                {handle}
                <button
                  onClick={() => removeCreatorFromWatchlist(handle)}
                  className="grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:text-ink"
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
          <h2 className="eyebrow mb-3">Live coverage</h2>
          <div className="flex flex-wrap gap-2">
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="eyebrow flex items-center gap-1.5">
              <Globe size={12} strokeWidth={1.75} aria-hidden="true" /> Web discovery
            </h2>
            <a
              href={ddg.searchUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 hover:text-ink"
            >
              Open this search on DuckDuckGo <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
            </a>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
                  className="group flex items-start gap-3 rounded-md border border-line p-3 transition-colors hover:border-line-strong"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-sunken text-ink-2" aria-hidden="true">
                    <KindIcon size={14} strokeWidth={1.75} />
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
          <p className="mt-2 font-mono text-[10px] text-ink-3">Leads via DuckDuckGo · {ddg.detail}</p>
        </section>
      )}

      {/* Preference levers */}
      <section aria-label="Creator filters" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search creators (queries the sources)"
              aria-label="Search creators"
              className="h-10 w-64 rounded-md border border-line bg-transparent pl-9 pr-8 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-ink-3 hover:text-ink"
                aria-label="Clear creator search"
              >
                <X size={13} strokeWidth={1.75} />
              </button>
            )}
          </div>

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

          <div className="ml-auto flex items-center gap-1">
            <ArrowUpDown size={13} strokeWidth={1.75} className="text-ink-3" aria-hidden="true" />
            {(Object.keys(sortLabels) as CreatorSort[]).map((value) => (
              <button
                key={value}
                onClick={() => setSort(value)}
                className={cn('chip !min-h-10 !px-3', sort === value && 'chip-active')}
                aria-pressed={sort === value}
              >
                {sortLabels[value]}
              </button>
            ))}
          </div>
        </div>

        {payloadTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {payloadTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                className={cn('chip !min-h-10', tagFilter === tag && 'chip-active')}
                aria-pressed={tagFilter === tag}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Creator grid */}
      {discoveryQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton-tile !aspect-[3/2]" />
          ))}
        </div>
      ) : discoveryQuery.error ? (
        <EmptyState
          icon={RefreshCw}
          title="Creator scan failed"
          description="The discovery service could not be reached. Try again."
          actionLabel="Retry"
          onAction={() => discoveryQuery.refetch()}
        />
      ) : filteredCreators.length === 0 ? (
        <EmptyState
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCreators.map((creator) => {
            const followId = creatorFollowId(creator.name)
            const followed = Boolean(followCache[followId])
            const aiOk = discovery?.aiDiscovery.state === 'ok'
            return (
              <article
                key={creator.id}
                className="group rounded-md border border-line bg-elevated p-4 transition-colors hover:border-line-strong"
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => setActiveCreator(creator)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left tap-highlight-none"
                    aria-label={`Open profile of ${creator.name}`}
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-sunken">
                      {creator.avatar ? (
                        <img src={creator.avatar} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="font-mono text-sm text-ink-2">{creator.name.charAt(0).toUpperCase()}</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink">{creator.name}</h3>
                        {creator.aiSuggested && aiOk && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-heat-dim px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-heat">
                            <Sparkles size={10} strokeWidth={1.75} aria-hidden="true" /> AI
                          </span>
                        )}
                      </span>
                      <span className="mono-meta mt-0.5 block uppercase">
                        {(creator.platforms ?? [creator.platform]).filter(Boolean).slice(0, 2).join(' · ') || creator.sourceAttribution || 'public source'}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => follow(creator)}
                    className={cn(
                      'inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2.5 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors',
                      followed ? 'bg-sunken text-ink' : 'bg-heat text-canvas hover:bg-heat-hover'
                    )}
                    aria-pressed={followed}
                    aria-label={followed ? `Unfollow ${creator.name}` : `Follow ${creator.name}`}
                  >
                    {followed ? <Check size={12} strokeWidth={1.75} /> : <Plus size={12} strokeWidth={1.75} />}
                    {followed ? 'Following' : 'Follow'}
                  </button>
                </div>

                <button
                  onClick={() => setActiveCreator(creator)}
                  className="mt-3 block w-full text-left tap-highlight-none"
                  aria-label={`Open profile of ${creator.name}`}
                  tabIndex={-1}
                >
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                    {creator.followers != null && <span>{formatMetric(creator.followers)} followers</span>}
                    <span>{creator.evidenceCount ?? creator.mediaCount ?? 0} evidence</span>
                    <span>seen {relativeTime(creator.lastSeenAt ?? creator.observedAt)}</span>
                  </span>

                  {(creator.matchReasons?.length || creator.discoveryReasons?.length) && (
                    <span className="mt-3 flex flex-wrap gap-1.5">
                      {(creator.matchReasons ?? creator.discoveryReasons ?? []).slice(0, 3).map((reason) => (
                        <span key={reason} className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] tracking-[0.02em] text-ink-2">
                          {reason}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </article>
            )
          })}
        </div>
      )}

      <CreatorDrawer creator={activeCreator} onClose={() => setActiveCreator(null)} />
    </div>
  )
}
