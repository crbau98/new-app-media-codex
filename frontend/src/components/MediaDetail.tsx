import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { apiUrl, resolvePublicUrl } from '@/lib/backendOrigin'
import {
  mediaItems,
  creators,
  type MediaItem,
} from '@/lib/mockData'
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Download,
  X,
  Play,
  ExternalLink,
  MoreHorizontal,
  Send,
  ThumbsUp,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

/* ────────────────────────────────────────────────
   Easing constants
   ──────────────────────────────────────────────── */
const easeOutExpo = [0.16, 1, 0.3, 1] as [number, number, number, number]
const easeSpring = [0.34, 1.56, 0.64, 1] as [number, number, number, number]

/* ────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────── */
function formatViews(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const hours = Math.floor((+now - +d) / 3600000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

/* ────────────────────────────────────────────────
   Mock Comments Data
   ──────────────────────────────────────────────── */
const mockComments = [
  {
    id: 'c1',
    name: 'Alex Stone',
    avatar: 'https://placebeard.it/64/64/1?grayscale=false',
    time: '2h ago',
    text: 'This is absolutely incredible. The cinematography is next level!',
    likes: 24,
  },
  {
    id: 'c2',
    name: 'Jordan Riley',
    avatar: 'https://placebeard.it/64/64/2?grayscale=false',
    time: '5h ago',
    text: 'Been waiting for something like this. Quality content right here.',
    likes: 18,
  },
  {
    id: 'c3',
    name: 'Drew Kane',
    avatar: 'https://placebeard.it/64/64/3?grayscale=false',
    time: '1d ago',
    text: 'The lighting in this one is perfect. Great work!',
    likes: 12,
  },
  {
    id: 'c4',
    name: 'Sam Cruz',
    avatar: 'https://placebeard.it/64/64/4?grayscale=false',
    time: '1d ago',
    text: 'One of my favorites from this creator. Always delivers.',
    likes: 9,
  },
  {
    id: 'c5',
    name: 'Mason Fox',
    avatar: 'https://placebeard.it/64/64/5?grayscale=false',
    time: '2d ago',
    text: 'Worth every second. Bookmarked for sure.',
    likes: 7,
  },
]

/* ────────────────────────────────────────────────
   Video Player Component
   ──────────────────────────────────────────────── */
function VideoPlayer({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false)
  const [streamUrl, setStreamUrl] = useState(item.mediaUrl)
  const [recovering, setRecovering] = useState(false)
  const attemptedRef = useRef<Set<string>>(new Set(item.mediaUrl ? [item.mediaUrl] : []))

  useEffect(() => {
    setFailed(false)
    setRecovering(false)
    setStreamUrl(item.mediaUrl)
    attemptedRef.current = new Set(item.mediaUrl ? [item.mediaUrl] : [])
  }, [item.id, item.mediaUrl])

  const recoverStream = useCallback(async () => {
    if (recovering) return
    setRecovering(true)
    try {
      const response = await fetch(apiUrl(`/api/screenshots/${item.id}/resolve-stream`), {
        method: 'POST',
      })
      if (!response.ok) throw new Error(`Stream recovery failed (${response.status})`)
      const data = await response.json() as {
        cached_url?: string | null
        local_url?: string | null
        direct_url?: string | null
      }
      const candidates = [data.cached_url, data.local_url, data.direct_url]
        .map(resolvePublicUrl)
        .filter(Boolean)
      const next = candidates.find((candidate) => !attemptedRef.current.has(candidate))
      if (!next) throw new Error('No alternate stream available')
      attemptedRef.current.add(next)
      setStreamUrl(next)
    } catch {
      setFailed(true)
    } finally {
      setRecovering(false)
    }
  }, [item.id, recovering])

  if (!streamUrl || failed) {
    return (
      <div className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-[var(--radius-lg)] bg-[var(--bg-darkest)]">
        <img src={item.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35 blur-sm" />
        <div className="relative z-10 flex max-w-xs flex-col items-center gap-3 px-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-white"><Play size={20} /></div>
          <p className="text-sm font-medium text-white">Playback is not available from this source.</p>
          {item.pageUrl && (
            <a href={item.pageUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">
              Open original <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <video
        key={streamUrl}
        src={streamUrl}
        poster={item.thumbnail}
        controls
        playsInline
        preload="metadata"
        onError={recoverStream}
        className="aspect-video w-full rounded-[var(--radius-lg)] bg-black object-contain"
      >
        Your browser does not support video playback.
      </video>
      {recovering && (
        <div className="absolute inset-0 grid place-items-center rounded-[var(--radius-lg)] bg-black/70 text-sm font-medium text-white">
          Connecting to an alternate stream…
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────
   Heart Burst Animation
   ──────────────────────────────────────────────── */
function HeartBurst({ trigger }: { trigger: number }) {
  const particles = useMemo(() => Array.from({ length: 8 }), [])

  return (
    <AnimatePresence>
      {trigger > 0 && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          {particles.map((_, i) => {
            const angle = (i / particles.length) * 2 * Math.PI
            const dist = 20 + Math.random() * 15
            const x = Math.cos(angle) * dist
            const y = Math.sin(angle) * dist
            return (
              <motion.div
                key={`${trigger}-${i}`}
                initial={{ opacity: 1, scale: 0.5, x: 0, y: 0 }}
                animate={{ opacity: 0, scale: 0, x, y }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: easeOutExpo }}
                className="absolute w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
              />
            )
          })}
        </div>
      )}
    </AnimatePresence>
  )
}

/* ────────────────────────────────────────────────
   Engagement Bar
   ──────────────────────────────────────────────── */
function EngagementBar({
  item,
  onShare,
}: {
  item: MediaItem
  onShare?: () => void
}) {
  const likeCache = useAppStore((s) => s.likeCache)
  const toggleLike = useAppStore((s) => s.toggleLike)
  const liked = likeCache[item.id] ?? item.isLiked ?? false
  const [likeCount, setLikeCount] = useState(item.likes ?? 0)
  const [burstTrigger, setBurstTrigger] = useState(0)

  const handleShare = useCallback(async () => {
    if (onShare) return onShare()
    const url = item.pageUrl || window.location.href
    if (navigator.share) await navigator.share({ title: item.title, url })
    else await navigator.clipboard.writeText(url)
  }, [item.pageUrl, item.title, onShare])

  const handleLike = useCallback(() => {
    toggleLike(item.id)
    if (!liked) {
      setLikeCount((c) => c + 1)
      setBurstTrigger((t) => t + 1)
    } else {
      setLikeCount((c) => Math.max(0, c - 1))
    }
  }, [item.id, liked, toggleLike])

  const actions = [
    {
      key: 'like',
      icon: Heart,
      active: liked,
      count: likeCount,
      onClick: handleLike,
      hasBurst: true,
    },
    {
      key: 'share',
      icon: Share2,
      active: false,
      count: null,
      onClick: handleShare,
    },
  ]

  return (
    <div className="flex items-center gap-1 py-3 border-b border-[var(--border-subtle)]">
      {actions.map((action, i) => {
        const Icon = action.icon
        return (
          <motion.button
            key={action.key}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05, duration: 0.3, ease: easeSpring }}
            onClick={action.onClick}
            className={cn(
              'relative flex items-center gap-1.5 px-3 py-2 rounded-md transition-colors',
              action.active
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
            )}
          >
            <motion.div
              animate={
                action.key === 'like' && action.active
                  ? { scale: [1, 1.4, 1] }
                  : {}
              }
              transition={{ duration: 0.3, ease: easeSpring }}
            >
              <Icon
                size={18}
                className={cn(action.active && action.key === 'like' && 'fill-[var(--accent)]')}
              />
            </motion.div>
            {action.count !== null && (
              <span className="text-[11px] font-mono text-[var(--text-tertiary)]">
                {action.count}
              </span>
            )}
            {action.hasBurst && <HeartBurst trigger={burstTrigger} />}
          </motion.button>
        )
      })}
    </div>
  )
}

/* ────────────────────────────────────────────────
   Metadata Panel
   ──────────────────────────────────────────────── */
function MetadataPanel({ item }: { item: MediaItem }) {
  const fields = [
    { label: 'Source', value: item.source },
    { label: 'Uploaded', value: timeAgo(item.createdAt) },
    { label: 'Format', value: item.isVideo ? 'Video' : 'Image' },
    { label: 'Views', value: formatViews(item.views) },
  ]

  return (
    <div className="py-3 border-b border-[var(--border-subtle)]">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {fields.map((field) => (
          <div key={field.label}>
            <span className="text-[11px] text-[var(--text-tertiary)] block">{field.label}</span>
            <span className="text-[13px] text-[var(--text-secondary)]">{field.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────
   Tags Section
   ──────────────────────────────────────────────── */
function TagsSection({ tags }: { tags: string[] }) {
  return (
    <div className="py-3 border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar pb-1">
        {tags.map((tag) => (
          <button
            key={tag}
            className="shrink-0 px-3 py-1 rounded-full bg-[var(--bg-surface)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-colors"
          >
            #{tag}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────
   Related Media
   ──────────────────────────────────────────────── */
function RelatedMedia({
  currentId,
  onSelect,
}: {
  currentId: string
  onSelect: (item: MediaItem) => void
}) {
  const related = useMemo(() => {
    return mediaItems
      .filter((m) => m.id !== currentId)
      .slice(0, 6)
  }, [currentId])

  return (
    <div className="py-3">
      <h4 className="text-[13px] font-semibold text-[var(--text-primary)] mb-2 uppercase tracking-wider">
        Related
      </h4>
      <div className="grid grid-cols-3 gap-2">
        {related.map((item, i) => (
          <motion.button
            key={item.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.3, ease: easeOutExpo }}
            onClick={() => onSelect(item)}
            className="relative aspect-square rounded-[var(--radius-md)] overflow-hidden border border-[var(--border-subtle)] group cursor-pointer"
          >
            <img
              src={item.thumbnail}
              alt={item.title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,3,5,0.5)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          </motion.button>
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────
   Comments Thread
   ──────────────────────────────────────────────── */
function CommentsThread() {
  const [likedComments, setLikedComments] = useState<Record<string, boolean>>({})

  const toggleCommentLike = useCallback((id: string) => {
    setLikedComments((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  return (
    <div className="py-3">
      <h4 className="text-[13px] font-semibold text-[var(--text-primary)] mb-3 uppercase tracking-wider">
        12 comments
      </h4>

      {/* Comment input */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-xs font-bold">
          U
        </div>
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
          <input
            type="text"
            placeholder="Add a comment..."
            className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <button className="text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors">
            <Send size={14} />
          </button>
        </div>
      </div>

      {/* Comments list */}
      <div className="space-y-3">
        {mockComments.map((comment, i) => (
          <motion.div
            key={comment.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.3, ease: easeOutExpo }}
            className="flex gap-2"
          >
            <img
              src={comment.avatar}
              alt={comment.name}
              className="w-8 h-8 rounded-full object-cover shrink-0"
              loading="lazy"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                  {comment.name}
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)]">{comment.time}</span>
              </div>
              <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">{comment.text}</p>
              <div className="flex items-center gap-3 mt-1">
                <button
                  onClick={() => toggleCommentLike(comment.id)}
                  className={cn(
                    'flex items-center gap-1 text-[11px] transition-colors',
                    likedComments[comment.id]
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  )}
                >
                  <ThumbsUp size={12} />
                  <span>
                    {comment.likes + (likedComments[comment.id] ? 1 : 0)}
                  </span>
                </button>
                <button className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
                  Reply
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────
   Media Detail Drawer
   ──────────────────────────────────────────────── */
interface MediaDetailProps {
  item: MediaItem | null
  open: boolean
  onClose: () => void
  onShare?: () => void
}

export default function MediaDetail({ item, open, onClose, onShare }: MediaDetailProps) {
  const [activeItem, setActiveItem] = useState<MediaItem | null>(item)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sync active item when prop changes
  useEffect(() => {
    if (item) setActiveItem(item)
  }, [item])

  // Handle keyboard: Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  const handleSelectRelated = useCallback((relatedItem: MediaItem) => {
    setActiveItem(relatedItem)
  }, [])

  const creator = useMemo(() => {
    if (!activeItem) return null
    return creators.find((c) => c.name === activeItem.creator) ?? null
  }, [activeItem])

  const followCache = useAppStore((s) => s.followCache)
  const toggleFollow = useAppStore((s) => s.toggleFollow)

  return (
    <AnimatePresence>
      {open && activeItem && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-stretch justify-end">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="media-detail-title"
            initial={{ x: '100%', opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0.5 }}
            transition={{ duration: 0.4, ease: easeOutExpo }}
            className="relative z-10 w-full md:w-[480px] md:max-w-[90vw] h-[85vh] md:h-full bg-[var(--bg-elevated)] md:rounded-l-[var(--radius-xl)] rounded-t-[var(--radius-xl)] overflow-hidden flex flex-col shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="md:hidden w-full flex justify-center pt-2 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-[var(--border-medium)]" />
            </div>

            {/* Close button */}
            <div className="shrink-0 flex items-center justify-end px-4 pt-2 md:pt-4 pb-1">
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto hide-scrollbar px-4 pb-6">
              {/* Hero Section */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.4, ease: easeOutExpo }}
                className="mb-4"
              >
                {activeItem.isVideo ? (
                  <VideoPlayer item={activeItem} />
                ) : (
                  <div className="relative w-full aspect-[4/5] md:aspect-video bg-[var(--bg-darkest)] rounded-[var(--radius-lg)] overflow-hidden">
                    <img
                      src={activeItem.thumbnail}
                      alt={activeItem.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,3,5,0.6)] to-transparent" />
                  </div>
                )}

                {/* Caption overlay */}
                <div className="mt-3">
                  <h2 id="media-detail-title" className="text-xl font-bold text-[var(--text-primary)] leading-tight">
                    {activeItem.title}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    {creator && (
                      <img
                        src={creator.avatar}
                        alt={creator.name}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                    )}
                    <span className="text-[13px] text-[var(--text-secondary)]">
                      {activeItem.creator}
                    </span>
                  </div>
                </div>
              </motion.div>

              {/* Creator Block */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.4, ease: easeOutExpo }}
                className="flex items-center gap-3 py-3 border-b border-[var(--border-subtle)]"
              >
                {creator ? (
                  <img
                    src={creator.avatar}
                    alt={creator.name}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-xs text-[var(--text-tertiary)]">
                    {activeItem.creator.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {activeItem.creator}
                  </h3>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    @
                    {activeItem.creator.toLowerCase().replace(/\s+/g, '')}
                  </span>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => creator && toggleFollow(creator.id)}
                  className={cn(
                    'px-4 py-1.5 rounded-full text-xs font-medium transition-colors',
                    creator && followCache[creator.id]
                      ? 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-medium)]'
                      : 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
                  )}
                >
                  {creator && followCache[creator.id] ? 'Following' : 'Follow'}
                </motion.button>
              </motion.div>

              {/* Engagement Bar */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.26, duration: 0.4, ease: easeOutExpo }}
              >
                <EngagementBar item={activeItem} onShare={onShare} />
              </motion.div>

              {/* Metadata */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.34, duration: 0.4, ease: easeOutExpo }}
              >
                <MetadataPanel item={activeItem} />
              </motion.div>

              {/* Tags */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.42, duration: 0.4, ease: easeOutExpo }}
              >
                <TagsSection tags={activeItem.tags} />
              </motion.div>

              {activeItem.description && <p className="py-4 text-sm leading-6 text-[var(--text-secondary)]">{activeItem.description}</p>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
