import { useState, useEffect, useMemo, useRef, useCallback } from 'react'

type SortOrder = 'newest' | 'oldest' | 'theme' | 'status'
import { useBrowseHypotheses } from '@/hooks/useHypotheses'
import { Skeleton } from '@/components/Skeleton'
import { HypothesisCard, getPinnedIds } from './HypothesisCard'
import { StreamingHypothesis } from './StreamingHypothesis'
import { api } from '@/lib/api'
import type { Hypothesis } from '@/lib/api'

function InsightsBar({
  hypotheses,
  activeStatus,
  onStatusClick,
}: {
  hypotheses: Hypothesis[]
  activeStatus: string
  onStatusClick: (status: string) => void
}) {
  const total = hypotheses.length
  const newCount = hypotheses.filter((h) => h.review_status === 'new').length
  const promoted = hypotheses.filter((h) => h.review_status === 'promoted').length
  const dismissed = hypotheses.filter((h) => h.review_status === 'dismissed').length
  const saved = hypotheses.filter((h) => h.is_saved).length
  const reviewing = hypotheses.filter((h) => h.review_status === 'reviewing').length

  const stats = [
    { label: 'Total', value: total, status: '', cls: 'bg-bg-subtle border-border text-text-secondary', activeCls: 'ring-1 ring-text-secondary/40' },
    { label: 'New', value: newCount, status: 'new', cls: 'bg-blue-500/10 border-blue-500/30 text-blue-400', activeCls: 'ring-1 ring-blue-500/50' },
    { label: 'Reviewing', value: reviewing, status: 'reviewing', cls: 'bg-amber/10 border-amber/30 text-amber', activeCls: 'ring-1 ring-amber/50' },
    { label: 'Promoted', value: promoted, status: 'promoted', cls: 'bg-green/10 border-green/30 text-green', activeCls: 'ring-1 ring-green/50' },
    { label: 'Dismissed', value: dismissed, status: 'dismissed', cls: 'bg-red/10 border-red/20 text-red/70', activeCls: 'ring-1 ring-red/30' },
    { label: 'Saved', value: saved, status: '__saved__', cls: 'bg-accent/10 border-accent/30 text-accent', activeCls: 'ring-1 ring-accent/50' },
  ]

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {stats.map(({ label, value, status, cls, activeCls }) => {
        const isActive = activeStatus === status && status !== ''
        return (
          <button
            key={label}
            onClick={() => onStatusClick(isActive ? '' : status)}
            aria-pressed={isActive}
            className={`rounded-xl border px-3 py-2.5 text-center transition-all hover:brightness-110 cursor-pointer ${cls} ${isActive ? activeCls : ''}`}
          >
            <p className="text-lg font-bold font-mono leading-none">{value}</p>
            <p className="text-[10px] uppercase tracking-wider mt-1 opacity-80">{label}</p>
          </button>
        )
      })}
    </div>
  )
}

function HypothesesFilters({
  search, setSearch,
  themeFilter, setThemeFilter,
  statusFilter, setStatusFilter,
  sortOrder, setSortOrder,
  themes,
}: {
  search: string; setSearch: (v: string) => void
  themeFilter: string; setThemeFilter: (v: string) => void
  statusFilter: string; setStatusFilter: (v: string) => void
  sortOrder: SortOrder; setSortOrder: (v: SortOrder) => void
  themes: string[]
}) {
  const ctrl = "px-3 py-2 bg-bg-subtle border border-border rounded-lg text-sm text-text-secondary focus:outline-none focus:border-accent/50"
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="search"
        placeholder="Search hypotheses…"
        value={search}
        onChange={(e) => { setSearch(e.target.value) }}
        className={`${ctrl} flex-1 min-w-48 text-text-primary placeholder:text-text-muted`}
      />
      <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)} className={ctrl} aria-label="Theme filter">
        <option value="">All themes</option>
        {themes.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={ctrl} aria-label="Status filter">
        <option value="">All statuses</option>
        {['new', 'reviewing', 'promoted', 'dismissed'].map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as SortOrder)} className={ctrl} aria-label="Sort order">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="theme">By theme</option>
        <option value="status">By status</option>
      </select>
    </div>
  )
}

function ExportDropdown() {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const downloadFile = useCallback((status?: string) => {
    const params: Record<string, string> = { format: 'md' }
    if (status) params.status = status
    const url = api.hypothesesExportUrl(params)
    const a = document.createElement('a')
    a.href = url
    a.download = 'hypotheses_report.md'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setToast('Report downloaded')
    setOpen(false)
  }, [])

  const copyToClipboard = useCallback(async () => {
    try {
      const md = await api.hypothesesExportMarkdown()
      await navigator.clipboard.writeText(md)
      setToast('Copied to clipboard')
    } catch {
      setToast('Copy failed')
    }
    setOpen(false)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
          <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
        </svg>
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-border bg-bg-surface shadow-lg py-1 animate-in fade-in slide-in-from-top-1">
          <button
            onClick={() => downloadFile()}
            className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-subtle transition-colors"
          >
            Export All (Markdown)
          </button>
          <button
            onClick={() => downloadFile('promoted')}
            className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-subtle transition-colors"
          >
            Export Promoted Only
          </button>
          <hr className="my-1 border-border" />
          <button
            onClick={() => void copyToClipboard()}
            className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg-subtle transition-colors"
          >
            Copy to Clipboard
          </button>
        </div>
      )}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] rounded-lg bg-green/90 px-4 py-2.5 text-sm text-white shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
    </div>
  )
}

const LIMIT = 24

export function HypothesesPage() {
  const [search, setSearch] = useState('')
  const [themeFilter, setThemeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [savedOnly, setSavedOnly] = useState(false)
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [offset, setOffset] = useState(0)
  const [pinnedIds, setPinnedIds] = useState<number[]>(() => getPinnedIds())

  // Reset offset when filters or sort change
  useEffect(() => {
    setOffset(0)
  }, [search, themeFilter, statusFilter, savedOnly, sortOrder])

  const params: Record<string, string | number | boolean> = { limit: LIMIT, offset }
  if (search) params.search = search
  if (themeFilter) params.theme = themeFilter
  if (statusFilter) params.review_status = statusFilter
  if (savedOnly) params.saved_only = true
  if (sortOrder !== 'newest') params.sort = sortOrder

  const { data: browseData, isLoading } = useBrowseHypotheses(params)
  const all = browseData?.hypotheses ?? []
  const total = browseData?.total ?? 0

  const filtersActive = !!(search || themeFilter || statusFilter || savedOnly)

  function handleInsightsBarClick(status: string) {
    if (status === '__saved__') {
      setSavedOnly((v) => !v)
      setStatusFilter('')
    } else {
      setStatusFilter(status)
      setSavedOnly(false)
    }
  }

  const insightsBarActive = savedOnly ? '__saved__' : statusFilter

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
  const pinnedHypotheses = useMemo(() => all.filter((h) => pinnedSet.has(h.id)), [all, pinnedSet])
  const unpinnedHypotheses = useMemo(() => all.filter((h) => !pinnedSet.has(h.id)), [all, pinnedSet])

  // Group unpinned hypotheses by theme, sorted alphabetically (used when no filters active)
  const byTheme = useMemo(() => {
    return unpinnedHypotheses.reduce((acc, h) => {
      const key = h.theme ?? 'general'
      ;(acc[key] ??= []).push(h)
      return acc
    }, {} as Record<string, Hypothesis[]>)
  }, [unpinnedHypotheses])

  const sortedThemes = useMemo(() => Object.keys(byTheme).sort(), [byTheme])

  // Derive theme list for filter dropdown from all loaded hypotheses
  const availableThemes = useMemo(() => {
    const set = new Set<string>()
    all.forEach((h) => { if (h.theme) set.add(h.theme) })
    return Array.from(set).sort()
  }, [all])

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-bg-surface p-5 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!isLoading && all.length === 0) {
    return (
      <div className="space-y-4 max-w-4xl">
        <StreamingHypothesis />
        <HypothesesFilters
          search={search} setSearch={setSearch}
          themeFilter={themeFilter} setThemeFilter={setThemeFilter}
          statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          sortOrder={sortOrder} setSortOrder={setSortOrder}
          themes={availableThemes}
        />
        <div className="flex flex-col items-center justify-center py-24 text-center px-8">
          <div className="text-5xl mb-4 opacity-30">💡</div>
          <h3 className="text-base font-semibold text-text-primary mb-2">No hypotheses found</h3>
          <p className="text-sm text-text-muted max-w-xs">
            {search || themeFilter || statusFilter
              ? 'Try adjusting your filters.'
              : 'Generate a hypothesis from the Hypotheses page or after a crawl.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <StreamingHypothesis />

      {/* Insights summary bar */}
      {all.length > 0 && (
        <InsightsBar
          hypotheses={all}
          activeStatus={insightsBarActive}
          onStatusClick={handleInsightsBarClick}
        />
      )}

      {/* Filter bar + export */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <HypothesesFilters
            search={search} setSearch={setSearch}
            themeFilter={themeFilter} setThemeFilter={setThemeFilter}
            statusFilter={statusFilter} setStatusFilter={setStatusFilter}
            sortOrder={sortOrder} setSortOrder={setSortOrder}
            themes={availableThemes}
          />
        </div>
        <ExportDropdown />
      </div>

      {filtersActive ? (
        /* Flat list when filters are active */
        <div className="space-y-3">
          {all.map((h) => (
            <HypothesisCard key={h.id} h={h} />
          ))}
        </div>
      ) : (
        <>
          {/* Pinned section */}
          {pinnedHypotheses.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-accent uppercase tracking-wider">📌 Pinned</span>
                <div className="flex-1 h-px bg-accent/20" />
              </div>
              <div className="rounded-xl bg-accent/5 p-3 space-y-3 border border-accent/10">
                {pinnedHypotheses.map((h) => (
                  <HypothesisCard key={h.id} h={h} />
                ))}
              </div>
            </div>
          )}

          {/* Theme-grouped unpinned hypotheses */}
          {sortedThemes.length > 0 && (
            <div className="space-y-2">
              {sortedThemes.map((theme, themeIndex) => (
                <div key={theme}>
                  <h3
                    className={`text-xs font-semibold text-text-muted uppercase tracking-wider mb-3 px-1 ${
                      themeIndex === 0 && pinnedHypotheses.length === 0 ? 'mt-0' : 'mt-6'
                    }`}
                  >
                    {theme}
                  </h3>
                  <div className="space-y-3">
                    {byTheme[theme].map((h) => (
                      <HypothesisCard key={h.id} h={h} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Load more pagination */}
      {total > offset + LIMIT && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => setOffset((o) => o + LIMIT)}
            className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:border-accent/40 hover:text-accent transition-colors"
          >
            Load more ({total - offset - LIMIT} remaining)
          </button>
        </div>
      )}
    </div>
  )
}
