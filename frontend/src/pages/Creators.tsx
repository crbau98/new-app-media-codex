import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Eye, Heart, Plus, Radar, RefreshCw, Search, Sparkles, Users, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { fetchLiveCreatorDirectory } from '@/lib/api'
import type { Creator, MediaItem } from '@/lib/mockData'
import MediaCard from '@/components/MediaCard'
import MediaDetail from '@/components/MediaDetail'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'

type CreatorSort = 'Smart picks' | 'Most watched' | 'Most liked' | 'A–Z'
type CreatorFilter = 'all' | 'ai-matches' | 'high-demand'

function formatMetric(value = 0): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function observedMedia(creator: Creator): MediaItem[] {
  return creator.media ?? []
}

function CreatorCard({
  creator,
  index,
  following,
  onFollow,
  onOpen,
}: {
  creator: Creator
  index: number
  following: boolean
  onFollow: () => void
  onOpen: () => void
}) {
  const media = observedMedia(creator)
  const cover = media[0]

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.035, 0.35), duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open creator ${creator.name}`}
      className="group overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] cursor-pointer card-lift"
    >
      <div className="relative h-28 overflow-hidden bg-[var(--bg-surface)]">
        {cover && <img src={cover.thumbnail} alt="" className="h-full w-full object-cover opacity-70 transition-transform duration-500 group-hover:scale-105" loading="lazy" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-elevated)] via-transparent to-transparent" />
        <span className="absolute right-2 top-2 rounded-full border border-white/15 bg-black/35 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm">
          {creator.platform || 'Public source'}
        </span>
      </div>

      <div className="relative px-4 pb-4">
        <div className="-mt-8 flex items-end justify-between gap-3">
          <img
            src={creator.avatar || cover?.thumbnail}
            alt={creator.name}
            className="h-16 w-16 rounded-full border-4 border-[var(--bg-elevated)] object-cover bg-[var(--bg-surface)]"
            loading="lazy"
          />
          <span className="mb-1 flex items-center gap-1 rounded-full bg-[var(--accent-dim)] px-2 py-1 text-[10px] font-semibold text-[var(--accent)]">
            {creator.isWatched ? <><Radar size={11} /> On radar</> : creator.isSimilar ? <><Sparkles size={11} /> {creator.similarityScore}% AI match</> : <><Sparkles size={11} /> {creator.curationScore || 0} public signal</>}
          </span>
        </div>

        <div className="mt-2 min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">{creator.name}</h2>
          <p className="truncate text-xs text-[var(--text-tertiary)]">@{creator.username || creator.name.replace(/\s+/g, '').toLowerCase()}</p>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div><p className="text-sm font-semibold text-[var(--text-primary)]">{creator.mediaCount || media.length}</p><p className="text-[10px] text-[var(--text-muted)]">clips</p></div>
          <div><p className="text-sm font-semibold text-[var(--text-primary)]">{formatMetric(creator.viewCount)}</p><p className="text-[10px] text-[var(--text-muted)]">watched</p></div>
          <div><p className="text-sm font-semibold text-[var(--text-primary)]">{formatMetric(creator.likeCount)}</p><p className="text-[10px] text-[var(--text-muted)]">liked</p></div>
        </div>

        <button
          onClick={(event) => {
            event.stopPropagation()
            onFollow()
          }}
          className={cn(
            'mt-4 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-2 text-sm font-medium transition-colors',
            following ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]' : 'btn-primary'
          )}
        >
          {following ? <><Check size={14} /> Following</> : 'Follow'}
        </button>
      </div>
    </motion.article>
  )
}

function CreatorDrawer({ creator, onClose }: { creator: Creator | null; onClose: () => void }) {
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const media = creator ? observedMedia(creator) : []

  return (
    <AnimatePresence>
      {creator && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-[var(--bg-overlay)]" onClick={onClose} />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="fixed inset-y-0 right-0 z-[101] w-full max-w-[540px] overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-base)] p-5"
          >
            <button onClick={onClose} className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-[var(--bg-overlay)] text-white" aria-label="Close creator">
              <X size={17} />
            </button>
            <div className="relative -mx-5 -mt-5 h-48 overflow-hidden bg-[var(--bg-surface)]">
              {media[0] && <img src={media[0].thumbnail} alt="" className="h-full w-full object-cover opacity-55" />}
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-base)] to-transparent" />
            </div>
            <div className="-mt-12 relative">
              <img src={creator.avatar || media[0]?.thumbnail} alt={creator.name} className="h-24 w-24 rounded-full border-4 border-[var(--bg-base)] object-cover bg-[var(--bg-surface)]" />
              <h2 className="mt-3 text-2xl font-bold text-[var(--text-primary)]">{creator.name}</h2>
              <p className="text-sm text-[var(--text-secondary)]">@{creator.username || creator.name.replace(/\s+/g, '').toLowerCase()} · {creator.sourceAttribution || creator.platform}</p>
            </div>

            <div className="my-6 grid grid-cols-3 divide-x divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-3 text-center">
              <div><p className="font-semibold text-[var(--text-primary)]">{creator.mediaCount || media.length}</p><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Observed</p></div>
              <div><p className="font-semibold text-[var(--text-primary)]">{formatMetric(creator.viewCount)}</p><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Public views</p></div>
              <div><p className="font-semibold text-[var(--text-primary)]">{formatMetric(creator.likeCount)}</p><p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Public likes</p></div>
            </div>

            {creator.isSimilar && creator.discoveryReasons?.length ? (
              <section className="mb-5 rounded-[var(--radius-md)] border border-[var(--accent)]/30 bg-[var(--accent-dim)] p-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]"><Sparkles size={14} /> Why AI suggested this creator</p>
                <div className="mt-3 flex flex-wrap gap-2">{creator.discoveryReasons.map((reason) => <span key={reason} className="rounded-full bg-[var(--bg-base)]/70 px-2.5 py-1 text-xs text-[var(--text-secondary)]">{reason}</span>)}</div>
              </section>
            ) : null}

            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[var(--text-primary)]">Latest public posts</h3>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">Source attribution is preserved; use the source to support a creator directly.</p>
              </div>
              {creator.profileUrl && <a href={creator.profileUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-[var(--border-medium)] px-3 py-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"><ExternalLink size={13} className="mr-1 inline" /> Source</a>}
            </div>

            {media.length ? (
              <div className="grid grid-cols-2 gap-3">
                {media.map((item) => <MediaCard key={item.id} item={item} onSelect={() => setSelectedMedia(item)} />)}
              </div>
            ) : (
              <EmptyState variant="category" title="No source posts available" description="The creator was observed, but the source did not return playable public media." />
            )}
          </motion.aside>
          <MediaDetail item={selectedMedia} open={Boolean(selectedMedia)} onClose={() => setSelectedMedia(null)} />
        </>
      )}
    </AnimatePresence>
  )
}

export default function CreatorsPage() {
  const [query, setQuery] = useState('')
  const [watchInput, setWatchInput] = useState('')
  const [sort, setSort] = useState<CreatorSort>('Smart picks')
  const [filter, setFilter] = useState<CreatorFilter>('all')
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null)
  const [isScanningNow, setIsScanningNow] = useState(false)
  const queryClient = useQueryClient()
  const followCache = useAppStore((state) => state.followCache)
  const toggleFollow = useAppStore((state) => state.toggleFollow)
  const addToast = useAppStore((state) => state.addToast)
  const creatorWatchlist = useAppStore((state) => state.creatorWatchlist)
  const addCreatorToWatchlist = useAppStore((state) => state.addCreatorToWatchlist)
  const removeCreatorFromWatchlist = useAppStore((state) => state.removeCreatorFromWatchlist)
  const directoryQueryKey = useMemo(() => ['live-creators', 'directory', creatorWatchlist] as const, [creatorWatchlist])
  const { data: creators = [], isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: directoryQueryKey,
    queryFn: () => fetchLiveCreatorDirectory(creatorWatchlist),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  })

  const visibleCreators = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const result = creators
      .filter((creator) => !normalized || [creator.name, creator.username || '', creator.platform || ''].join(' ').toLowerCase().includes(normalized))
      .filter((creator) => filter !== 'high-demand' || (creator.curationScore || 0) >= 65)
      .filter((creator) => filter !== 'ai-matches' || creator.isSimilar)
    return [...result].sort((a, b) => {
      if (sort === 'Most watched') return (b.viewCount || 0) - (a.viewCount || 0)
      if (sort === 'Most liked') return (b.likeCount || 0) - (a.likeCount || 0)
      if (sort === 'A–Z') return a.name.localeCompare(b.name)
      return Number(b.isWatched) - Number(a.isWatched) || (b.similarityScore || 0) - (a.similarityScore || 0) || (b.curationScore || 0) - (a.curationScore || 0) || (b.viewCount || 0) - (a.viewCount || 0)
    })
  }, [creators, filter, query, sort])

  const follow = useCallback((creator: Creator) => {
    const isFollowing = !followCache[creator.id]
    toggleFollow(creator.id)
    if (isFollowing) addToast({ type: 'success', title: `Following @${creator.username || creator.name}` })
  }, [addToast, followCache, toggleFollow])

  const addWatch = useCallback((event: FormEvent) => {
    event.preventDefault()
    const candidate = watchInput.trim().replace(/^@/, '')
    if (candidate.length < 2) return
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(candidate)) {
      addToast({ type: 'error', title: 'Use a public handle or creator name—not an email' })
      return
    }
    const key = candidate.toLowerCase().replace(/[^a-z0-9]+/g, '')
    if (creatorWatchlist.some((item) => item.toLowerCase().replace(/[^a-z0-9]+/g, '') === key)) {
      addToast({ type: 'info', title: 'Creator is already on your radar' })
      return
    }
    if (creatorWatchlist.length >= 8) {
      addToast({ type: 'error', title: 'Creator radar is limited to 8 active searches' })
      return
    }
    addCreatorToWatchlist(candidate)
    setWatchInput('')
    addToast({ type: 'success', title: `Scanning public sources for @${candidate}` })
  }, [addCreatorToWatchlist, addToast, creatorWatchlist, watchInput])

  const scanNow = useCallback(async () => {
    if (isScanningNow) return
    setIsScanningNow(true)
    try {
      const freshCreators = await fetchLiveCreatorDirectory(creatorWatchlist, true)
      queryClient.setQueryData(directoryQueryKey, freshCreators)
      await queryClient.invalidateQueries({ queryKey: ['media'] })
      const aiMatches = freshCreators.filter((creator) => creator.isSimilar).length
      addToast({
        type: 'success',
        title: 'Fresh public-source scan complete',
        message: `${freshCreators.length} creators observed · ${aiMatches} AI matches`,
      })
    } catch {
      addToast({ type: 'error', title: 'Immediate scan could not complete', message: 'The public provider did not respond. Scheduled scanning remains active.' })
    } finally {
      setIsScanningNow(false)
    }
  }, [addToast, creatorWatchlist, directoryQueryKey, isScanningNow, queryClient])

  return (
    <div className="space-y-6">
      <header className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <span className="eyebrow text-[var(--accent)]">PERFORMER RADAR</span>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Public male creator discovery</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Search current source-attributed performers, save favorites, and surface public posts by engagement and freshness. Scores describe discovery signals—not anyone’s appearance.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]"><Users size={14} /> {creators.length} observed creators</div>
        </div>
      </header>

      <section className="rounded-[var(--radius-lg)] border border-[var(--accent)]/30 bg-[linear-gradient(135deg,var(--accent-dim),var(--bg-elevated)_55%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Radar size={17} className="text-[var(--accent)]" /> Automatic creator radar</div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Add a public handle or creator name. AI compares source tags to find adjacent creators, while the live app refreshes every two minutes and a background scan keeps the seeded radar warm. Emails are removed before anything is displayed.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span aria-live="polite" className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)]/60 px-3 py-1.5 text-[11px] text-[var(--text-secondary)]">
              {isFetching || isScanningNow ? 'Scanning sources…' : `${creators.filter((creator) => creator.isWatched).length} matched`} · {dataUpdatedAt ? `updated ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'waiting'}
            </span>
            <button onClick={scanNow} disabled={isScanningNow} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--accent)]/50 bg-[var(--bg-base)] px-3 text-xs font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent-dim)] disabled:cursor-wait disabled:opacity-60">
              <RefreshCw size={13} className={cn(isScanningNow && 'animate-spin')} /> {isScanningNow ? 'Scanning now' : 'Scan now'}
            </button>
          </div>
        </div>
        <form onSubmit={addWatch} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-medium)] bg-[var(--bg-base)] px-3 focus-within:border-[var(--accent)]">
            <Search size={15} className="text-[var(--text-tertiary)]" />
            <input value={watchInput} onChange={(event) => setWatchInput(event.target.value)} placeholder="Public handle or creator name" maxLength={50} className="w-full bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" />
          </label>
          <button type="submit" className="btn-primary flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-4 text-sm font-medium"><Plus size={15} /> Add to radar</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {creatorWatchlist.map((creator) => (
            <span key={creator} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)]/75 py-1 pl-3 pr-1.5 text-xs text-[var(--text-primary)]">
              @{creator}
              <button onClick={() => removeCreatorFromWatchlist(creator)} className="grid h-6 w-6 place-items-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]" aria-label={`Stop watching ${creator}`}><X size={12} /></button>
            </span>
          ))}
        </div>
      </section>

      <div className="sticky top-14 z-30 -mx-4 flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3 backdrop-blur-md">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search performer or platform" className="w-full bg-transparent outline-none placeholder:text-[var(--text-muted)]" />
        </label>
        <div className="flex items-center gap-1 rounded-full bg-[var(--bg-surface)] p-1">
          <button onClick={() => setFilter('all')} className={cn('rounded-full px-3 py-1.5 text-xs transition-colors', filter === 'all' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]')}>All</button>
          <button onClick={() => setFilter('ai-matches')} className={cn('rounded-full px-3 py-1.5 text-xs transition-colors', filter === 'ai-matches' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]')}>AI matches</button>
          <button onClick={() => setFilter('high-demand')} className={cn('rounded-full px-3 py-1.5 text-xs transition-colors', filter === 'high-demand' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]')}>High demand</button>
        </div>
        <select value={sort} onChange={(event) => setSort(event.target.value as CreatorSort)} className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none">
          {(['Smart picks', 'Most watched', 'Most liked', 'A–Z'] as const).map((option) => <option key={option}>{option}</option>)}
        </select>
      </div>

      {isError ? <EmptyState variant="error" title="Creator directory unavailable" description="The public source did not respond. Your local follows are unchanged." actionLabel="Retry" onAction={() => refetch()} /> : isLoading ? <SkeletonGrid count={10} /> : visibleCreators.length ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleCreators.map((creator, index) => <CreatorCard key={creator.id} creator={creator} index={index} following={Boolean(followCache[creator.id])} onFollow={() => follow(creator)} onOpen={() => setSelectedCreator(creator)} />)}
        </section>
      ) : (
        <EmptyState variant="search" title="No observed creators match" description="Try a different name, remove the demand filter, or check back when the public source refreshes." actionLabel="Clear filters" onAction={() => { setQuery(''); setFilter('all') }} />
      )}

      <CreatorDrawer creator={selectedCreator} onClose={() => setSelectedCreator(null)} />
    </div>
  )
}
