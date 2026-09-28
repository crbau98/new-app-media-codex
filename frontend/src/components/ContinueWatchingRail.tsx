import { useEffect, useMemo, useState } from 'react'
import { History } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { continueWatching, PROGRESS_EVENT, type ProgressEntry } from '@/lib/collections'
import MediaRail from '@/components/discovery/MediaRail'

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

  const entryById = useMemo(() => new Map(entries.map(({ entry, item }) => [item.id, entry])), [entries])

  if (entries.length === 0) return null

  return (
    <MediaRail
      title="Continue watching"
      eyebrow="Pick up where you left off"
      icon={<History size={12} strokeWidth={1.75} aria-hidden="true" />}
      variant="wide"
      items={entries.map(({ item }) => item)}
      onSelect={onSelect}
      label={(item) => {
        const entry = entryById.get(item.id)
        return entry ? `Resume ${item.title} at ${formatClock(entry.seconds)}` : undefined
      }}
      progress={(item) => {
        const entry = entryById.get(item.id)
        return entry ? percentOf(entry) : undefined
      }}
      caption={(item) => {
        const entry = entryById.get(item.id)
        return entry ? `${formatClock(entry.seconds)} / ${formatClock(entry.duration)} · ${percentOf(entry)}% watched` : null
      }}
    />
  )
}
