import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, Eye, Heart, Play, Share2, Sparkles, ThumbsDown, ThumbsUp, UserPlus, X } from 'lucide-react'
import { apiUrl, resolvePublicUrl } from '@/lib/backendOrigin'
import type { MediaItem } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number]

function creatorId(name: string): string {
  return `redgifs-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')}`
}

function metric(value = 0): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function relativeDate(value: string): string {
  const milliseconds = Date.now() - Date.parse(value)
  if (!Number.isFinite(milliseconds)) return 'Date unavailable'
  const hours = Math.max(0, Math.floor(milliseconds / 3_600_000))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function VideoPlayer({ item }: { item: MediaItem }) {
  const autoplay = useAppStore((state) => state.autoplayVideos)
  const muteOnStart = useAppStore((state) => state.muteOnStart)
  const pictureInPicture = useAppStore((state) => state.pictureInPicture)
  const quality = useAppStore((state) => state.defaultQuality)
  const initial = useMemo(() => {
    const supplied = item.streamCandidates?.length ? item.streamCandidates : item.mediaUrl ? [item.mediaUrl] : []
    if (quality !== '720p' || supplied.length < 2) return supplied
    return [supplied[1], supplied[0], ...supplied.slice(2)]
  }, [item.mediaUrl, item.streamCandidates, quality])
  const [candidates, setCandidates] = useState(initial)
  const [index, setIndex] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setCandidates(initial)
    setIndex(0)
    setFailed(false)
    setRecovering(false)
  }, [initial, item.id])

  const recover = useCallback(async () => {
    if (index + 1 < candidates.length) {
      setIndex((value) => value + 1)
      return
    }
    if (item.id.startsWith('rg-') || recovering) {
      setFailed(true)
      return
    }
    setRecovering(true)
    try {
      const response = await fetch(apiUrl(`/api/screenshots/${item.id}/resolve-stream`), { method: 'POST' })
      if (!response.ok) throw new Error('No alternate stream')
      const data = await response.json() as { cached_url?: string; local_url?: string; direct_url?: string }
      const alternatives = [data.cached_url, data.local_url, data.direct_url].map(resolvePublicUrl).filter((url): url is string => Boolean(url))
      if (!alternatives.length) throw new Error('No alternate stream')
      setCandidates(alternatives)
      setIndex(0)
    } catch {
      setFailed(true)
    } finally {
      setRecovering(false)
    }
  }, [candidates.length, index, item.id, recovering])

  if (!candidates[index] || failed) {
    return (
      <div className="relative grid min-h-72 place-items-center overflow-hidden rounded-[var(--radius-lg)] bg-black">
        <img src={item.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 blur-md" />
        <div className="relative z-10 max-w-xs px-5 text-center"><Play className="mx-auto text-white" /><p className="mt-3 text-sm font-medium text-white">This stream is temporarily unavailable.</p>{item.pageUrl && <a href={item.pageUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black">Open original <ExternalLink size={14} /></a>}</div>
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-black">
      <video key={candidates[index]} src={candidates[index]} poster={item.thumbnail} controls playsInline preload="metadata" autoPlay={autoplay} muted={muteOnStart} disablePictureInPicture={!pictureInPicture} onError={recover} className="max-h-[68dvh] min-h-64 w-full object-contain">Your browser does not support video playback.</video>
      {(recovering || index > 0) && <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white backdrop-blur-sm">{recovering ? 'Finding another stream…' : `Fallback ${index + 1} connected`}</div>}
    </div>
  )
}

interface MediaDetailProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  onShare?: () => void
}

export default function MediaDetail({ item, open, onClose, onShare }: MediaDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const viewedRef = useRef<string | null>(null)
  const likeCache = useAppStore((state) => state.likeCache)
  const toggleLike = useAppStore((state) => state.toggleLike)
  const followCache = useAppStore((state) => state.followCache)
  const toggleFollow = useAppStore((state) => state.toggleFollow)
  const addRecentlyViewed = useAppStore((state) => state.addRecentlyViewed)
  const recordFeedback = useAppStore((state) => state.recordDiscoveryFeedback)
  const addToast = useAppStore((state) => state.addToast)
  const id = item ? creatorId(item.creator) : ''
  const liked = item ? Boolean(likeCache[item.id] ?? item.isLiked) : false
  const followed = Boolean(id && followCache[id])

  useEffect(() => {
    if (!open || !item || viewedRef.current === item.id) return
    viewedRef.current = item.id
    addRecentlyViewed(item.id)
    recordFeedback(item, 'view')
  }, [addRecentlyViewed, item, open, recordFeedback])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', closeOnEscape)
      previous?.focus()
    }
  }, [onClose, open])

  const share = useCallback(async () => {
    if (!item) return
    if (onShare) return onShare()
    const url = item.pageUrl || window.location.href
    if (navigator.share) await navigator.share({ title: item.title, url })
    else {
      await navigator.clipboard.writeText(url)
      addToast({ type: 'success', title: 'Source link copied' })
    }
  }, [addToast, item, onShare])

  const feedback = useCallback((signal: 'more' | 'less') => {
    if (!item) return
    recordFeedback(item, signal)
    addToast({ type: 'info', title: signal === 'more' ? 'Your mix learned from this' : 'Your mix will show less like this', message: 'Saved privately on this device.' })
  }, [addToast, item, recordFeedback])

  return (
    <AnimatePresence>
      {open && item && <div className="fixed inset-0 z-[200] flex items-end justify-end md:items-stretch">
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 h-full w-full bg-[var(--bg-overlay)] backdrop-blur-sm" aria-label="Close media details" />
        <motion.div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="media-title" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ duration: 0.35, ease: easeOut }} className="relative z-10 flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-xl)] bg-[var(--bg-elevated)] shadow-lg outline-none md:h-full md:max-w-[620px] md:rounded-l-[var(--radius-xl)] md:rounded-tr-none">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3"><span className="text-xs font-medium text-[var(--text-tertiary)]">Public source · {item.source}</span><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-[var(--bg-surface)] text-[var(--text-secondary)]" aria-label="Close"><X size={16} /></button></div>
          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4 sm:px-5">
            {item.isVideo ? <VideoPlayer item={item} /> : <img src={item.thumbnail} alt={item.title} className="max-h-[68dvh] w-full rounded-[var(--radius-lg)] object-contain" />}
            <div className="mt-5">
              <h2 id="media-title" className="text-xl font-bold leading-tight text-[var(--text-primary)]">{item.title}</h2>
              <div className="mt-3 flex items-center gap-3 border-b border-[var(--border-subtle)] pb-4"><div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--accent-dim)] text-sm font-bold text-[var(--accent)]">{item.creator.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[var(--text-primary)]">@{item.creator}</p><p className="text-xs text-[var(--text-tertiary)]">Observed on {item.source}</p></div><button onClick={() => toggleFollow(id)} className={cn('inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-xs font-semibold', followed ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]' : 'bg-[var(--accent)] text-white')}><UserPlus size={14} /> {followed ? 'Following' : 'Follow'}</button></div>

              <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border-subtle)] py-3">
                <button onClick={() => toggleLike(item.id)} className={cn('inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm', liked ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]')}><Heart size={17} className={liked ? 'fill-current' : ''} /> {metric((item.likes || 0) + (liked && !item.isLiked ? 1 : 0))}</button>
                <button onClick={share} className="inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"><Share2 size={17} /> Share</button>
                {item.pageUrl && <a href={item.pageUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)]">Original <ExternalLink size={14} /></a>}
              </div>

              <section className="border-b border-[var(--border-subtle)] py-4"><div className="flex items-center gap-2"><Sparkles size={15} className="text-[var(--accent)]" /><h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-primary)]">Why this appeared</h3></div><div className="mt-3 flex flex-wrap gap-2">{(item.recommendationReasons || item.curationReasons || ['Matches the current public feed']).map((reason) => <span key={reason} className="rounded-full bg-[var(--accent-dim)] px-3 py-1.5 text-xs text-[var(--accent)]">{reason}</span>)}</div><div className="mt-3 flex gap-2"><button onClick={() => feedback('more')} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"><ThumbsUp size={14} /> More like this</button><button onClick={() => feedback('less')} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--border-subtle)] px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"><ThumbsDown size={14} /> Less like this</button></div></section>

              <div className="grid grid-cols-3 gap-3 border-b border-[var(--border-subtle)] py-4 text-center"><div><Eye size={14} className="mx-auto text-[var(--text-tertiary)]" /><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{metric(item.views)}</p><p className="text-[10px] text-[var(--text-muted)]">views</p></div><div><Heart size={14} className="mx-auto text-[var(--text-tertiary)]" /><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{metric(item.likes)}</p><p className="text-[10px] text-[var(--text-muted)]">likes</p></div><div><Sparkles size={14} className="mx-auto text-[var(--text-tertiary)]" /><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{item.curationScore || 0}</p><p className="text-[10px] text-[var(--text-muted)]">public signal</p></div></div>
              <p className="mt-4 text-xs text-[var(--text-tertiary)]">Published {relativeDate(item.createdAt)} · Source metrics are sampled when this feed refreshes.</p>
              {item.description && <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">{item.description}</p>}
              <div className="mt-4 flex flex-wrap gap-2">{item.tags.map((tag) => <span key={tag} className="rounded-full bg-[var(--bg-surface)] px-3 py-1 text-xs text-[var(--text-secondary)]">#{tag}</span>)}</div>
            </div>
          </div>
        </motion.div>
      </div>}
    </AnimatePresence>
  )
}
