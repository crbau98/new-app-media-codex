import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  getMediaByCategory,
  getFeaturedItems,
  creators,
  categories,
  type MediaItem,
} from '@/lib/mockData'
import { fetchMedia } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import MediaCard from '@/components/MediaCard'
import CategoryHeader from '@/components/CategoryHeader'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import {
  Play,
  Plus,
  Grid3X3,
  List,
  LayoutGrid,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Shuffle,
} from 'lucide-react'

/* ───────────────────────────────────────────────
   Cinematic Hero
   ─────────────────────────────────────────────── */
function CinematicHero() {
  const featured = useMemo(() => getFeaturedItems(3), [])
  const [index, setIndex] = useState(0)
  const [_direction, setDirection] = useState(1)

  useEffect(() => {
    const timer = setInterval(() => {
      setDirection(1)
      setIndex((i) => (i + 1) % featured.length)
    }, 6000)
    return () => clearInterval(timer)
  }, [featured.length])

  const current = featured[index]
  const goTo = (i: number) => {
    setDirection(i > index ? 1 : -1)
    setIndex(i)
  }

  return (
    <div className="relative w-full h-[280px] md:h-[420px] rounded-[var(--radius-lg)] overflow-hidden mb-6">
      {/* Background layers with crossfade */}
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, scale: 1.05 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] as [number, number, number, number] }}
          className="absolute inset-0"
        >
          <img
            src={current.thumbnail}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-[rgba(3,3,5,0.6)] backdrop-blur-[40px]" />
          <div
            className="absolute inset-0"
            style={{ boxShadow: 'var(--shadow-hero)' }}
          />
        </motion.div>
      </AnimatePresence>

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="flex flex-col gap-3 max-w-xl"
          >
            <span className="eyebrow text-[var(--accent)] bg-[var(--accent-dim)] px-3 py-1 rounded-full w-fit">
              FEATURED
            </span>
            <h1 className="hero-title text-[var(--text-primary)] line-clamp-2">
              {current.title}
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              {current.creator} • {current.duration || 'Photo'} • {current.source}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <button className="btn-primary">
                <Play size={16} fill="white" /> Watch Now
              </button>
              <button className="px-4 py-2 rounded-md border border-[var(--border-medium)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors">
                Add to Collection
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation dots */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
          {featured.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === index ? 'w-[18px] bg-[var(--accent)]' : 'w-1.5 bg-[var(--text-muted)]'
              )}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Manual arrows (desktop hover) */}
        <div className="hidden md:flex absolute inset-y-0 left-0 right-0 items-center justify-between px-4 opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
          <button
            onClick={() => goTo((index - 1 + featured.length) % featured.length)}
            className="pointer-events-auto w-10 h-10 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center text-white hover:bg-[var(--bg-surface)] transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => goTo((index + 1) % featured.length)}
            className="pointer-events-auto w-10 h-10 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center text-white hover:bg-[var(--bg-surface)] transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Stories Rail
   ─────────────────────────────────────────────── */
function StoriesRail() {
  const storyCreators = useMemo(() => creators.slice(0, 8), [])

  return (
    <div className="relative mb-6">
      {/* Fade edges */}
      <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-[var(--bg-base)] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-[var(--bg-base)] to-transparent z-10 pointer-events-none" />

      <div className="flex gap-4 overflow-x-auto hide-scrollbar px-2 py-2 scroll-snap-x mandatory">
        {/* Add Story */}
        <div className="flex flex-col items-center gap-1.5 shrink-0 scroll-snap-align-start">
          <button className="w-16 h-16 rounded-full border-2 border-dashed border-[var(--border-medium)] flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--text-secondary)] transition-colors">
            <Plus size={20} />
          </button>
          <span className="text-[11px] text-[var(--text-secondary)]">Add</span>
        </div>

        {storyCreators.map((creator, i) => (
          <motion.div
            key={creator.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="flex flex-col items-center gap-1.5 shrink-0 scroll-snap-align-start"
          >
            <div className={cn('p-[3px] rounded-full', creator.storySeen ? 'story-ring-seen' : 'story-ring')}>
              <img
                src={creator.avatar}
                alt={creator.name}
                className="w-[58px] h-[58px] rounded-full object-cover border-2 border-[var(--bg-base)]"
                loading="lazy"
              />
            </div>
            <span className="text-[11px] text-[var(--text-secondary)] max-w-[64px] truncate">
              {creator.name}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Discoverability Toolbar
   ─────────────────────────────────────────────── */
type ViewModeType = 'grid' | 'list' | 'mosaic' | 'timeline'

function DiscoverabilityToolbar({
  viewMode,
  onViewModeChange,
  sort,
  onSortChange,
  onSurprise,
}: {
  viewMode: ViewModeType
  onViewModeChange: (v: ViewModeType) => void
  sort: string
  onSortChange: (s: string) => void
  onSurprise: () => void
}) {
  const filters = useAppStore((s) => s.filters)
  const setFilters = useAppStore((s) => s.setFilters)

  const chips = [
    { label: 'All', count: 1447, value: null },
    { label: 'Videos', count: 48, value: 'video' },
    { label: 'Images', count: null, value: 'image' },
    { label: 'Favorites', count: 0, value: 'favorites' },
  ]

  const sortOptions = ['Newest', 'Oldest', 'Top Rated', 'A–Z', 'Random', 'Most Viewed']

  return (
    <div
      className="sticky top-14 z-30 -mx-4 px-4 py-2 flex items-center gap-3 overflow-x-auto hide-scrollbar border-b border-[var(--border-subtle)]"
      style={{
        background: 'var(--bg-base)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Filter pills */}
      <div className="flex items-center gap-1.5 shrink-0">
        {chips.map((chip) => (
          <button
            key={chip.label}
            onClick={() => setFilters({ sourceType: chip.value })}
            className={cn(
              'ui-chip whitespace-nowrap',
              filters.sourceType === chip.value && 'ui-chip-active'
            )}
          >
            {chip.label}
            {chip.count !== null && (
              <span className="text-[var(--text-muted)]">({chip.count})</span>
            )}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-[var(--border-subtle)] shrink-0" />

      {/* Sort */}
      <div className="relative shrink-0 group">
        <button className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          {sort} <ChevronDown size={14} />
        </button>
        <div className="absolute top-full left-0 mt-1 w-40 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 py-1">
          {sortOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => onSortChange(opt)}
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

      {/* View toggles */}
      <div className="flex items-center gap-1 shrink-0">
        {([
          { key: 'grid', icon: Grid3X3 },
          { key: 'list', icon: List },
          { key: 'mosaic', icon: LayoutGrid },
          { key: 'timeline', icon: Clock },
        ] as const).map(({ key, icon: Icon }) => (
          <button
            key={key}
            onClick={() => onViewModeChange(key)}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              viewMode === key ? 'text-[var(--accent)] bg-[var(--accent-dim)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
            aria-label={`${key} view`}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Surprise Me */}
      <motion.button
        onClick={onSurprise}
        whileTap={{ scale: 0.95 }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors shrink-0"
      >
        <Sparkles size={14} />
        Surprise Me
      </motion.button>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Floating Category Navigator
   ─────────────────────────────────────────────── */
function FloatingNavigator({
  activeCategory,
  onSelect,
  visible,
}: {
  activeCategory: string
  onSelect: (name: string) => void
  visible: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="fixed bottom-8 right-8 z-[50] hidden md:block"
        >
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 px-4 h-11 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-md text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              {activeCategory}
              <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 8 }}
                  transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }}
                  className="absolute bottom-full right-0 mb-2 w-56 max-h-72 overflow-y-auto hide-scrollbar bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-lg py-1"
                >
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => {
                        onSelect(cat.name)
                        setOpen(false)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[var(--bg-surface)] transition-colors',
                        activeCategory === cat.name
                          ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                          : 'text-[var(--text-secondary)]'
                      )}
                    >
                      <span>{cat.name}</span>
                      <span className="text-[11px] font-mono text-[var(--text-muted)]">{cat.count}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────────────────────────────────────────────
   Home Page
   ─────────────────────────────────────────────── */
export default function HomePage() {
  const [viewMode, setViewMode] = useState<ViewModeType>('grid')
  const [sort, setSort] = useState('Newest')
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
  const [showSurprise, setShowSurprise] = useState(false)
  const [surpriseItem, setSurpriseItem] = useState<MediaItem | null>(null)
  const [scrollY, setScrollY] = useState(0)
  const [activeCategory, setActiveCategory] = useState('Featured')
  const mainRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['media', 'home'],
    queryFn: () => fetchMedia({ sort: 'newest' }, 1, 100),
  })

  const allItems = data?.items ?? []

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const toggleCategory = useCallback((name: string) => {
    setExpandedCategories((prev) => ({ ...prev, [name]: !prev[name] }))
  }, [])

  const handleSurprise = useCallback(() => {
    setShowSurprise(true)
    // Shuffle animation: pick random item after brief delay
    const candidates = allItems.length > 0 ? allItems : getMediaByCategory('Featured')
    const random = candidates[Math.floor(Math.random() * candidates.length)]
    setTimeout(() => {
      setSurpriseItem(random)
    }, 600)
  }, [allItems])

  const handleSurpriseClose = useCallback(() => {
    setShowSurprise(false)
    setSurpriseItem(null)
  }, [])

  const scrollToCategory = useCallback((name: string) => {
    const el = document.getElementById(`cat-${name}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  // Group items by category
  const grouped = useMemo(() => {
    const map: Record<string, MediaItem[]> = {}
    for (const cat of categories) {
      map[cat.name] = allItems.filter((m) => m.category === cat.name)
      if (map[cat.name].length === 0 && cat.name !== 'Featured') {
        map[cat.name] = getMediaByCategory(cat.name)
      }
    }
    // If API data missing, use static data for Featured
    if (!map['Featured'] || map['Featured'].length === 0) {
      map['Featured'] = getMediaByCategory('Featured')
    }
    return map
  }, [allItems])

  const categoryOrder = categories.map((c) => c.name)
  const showFloatingNav = scrollY > 400

  return (
    <div ref={mainRef} className="space-y-6">
      {/* Hero */}
      <section className="animate-page-enter">
        <CinematicHero />
      </section>

      {/* Stories */}
      <section>
        <StoriesRail />
      </section>

      {/* Toolbar */}
      <DiscoverabilityToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        sort={sort}
        onSortChange={setSort}
        onSurprise={handleSurprise}
      />

      {/* Category grids */}
      {isLoading ? (
        <div className="space-y-6">
          <SkeletonGrid count={6} />
          <SkeletonGrid count={6} />
          <SkeletonGrid count={6} />
        </div>
      ) : (
        <div className="space-y-8">
          {categoryOrder.map((catName) => {
            const items = grouped[catName] ?? []
            const expanded = expandedCategories[catName] !== false // default open
            return (
              <section key={catName} id={`cat-${catName}`}>
                <CategoryHeader
                  name={catName}
                  count={items.length}
                  onToggle={() => toggleCategory(catName)}
                  expanded={expanded}
                />
                {expanded && (
                  <div className="mt-3">
                    {items.length === 0 ? (
                      <EmptyState
                        variant="category"
                        onAction={() => {}}
                      />
                    ) : viewMode === 'grid' ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4 stagger-in">
                        {items.map((item, i) => (
                          <MediaCard
                            key={item.id}
                            item={item}
                            aspectRatio={i % 3 === 0 ? '3/4' : i % 3 === 1 ? '4/5' : '1/1'}
                          />
                        ))}
                      </div>
                    ) : viewMode === 'list' ? (
                      <div className="flex flex-col gap-2 stagger-in">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 p-2 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
                          >
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="w-[120px] h-[80px] rounded-[var(--radius-md)] object-cover shrink-0"
                              loading="lazy"
                            />
                            <div className="flex flex-col gap-1">
                              <h4 className="text-sm font-medium text-[var(--text-primary)]">{item.title}</h4>
                              <p className="text-xs text-[var(--text-secondary)]">
                                {item.creator} • {item.source}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : viewMode === 'mosaic' ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4 stagger-in">
                        {items.map((item, i) => (
                          <MediaCard
                            key={item.id}
                            item={item}
                            aspectRatio={i % 5 === 0 ? '16/9' : '4/5'}
                            className={i % 5 === 0 ? 'sm:col-span-2 sm:row-span-2' : ''}
                          />
                        ))}
                      </div>
                    ) : (
                      /* timeline */
                      <div className="flex flex-col gap-2 stagger-in">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center gap-3 p-2 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
                          >
                            <span className="text-[11px] font-mono text-[var(--text-muted)] w-16 shrink-0">
                              {new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              className="w-20 h-14 rounded-[var(--radius-md)] object-cover shrink-0"
                              loading="lazy"
                            />
                            <div className="flex flex-col gap-0.5">
                              <h4 className="text-sm font-medium text-[var(--text-primary)]">{item.title}</h4>
                              <p className="text-xs text-[var(--text-secondary)]">{item.creator}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* Surprise Me Overlay */}
      <AnimatePresence>
        {showSurprise && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[300] bg-[var(--bg-overlay)] flex items-center justify-center p-4"
            onClick={handleSurpriseClose}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 20 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
              className="relative w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              {surpriseItem ? (
                <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shadow-lg">
                  <div className="relative aspect-[4/5]">
                    <img
                      src={surpriseItem.thumbnail}
                      alt={surpriseItem.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[rgba(3,3,5,0.8)] to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-5 space-y-3">
                      <h3 className="text-xl font-bold text-[var(--text-primary)]">{surpriseItem.title}</h3>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {surpriseItem.creator} • {surpriseItem.category}
                      </p>
                      <div className="flex items-center gap-2">
                        <button className="btn-primary flex-1">
                          <Play size={16} fill="white" /> Play
                        </button>
                        <button
                          onClick={handleSurprise}
                          className="px-4 py-2 rounded-md border border-[var(--border-medium)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors"
                        >
                          <Shuffle size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{ rotate: 360 }}
                        transition={{ duration: 0.4, repeat: Infinity, ease: 'linear' }}
                      >
                        <Sparkles size={24} className="text-[var(--accent)]" />
                      </motion.div>
                    ))}
                  </div>
                  <p className="text-[var(--text-secondary)] text-sm">Shuffling...</p>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Category Navigator */}
      <FloatingNavigator
        activeCategory={activeCategory}
        onSelect={(name) => {
          setActiveCategory(name)
          scrollToCategory(name)
        }}
        visible={showFloatingNav}
      />
    </div>
  )
}
