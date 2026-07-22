import { useEffect, useMemo, useState } from 'react'
import { History } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { continueWatching, PROGRESS_EVENT, type ProgressEntry } from '@/lib/collections'
import MediaImage from '@/components/MediaImage'

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

/**
 * Resume rail: videos the user started but did not finish, mapped back onto
 * items already present in the live feed (nothing is re-fetched or rehosted).
 * Refreshes when playback progress is recorded.
 */
export default function ContinueWatchingRail({ items, onSelect }: ContinueWatchingRailProps) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1)
    window.addEventListener(PROGRESS_EVENT, bump)
    return () => window.removeEventListener(PROGRESS_EVENT, bump)
  }, [])

  const entries = useMemo(() => {
    void version
    const byId = new Map(items.map((item) => [item.id, item]))
    return continueWatching(10)
      .map((entry) => ({ entry, item: byId.get(entry.itemId) }))
      .filter((pair): pair is { entry: ProgressEntry; item: MediaItem } => Boolean(pair.item))
  }, [items, version])

  if (entries.length === 0) return null

  return (
    <section aria-label="Continue watching" className="content-auto">
      <div className="mb-3">
        <h2 className="eyebrow flex items-center gap-1.5">
          <History size={12} strokeWidth={1.75} aria-hidden="true" /> Continue watching
        </h2>
      </div>
      <div className="hide-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {entries.map(({ entry, item }) => {
          const percent = entry.duration > 0 ? Math.min(100, Math.round((entry.seconds / entry.duration) * 100)) : 0
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="w-36 shrink-0 text-left tap-highlight-none"
              aria-label={`Resume ${item.title} at ${formatClock(entry.seconds)}`}
            >
              <span className="relative block aspect-video overflow-hidden rounded-md bg-sunken">
                <MediaImage
                  sources={[item.thumbnail]}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  skeletonClassName="absolute inset-0"
                />
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-canvas/40">
                  <span className="block h-full bg-heat" style={{ width: `${percent}%` }} />
                </span>
                <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-canvas/85 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.04em] text-ink">
                  {formatClock(entry.seconds)} / {formatClock(entry.duration)}
                </span>
              </span>
              <span className="mt-1.5 block truncate text-[12px] font-medium leading-snug text-ink">{item.title}</span>
              <span className="mt-0.5 block truncate font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
                @{item.creator} · {percent}% watched
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
