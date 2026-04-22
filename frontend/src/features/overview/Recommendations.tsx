import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type RecommendationsPayload } from '@/lib/api'
import { useAppStore } from '@/store'
import { cn } from '@/lib/cn'
import { TagChip } from '@/components/TagChip'

const SOURCE_BADGE: Record<string, string> = {
  reddit: 'bg-orange-500/15 text-orange-400',
  twitter: 'bg-sky-500/15 text-sky-400',
  x: 'bg-sky-500/15 text-sky-400',
  pubmed: 'bg-blue-500/15 text-blue-400',
  biorxiv: 'bg-green-500/15 text-green-400',
  arxiv: 'bg-teal-500/15 text-teal-400',
  literature: 'bg-purple-500/15 text-purple-400',
  duckduckgo: 'bg-amber-500/15 text-amber-400',
  lpsg: 'bg-rose-500/15 text-rose-400',
}

function sourceBadgeClass(sourceType: string): string {
  return SOURCE_BADGE[sourceType?.toLowerCase()] ?? 'bg-bg-subtle text-text-muted'
}

function SkeletonCard() {
  return (
    <div className="bg-bg-elevated rounded-lg p-3 animate-pulse space-y-2">
      <div className="h-3.5 shimmer rounded w-3/4" />
      <div className="h-3 shimmer rounded w-1/2" />
      <div className="flex gap-1.5 mt-2">
        <div className="h-5 w-14 shimmer rounded-full" />
        <div className="h-5 w-16 shimmer rounded-full" />
      </div>
    </div>
  )
}

export function Recommendations() {
  const queryClient = useQueryClient()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)

  const { data, isLoading, isError } = useQuery<RecommendationsPayload>({
    queryKey: ['recommendations'],
    queryFn: api.recommendations,
    staleTime: 120_000,
  })

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ['recommendations'] })
  }

  function handleItemClick(id: number) {
    setActiveView('images')
    setTimeout(() => setSelectedItemId(id), 50)
  }

  // Empty state: no saved items yet
  if (!isLoading && !isError && data?.reason === 'no_saved_items') {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono">
            Recommended for You
          </h2>
        </div>
        <p className="text-xs text-text-muted font-mono text-center py-4">
          Save some items to get personalized recommendations.
        </p>
      </div>
    )
  }

  // Empty state: saved items have no compounds/mechanisms
  if (!isLoading && !isError && data?.reason === 'no_signals') {
    return (
      <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono">
            Recommended for You
          </h2>
        </div>
        <p className="text-xs text-text-muted font-mono text-center py-4">
          Your saved items have no compounds or mechanisms to match against.
        </p>
      </div>
    )
  }

  // No results despite having saved items
  if (!isLoading && !isError && data?.items?.length === 0) {
    return null
  }

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-4 card-hover glass">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-text-muted font-mono">
          Recommended for You
        </h2>
        <button
          onClick={handleRefresh}
          className="text-[10px] text-text-muted hover:text-accent transition-colors font-mono uppercase tracking-wider"
          title="Refresh recommendations"
        >
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <p className="text-xs text-red font-mono text-center py-4">
          Failed to load recommendations.
        </p>
      ) : (
        <div className="space-y-2">
          {data?.items.map((item) => {
            const title =
              item.title.length > 70
                ? item.title.slice(0, 70).trimEnd() + '\u2026'
                : item.title
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item.id)}
                className="w-full text-left bg-bg-elevated hover:bg-bg-subtle border border-transparent hover:border-accent/30 rounded-lg p-3 transition-all group"
              >
                {/* Title + source badge */}
                <div className="flex items-start gap-2 mb-1.5">
                  <p className="flex-1 text-xs text-text-secondary leading-snug group-hover:text-text-primary transition-colors">
                    {title}
                  </p>
                  <span
                    className={cn(
                      'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase shrink-0',
                      sourceBadgeClass(item.source_type),
                    )}
                  >
                    {item.source_type}
                  </span>
                </div>

                {/* Why recommended */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {item.overlapping_compounds.slice(0, 3).map((c) => (
                    <TagChip key={c} label={c} variant="compound" size="sm" />
                  ))}
                  {item.overlapping_mechanisms.slice(0, 3).map((m) => (
                    <TagChip key={m} label={m} variant="mechanism" size="sm" />
                  ))}
                  {item.overlap_count > 6 && (
                    <span className="text-[9px] text-text-muted font-mono self-center">
                      +{item.overlap_count - 6} more
                    </span>
                  )}
                </div>

                {/* Score */}
                {item.score > 0 && (
                  <p className="text-[10px] font-mono text-text-muted mt-1.5 tabular-nums">
                    Score {item.score.toFixed(2)}
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
