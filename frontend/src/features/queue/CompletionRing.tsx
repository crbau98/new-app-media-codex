import { Check } from 'lucide-react'
import { progressRatio, WATCHED_RATIO, type ProgressEntry } from '@/lib/collections'
import { cn } from '@/lib/utils'
import { useProgressMap } from './progressStore'

interface CompletionRingProps {
  entry: ProgressEntry | undefined
  /** Ring diameter in px. */
  size?: number
  className?: string
}

const R = 9
const C = 2 * Math.PI * R

/**
 * Subtle completion ring drawn from the existing watch-progress data:
 * a gold arc for partly watched videos, a check once it is (nearly) finished.
 * Renders nothing for untouched items. Absolutely positioned top-right of the
 * nearest `relative` ancestor unless `className` overrides.
 */
export function CompletionRingView({ entry, size = 22, className }: CompletionRingProps) {
  const ratio = progressRatio(entry)
  if (ratio === null || ratio < 0.02) return null
  const done = ratio >= WATCHED_RATIO
  const percent = Math.round(ratio * 100)
  return (
    <span
      className={cn('pointer-events-none absolute right-1.5 top-1.5 z-[3] grid place-items-center rounded-full bg-black/60', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={done ? 'Watched' : `${percent}% watched`}
      title={done ? 'Watched' : `${percent}% watched`}
      data-testid="completion-ring"
      data-done={done ? 'true' : 'false'}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r={R} fill="none" stroke="rgb(255 255 255 / 0.22)" strokeWidth="2.2" />
        <circle
          cx="12"
          cy="12"
          r={R}
          fill="none"
          stroke={done ? 'rgb(var(--gold-ink))' : 'rgb(var(--gold))'}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - (done ? 1 : ratio))}
        />
      </svg>
      {done && <Check size={Math.round(size * 0.45)} strokeWidth={3} className="relative text-gold-ink" aria-hidden="true" />}
    </span>
  )
}

/**
 * Same ring, looking itself up by item id. Drop inside any `relative` card:
 *
 *   <CompletionRing itemId={item.id} />
 */
export default function CompletionRing({ itemId, size, className }: { itemId: string; size?: number; className?: string }) {
  const progress = useProgressMap()
  return <CompletionRingView entry={progress[itemId]} size={size} className={className} />
}
