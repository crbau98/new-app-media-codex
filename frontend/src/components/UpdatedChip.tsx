import { useEffect, useState } from 'react'
import { relativeTime } from '@/lib/discovery'
import { cn } from '@/lib/utils'

/**
 * "Updated Xm ago" stale-data chip. Re-renders every 30s so the label
 * tracks the payload's updatedAt timestamp.
 */
export default function UpdatedChip({ updatedAt, className }: { updatedAt?: string | number | null; className?: string }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5',
        'font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3',
        className
      )}
      title={updatedAt ? new Date(updatedAt).toLocaleString() : 'Waiting for first refresh'}
    >
      <span className="live-dot" aria-hidden="true" />
      {updatedAt ? `Updated ${relativeTime(updatedAt)}` : 'Waiting for feed'}
    </span>
  )
}
