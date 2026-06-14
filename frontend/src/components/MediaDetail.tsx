import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
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
  Pause,
  Volume2,
  VolumeX,
  Maximize,
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/* ────────────────────────────────────────────────
   Mock Comments Data
   ──────────────────────────────────────────────── */
const mockComments = [
  {
    id: 'c1',
    name: 'Alex Stone',
    avatar: 'https://picsum.photos/seed/901/64/64',
    time: '2h ago',
    text: 'This is absolutely incredible. The cinematography is next level!',
    likes: 24,
  },
  {
    id: 'c2',
    name: 'Jordan Riley',
    avatar: 'https://picsum.photos/seed/902/64/64',
    time: '5h ago',
    text: 'Been waiting for something like this. Quality content right here.',
    likes: 18,
  },
  {
    id: 'c3',
    name: 'Drew Kane',
    avatar: 'https://picsum.photos/seed/903/64/64',
    time: '1d ago',
    text: 'The lighting in this one is perfect. Great work!',
    likes: 12,
  },
  {
    id: 'c4',
    name: 'Sam Cruz',
    avatar: 'https://picsum.photos/seed/904/64/64',
    time: '1d ago',
    text: 'One of my favorites from this creator. Always delivers.',
    likes: 9,
  },
  {
    id: 'c5',
    name: 'Mason Fox',
    avatar: 'https://picsum.photos/seed/905/64/64',
    time: '2d ago',
    text: 'Worth every second. Bookmarked for sure.',
    likes: 7,
  },
]

/* ────────────────────────────────────────────────
   Video Player Component
   ──────────────────────────────────────────────── */
function VideoPlayer({ poster }: { poster: string }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [volume, setVolume] = useState(true)
  const [showControls, setShowControls] = useState(true)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p)
  }, [])

  const toggleVolume = useCallback(() => {
    setVolume((v) => !v)
  }, [])

  const handleMouseMove = useCallback(() => {
    setShowControls(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => {
      if (playing) setShowControls(false)
    }, 3000)
  }, [playing])

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    }
  }, [])

  const handleScrub = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current) return
    const rect = progressRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setProgress(pct)
  }, [])

  // Simulate progress when playing
  useEffect(() => {
    if (!playing) return
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 1) {
          setPlaying(false)
          return 0
        }
        return p + 0.005
      })
    }, 100)
    return () => clearInterval(interval)
  }, [playing])

  return (
    <div
      className="relative w-full aspect-video bg-[var(--bg-darkest)] rounded-[var(--radius-lg)] overflow-hidden group/player"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => playing && setShowControls(false)}
    >
      {/* Poster image */}
      <img
        src={poster}
        alt=""
        className={cn(
          'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
          playing ? 'opacity-50' : 'opacity-100'
        )}
      />

      {/* Play/Pause overlay button */}
      <button
        onClick={togglePlay}
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-300',
          showControls ? 'opacity-100' : 'opacity-0'
        )}
      >
        <motion.div
          whileTap={{ scale: 0.9 }}
          className="w-14 h-14 rounded-full bg-[var(--bg-overlay)] backdrop-blur-sm flex items-center justify-center"
        >
          {playing ? (
            <Pause size={24} className="text-white" fill="white" />
          ) : (
            <Play size={24} className="text-white ml-0.5" fill="white" />
          )}
        </motion.div>
      </button>

      {/* Controls bar */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-[rgba(3,3,5,0.8)] to-transparent transition-opacity duration-300',
          showControls ? 'opacity-100' : 'opacity-0'
        )}
      >
        {/* Progress bar */}
        <div
          ref={progressRef}
          className="w-full h-1 bg-[rgba(255,255,255,0.2)] rounded-full cursor-pointer mb-3"
          onClick={handleScrub}
        >
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={togglePlay} className="text-white hover:text-[var(--accent)] transition-colors">
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button onClick={toggleVolume} className="text-white hover:text-[var(--accent)] transition-colors">
              {volume ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <span className="text-[11px] font-mono text-white/70">
              {formatDuration(progress * 180)} / 3:00
            </span>
          </div>
          <button className="text-white hover:text-[var(--accent)] transition-colors">
            <Maximize size={16} />
          </button>
        </div>
      </div>
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
  const liked = likeCache[item.id] ?? false
  const [likeCount, setLikeCount] = useState(item.views > 1000 ? Math.floor(item.views / 100) : 12)
  const [burstTrigger, setBurstTrigger] = useState(0)
  const [saved, setSaved] = useState(false)

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
      key: 'comment',
      icon: MessageCircle,
      active: false,
      count: 12,
      onClick: () => {},
    },
    {
      key: 'share',
      icon: Share2,
      active: false,
      count: null,
      onClick: onShare,
    },
    {
      key: 'save',
      icon: Bookmark,
      active: saved,
      count: null,
      onClick: () => setSaved((s) => !s),
    },
    {
      key: 'download',
      icon: Download,
      active: false,
      count: null,
      onClick: () => {},
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
    { label: 'Quality', value: 'HD' },
    { label: 'Uploaded', value: timeAgo(item.createdAt) },
    { label: 'Duration', value: item.isVideo ? item.duration : 'Photo' },
    { label: 'File size', value: `${(Math.random() * 20 + 2).toFixed(1)} MB` },
    { label: 'Dimensions', value: '1920×1080' },
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
                  <VideoPlayer poster={activeItem.thumbnail} />
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
                  <h2 className="text-xl font-bold text-[var(--text-primary)] leading-tight">
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

              {/* Related Media */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4, ease: easeOutExpo }}
              >
                <RelatedMedia
                  currentId={activeItem.id}
                  onSelect={handleSelectRelated}
                />
              </motion.div>

              {/* Comments */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.58, duration: 0.4, ease: easeOutExpo }}
              >
                <CommentsThread />
              </motion.div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
