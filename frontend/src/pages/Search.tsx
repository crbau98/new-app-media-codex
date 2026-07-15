import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { ExternalLink, Eye, Heart, Search, Sparkles, Users, X } from 'lucide-react'
import EmptyState from '@/components/EmptyState'
import MediaCard from '@/components/MediaCard'
import MediaDetail from '@/components/MediaDetail'
import SkeletonGrid from '@/components/SkeletonGrid'
import { fetchLiveDiscovery, searchMedia, type MediaFilters } from '@/lib/api'
import type { Creator, MediaItem } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

type ResultTab = 'all' | 'videos' | 'creators'
type SearchSort = 'smart' | 'mostViewed' | 'mostLiked' | 'newest'

function metric(value = 0): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function CreatorResult({ creator, onSelect }: { creator: Creator; onSelect: (creator: Creator) => void }) {
  return (
    <motion.article initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <button onClick={() => onSelect(creator)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <img src={creator.avatar} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" loading="lazy" />
        <span className="min-w-0">
          <strong className="block truncate text-sm text-[var(--text-primary)]">@{creator.username || creator.name}</strong>
          <span className="mt-1 flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]"><span className="flex items-center gap-1"><Eye size={11} /> {metric(creator.viewCount)}</span><span className="flex items-center gap-1"><Heart size={11} /> {metric(creator.likeCount)}</span></span>
        </span>
      </button>
      {creator.profileUrl && <a href={creator.profileUrl} target="_blank" rel="noreferrer" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]" aria-label={`Open ${creator.name} on ${creator.platform || 'source'}`}><ExternalLink size={14} /></a>}
    </motion.article>
  )
}

export default function SearchPage() {
  const query = useAppStore((state) => state.searchQuery)
  const setQuery = useAppStore((state) => state.setSearchQuery)
  const [tab, setTab] = useState<ResultTab>('all')
  const [sort, setSort] = useState<SearchSort>('smart')
  const [highDemand, setHighDemand] = useState(false)
  const [creator, setCreator] = useState<Creator | null>(null)
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [deferredQuery, setDeferredQuery] = useState(query.trim())
  const creatorWatchlist = useAppStore((state) => state.creatorWatchlist)
  const hiddenMedia = useAppStore((state) => state.hiddenMedia)

  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredQuery(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  const apiSort: MediaFilters['sort'] = sort === 'mostViewed' ? 'mostViewed' : sort === 'mostLiked' ? 'topRated' : sort === 'newest' ? 'newest' : 'smart'
  const discoveryQuery = useQuery({
    queryKey: ['live-discovery', 'search', creatorWatchlist],
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  const searchQuery = useQuery({
    queryKey: ['search', deferredQuery, sort, creatorWatchlist],
    queryFn: () => searchMedia(deferredQuery, { sort: apiSort, watchlist: creatorWatchlist }),
    enabled: Boolean(deferredQuery),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
  const data = deferredQuery ? searchQuery.data : discoveryQuery.data
  const isLoading = deferredQuery ? searchQuery.isLoading : discoveryQuery.isLoading
  const isError = deferredQuery ? searchQuery.isError : discoveryQuery.isError
  const isFetching = deferredQuery ? searchQuery.isFetching : discoveryQuery.isFetching
  const refetch = deferredQuery ? searchQuery.refetch : discoveryQuery.refetch
  const creators = useMemo(() => discoveryQuery.data?.performers ?? [], [discoveryQuery.data?.performers])
  const creatorsLoading = discoveryQuery.isLoading

  const media = useMemo(() => {
    let result = (data?.items ?? []).filter((item) => !hiddenMedia.includes(item.id))
    if (creator) result = result.filter((item) => item.creator.toLowerCase() === creator.name.toLowerCase())
    if (highDemand) result = result.filter((item) => (item.curationScore || 0) >= 65)
    if (sort === 'smart') result = [...result].sort((a, b) => (b.curationScore || 0) - (a.curationScore || 0))
    if (sort === 'mostLiked') result = [...result].sort((a, b) => (b.likes || 0) - (a.likes || 0))
    return result
  }, [creator, data?.items, hiddenMedia, highDemand, sort])
  const creatorResults = useMemo(() => {
    const needle = deferredQuery.toLowerCase()
    return creators.filter((candidate) => !needle || `${candidate.name} ${candidate.username || ''}`.toLowerCase().includes(needle)).slice(0, tab === 'creators' ? 40 : 8)
  }, [creators, deferredQuery, tab])

  const chooseCreator = useCallback((next: Creator) => {
    setCreator(next)
    setQuery(next.name)
    setTab('videos')
  }, [setQuery])

  return (
    <div className="space-y-6">
      <header className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 sm:p-7">
        <span className="eyebrow inline-flex items-center gap-1.5 text-[var(--accent)]"><Search size={13} /> DISCOVER</span>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">Find creators and public posts</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">Search creator handles, source-provided descriptions, and tags. Every result preserves its original source.</p>
        <label className="mt-6 flex min-h-14 items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-medium)] bg-[var(--bg-base)] px-4 focus-within:border-[var(--accent)]">
          <Search size={19} className="shrink-0 text-[var(--text-tertiary)]" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setCreator(null) }} placeholder="Search a creator, tag, or description" className="w-full bg-transparent text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" autoComplete="off" />
          {query && <button onClick={() => { setQuery(''); setCreator(null) }} className="grid h-9 w-9 place-items-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-surface)]" aria-label="Clear search"><X size={16} /></button>}
        </label>
      </header>

      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/95 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-1 rounded-full bg-[var(--bg-surface)] p-1">
          {([['all', 'All'], ['videos', 'Videos'], ['creators', 'Creators']] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={cn('rounded-full px-3 py-1.5 text-xs font-medium', tab === value ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]')}>{label}</button>)}
        </div>
        <button onClick={() => setHighDemand((value) => !value)} className={cn('rounded-full border px-3 py-2 text-xs', highDemand ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]')}><Sparkles size={12} className="mr-1 inline" /> High demand</button>
        <select value={sort} onChange={(event) => setSort(event.target.value as SearchSort)} className="ml-auto rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none" aria-label="Sort results">
          <option value="smart">Smart relevance</option><option value="mostViewed">Most watched</option><option value="mostLiked">Most liked</option><option value="newest">Newest</option>
        </select>
      </div>

      {creator && <section className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--accent)]/40 bg-[var(--accent-dim)] p-3"><img src={creator.avatar} alt="" className="h-11 w-11 rounded-full object-cover" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[var(--text-primary)]">Showing @{creator.username || creator.name}</p><p className="text-xs text-[var(--text-tertiary)]">{creator.mediaCount || 0} observed public posts</p></div><button onClick={() => { setCreator(null); setQuery('') }} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5" aria-label="Clear creator filter"><X size={15} /></button></section>}

      {(tab === 'all' || tab === 'creators') && (creatorsLoading ? <SkeletonGrid count={4} /> : creatorResults.length ? <section><div className="mb-3 flex items-center gap-2"><Users size={16} className="text-[var(--accent)]" /><h2 className="font-semibold text-[var(--text-primary)]">Creators</h2><span className="text-xs text-[var(--text-tertiary)]">{creatorResults.length} matches</span></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{creatorResults.map((item) => <CreatorResult key={item.id} creator={item} onSelect={chooseCreator} />)}</div></section> : deferredQuery && <EmptyState variant="search" title="No creator handle matched" description="Try a shorter handle or browse the current creator directory." />)}

      {(tab === 'all' || tab === 'videos') && <section>
        <div className="mb-3 flex items-center gap-2"><Sparkles size={16} className="text-[var(--accent)]" /><h2 className="font-semibold text-[var(--text-primary)]">Public posts</h2>{isFetching && <span className="text-xs text-[var(--text-tertiary)]">Updating…</span>}</div>
        {isLoading ? <SkeletonGrid count={12} /> : isError ? <EmptyState variant="error" title="Search source unavailable" description="The public provider did not respond. Retry without losing your search." actionLabel="Retry" onAction={() => refetch()} /> : media.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{media.map((item) => <MediaCard key={item.id} item={item} onSelect={() => setSelected(item)} />)}</div> : <EmptyState variant="search" title="No public posts matched" description="Try fewer words, another creator, or remove the high-demand filter." actionLabel="Clear filters" onAction={() => { setQuery(''); setCreator(null); setHighDemand(false) }} />}
      </section>}

      <MediaDetail item={selected} open={Boolean(selected)} onClose={() => setSelected(null)} />
    </div>
  )
}
