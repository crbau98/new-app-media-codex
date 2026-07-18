import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, RefreshCw, Search as SearchIcon, X } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { searchMedia } from '@/lib/api'
import { useAppStore, type GridDensity } from '@/store'
import MediaCard from '@/components/MediaCard'
import MediaDetail from '@/components/MediaDetail'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import { cn } from '@/lib/utils'

const densityCols: Record<GridDensity, string> = {
  compact: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7',
  normal: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
  spacious: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5',
}

const sortOptions = [
  { id: 'smart', label: 'Best match' },
  { id: 'newest', label: 'Newest' },
  { id: 'mostViewed', label: 'Most viewed' },
  { id: 'topRated', label: 'Top rated' },
] as const

type SortId = (typeof sortOptions)[number]['id']

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''
  const [input, setInput] = useState(urlQuery)
  const [sort, setSort] = useState<SortId>('smart')
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const gridDensity = useAppStore((s) => s.gridDensity)
  const searchHistory = useAppStore((s) => s.searchHistory)
  const addSearchToHistory = useAppStore((s) => s.addSearchToHistory)
  const clearSearchHistory = useAppStore((s) => s.clearSearchHistory)

  // Keep the input in sync with deep links (/search?q=...)
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery)
  if (lastUrlQuery !== urlQuery) {
    setLastUrlQuery(urlQuery)
    setInput(urlQuery)
  }

  const submittedQuery = urlQuery.trim()

  const resultsQuery = useQuery({
    queryKey: ['media-search', submittedQuery, sort],
    queryFn: () => searchMedia(submittedQuery, { sort }),
    enabled: submittedQuery.length > 0,
  })

  const results = useMemo(() => resultsQuery.data?.items ?? [], [resultsQuery.data])

  const submit = (value: string) => {
    const q = value.trim()
    setSearchParams(q ? { q } : {}, { replace: true })
    if (q) addSearchToHistory(q)
  }

  // Record deep-linked queries in history once
  useEffect(() => {
    if (submittedQuery) addSearchToHistory(submittedQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="animate-page-enter space-y-6">
      <div className="border-b border-line pb-5">
        <p className="eyebrow">Search the archive</p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-ink">Find anything public</h1>
      </div>

      {/* Search input */}
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          submit(input)
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <SearchIcon size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Titles, creators, tags"
            aria-label="Search query"
            className="h-11 w-full rounded-md border border-line bg-elevated pl-10 pr-10 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
          />
          {input && (
            <button
              type="button"
              onClick={() => {
                setInput('')
                submit('')
              }}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-ink-3 hover:text-ink"
              aria-label="Clear search"
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          )}
        </div>
        <button type="submit" className="btn-primary min-h-11">
          Search
        </button>
      </form>

      {/* History */}
      {!submittedQuery && searchHistory.length > 0 && (
        <section aria-label="Recent searches">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="eyebrow">Recent searches</h2>
            <button
              onClick={clearSearchHistory}
              className="inline-flex min-h-10 items-center font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink"
            >
              Clear history
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((term) => (
              <button key={term} onClick={() => submit(term)} className="chip">
                {term}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Sort + results */}
      {submittedQuery && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3" role="status">
              {resultsQuery.isLoading
                ? 'Searching…'
                : `${results.length} result${results.length === 1 ? '' : 's'} for “${submittedQuery}”`}
            </p>
            <div className="flex gap-1.5" role="group" aria-label="Sort results">
              {sortOptions.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setSort(option.id)}
                  className={cn('chip !min-h-10 !px-3', sort === option.id && 'chip-active')}
                  aria-pressed={sort === option.id}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {resultsQuery.isLoading ? (
            <SkeletonGrid count={10} />
          ) : resultsQuery.error ? (
            <EmptyState
              icon={RefreshCw}
              title="Search failed"
              description="The archive could not be reached. Try again in a moment."
              actionLabel="Retry"
              onAction={() => resultsQuery.refetch()}
            />
          ) : results.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No matches"
              description="Nothing public matched that query. Try a creator handle or a broader tag."
              actionLabel="Clear search"
              onAction={() => {
                setInput('')
                submit('')
              }}
            />
          ) : (
            <div className={cn('media-grid grid gap-4', densityCols[gridDensity])}>
              {results.map((item) => (
                <MediaCard key={item.id} item={item} aspectRatio="2/3" onSelect={(id) => setSelectedItem(results.find((entry) => entry.id === id) ?? null)} />
              ))}
            </div>
          )}
        </>
      )}

      {!submittedQuery && searchHistory.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-line p-4">
          <ArrowUpRight size={14} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
          <p className="text-[13px] leading-5 text-ink-2">
            Search runs against the live public archive — titles, creator handles and tags.
            Deep links like <span className="font-mono text-ink">/search?q=query</span> work too.
          </p>
        </div>
      )}

      <MediaDetail
        item={selectedItem}
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        items={results}
        onNavigate={setSelectedItem}
      />
    </div>
  )
}
