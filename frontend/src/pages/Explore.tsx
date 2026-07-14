import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  BrainCircuit,
  Eye,
  EyeOff,
  Heart,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import MediaCard from '@/components/MediaCard'
import MediaDetail from '@/components/MediaDetail'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import { fetchMedia } from '@/lib/api'
import { discoveryStrength, rankForYou, type DiscoveryMode } from '@/lib/discovery'
import type { MediaItem } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { useAppStore, type DiscoveryFeedback } from '@/store'

const MODES: Array<{ value: DiscoveryMode; label: string; description: string }> = [
  { value: 'balanced', label: 'Balanced', description: 'A mix of your taste and fresh discoveries' },
  { value: 'familiar', label: 'More familiar', description: 'Lean into creators and tags you already enjoy' },
  { value: 'adventurous', label: 'Explore', description: 'Prioritize variety and creators you have not seen' },
]

function formatMetric(value = 0): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function FeedbackBar({ item, onFeedback }: { item: MediaItem; onFeedback: (item: MediaItem, signal: DiscoveryFeedback) => void }) {
  return (
    <div className="flex items-center gap-1 border-t border-[var(--border-subtle)] px-2 py-2">
      <button onClick={() => onFeedback(item, 'more')} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-xs text-[var(--text-secondary)] hover:bg-[var(--accent-dim)] hover:text-[var(--accent)]" aria-label={`Show more like ${item.title}`}>
        <ThumbsUp size={13} /> More like this
      </button>
      <button onClick={() => onFeedback(item, 'less')} className="grid min-h-9 min-w-9 place-items-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]" aria-label={`Show less like ${item.title}`} title="Show less like this">
        <ThumbsDown size={13} />
      </button>
      <button onClick={() => onFeedback(item, 'hide')} className="grid min-h-9 min-w-9 place-items-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]" aria-label={`Hide ${item.title}`} title="Hide this post">
        <EyeOff size={13} />
      </button>
    </div>
  )
}

function DiscoveryCard({ item, onOpen, onFeedback }: { item: MediaItem; onOpen: (item: MediaItem) => void; onFeedback: (item: MediaItem, signal: DiscoveryFeedback) => void }) {
  return (
    <article className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
      <MediaCard item={item} onSelect={() => onOpen(item)} className="rounded-none border-0" />
      <div className="px-3 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">@{item.creator}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-tertiary)]">{item.recommendationReasons?.[0]}</p>
          </div>
          <span className="shrink-0 rounded-full bg-[var(--accent-dim)] px-2 py-1 text-[10px] font-semibold text-[var(--accent)]">{Math.round(item.personalizedScore || 0)}</span>
        </div>
      </div>
      <FeedbackBar item={item} onFeedback={onFeedback} />
    </article>
  )
}

export default function ExplorePage() {
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const tagPreferences = useAppStore((state) => state.tagPreferences)
  const creatorPreferences = useAppStore((state) => state.creatorPreferences)
  const followCache = useAppStore((state) => state.followCache)
  const likeCache = useAppStore((state) => state.likeCache)
  const recentlyViewed = useAppStore((state) => state.recentlyViewed)
  const hiddenMedia = useAppStore((state) => state.hiddenMedia)
  const mode = useAppStore((state) => state.discoveryMode)
  const setMode = useAppStore((state) => state.setDiscoveryMode)
  const recordFeedback = useAppStore((state) => state.recordDiscoveryFeedback)
  const addRecentlyViewed = useAppStore((state) => state.addRecentlyViewed)
  const resetProfile = useAppStore((state) => state.resetDiscoveryProfile)
  const addToast = useAppStore((state) => state.addToast)
  const creatorWatchlist = useAppStore((state) => state.creatorWatchlist)

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['media', 'for-you', creatorWatchlist],
    queryFn: () => fetchMedia({ sort: 'newest', watchlist: creatorWatchlist }, 1, 100),
    staleTime: 60_000,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
  })

  const sourceItems = useMemo(() => data?.items ?? [], [data?.items])
  const ranked = useMemo(() => rankForYou(sourceItems, {
    tagPreferences,
    creatorPreferences,
    followCache,
    likeCache,
    recentlyViewed,
    hiddenMedia,
    mode,
  }), [creatorPreferences, followCache, hiddenMedia, likeCache, mode, recentlyViewed, sourceItems, tagPreferences])
  const featured = ranked[0]
  const rest = ranked.slice(1)
  const strength = discoveryStrength(tagPreferences, creatorPreferences)
  const creatorCount = useMemo(() => new Set(sourceItems.map((item) => item.creator.toLowerCase())).size, [sourceItems])
  const topInterests = useMemo(() => Object.entries(tagPreferences)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6), [tagPreferences])

  const openItem = useCallback((item: MediaItem) => {
    addRecentlyViewed(item.id)
    recordFeedback(item, 'view')
    setSelected(item)
  }, [addRecentlyViewed, recordFeedback])

  const handleFeedback = useCallback((item: MediaItem, signal: DiscoveryFeedback) => {
    recordFeedback(item, signal)
    const title = signal === 'more' ? 'Your mix learned from this' : signal === 'hide' ? 'Hidden from your feed' : 'Your mix will show less like this'
    addToast({ type: 'info', title, message: 'Your taste profile stays on this device.' })
    if (signal === 'hide' && selected?.id === item.id) setSelected(null)
  }, [addToast, recordFeedback, selected?.id])

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[var(--accent-glow)] blur-[90px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <span className="eyebrow inline-flex items-center gap-1.5 text-[var(--accent)]"><BrainCircuit size={13} /> FOR YOU</span>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">A discovery feed that learns your taste</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">An explainable recommendation engine reorders public, source-attributed creator posts from your likes, follows, viewing, and direct feedback.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]"><ShieldCheck size={14} className="text-[var(--accent)]" /> Private on-device profile</div>
        </div>

        <div className="relative mt-6 grid grid-cols-3 gap-2 sm:max-w-lg">
          {MODES.map((option) => (
            <button key={option.value} onClick={() => setMode(option.value)} className={cn('rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors', mode === option.value ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--text-primary)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]')} title={option.description}>
              <span className="block text-xs font-semibold">{option.label}</span>
              <span className="mt-1 hidden text-[10px] leading-4 text-[var(--text-tertiary)] sm:block">{option.description}</span>
            </button>
          ))}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><p className="text-2xl font-bold text-[var(--text-primary)]">{strength}%</p><p className="mt-1 text-xs text-[var(--text-tertiary)]">Taste signal</p></div>
        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><p className="text-2xl font-bold text-[var(--text-primary)]">{sourceItems.length}</p><p className="mt-1 text-xs text-[var(--text-tertiary)]">Live posts</p></div>
        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><p className="text-2xl font-bold text-[var(--text-primary)]">{creatorCount}</p><p className="mt-1 text-xs text-[var(--text-tertiary)]">Creators in mix</p></div>
        <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><p className="text-sm font-semibold text-[var(--text-primary)]">{dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Connecting'}</p><button onClick={() => refetch()} disabled={isFetching} className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--accent)] disabled:opacity-50"><RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} /> Refresh mix</button></div>
      </section>

      {topInterests.length ? (
        <section className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Learning</span>
          {topInterests.map(([tag, value]) => <span key={tag} className="rounded-full bg-[var(--accent-dim)] px-3 py-1 text-xs text-[var(--accent)]">#{tag} · {value.toFixed(1)}</span>)}
          <button onClick={resetProfile} className="ml-auto text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">Reset taste</button>
        </section>
      ) : (
        <section className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-secondary)]"><Sparkles size={17} className="mt-0.5 shrink-0 text-[var(--accent)]" /><p>Start with the balanced public feed. Use <strong className="text-[var(--text-primary)]">More like this</strong>, likes, and follows to teach your mix—every recommendation stays explainable.</p></section>
      )}

      {isLoading ? <SkeletonGrid count={12} /> : isError ? (
        <EmptyState variant="error" title="The public feed is temporarily unavailable" description="Your taste profile is safe on this device. Retry the live source when your connection returns." actionLabel="Retry" onAction={() => refetch()} />
      ) : featured ? (
        <>
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative min-h-[340px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-darkest)] sm:min-h-[430px]">
            <img src={featured.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-transparent" />
            <div className="relative flex min-h-[340px] max-w-xl flex-col justify-end p-6 sm:min-h-[430px] sm:p-9">
              <span className="eyebrow flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-white"><Sparkles size={12} /> TOP MATCH</span>
              <h2 className="mt-3 line-clamp-2 text-2xl font-bold text-white sm:text-4xl">{featured.title}</h2>
              <p className="mt-2 text-sm text-white/70">@{featured.creator} · {formatMetric(featured.views)} public views</p>
              <div className="mt-4 flex flex-wrap gap-2">{featured.recommendationReasons?.map((reason) => <span key={reason} className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs text-white/80 backdrop-blur-sm">{reason}</span>)}</div>
              <div className="mt-6 flex flex-wrap gap-2">
                <button onClick={() => openItem(featured)} className="btn-primary"><Play size={16} fill="currentColor" /> Watch</button>
                <button onClick={() => handleFeedback(featured, 'more')} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/20 bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/15"><ThumbsUp size={15} /> More like this</button>
              </div>
            </div>
          </motion.section>

          <section>
            <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="text-xl font-semibold text-[var(--text-primary)]">Your smart mix</h2><p className="mt-1 text-xs text-[var(--text-tertiary)]">Re-ranked instantly as you give feedback</p></div><div className="hidden items-center gap-3 text-xs text-[var(--text-tertiary)] sm:flex"><span className="flex items-center gap-1"><Eye size={12} /> public views</span><span className="flex items-center gap-1"><Heart size={12} /> public likes</span></div></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rest.map((item) => <DiscoveryCard key={item.id} item={item} onOpen={openItem} onFeedback={handleFeedback} />)}</div>
          </section>
        </>
      ) : (
        <EmptyState variant="category" title="Your mix is clear" description="Refresh the public source or reset hidden posts to rebuild it." actionLabel="Reset taste" onAction={resetProfile} />
      )}

      <MediaDetail item={selected} open={Boolean(selected)} onClose={() => setSelected(null)} />
    </div>
  )
}
