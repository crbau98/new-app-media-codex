import { Sparkles } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { useRecommendations } from '@/hooks/useRecommendations'
import MediaImage from '@/components/MediaImage'

interface ForYouRailProps {
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
}

/**
 * Horizontal rail of private on-device recommendations. Renders nothing until
 * the user has local signals (likes/saves/watch progress). Each card shows the
 * top reason so the ranking stays explainable.
 */
export default function ForYouRail({ items, onSelect }: ForYouRailProps) {
  const { scored, hasSignals } = useRecommendations(items, 14)
  if (!hasSignals || scored.length === 0) return null

  return (
    <section aria-label="Recommended for you" className="content-auto">
      <div className="mb-3">
        <h2 className="eyebrow flex items-center gap-1.5">
          <Sparkles size={12} strokeWidth={1.75} aria-hidden="true" /> For you · on-device
        </h2>
      </div>
      <div className="hide-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {scored.map(({ item, reasons }) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="w-32 shrink-0 text-left tap-highlight-none"
            aria-label={`Open ${item.title}`}
          >
            <span className="relative block aspect-[2/3] overflow-hidden rounded-md bg-sunken">
              <MediaImage
                sources={item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                skeletonClassName="absolute inset-0"
              />
            </span>
            <span className="mt-1.5 block truncate text-[12px] font-medium leading-snug text-ink">{item.title}</span>
            {reasons[0] && (
              <span className="mt-0.5 block truncate font-mono text-[9px] uppercase tracking-[0.06em] text-ink-3">
                {reasons[0]}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
