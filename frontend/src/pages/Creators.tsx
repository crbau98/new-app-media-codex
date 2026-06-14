import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  creators,
  mediaItems,
  type Creator,
  type MediaItem,
} from '@/lib/mockData'
import MediaCard from '@/components/MediaCard'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import {
  Search,
  ChevronDown,
  Check,
  Play,
  X,
  ArrowRight,
  TrendingUp,
  Clock,
  Grid3X3,
  List,
  Users,
} from 'lucide-react'

/* ───────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────── */
function getCreatorContent(creatorName: string): MediaItem[] {
  return mediaItems.filter((m) => m.creator === creatorName)
}

function formatFollowers(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${n}`
}

/* ───────────────────────────────────────────────
   Creator Spotlight (Weekly Featured)
   ─────────────────────────────────────────────── */
function CreatorSpotlight({ creator, onFollow, isFollowing }: {
  creator: Creator
  onFollow: () => void
  isFollowing: boolean
}) {
  const content = useMemo(() => getCreatorContent(creator.name).slice(0, 4), [creator.name])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
      className="relative w-full h-[240px] rounded-[var(--radius-lg)] overflow-hidden mb-8"
    >
      {/* Background collage with blur */}
      <div className="absolute inset-0 flex">
        {content.slice(0, 3).map((item, i) => (
          <div key={i} className="flex-1 relative overflow-hidden">
            <img
              src={item.thumbnail}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 bg-[rgba(3,3,5,0.75)] backdrop-blur-xl" />
      <div className="absolute inset-0" style={{ boxShadow: 'var(--shadow-hero)' }} />

      {/* Content */}
      <div className="absolute inset-0 flex items-center p-6 md:p-8 gap-6">
        {/* Avatar with animated conic-gradient ring */}
        <div className="relative shrink-0">
          <div
            className="w-[120px] h-[120px] rounded-full p-[3px]"
            style={{
              background: 'conic-gradient(from 0deg, #e879a9, #a855f7, #8b5cf6, #e879a9)',
              animation: 'spin 8s linear infinite',
            }}
          >
            <div className="w-full h-full rounded-full p-[3px] bg-[var(--bg-base)]">
              <img
                src={creator.avatar}
                alt={creator.name}
                className="w-full h-full rounded-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="flex flex-col gap-2 min-w-0">
          <span className="eyebrow text-[var(--accent)]">
            This Week&apos;s Spotlight
          </span>
          <h2 className="text-[clamp(24px,3vw,32px)] font-bold text-[var(--text-primary)] leading-tight">
            {creator.name}
          </h2>
          <p className="text-sm text-[var(--text-secondary)]">
            @{creator.name.toLowerCase().replace(/\s+/g, '')}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            {content.length} items • {formatFollowers(creator.followers)} followers
            {creator.hasStory && ` • ${creator.storySeen ? '0' : '1'} new story`}
          </p>
          {/* Preview thumbnails */}
          {content.length > 0 && (
            <div className="flex gap-2 mt-1 overflow-x-auto hide-scrollbar">
              {content.map((item) => (
                <div key={item.id} className="w-16 h-16 rounded-[var(--radius-sm)] overflow-hidden shrink-0 border border-[var(--border-subtle)]">
                  <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="hidden md:flex flex-col gap-2 ml-auto shrink-0">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={onFollow}
            className={cn(
              'btn-primary min-w-[120px]',
              isFollowing && 'bg-[var(--success)]'
            )}
          >
            {isFollowing ? (
              <>
                <Check size={14} /> Following
              </>
            ) : (
              'Follow'
            )}
          </motion.button>
          <button className="px-4 py-2 rounded-md border border-[var(--border-medium)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors">
            View Profile
          </button>
          {content[0]?.isVideo && (
            <button className="flex items-center gap-2 px-4 py-2 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors">
              <Play size={14} /> Watch Latest
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ───────────────────────────────────────────────
   Creator Card
   ─────────────────────────────────────────────── */
function CreatorCard({
  creator,
  index,
  isFollowing,
  onFollow,
  onClick,
}: {
  creator: Creator
  index: number
  isFollowing: boolean
  onFollow: () => void
  onClick: () => void
}) {
  const content = useMemo(() => getCreatorContent(creator.name), [creator.name])
  const [followed, setFollowed] = useState(isFollowing)
  const [showBurst, setShowBurst] = useState(false)

  const handleFollow = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setFollowed(!followed)
    onFollow()
    if (!followed) {
      setShowBurst(true)
      setTimeout(() => setShowBurst(false), 600)
    }
  }, [followed, onFollow])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.05,
        duration: 0.4,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      onClick={onClick}
      className={cn(
        'group relative bg-[var(--bg-elevated)] rounded-[var(--radius-md)] overflow-hidden cursor-pointer',
        'border border-[var(--border-subtle)]',
        'card-lift'
      )}
    >
      {/* Cover image area */}
      <div className="h-[100px] bg-[var(--bg-surface)] relative overflow-hidden">
        {content[0] && (
          <img
            src={content[0].thumbnail}
            alt=""
            className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--bg-elevated)]" />
      </div>

      {/* Avatar */}
      <div className="flex justify-center -mt-8 relative z-10">
        <div
          className={cn(
            'p-[2px] rounded-full',
            creator.hasStory && !creator.storySeen ? 'story-ring' : 'story-ring-seen'
          )}
        >
          <img
            src={creator.avatar}
            alt={creator.name}
            className="w-16 h-16 rounded-full object-cover border-2 border-[var(--bg-elevated)]"
            loading="lazy"
          />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 pt-2 flex flex-col items-center gap-1">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">{creator.name}</h3>
        <p className="text-xs text-[var(--text-tertiary)]">
          @{creator.name.toLowerCase().replace(/\s+/g, '')}
        </p>
        <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--text-muted)] mt-1">
          <span>{content.length} items</span>
          <span>•</span>
          <span>{formatFollowers(creator.followers)} followers</span>
        </div>
        {creator.hasStory && !creator.storySeen && (
          <span className="mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--accent-dim)] text-[var(--accent)]">
            New story
          </span>
        )}

        {/* Follow button */}
        <div className="mt-3 w-full relative">
          {showBurst && (
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: 8 }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                  animate={{
                    opacity: 0,
                    x: Math.cos((i / 8) * Math.PI * 2) * 40,
                    y: Math.sin((i / 8) * Math.PI * 2) * 40,
                    scale: 0,
                  }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="absolute left-1/2 top-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)]"
                />
              ))}
            </div>
          )}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleFollow}
            className={cn(
              'w-full py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors',
              followed
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                : 'btn-primary'
            )}
          >
            {followed ? (
              <span className="flex items-center justify-center gap-1.5">
                <Check size={14} /> Following
              </span>
            ) : (
              'Follow'
            )}
          </motion.button>
        </div>
      </div>
    </motion.div>
  )
}

/* ───────────────────────────────────────────────
   Quick-Access Creator Rail (Sticky)
   ─────────────────────────────────────────────── */
function CreatorRail({ onSelect }: { onSelect: (creator: Creator) => void }) {
  const followCache = useAppStore((s) => s.followCache)
  const followedCreators = useMemo(
    () => creators.filter((c) => followCache[c.id]).slice(0, 10),
    [followCache]
  )

  if (followedCreators.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
      className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-[var(--bg-base)]/80 backdrop-blur-md border-y border-[var(--border-subtle)] mb-6"
    >
      <div className="flex items-center gap-3 overflow-x-auto hide-scrollbar">
        <span className="text-xs font-medium text-[var(--text-muted)] shrink-0">Your creators</span>
        {followedCreators.map((creator) => (
          <button
            key={creator.id}
            onClick={() => onSelect(creator)}
            className="flex items-center gap-2 shrink-0 group"
          >
            <div
              className={cn(
                'p-[2px] rounded-full',
                creator.hasStory && !creator.storySeen ? 'story-ring' : 'story-ring-seen'
              )}
            >
              <img
                src={creator.avatar}
                alt={creator.name}
                className="w-9 h-9 rounded-full object-cover"
                loading="lazy"
              />
            </div>
            <span className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors max-w-[80px] truncate">
              {creator.name}
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

/* ───────────────────────────────────────────────
   Creator Detail Drawer
   ─────────────────────────────────────────────── */
function CreatorDrawer({
  creator,
  open,
  onClose,
}: {
  creator: Creator | null
  open: boolean
  onClose: () => void
}) {
  const content = useMemo(() => {
    if (!creator) return []
    return getCreatorContent(creator.name).slice(0, 9)
  }, [creator])

  return (
    <AnimatePresence>
      {open && creator && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[100] bg-[var(--bg-overlay)]"
            onClick={onClose}
          />
          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="fixed top-0 right-0 bottom-0 z-[101] w-full md:w-[480px] bg-[var(--bg-base)] border-l border-[var(--border-subtle)] overflow-y-auto hide-scrollbar"
          >
            {/* Header */}
            <div className="relative">
              <div className="h-[160px] bg-[var(--bg-surface)] relative overflow-hidden">
                {content[0] && (
                  <img src={content[0].thumbnail} alt="" className="w-full h-full object-cover opacity-50" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[var(--bg-base)]" />
              </div>
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center text-white hover:bg-[var(--bg-surface)] transition-colors"
              >
                <X size={16} />
              </button>
              <div className="flex flex-col items-center -mt-10 px-6">
                <img
                  src={creator.avatar}
                  alt={creator.name}
                  className="w-20 h-20 rounded-full object-cover border-4 border-[var(--bg-base)]"
                />
                <h2 className="text-xl font-bold text-[var(--text-primary)] mt-3">{creator.name}</h2>
                <p className="text-sm text-[var(--text-secondary)]">
                  @{creator.name.toLowerCase().replace(/\s+/g, '')}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 px-6 py-4">
              <div className="text-center">
                <div className="text-lg font-mono font-semibold text-[var(--text-primary)]">{content.length}</div>
                <div className="text-[11px] text-[var(--text-muted)] uppercase">Items</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-mono font-semibold text-[var(--text-primary)]">{formatFollowers(creator.followers)}</div>
                <div className="text-[11px] text-[var(--text-muted)] uppercase">Followers</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-mono font-semibold text-[var(--text-primary)]">{Math.floor(creator.followers * 0.3)}</div>
                <div className="text-[11px] text-[var(--text-muted)] uppercase">Following</div>
              </div>
            </div>

            {/* Media grid */}
            {content.length > 0 && (
              <div className="px-6 py-4">
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Latest Media</h4>
                <div className="grid grid-cols-3 gap-2">
                  {content.map((item) => (
                    <div key={item.id} className="aspect-square rounded-[var(--radius-sm)] overflow-hidden border border-[var(--border-subtle)]">
                      <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Link to all */}
            <div className="px-6 py-4">
              <a
                href="#/media"
                onClick={() => {
                  useAppStore.getState().setMediaCreatorFilter(creator.id)
                  onClose()
                }}
                className="flex items-center gap-2 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
              >
                View all media <ArrowRight size={14} />
              </a>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/* ───────────────────────────────────────────────
   Main Creators Page
   ─────────────────────────────────────────────── */
export default function CreatorsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [sort, setSort] = useState<'Most Popular' | 'Recently Active' | 'A-Z' | 'Most Content'>('Most Popular')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showRail, setShowRail] = useState(false)

  const followCache = useAppStore((s) => s.followCache)
  const toggleFollow = useAppStore((s) => s.toggleFollow)
  const addToast = useAppStore((s) => s.addToast)

  // Spotlight: pick a creator deterministically
  const spotlight = useMemo(() => {
    const idx = Math.floor(creators.length / 2)
    return creators[idx]
  }, [])

  // Scroll listener for sticky rail
  useEffect(() => {
    const onScroll = () => setShowRail(window.scrollY > 300)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Filter & sort creators
  const filtered = useMemo(() => {
    let result = [...creators]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || c.name.toLowerCase().replace(/\s+/g, '').includes(q)
      )
    }
    switch (sort) {
      case 'Most Popular':
        result.sort((a, b) => b.followers - a.followers)
        break
      case 'A-Z':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'Most Content': {
        const counts = new Map<string, number>()
        mediaItems.forEach((m) => {
          counts.set(m.creator, (counts.get(m.creator) || 0) + 1)
        })
        result.sort((a, b) => (counts.get(b.name) || 0) - (counts.get(a.name) || 0))
        break
      }
      case 'Recently Active':
        // Use story seen status as proxy for recent activity
        result.sort((a, b) => (b.hasStory && !b.storySeen ? 1 : 0) - (a.hasStory && !a.storySeen ? 1 : 0))
        break
    }
    return result
  }, [searchQuery, sort])

  const handleFollow = useCallback((id: string, name: string) => {
    toggleFollow(id)
    const nowFollowing = !followCache[id]
    if (nowFollowing) {
      addToast({ type: 'success', title: `Now following @${name.toLowerCase().replace(/\s+/g, '')}` })
    }
  }, [followCache, toggleFollow, addToast])

  const handleCreatorClick = useCallback((creator: Creator) => {
    setSelectedCreator(creator)
    setDrawerOpen(true)
  }, [])

  const handleRailSelect = useCallback((creator: Creator) => {
    setSelectedCreator(creator)
    setDrawerOpen(true)
  }, [])

  const totalItems = mediaItems.length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="py-4"
      >
        <h1 className="text-[clamp(24px,3vw,36px)] font-bold text-[var(--text-primary)] tracking-tight">
          Creators
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Discover and follow your favorite performers
        </p>
        <p className="text-xs font-mono text-[var(--text-muted)] mt-1">
          {creators.length} creators • {totalItems} items
        </p>
      </motion.div>

      {/* Search + Sort Toolbar */}
      <div
        className="sticky top-14 z-30 -mx-4 px-4 py-2 flex items-center gap-3 overflow-x-auto hide-scrollbar border-b border-[var(--border-subtle)]"
        style={{
          background: 'var(--bg-base)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {/* Search */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] w-[280px] shrink-0">
          <Search size={14} className="text-[var(--text-tertiary)] shrink-0" />
          <input
            type="text"
            placeholder="Search creators..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-full"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative shrink-0 group">
          <button className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            {sort} <ChevronDown size={14} />
          </button>
          <div className="absolute top-full left-0 mt-1 w-44 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 py-1">
            {(['Most Popular', 'Recently Active', 'A-Z', 'Most Content'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setSort(opt)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-surface)] transition-colors',
                  sort === opt ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="w-px h-5 bg-[var(--border-subtle)] shrink-0" />

        {/* View toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'grid' ? 'text-[var(--accent)] bg-[var(--accent-dim)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === 'list' ? 'text-[var(--accent)] bg-[var(--accent-dim)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Creator Spotlight */}
      <section>
        <CreatorSpotlight
          creator={spotlight}
          isFollowing={!!followCache[spotlight.id]}
          onFollow={() => handleFollow(spotlight.id, spotlight.name)}
        />
      </section>

      {/* Quick-Access Rail (appears on scroll) */}
      <AnimatePresence>
        {showRail && (
          <CreatorRail onSelect={handleRailSelect} />
        )}
      </AnimatePresence>

      {/* Creator Grid */}
      <section>
        {filtered.length === 0 ? (
          <EmptyState
            variant="search"
            title="No creators found"
            description="Try different keywords to find creators."
            actionLabel="Clear search"
            onAction={() => setSearchQuery('')}
          />
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-5">
            {filtered.map((creator, i) => (
              <CreatorCard
                key={creator.id}
                creator={creator}
                index={i}
                isFollowing={!!followCache[creator.id]}
                onFollow={() => handleFollow(creator.id, creator.name)}
                onClick={() => handleCreatorClick(creator)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((creator, i) => {
              const content = getCreatorContent(creator.name)
              return (
                <motion.div
                  key={creator.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
                  onClick={() => handleCreatorClick(creator)}
                  className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
                >
                  <div
                    className={cn(
                      'p-[2px] rounded-full shrink-0',
                      creator.hasStory && !creator.storySeen ? 'story-ring' : 'story-ring-seen'
                    )}
                  >
                    <img
                      src={creator.avatar}
                      alt={creator.name}
                      className="w-12 h-12 rounded-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)]">{creator.name}</h4>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {content.length} items • {formatFollowers(creator.followers)} followers
                    </p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleFollow(creator.id, creator.name)
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors shrink-0',
                      followCache[creator.id]
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)]'
                        : 'btn-primary'
                    )}
                  >
                    {followCache[creator.id] ? 'Following' : 'Follow'}
                  </motion.button>
                </motion.div>
              )
            })}
          </div>
        )}
      </section>

      {/* Creator Detail Drawer */}
      <CreatorDrawer
        creator={selectedCreator}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
