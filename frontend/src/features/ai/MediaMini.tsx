import { Play } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import type { MediaItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatDuration, parseDurationString } from './core/library'

const durationLabel = (item: MediaItem) => (item.isVideo ? formatDuration(parseDurationString(item.duration)) : 'Photo')

/** Compact row: thumbnail, title, @creator, length, and the "why". Used in the command bar. */
export function MediaMiniRow({ item, reason, active, onSelect, onHover, id }: {
  item: MediaItem
  reason?: string
  active?: boolean
  onSelect: () => void
  onHover?: () => void
  id?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        'relative flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-left transition-colors tap-highlight-none',
        active ? 'ai-row-active' : 'hover:bg-sunken/60',
      )}
    >
      <span className="relative h-11 w-[68px] shrink-0 overflow-hidden rounded-sm bg-sunken">
        <MediaImage sources={[item.thumbnail]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" />
        {item.isVideo && <Play size={11} strokeWidth={2} className="absolute bottom-1 left-1 text-ink drop-shadow" aria-hidden="true" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium leading-snug text-ink">{item.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[10.5px] tracking-[0.03em] text-ink-3">
          <span className="truncate">@{item.creator}</span>
          <span aria-hidden="true">·</span>
          <span>{durationLabel(item)}</span>
        </span>
        {reason && <span className="ai-gold-text mt-0.5 block truncate text-[11px] opacity-90">{reason}</span>}
      </span>
    </button>
  )
}

/** Poster card for the concierge's horizontal result strips. */
export function MediaMiniCard({ item, reason, onSelect }: { item: MediaItem; reason?: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Open ${item.title}`}
      className="group w-[132px] shrink-0 snap-start text-left tap-highlight-none focus-visible:outline-none"
    >
      <span className="relative block aspect-[3/4] overflow-hidden rounded-md border border-line bg-sunken transition-colors group-hover:border-[rgb(var(--ai-gold)/0.5)] group-focus-visible:border-[rgb(var(--ai-gold)/0.7)]">
        <MediaImage sources={item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-6 font-mono text-[10px] text-white/90">
          <span className="inline-flex items-center gap-1">{item.isVideo && <Play size={9} strokeWidth={2.2} aria-hidden="true" />}{durationLabel(item)}</span>
        </span>
      </span>
      <span className="mt-1.5 block truncate text-[12px] font-medium leading-snug text-ink">{item.title}</span>
      <span className="block truncate font-mono text-[10px] text-ink-3">@{item.creator}</span>
      {reason && <span className="ai-gold-text mt-0.5 line-clamp-2 text-[10.5px] leading-tight opacity-90">{reason}</span>}
    </button>
  )
}
