import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  type CategoryDef,
  type Creator,
  type MediaItem,
} from '@/lib/mockData'
import { fetchCategories, fetchLiveCreatorDirectory, fetchMedia } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import MediaCard from '@/components/MediaCard'
import MediaDetail from '@/components/MediaDetail'
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
  X,
} from 'lucide-react'

/* ───────────────────────────────────────────────
   Cinematic Hero
   ─────────────────────────────────────────────── */
function CinematicHero({ items, onWatch }: { items: MediaItem[]; onWatch: (item: MediaItem) => void }) {
  const featured = items.slice(0, 3)
  const [index, setIndex] = useState(0)
  const [_direction, setDirection] = useState(1)

  useEffect(() => {
    if (!featured.length) return
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

  if (!current) {
    return (
      <div className="mb-6 grid min-h-[200px] place-items-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-6 text-center">
        <div>
          <p className="text-base font-semibold text-[var(--text-primary)]">Connecting to live media…</p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">Loading source-attributed public media. Design placeholders stay hidden.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-[200px] sm:h-[280px] md:h-[420px] rounded-[var(--radius-lg)] overflow-hidden mb-6">
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
      <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-6 md:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="flex flex-col gap-2 sm:gap-3 max-w-xl"
          >
            <span className="eyebrow text-[var(--accent)] bg-[var(--accent-dim)] px-3 py-1 rounded-full w-fit text-[11px] sm:text-sm">
              FEATURED
            </span>
            <h1 className="text-xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-[var(--text-primary)] line-clamp-2 leading-tight">
              {current.title}
            </h1>
            <p className="text-xs sm:text-sm text-[var(--text-secondary)]">
              {current.creator} • {current.duration || 'Photo'} • {current.source}
            </p>
            <div className="flex items-center gap-3 mt-1">
              <button
                className="btn-primary tap-highlight-none"
                onClick={() => onWatch(current)}
              >
                <Play size={16} fill="white" /> Watch Now
              </button>
              {current.pageUrl && <a href={current.pageUrl} target="_blank" rel="noreferrer" className="px-3 sm:px-4 py-2 rounded-md border border-white/20 text-xs sm:text-sm text-white hover:bg-white/10 transition-colors tap-highlight-none">Open source</a>}
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
            className="pointer-events-auto w-10 h-10 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center text-white hover:bg-[var(--bg-surface)] transition-colors tap-highlight-none"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => goTo((index + 1) % featured.length)}
            className="pointer-events-auto w-10 h-10 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center text-white hover:bg-[var(--bg-surface)] transition-colors tap-highlight-none"
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
function StoriesRail({ creators }: { creators: Creator[] }) {
  const storyCreators = useMemo(() => creators.slice(0, 8), [creators])

  if (!storyCreators.length) return null

  return (
    <div className="relative mb-6">
      {/* Fade edges */}
      <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-[var(--bg-base)] to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-[var(--bg-base)] to-transparent z-10 pointer-events-none" />

      <div className="flex gap-4 overflow-x-auto hide-scrollbar px-2 py-2 scroll-snap-x mandatory">
        {/* Live-source marker */}
        <div className="flex flex-col items-center gap-1.5 shrink-0 scroll-snap-align-start">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full border-2 border-dashed border-[var(--border-medium)] flex items-center justify-center text-[var(--accent)]">
            <Plus size={20} />
          </div>
          <span className="text-[10px] sm:text-[11px] text-[var(--text-secondary)]">Live</span>
        </div>

        {storyCreators.map((creator, i) => (
          <motion.div
            key={creator.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
            className="flex flex-col items-center gap-1.5 shrink-0 scroll-snap-align-start"
          >
            <div className={cn('p-[2px] sm:p-[3px] rounded-full', creator.storySeen ? 'story-ring-seen' : 'story-ring')}>
              <img
                src={creator.avatar}
                alt={creator.name}
                className="w-[50px] h-[50px] sm:w-[58px] sm:h-[58px] rounded-full object-cover border-2 border-[var(--bg-base)]"
                loading="lazy"
              />
            </div>
            <span className="text-[10px] sm:text-[11px] text-[var(--text-secondary)] max-w-[56px] sm:max-w-[64px] truncate">
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
    { label: 'All', value: null },
    { label: 'Smart picks', value: 'smart' },
    { label: 'High demand', value: 'highDemand' },
    { label: 'Most watched', value: 'mostViewed' },
    { label: 'Videos', value: 'video' },
    { label: 'Favorites', value: 'favorites' },
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
              'ui-chip whitespace-nowrap tap-highlight-none',
              filters.sourceType === chip.value && 'ui-chip-active'
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-[var(--border-subtle)] shrink-0" />

      {/* Sort */}
      <label className="relative shrink-0 text-sm text-[var(--text-secondary)]">
        <span className="sr-only">Sort library</span>
        <select value={sort} onChange={(event) => onSortChange(event.target.value)} className="min-h-11 appearance-none rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2 pl-3 pr-8 text-sm text-[var(--text-primary)] outline-none">
          {sortOptions.map((option) => <option key={option}>{option}</option>)}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
      </label>

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
              'p-1.5 rounded-md transition-colors tap-highlight-none',
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
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition-colors shrink-0 tap-highlight-none"
      >
        <Sparkles size={14} />
        <span className="hidden sm:inline">Surprise Me</span>
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
  categories,
}: {
  activeCategory: string
  onSelect: (name: string) => void
  visible: boolean
  categories: CategoryDef[]
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
          className="fixed bottom-8 right-4 sm:right-8 z-[50] hidden md:block"
        >
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-2 px-4 h-11 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-md text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors tap-highlight-none"
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
                        'w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-[var(--bg-surface)] transition-colors tap-highlight-none',
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
  const [activeCategory, setActiveCategory] = useState('Recently added')
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)

  const sortValue = useMemo(() => ({
    Newest: 'newest',
    Oldest: 'oldest',
    'Top Rated': 'topRated',
    'A–Z': 'az',
    Random: 'random',
    'Most Viewed': 'mostViewed',
  } as const)[sort] ?? 'newest', [sort])

  const { data, isLoading } = useQuery({
    queryKey: ['media', 'home', sortValue],
    queryFn: () => fetchMedia({ sort: sortValue }, 1, 100),
  })
  const { data: liveCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  })
  const { data: liveCreators = [] } = useQuery({
    queryKey: ['live-creators', 'home'],
    queryFn: fetchLiveCreatorDirectory,
    staleTime: 60_000,
  })

  const allItems = useMemo(() => data?.items ?? [], [data?.items])
  const filters = useAppStore((s) => s.filters)
  const visibleItems = useMemo(() => {
    if (filters.sourceType === 'video') return allItems.filter((item) => item.isVideo)
    if (filters.sourceType === 'image') return allItems.filter((item) => !item.isVideo)
    if (filters.sourceType === 'favorites') return allItems.filter((item) => item.isLiked)
    if (filters.sourceType === 'smart') return [...allItems].sort((a, b) => (b.curationScore || 0) - (a.curationScore || 0))
    if (filters.sourceType === 'highDemand') return allItems.filter((item) => (item.curationScore || 0) >= 65)
    if (filters.sourceType === 'mostViewed') return [...allItems].sort((a, b) => b.views - a.views)
    return allItems
  }, [allItems, filters.sourceType])

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const toggleCategory = useCallback((name: string) => {
    setExpandedCategories((prev) => ({ ...prev, [name]: !prev[name] }))
  }, [])

  const handleSurprise = useCallback(() => {
    if (!visibleItems.length) return
    setShowSurprise(true)
    const random = visibleItems[Math.floor(Math.random() * visibleItems.length)]
    setTimeout(() => {
      setSurpriseItem(random)
    }, 600)
  }, [visibleItems])

  const handleSurpriseClose = useCallback(() => {
    setShowSurprise(false)
    setSurpriseItem(null)
  }, [])

  const handleOpenDetail = useCallback((item: MediaItem) => {
    setSelectedItem(item)
    setDetailOpen(true)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false)
    setTimeout(() => setSelectedItem(null), 400)
  }, [])

  const handleSurprisePlay = useCallback(() => {
    if (surpriseItem) {
      handleOpenDetail(surpriseItem)
      setShowSurprise(false)
    }
  }, [surpriseItem, handleOpenDetail])

  const scrollToCategory = useCallback((name: string) => {
    const el = document.getElementById(`cat-${name}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  // Group items by category
  const grouped = useMemo(() => {
    const map: Record<string, MediaItem[]> = {}
    map['Recently added'] = visibleItems
    for (const cat of liveCategories ?? []) {
      map[cat.name] = visibleItems.filter((m) => m.category === cat.name || m.tags.includes(cat.name))
    }
    return map
  }, [liveCategories, visibleItems])

  const categoryOrder = ['Recently added', ...(liveCategories ?? []).map((c) => c.name)]
    .filter((name, index, list) => list.indexOf(name) === index)
  const showFloatingNav = scrollY > 400

  return (
    <div ref={mainRef} className="space-y-6">
      {/* Hero */}
      <section className="animate-page-enter">
        <CinematicHero items={visibleItems} onWatch={handleOpenDetail} />
      </section>

      <StoriesRail creators={liveCreators} />

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
                            aspectRatio="4/5"
                            onSelect={() => handleOpenDetail(item)}
                          />
                        ))}
                      </div>
                    ) : viewMode === 'list' ? (
                      <div className="flex flex-col gap-2 stagger-in">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => handleOpenDetail(item)}
                            className="flex items-center gap-3 p-2 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer tap-highlight-none"
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
                            onSelect={() => handleOpenDetail(item)}
                          />
                        ))}
                      </div>
                    ) : (
                      /* timeline */
                      <div className="flex flex-col gap-2 stagger-in">
                        {items.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => handleOpenDetail(item)}
                            className="flex items-center gap-3 p-2 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer tap-highlight-none"
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
                        <button
                          className="btn-primary flex-1 tap-highlight-none"
                          onClick={handleSurprisePlay}
                        >
                          <Play size={16} fill="white" /> Play
                        </button>
                        <button
                          onClick={handleSurprise}
                          className="px-4 py-2 rounded-md border border-[var(--border-medium)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors tap-highlight-none"
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
        categories={liveCategories ?? []}
      />

      {/* Media Detail Drawer */}
      <MediaDetail
        item={selectedItem}
        open={detailOpen}
        onClose={handleCloseDetail}
      />
    </div>
  )
}
