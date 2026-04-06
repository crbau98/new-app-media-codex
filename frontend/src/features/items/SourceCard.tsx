import { useState, useEffect, useRef, memo } from 'react'
import { Bookmark, BookmarkCheck, Archive, Check, Copy, Star, Clock } from 'lucide-react'
import { SourceIcon } from '@/components/SourceIcon'
import { TagChip } from '@/components/TagChip'
import { Badge } from '@/components/Badge'
import { useUpdateItem } from '@/hooks/useItems'
import type { ResearchItem } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/store'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-accent/20 text-accent rounded-sm not-italic">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

export type Density = 'compact' | 'comfortable' | 'spacious'
type BadgeVariant = 'default' | 'accent' | 'teal' | 'amber' | 'green' | 'red' | 'purple' | 'muted'

const REVIEW_VARIANT: Record<string, BadgeVariant> = {
  new: 'default',
  reviewing: 'amber',
  shortlisted: 'green',
  archived: 'muted',
}

// Static gradient string — module-level to avoid recreating on each render
const SCORE_BAR_GRADIENT = 'linear-gradient(to right, var(--color-teal), var(--color-accent))'

function calcReadingTime(summary: string, content: string): number {
  const text = `${summary ?? ''} ${content ?? ''}`.trim()
  const wordCount = text.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(wordCount / 200))
}

function normalizeScore(score: number): number {
  if (score <= 0) return 0
  if (score <= 1) return score
  return Math.min(score / 100, 1)
}

export const SourceCard = memo(function SourceCard({
  item,
  selected,
  onSelect,
  density = 'comfortable',
  index = 0,
  visited = false,
}: {
  item: ResearchItem
  selected: boolean
  onSelect: (id: number) => void
  density?: Density
  index?: number
  visited?: boolean
}) {
  const update = useUpdateItem()
  const qc = useQueryClient()
  const searchQuery = useAppStore((s) => s.filters.search)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const addToast = useAppStore((s) => s.addToast)
  const reviewVariant: BadgeVariant = REVIEW_VARIANT[item.review_status] ?? 'default'
  const lastVisit = localStorage.getItem('lastVisit')
  const isNew = !!(item.first_seen_at && lastVisit && new Date(item.first_seen_at) > new Date(lastVisit))

  // Copy excerpt state
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleCopyExcerpt(e: React.MouseEvent) {
    e.stopPropagation()
    const excerpt = (item.summary ?? '').slice(0, 200)
    navigator.clipboard.writeText(excerpt).then(() => {
      setCopied(true)
      addToast('Excerpt copied')
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  function goTag(type: 'compound' | 'mechanism', value: string) {
    resetFilters()
    setFilter(type, value)
    setActiveView('items')
  }

  const densityClass = density === 'compact' ? 'py-2' : density === 'spacious' ? 'py-4' : 'py-3'

  const readMins = calcReadingTime(item.summary, item.content)
  const hasScore = item.score > 0
  const scoreFraction = hasScore ? normalizeScore(item.score) : 0

  const staggerDelay = Math.min(index * 40, 400)

  return (
    <div
      data-item-id={item.id}
      className={cn(
        'group relative bg-bg-surface border border-border rounded-xl overflow-hidden card-hover cursor-pointer',
        'animate-[fade-in_0.35s_ease_both]',
        'hover:border-accent/50 hover:bg-bg-elevated hover:shadow-md cursor-pointer',
        selected && 'border-accent/60 bg-bg-elevated ring-1 ring-accent/20',
        visited && !selected && 'border-border/50',
      )}
      style={{ animationDelay: `${staggerDelay}ms` }}
      title="Click to open detail"
    >
      {/* Visited left-edge indicator */}
      {visited && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-text-muted/20 rounded-l-xl" />
      )}
      {/* Score bar */}
      {hasScore && (
        <div className="w-full h-[2px] bg-bg-subtle">
          <div
            className="h-full transition-[width] duration-700 ease-out"
            style={{
              width: `${scoreFraction * 100}%`,
              background: SCORE_BAR_GRADIENT,
            }}
          />
        </div>
      )}

      {/* Copy excerpt button */}
      {item.summary && (
        <button
          onClick={handleCopyExcerpt}
          title="Copy excerpt"
          aria-label="Copy excerpt"
          className={cn(
            'absolute top-2 right-2 z-10 flex items-center justify-center w-6 h-6 rounded transition-all duration-150',
            'bg-bg-elevated border border-border text-text-muted',
            'hover:border-accent/40 hover:text-accent',
            'opacity-0 group-hover:opacity-100',
          )}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}

      <div className={cn('pl-4 pr-4', densityClass)}>
        {/* Header row */}
        <div className="flex items-start gap-2 mb-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onSelect(item.id) }}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 shrink-0 accent-accent"
            aria-label={`Select ${item.title}`}
          />
          <div className="flex-1 min-w-0">
            {/* Metadata row */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="flex items-center gap-1 text-xs text-text-muted font-mono">
                <SourceIcon sourceType={item.source_type} size={11} />
                <span>{item.source_type}</span>
              </span>
              <Badge variant="muted" mono>{item.theme}</Badge>
              {item.review_status && item.review_status !== 'new' && (
                <Badge variant={reviewVariant}>{item.review_status}</Badge>
              )}
              {item.score > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-accent font-mono bg-accent/8 border border-accent/20 rounded px-1.5 py-0.5">
                  ◆ {item.score.toFixed(1)}
                </span>
              )}
              {item.is_saved && <Badge variant="green">saved</Badge>}
              {item.queued_at && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-teal font-mono bg-teal/8 border border-teal/20 rounded px-1.5 py-0.5" title="In reading queue">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  queued
                </span>
              )}
              {isNew && <Badge variant="accent">new</Badge>}
              {item.user_note && (
                <span
                  className="inline-flex items-center gap-0.5 text-[11px] text-text-muted font-mono bg-bg-subtle border border-border rounded px-1.5 py-0.5"
                  title={item.user_note.slice(0, 120)}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  note
                </span>
              )}
            </div>
            {/* Title */}
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'text-[15px] font-semibold hover:text-accent transition-colors line-clamp-2 leading-snug',
                visited ? 'text-text-secondary' : 'text-text-primary',
              )}
            >
              <Highlighted text={item.title || ''} query={searchQuery} />
            </a>
          </div>
        </div>

        {/* Summary */}
        {item.summary && (
          <p className="text-xs text-text-secondary line-clamp-2 mb-2.5 ml-6"><Highlighted text={(item.summary || '').slice(0, 200)} query={searchQuery} /></p>
        )}

        {/* Compound + mechanism chips */}
        {(item.compounds.length > 0 || item.mechanisms.length > 0) && (
          <div className="flex flex-wrap gap-1 mb-2.5 ml-6">
            {item.compounds.map((c) => (
              <TagChip
                key={c}
                label={c}
                variant="compound"
                onClick={(e) => { e.stopPropagation(); goTag('compound', c) }}
              />
            ))}
            {item.mechanisms.map((m) => (
              <TagChip
                key={m}
                label={m}
                variant="mechanism"
                onClick={(e) => { e.stopPropagation(); goTag('mechanism', m) }}
              />
            ))}
          </div>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between ml-6">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-text-muted font-mono">
              {item.domain}
              {item.first_seen_at && ` · ${item.first_seen_at.slice(0, 10)}`}
            </span>
            <span className="text-xs text-text-muted font-mono bg-bg-subtle rounded-full px-2 py-0.5">
              ~{readMins} min read
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <ActionButton
              title={item.is_saved ? 'Unsave' : 'Save'}
              hoverClass="hover:bg-amber/10 hover:text-amber"
              active={item.is_saved}
              activeClass="text-amber"
              onClick={() => update.mutate({ id: item.id, patch: { is_saved: !item.is_saved } })}
            >
              {item.is_saved
                ? <BookmarkCheck size={13} />
                : <Bookmark size={13} />
              }
            </ActionButton>
            <ActionButton
              title={item.queued_at ? 'Remove from queue' : 'Read later'}
              hoverClass="hover:bg-teal/10 hover:text-teal"
              active={!!item.queued_at}
              activeClass="text-teal"
              onClick={() => {
                const patch = item.queued_at ? { queued_at: null } : { queued_at: new Date().toISOString() }
                api.updateItem(item.id, patch).then(() => {
                  qc.invalidateQueries({ queryKey: ['items'] })
                  qc.invalidateQueries({ queryKey: ['queue-count'] })
                })
              }}
            >
              <Clock size={13} />
            </ActionButton>
            <ActionButton
              title={item.review_status === 'shortlisted' ? 'Shortlisted' : 'Shortlist'}
              hoverClass="hover:bg-green/10 hover:text-green"
              active={item.review_status === 'shortlisted'}
              activeClass="text-green"
              onClick={() => {
                const next = item.review_status === 'shortlisted' ? 'reviewing' : 'shortlisted'
                update.mutate({ id: item.id, patch: { review_status: next } })
              }}
            >
              <Star size={13} />
            </ActionButton>
            <ActionButton
              title={item.review_status === 'archived' ? 'Archived' : 'Archive'}
              hoverClass="hover:bg-red/10 hover:text-red"
              active={item.review_status === 'archived'}
              activeClass="text-red"
              onClick={() => {
                const next = item.review_status === 'archived' ? 'reviewing' : 'archived'
                update.mutate({ id: item.id, patch: { review_status: next } })
              }}
            >
              <Archive size={13} />
            </ActionButton>
          </div>
        </div>
      </div>
      <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent/60"><path d="m9 18 6-6-6-6"/></svg>
      </div>
    </div>
  )
}, (prev, next) => {
  return prev.item.id === next.item.id &&
    prev.selected === next.selected &&
    prev.visited === next.visited &&
    prev.density === next.density
})

function ActionButton({
  children,
  title,
  onClick,
  hoverClass,
  active = false,
  activeClass = '',
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  hoverClass: string
  active?: boolean
  activeClass?: string
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded transition-all',
        active ? activeClass : 'text-text-muted',
        hoverClass,
      )}
    >
      {children}
    </button>
  )
}
