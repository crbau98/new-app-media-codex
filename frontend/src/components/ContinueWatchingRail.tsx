import { useMemo, useState } from 'react'
import { History, X } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { clearProgress, removeProgress, unfinishedEntries, type ProgressEntry } from '@/lib/collections'
import { useProgressMap } from '@/features/queue/progressStore'
import MediaCard from '@/components/MediaCard'
import Rail from '@/components/discovery/Rail'
import SectionHeader from '@/components/discovery/SectionHeader'
import '@/styles/discovery.css'

export { default as MomentsRail } from '@/features/queue/MomentsRail'

interface ContinueWatchingRailProps {
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function percentOf(entry: ProgressEntry): number {
  return entry.duration > 0 ? Math.min(100, Math.round((entry.seconds / entry.duration) * 100)) : 0
}

/**
 * Resume rail: videos the user started but did not finish, most recently
 * watched first, mapped back onto items already present in the live feed
 * (nothing is re-fetched or rehosted). Each card can be removed, and the whole
 * list cleared; both only touch this device's resume positions.
 */
export default function ContinueWatchingRail({ items, onSelect }: ContinueWatchingRailProps) {
  const progress = useProgressMap()
  const [confirmClear, setConfirmClear] = useState(false)

  const entries = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]))
    return unfinishedEntries(progress, 40)
      .map((entry) => ({ entry, item: byId.get(entry.itemId) }))
      .filter((pair): pair is { entry: ProgressEntry; item: MediaItem } => Boolean(pair.item))
      .slice(0, 10)
  }, [items, progress])

  if (entries.length === 0) return null

  return (
    <section aria-label="Continue watching">
      <SectionHeader title="Continue watching" eyebrow="Pick up where you left off" icon={<History size={12} strokeWidth={1.75} aria-hidden="true" />}>
        <button
          type="button"
          onClick={() => {
            if (!confirmClear) {
              setConfirmClear(true)
              return
            }
            setConfirmClear(false)
            clearProgress()
          }}
          onBlur={() => setConfirmClear(false)}
          className={confirmClear ? 'btn-heat' : 'btn-secondary'}
          data-testid="continue-clear"
        >
          {confirmClear ? 'Confirm clear all' : 'Clear all'}
        </button>
      </SectionHeader>
      <Rail ariaLabel="Continue watching">
        {entries.map(({ entry, item }, index) => (
          <div key={item.id} className="d-rail-item group relative" data-variant="wide">
            <MediaCard
              item={item}
              aspectRatio="16 / 9"
              onSelect={() => onSelect(item)}
              priority={index < 3}
              progress={percentOf(entry)}
              label={`Resume ${item.title} at ${formatClock(entry.seconds)}`}
            />
            <button type="button" onClick={() => removeProgress(item.id)} className="d-remove" aria-label={`Remove ${item.title} from Continue watching`}>
              <X size={14} strokeWidth={2} />
            </button>
            <div className="d-rail-caption">
              {formatClock(entry.seconds)} / {formatClock(entry.duration)} · {percentOf(entry)}% watched
            </div>
          </div>
        ))}
      </Rail>
    </section>
  )
}
