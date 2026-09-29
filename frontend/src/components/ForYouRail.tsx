import { Sparkles } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { useRecommendations } from '@/hooks/useRecommendations'
import MediaRail from '@/components/discovery/MediaRail'

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

  const reasonById = new Map(scored.map(({ item, reasons }) => [item.id, reasons[0]]))

  return (
    <MediaRail
      title="Recommended for you"
      eyebrow="For you · on-device"
      icon={<Sparkles size={12} strokeWidth={1.75} aria-hidden="true" />}
      items={scored.map((entry) => entry.item)}
      onSelect={onSelect}
      caption={(item) => reasonById.get(item.id)}
    />
  )
}
