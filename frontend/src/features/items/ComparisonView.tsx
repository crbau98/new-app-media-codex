import { useState, useEffect, useMemo } from 'react'
import { api } from '@/lib/api'
import type { ResearchItem } from '@/lib/api'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/cn'

const ACCENT_COLORS = [
  'border-blue-500/50',
  'border-purple-500/50',
  'border-teal-500/50',
  'border-rose-500/50',
]

const ACCENT_BG = [
  'bg-blue-500/10',
  'bg-purple-500/10',
  'bg-teal-500/10',
  'bg-rose-500/10',
]

interface ComparisonViewProps {
  itemIds: number[]
  onClose: () => void
  onRemove: (id: number) => void
}

function parseJsonArray(raw: string[] | string | null | undefined): string[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return raw ? [raw] : []
    }
  }
  return []
}

export function ComparisonView({ itemIds, onClose, onRemove }: ComparisonViewProps) {
  const [items, setItems] = useState<ResearchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all(itemIds.map((id) => api.item(id)))
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [itemIds])

  // Compute shared / unique compounds and mechanisms across all items
  const { sharedCompounds, sharedMechanisms } = useMemo(() => {
    if (items.length < 2) return { sharedCompounds: new Set<string>(), sharedMechanisms: new Set<string>() }

    const compoundSets = items.map((it) => new Set(parseJsonArray(it.compounds)))
    const mechanismSets = items.map((it) => new Set(parseJsonArray(it.mechanisms)))

    const shared = (sets: Set<string>[]) => {
      const all = new Set<string>()
      sets.forEach((s) => s.forEach((v) => all.add(v)))
      const result = new Set<string>()
      all.forEach((v) => {
        const count = sets.filter((s) => s.has(v)).length
        if (count > 1) result.add(v)
      })
      return result
    }

    return {
      sharedCompounds: shared(compoundSets),
      sharedMechanisms: shared(mechanismSets),
    }
  }, [items])

  const gridCols =
    itemIds.length === 2
      ? 'md:grid-cols-2'
      : itemIds.length === 3
        ? 'md:grid-cols-3'
        : 'md:grid-cols-4'

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-bg-base/95 backdrop-blur-sm flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-bg-base/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
        <p className="text-red-400 text-sm" role="alert">{error}</p>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg-base/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <h2 className="text-lg font-semibold text-text-primary">
            Comparison
          </h2>
          <span className="text-xs text-text-muted font-mono">{items.length} items</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-subtle transition-colors"
          aria-label="Close comparison"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Comparison grid */}
      <div className={cn('flex-1 overflow-y-auto p-6 grid gap-4 grid-cols-1', gridCols)}>
        {items.map((item, idx) => {
          const compounds = parseJsonArray(item.compounds)
          const mechanisms = parseJsonArray(item.mechanisms)
          const maxScore = 10
          const scorePct = Math.min((item.score / maxScore) * 100, 100)

          return (
            <div
              key={item.id}
              className={cn(
                'flex flex-col rounded-xl border-2 bg-bg-surface overflow-hidden',
                ACCENT_COLORS[idx % ACCENT_COLORS.length],
              )}
            >
              {/* Top accent bar */}
              <div className={cn('h-1', ACCENT_BG[idx % ACCENT_BG.length])} />

              <div className="p-4 flex flex-col gap-4 flex-1">
                {/* Title */}
                <div>
                  <h3 className="text-sm font-semibold text-text-primary leading-snug line-clamp-3">
                    {item.title}
                  </h3>
                </div>

                {/* Source + Date */}
                <div className="flex items-center gap-2 text-xs text-text-muted">
                  <span className="px-1.5 py-0.5 rounded bg-bg-subtle font-medium uppercase tracking-wide">
                    {item.source_type}
                  </span>
                  {item.published_at && (
                    <span>{new Date(item.published_at).toLocaleDateString()}</span>
                  )}
                </div>

                {/* Score bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-text-muted mb-1">
                    <span>Score</span>
                    <span className="font-mono">{item.score.toFixed(1)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-bg-subtle overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${scorePct}%` }}
                    />
                  </div>
                </div>

                {/* Summary */}
                <div>
                  <p className="text-xs font-medium text-text-muted mb-1">Summary</p>
                  <div className="max-h-32 overflow-y-auto text-xs text-text-secondary leading-relaxed">
                    {item.summary || 'No summary available.'}
                  </div>
                </div>

                {/* Compounds */}
                <div>
                  <p className="text-xs font-medium text-text-muted mb-1.5">
                    Compounds {compounds.length > 0 && <span className="font-mono">({compounds.length})</span>}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {compounds.length === 0 ? (
                      <span className="text-xs text-text-muted italic">None</span>
                    ) : (
                      compounds.map((c) => {
                        const isShared = sharedCompounds.has(c)
                        return (
                          <span
                            key={c}
                            className={cn(
                              'px-2 py-0.5 rounded-full text-xs font-medium',
                              isShared
                                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
                            )}
                          >
                            {c}
                          </span>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Mechanisms */}
                <div>
                  <p className="text-xs font-medium text-text-muted mb-1.5">
                    Mechanisms {mechanisms.length > 0 && <span className="font-mono">({mechanisms.length})</span>}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {mechanisms.length === 0 ? (
                      <span className="text-xs text-text-muted italic">None</span>
                    ) : (
                      mechanisms.map((m) => {
                        const isShared = sharedMechanisms.has(m)
                        return (
                          <span
                            key={m}
                            className={cn(
                              'px-2 py-0.5 rounded-full text-xs font-medium',
                              isShared
                                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30',
                            )}
                          >
                            {m}
                          </span>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="px-6 py-2 border-t border-border flex items-center gap-4 text-xs text-text-muted shrink-0">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/40" />
          Shared across items
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/40" />
          Unique to one item
        </span>
      </div>

      {/* Bottom bar */}
      <div className="px-6 py-3 border-t border-border flex items-center gap-3 shrink-0 bg-bg-surface/80">
        {items.map((item, idx) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            onClick={() => onRemove(item.id)}
            className="text-xs"
          >
            <span
              className={cn(
                'inline-block w-2 h-2 rounded-full mr-1.5',
                ACCENT_BG[idx % ACCENT_BG.length],
              )}
            />
            Remove #{item.id}
          </Button>
        ))}
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  )
}
