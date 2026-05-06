import { useRef, useEffect, useMemo, useCallback } from 'react'
import { SourceIcon } from '@/components/SourceIcon'
import { Badge } from '@/components/Badge'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/cn'
import type { ResearchItem } from '@/lib/api'

/** Color map for source_type dots on the timeline */
const SOURCE_COLORS: Record<string, string> = {
  reddit: '#FF4500',
  pubmed: '#326599',
  arxiv: '#B31B1B',
  biorxiv: '#6A3D9A',
  x: '#1DA1F2',
  twitter: '#1DA1F2',
  lpsg: '#E040FB',
  duckduckgo: '#DE5833',
  ddg: '#DE5833',
  web: '#4CAF50',
  firecrawl: '#FF6D00',
  visual_capture: '#00BCD4',
  literature: '#795548',
}

function dotColor(sourceType: string): string {
  return SOURCE_COLORS[sourceType.toLowerCase()] ?? 'var(--color-accent)'
}

/** Format a date string into a readable header like "Mar 15, 2026" */
function formatDateHeader(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Extract just the YYYY-MM-DD date key from an ISO string */
function dateKey(iso: string): string {
  return iso.slice(0, 10)
}

interface DateGroup {
  date: string
  label: string
  items: ResearchItem[]
}

function groupByDate(items: ResearchItem[]): DateGroup[] {
  const map = new Map<string, ResearchItem[]>()
  for (const item of items) {
    const key = dateKey(item.first_seen_at)
    const existing = map.get(key)
    if (existing) {
      existing.push(item)
    } else {
      map.set(key, [item])
    }
  }
  // Already sorted DESC from the API, but ensure group order matches
  const groups: DateGroup[] = []
  for (const [key, groupItems] of map) {
    groups.push({
      date: key,
      label: formatDateHeader(key),
      items: groupItems,
    })
  }
  return groups
}

function normalizeScore(score: number): number {
  if (score <= 0) return 0
  if (score <= 1) return score
  return Math.min(score / 100, 1)
}

interface TimelineViewProps {
  items: ResearchItem[]
  total: number
  isFetching: boolean
  isLoading: boolean
  hasNextPage: boolean
  onLoadMore: () => void
  onItemClick: (id: number) => void
}

export function TimelineView({
  items,
  total,
  isFetching,
  isLoading,
  hasNextPage,
  onLoadMore,
  onItemClick,
}: TimelineViewProps) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetching && hasNextPage) {
          onLoadMore()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isFetching, hasNextPage, onLoadMore])

  const groups = useMemo(() => groupByDate(items), [items])

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="md" />
      </div>
    )
  }

  if (items.length === 0) {
    return null // parent handles empty state
  }

  return (
    <div className="relative pl-8">
      {/* Vertical timeline line */}
      <div
        className="absolute left-3.5 top-0 bottom-0 w-0.5"
        style={{ backgroundColor: 'var(--color-accent)', opacity: 0.35 }}
      />

      {groups.map((group) => (
        <div key={group.date} className="mb-6">
          {/* Date header */}
          <div className="relative flex items-center mb-3">
            {/* Diamond on the line */}
            <div
              className="absolute -left-8 w-3 h-3 rounded-sm rotate-45 border-2 border-bg-surface z-10"
              style={{ backgroundColor: 'var(--color-accent)', left: '-1.125rem' }}
            />
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              {group.label}
            </h3>
          </div>

          {/* Items for this date */}
          <div className="space-y-2">
            {group.items.map((item) => (
              <TimelineCard
                key={item.id}
                item={item}
                onClick={() => onItemClick(item.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-1" aria-hidden />

      {isFetching && !isLoading && (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      )}

      {/* Total count */}
      <div className="text-xs text-text-muted font-mono pt-2 pl-1">
        {total} item{total !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

function TimelineCard({ item, onClick }: { item: ResearchItem; onClick: () => void }) {
  const score = normalizeScore(item.score)
  const color = dotColor(item.source_type)

  const handleClick = useCallback(() => onClick(), [onClick])

  return (
    <div className="relative flex items-start gap-3 group" data-item-id={item.id}>
      {/* Dot on timeline */}
      <div className="relative flex-shrink-0 flex items-center" style={{ width: 0 }}>
        <div
          className="absolute w-2.5 h-2.5 rounded-full border-2 border-bg-surface z-10"
          style={{
            backgroundColor: color,
            left: '-1.5625rem', // align with the vertical line center
            top: '0.5rem',
          }}
        />
        {/* Horizontal connector */}
        <div
          className="absolute h-px"
          style={{
            backgroundColor: color,
            opacity: 0.4,
            left: '-0.875rem',
            width: '0.875rem',
            top: '0.75rem',
          }}
        />
      </div>

      {/* Card */}
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150',
          'bg-bg-surface/50 border border-border/50',
          'hover:bg-bg-surface hover:border-border hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
          'cursor-pointer',
        )}
      >
        {/* Source icon */}
        <SourceIcon sourceType={item.source_type} size={14} className="text-text-muted flex-shrink-0" />

        {/* Title */}
        <span className="flex-1 text-sm text-text-primary truncate leading-snug">
          {item.title || 'Untitled'}
        </span>

        {/* Theme badge */}
        {item.theme && (
          <Badge variant="default" className="text-[10px] flex-shrink-0">
            {item.theme}
          </Badge>
        )}

        {/* Score indicator */}
        {score > 0 && (
          <div
            className="flex-shrink-0 w-8 h-1.5 rounded-full bg-bg-elevated overflow-hidden"
            title={`Score: ${Math.round(score * 100)}%`}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${score * 100}%`,
                background: 'linear-gradient(to right, var(--color-teal), var(--color-accent))',
              }}
            />
          </div>
        )}
      </button>
    </div>
  )
}
