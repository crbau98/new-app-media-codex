import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  mediaItems,
  creators,
  categories,
  type MediaItem,
  type Creator,
} from '@/lib/mockData'
import MediaCard from '@/components/MediaCard'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import {
  Search,
  X,
  Clock,
  TrendingUp,
  Users,
  Grid3X3,
  ChevronDown,
  SlidersHorizontal,
  ArrowDown,
  Star,
  Filter,
} from 'lucide-react'

/* ───────────────────────────────────────────────
   Types
   ─────────────────────────────────────────────── */
interface SearchFilters {
  type: 'all' | 'video' | 'image'
  duration: 'any' | 'short' | 'medium' | 'long'
  quality: 'any' | 'hd' | '4k'
  date: 'all' | 'today' | 'week' | 'month'
  rating: 'any' | '4plus' | '5'
  source: 'all' | 'Tube' | 'Redgifs'
  creator: string | null
}

const defaultFilters: SearchFilters = {
  type: 'all',
  duration: 'any',
  quality: 'any',
  date: 'all',
  rating: 'any',
  source: 'all',
  creator: null,
}

/* ───────────────────────────────────────────────
   Trending searches (static)
   ─────────────────────────────────────────────── */
const trendingSearches = [
  'gay sauna',
  'massage',
  'threesome',
  'solo',
  'cum',
]

/* ───────────────────────────────────────────────
   URL helpers for hash-based routing
   ─────────────────────────────────────────────── */
function getHashQueryParams(): Record<string, string> {
  const hash = window.location.hash
  const parts = hash.split('?')
  if (parts.length < 2) return {}
  const params = new URLSearchParams(parts[1])
  const result: Record<string, string> = {}
  params.forEach((v, k) => {
    result[k] = v
  })
  return result
}

function setHashQueryParams(params: Record<string, string | null>) {
  const hash = window.location.hash
  const base = hash.split('?')[0] || '#/search'
  const filtered: Record<string, string> = {}
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== '' && v !== 'all') filtered[k] = v
  })
  const qs = new URLSearchParams(filtered).toString()
  const next = qs ? `${base}?${qs}` : base
  window.location.hash = next.replace('#', '')
}

/* ───────────────────────────────────────────────
   Highlight matching text
   ─────────────────────────────────────────────── */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} className="bg-[var(--accent-dim)] text-[var(--accent)] rounded px-0.5">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

/* ───────────────────────────────────────────────
   Search Hero with Autocomplete
   ─────────────────────────────────────────────── */
function SearchHero({
  query,
  onQueryChange,
  onSubmit,
  recentSearches,
  onRecentSelect,
  onRecentRemove,
}: {
  query: string
  onQueryChange: (q: string) => void
  onSubmit: () => void
  recentSearches: string[]
  onRecentSelect: (q: string) => void
  onRecentRemove: (q: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // Autofocus on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  // Build suggestion list
  const suggestions = useMemo(() => {
    const list: { type: string; label: string; icon: React.ReactNode; action: () => void }[] = []
    if (recentSearches.length > 0) {
      recentSearches.slice(0, 5).forEach((term) => {
        list.push({
          type: 'recent',
          label: term,
          icon: <Clock size={14} className="text-[var(--text-muted)]" />,
          action: () => onRecentSelect(term),
        })
      })
    }
    if (query.length < 3) {
      trendingSearches.forEach((term) => {
        list.push({
          type: 'trending',
          label: term,
          icon: <TrendingUp size={14} className="text-[var(--live-pulse)]" />,
          action: () => onRecentSelect(term),
        })
      })
    }
    // Suggested creators
    if (query.length >= 1) {
      const matching = creators.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
      )
      matching.slice(0, 3).forEach((c) => {
        list.push({
          type: 'creator',
          label: c.name,
          icon: <img src={c.avatar} alt="" className="w-4 h-4 rounded-full" />,
          action: () => onRecentSelect(c.name),
        })
      })
    }
    // Suggested categories
    if (query.length >= 1) {
      const matching = categories.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase())
      )
      matching.slice(0, 3).forEach((c) => {
        list.push({
          type: 'category',
          label: c.name,
          icon: <Grid3X3 size={14} className="text-[var(--text-muted)]" />,
          action: () => onRecentSelect(c.name),
        })
      })
    }
    return list
  }, [query, recentSearches, onRecentSelect])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        suggestions[highlightedIndex].action()
      } else {
        onSubmit()
      }
      setFocused(false)
    } else if (e.key === 'Escape') {
      setFocused(false)
      inputRef.current?.blur()
    }
  }, [suggestions, highlightedIndex, onSubmit])

  const showDropdown = focused && (suggestions.length > 0 || query.length > 0)

  return (
    <div className="relative">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
        className={cn(
          'flex items-center gap-3 px-4 h-14 rounded-[var(--radius-lg)] border transition-all duration-200',
          focused
            ? 'bg-[var(--bg-surface)] border-[var(--border-medium)] shadow-[0_0_30px_rgba(232,121,169,0.1)]'
            : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)]'
        )}
      >
        <Search size={20} className="text-[var(--text-tertiary)] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setHighlightedIndex(-1)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder="Search media, creators, categories..."
          className="bg-transparent text-[clamp(18px,2.5vw,28px)] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none w-full"
        />
        {query && (
          <button
            onClick={() => {
              onQueryChange('')
              inputRef.current?.focus()
            }}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0"
          >
            <X size={18} />
          </button>
        )}
        {!query && (
          <span className="hidden md:flex items-center gap-0.5 kbd shrink-0">
            ⌘K
          </span>
        )}
      </motion.div>

      {/* Autocomplete Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }}
            className="absolute top-full left-0 right-0 mt-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] shadow-lg z-50 overflow-hidden"
          >
            {/* Recent */}
            {recentSearches.length > 0 && (
              <div className="py-2">
                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Recent
                </div>
                {recentSearches.slice(0, 5).map((term, i) => (
                  <button
                    key={`recent-${term}`}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => {
                      onRecentSelect(term)
                      setFocused(false)
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                      highlightedIndex === i ? 'bg-[var(--bg-surface)]' : ''
                    )}
                  >
                    <Clock size={14} className="text-[var(--text-muted)]" />
                    <span className="text-[var(--text-secondary)]">{term}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRecentRemove(term)
                      }}
                      className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    >
                      <X size={12} />
                    </button>
                  </button>
                ))}
              </div>
            )}

            {/* Trending */}
            {query.length < 3 && (
              <div className="py-2 border-t border-[var(--border-subtle)]">
                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Trending
                </div>
                {trendingSearches.map((term, i) => {
                  const idx = recentSearches.length + i
                  return (
                    <button
                      key={`trend-${term}`}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => {
                        onRecentSelect(term)
                        setFocused(false)
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                        highlightedIndex === idx ? 'bg-[var(--bg-surface)]' : ''
                      )}
                    >
                      <TrendingUp size={14} className="text-[var(--live-pulse)]" />
                      <span className="text-[var(--text-secondary)]">{term}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Creators */}
            {creators.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).length > 0 && (
              <div className="py-2 border-t border-[var(--border-subtle)]">
                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Creators
                </div>
                {creators
                  .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 3)
                  .map((c, i) => {
                    const base = recentSearches.length + trendingSearches.length
                    const idx = base + i
                    return (
                      <button
                        key={`creator-${c.id}`}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                        onClick={() => {
                          onRecentSelect(c.name)
                          setFocused(false)
                        }}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                          highlightedIndex === idx ? 'bg-[var(--bg-surface)]' : ''
                        )}
                      >
                        <img src={c.avatar} alt="" className="w-5 h-5 rounded-full" />
                        <span className="text-[var(--text-secondary)]">{c.name}</span>
                      </button>
                    )
                  })}
              </div>
            )}

            {/* Categories */}
            {categories.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).length > 0 && (
              <div className="py-2 border-t border-[var(--border-subtle)]">
                <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Categories
                </div>
                {categories
                  .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
                  .slice(0, 3)
                  .map((c, i) => {
                    const base =
                      recentSearches.length +
                      trendingSearches.length +
                      creators.filter((cc) => cc.name.toLowerCase().includes(query.toLowerCase())).slice(0, 3).length
                    const idx = base + i
                    return (
                      <button
                        key={`cat-${c.id}`}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                        onClick={() => {
                          onRecentSelect(c.name)
                          setFocused(false)
                        }}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                          highlightedIndex === idx ? 'bg-[var(--bg-surface)]' : ''
                        )}
                      >
                        <Grid3X3 size={14} className="text-[var(--text-muted)]" />
                        <span className="text-[var(--text-secondary)]">{c.name}</span>
                        <span className="ml-auto text-[11px] font-mono text-[var(--text-muted)]">{c.count}</span>
                      </button>
                    )
                  })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────────────────────────────────────────────
   Filter Chip
   ─────────────────────────────────────────────── */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--bg-surface)] text-sm text-[var(--text-secondary)] border border-[var(--border-subtle)] shrink-0"
    >
      <span>{label}</span>
      <button
        onClick={onRemove}
        className="text-[var(--text-tertiary)] hover:text-[var(--error)] transition-colors"
      >
        <X size={12} />
      </button>
    </motion.div>
  )
}

/* ───────────────────────────────────────────────
   Advanced Filter Panel
   ─────────────────────────────────────────────── */
function AdvancedFilterPanel({
  filters,
  onChange,
  open,
}: {
  filters: SearchFilters
  onChange: (f: Partial<SearchFilters>) => void
  open: boolean
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="overflow-hidden"
        >
          <div className="mt-4 p-4 rounded-[var(--radius-lg)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Type */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 block">
                Type
              </label>
              <div className="flex gap-2">
                {(['all', 'video', 'image'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => onChange({ type: t })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm capitalize transition-colors',
                      filters.type === t
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 block">
                Duration
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'any' as const, label: 'Any' },
                  { key: 'short' as const, label: '<2 min' },
                  { key: 'medium' as const, label: '2-10 min' },
                  { key: 'long' as const, label: '>10 min' },
                ].map((d) => (
                  <button
                    key={d.key}
                    onClick={() => onChange({ duration: d.key })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm transition-colors',
                      filters.duration === d.key
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 block">
                Quality
              </label>
              <div className="flex gap-2">
                {(['any', 'hd', '4k'] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => onChange({ quality: q })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm uppercase transition-colors',
                      filters.quality === q
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                    )}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 block">
                Date Added
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'all' as const, label: 'All Time' },
                  { key: 'today' as const, label: 'Today' },
                  { key: 'week' as const, label: 'This Week' },
                  { key: 'month' as const, label: 'This Month' },
                ].map((d) => (
                  <button
                    key={d.key}
                    onClick={() => onChange({ date: d.key })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm transition-colors',
                      filters.date === d.key
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Rating */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 block">
                Rating
              </label>
              <div className="flex gap-2">
                {([
                  { key: 'any' as const, label: 'Any' },
                  { key: '4plus' as const, label: '4+ Stars' },
                  { key: '5' as const, label: '5 Stars' },
                ] as const).map((r) => (
                  <button
                    key={r.key}
                    onClick={() => onChange({ rating: r.key })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm transition-colors',
                      filters.rating === r.key
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Source */}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 block">
                Source
              </label>
              <div className="flex gap-2">
                {(['all', 'Tube', 'Redgifs'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => onChange({ source: s })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm transition-colors',
                      filters.source === s
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Creator select */}
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 block">
                Creator
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onChange({ creator: null })}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-sm transition-colors',
                    filters.creator === null
                      ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                      : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                  )}
                >
                  All Creators
                </button>
                {creators.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onChange({ creator: c.name })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm transition-colors',
                      filters.creator === c.name
                        ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────────────────────────────────────────────
   Main Search Page
   ─────────────────────────────────────────────── */
export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultFilters })
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<MediaItem[]>([])
  const [displayCount, setDisplayCount] = useState(24)
  const [sort, setSort] = useState('Relevance')

  const searchQuery = useAppStore((s) => s.searchQuery)
  const setAppSearchQuery = useAppStore((s) => s.setSearchQuery)

  // Load from URL on mount
  useEffect(() => {
    const params = getHashQueryParams()
    if (params.q) {
      setQuery(params.q)
      setDebouncedQuery(params.q)
    }
    if (params.type) setFilters((f) => ({ ...f, type: params.type as SearchFilters['type'] }))
    if (params.duration) setFilters((f) => ({ ...f, duration: params.duration as SearchFilters['duration'] }))
    if (params.quality) setFilters((f) => ({ ...f, quality: params.quality as SearchFilters['quality'] }))
    if (params.date) setFilters((f) => ({ ...f, date: params.date as SearchFilters['date'] }))
    if (params.rating) setFilters((f) => ({ ...f, rating: params.rating as SearchFilters['rating'] }))
    if (params.source) setFilters((f) => ({ ...f, source: params.source as SearchFilters['source'] }))
    if (params.creator) setFilters((f) => ({ ...f, creator: params.creator }))
    if (params.sort) setSort(params.sort)
  }, [])

  // Debounce search
  useEffect(() => {
    setLoading(true)
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
      setLoading(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // Sync to URL
  useEffect(() => {
    setHashQueryParams({
      q: debouncedQuery || null,
      type: filters.type === 'all' ? null : filters.type,
      duration: filters.duration === 'any' ? null : filters.duration,
      quality: filters.quality === 'any' ? null : filters.quality,
      date: filters.date === 'all' ? null : filters.date,
      rating: filters.rating === 'any' ? null : filters.rating,
      source: filters.source === 'all' ? null : filters.source,
      creator: filters.creator,
      sort: sort === 'Relevance' ? null : sort,
    })
  }, [debouncedQuery, filters, sort])

  // Sync to app store
  useEffect(() => {
    setAppSearchQuery(debouncedQuery)
  }, [debouncedQuery, setAppSearchQuery])

  // Perform search
  const allResults = useMemo(() => {
    let result = [...mediaItems]
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase()
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.creator.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)) ||
          m.category.toLowerCase().includes(q)
      )
    }
    // Apply filters
    if (filters.type === 'video') result = result.filter((m) => m.isVideo)
    if (filters.type === 'image') result = result.filter((m) => !m.isVideo)
    if (filters.duration === 'short') result = result.filter((m) => m.isVideo && parseDuration(m.duration) < 120)
    if (filters.duration === 'medium') result = result.filter((m) => m.isVideo && parseDuration(m.duration) >= 120 && parseDuration(m.duration) <= 600)
    if (filters.duration === 'long') result = result.filter((m) => m.isVideo && parseDuration(m.duration) > 600)
    if (filters.rating === '4plus') result = result.filter((m) => m.rating >= 4)
    if (filters.rating === '5') result = result.filter((m) => m.rating >= 5)
    if (filters.date === 'today') {
      const today = new Date().toDateString()
      result = result.filter((m) => new Date(m.createdAt).toDateString() === today)
    }
    if (filters.date === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      result = result.filter((m) => new Date(m.createdAt) >= weekAgo)
    }
    if (filters.date === 'month') {
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      result = result.filter((m) => new Date(m.createdAt) >= monthAgo)
    }
    if (filters.source !== 'all') result = result.filter((m) => m.source === filters.source)
    if (filters.creator) result = result.filter((m) => m.creator === filters.creator)

    // Sort
    switch (sort) {
      case 'Newest':
        result.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
        break
      case 'Top Rated':
        result.sort((a, b) => b.rating - a.rating)
        break
      case 'Most Viewed':
        result.sort((a, b) => b.views - a.views)
        break
      default:
        // Relevance — items matching in title first
        if (debouncedQuery) {
          const q = debouncedQuery.toLowerCase()
          result.sort((a, b) => {
            const aTitle = a.title.toLowerCase().includes(q) ? 2 : 0
            const bTitle = b.title.toLowerCase().includes(q) ? 2 : 0
            return bTitle - aTitle || b.views - a.views
          })
        }
        break
    }
    return result
  }, [debouncedQuery, filters, sort])

  const displayed = useMemo(() => allResults.slice(0, displayCount), [allResults, displayCount])

  const handleSearchSubmit = useCallback(() => {
    if (!debouncedQuery.trim()) return
    setRecentSearches((prev) => {
      const next = [debouncedQuery, ...prev.filter((s) => s !== debouncedQuery)].slice(0, 5)
      return next
    })
  }, [debouncedQuery])

  const handleRecentSelect = useCallback((term: string) => {
    setQuery(term)
    setDebouncedQuery(term)
    setRecentSearches((prev) => {
      const next = [term, ...prev.filter((s) => s !== term)].slice(0, 5)
      return next
    })
  }, [])

  const handleRecentRemove = useCallback((term: string) => {
    setRecentSearches((prev) => prev.filter((s) => s !== term))
  }, [])

  // Build active filter chips
  const activeChips = useMemo(() => {
    const chips: { label: string; key: string }[] = []
    if (filters.type !== 'all') chips.push({ label: `Type: ${filters.type}`, key: 'type' })
    if (filters.duration !== 'any') chips.push({ label: `Duration: ${filters.duration}`, key: 'duration' })
    if (filters.quality !== 'any') chips.push({ label: `Quality: ${filters.quality}`, key: 'quality' })
    if (filters.date !== 'all') chips.push({ label: `Date: ${filters.date}`, key: 'date' })
    if (filters.rating !== 'any') chips.push({ label: `Rating: ${filters.rating}`, key: 'rating' })
    if (filters.source !== 'all') chips.push({ label: `Source: ${filters.source}`, key: 'source' })
    if (filters.creator) chips.push({ label: `Creator: ${filters.creator}`, key: 'creator' })
    return chips
  }, [filters])

  const removeFilter = useCallback((key: string) => {
    setFilters((f) => ({
      ...f,
      [key]: key === 'creator' ? null : key === 'type' || key === 'source' ? 'all' : 'any',
    }))
  }, [])

  const hasActiveFilters = activeChips.length > 0

  return (
    <div className="space-y-4">
      {/* Search Hero */}
      <SearchHero
        query={query}
        onQueryChange={setQuery}
        onSubmit={handleSearchSubmit}
        recentSearches={recentSearches}
        onRecentSelect={handleRecentSelect}
        onRecentRemove={handleRecentRemove}
      />

      {/* Filter toggle + sort */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setFiltersOpen(!filtersOpen)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors',
            filtersOpen || hasActiveFilters
              ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
              : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]/80'
          )}
        >
          <SlidersHorizontal size={14} />
          Filters
          {hasActiveFilters && (
            <span className="w-4 h-4 rounded-full bg-[var(--accent)] text-white text-[10px] flex items-center justify-center font-bold">
              {activeChips.length}
            </span>
          )}
        </button>

        <div className="relative shrink-0 group">
          <button className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            {sort} <ChevronDown size={14} />
          </button>
          <div className="absolute top-full left-0 mt-1 w-40 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 py-1">
            {(['Relevance', 'Newest', 'Top Rated', 'Most Viewed'] as const).map((opt) => (
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
      </div>

      {/* Advanced Filter Panel */}
      <AdvancedFilterPanel filters={filters} onChange={(f) => setFilters((prev) => ({ ...prev, ...f }))} open={filtersOpen} />

      {/* Active Filter Chips */}
      <AnimatePresence>
        {hasActiveFilters && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 overflow-x-auto hide-scrollbar"
          >
            {activeChips.map((chip) => (
              <FilterChip
                key={chip.key}
                label={chip.label}
                onRemove={() => removeFilter(chip.key)}
              />
            ))}
            <button
              onClick={() => setFilters({ ...defaultFilters })}
              className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors shrink-0"
            >
              Clear all
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results header */}
      {debouncedQuery.trim() && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-end justify-between"
        >
          <h2 className="text-sm text-[var(--text-secondary)]">
            {allResults.length} results for &apos;{debouncedQuery}&apos;
          </h2>
          <span className="text-[11px] text-[var(--text-muted)]">
            Showing {displayed.length} of {allResults.length}
          </span>
        </motion.div>
      )}

      {/* Results Grid */}
      {loading ? (
        <SkeletonGrid count={6} />
      ) : displayed.length === 0 ? (
        <EmptyState
          variant="search"
          title={debouncedQuery ? `No results for '${debouncedQuery}'` : 'No results'}
          description="Try different keywords or clear filters to find what you're looking for."
          actionLabel="Clear filters"
          onAction={() => {
            setQuery('')
            setDebouncedQuery('')
            setFilters({ ...defaultFilters })
          }}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
          {displayed.map((item, i) => (
            <div key={item.id} className="flex flex-col gap-1.5">
              <MediaCard
                item={item}
                aspectRatio={i % 3 === 0 ? '3/4' : i % 3 === 1 ? '4/5' : '1/1'}
              />
              {debouncedQuery && (
                <p className="text-xs text-[var(--text-secondary)] line-clamp-1 px-0.5">
                  <HighlightText text={item.title} query={debouncedQuery} />
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Load more */}
      {!loading && displayed.length < allResults.length && (
        <div className="flex justify-center py-6">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setDisplayCount((c) => c + 24)}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowDown size={14} /> Load more
          </motion.button>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────
   Helper: parse video duration to seconds
   ─────────────────────────────────────────────── */
function parseDuration(dur: string): number {
  if (!dur) return 0
  const parts = dur.split(':').map(Number)
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}
