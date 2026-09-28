import type { ReactNode } from 'react'
import type { MediaItem } from '@/lib/types'
import MediaCard from '@/components/MediaCard'
import Rail from './Rail'
import SectionHeader from './SectionHeader'
import '@/styles/discovery.css'

interface MediaRailProps {
  title: string
  eyebrow?: string
  icon?: ReactNode
  note?: string
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
  /** poster = 3:4 portrait tiles; wide = 16:9 landscape tiles. */
  variant?: 'poster' | 'wide'
  actionLabel?: string
  onAction?: () => void
  /** Optional caption rendered under each card (e.g. recommendation reason). */
  caption?: (item: MediaItem) => ReactNode
  /** Optional per-item resume progress (0-100). */
  progress?: (item: MediaItem) => number | undefined
  /** Optional accessible-name override per card. */
  label?: (item: MediaItem) => string | undefined
  className?: string
}

/** Titled rail of MediaCards with consistent snap/drag/arrow behaviour. */
export default function MediaRail({
  title,
  eyebrow,
  icon,
  note,
  items,
  onSelect,
  variant = 'poster',
  actionLabel,
  onAction,
  caption,
  progress,
  label,
  className,
}: MediaRailProps) {
  if (items.length === 0) return null
  return (
    <section aria-label={title} className={className}>
      <SectionHeader title={title} eyebrow={eyebrow} icon={icon} note={note} actionLabel={actionLabel} onAction={onAction} />
      <Rail ariaLabel={title}>
        {items.map((item, index) => (
          <div key={item.id} className="d-rail-item" data-variant={variant}>
            <MediaCard
              item={item}
              aspectRatio={variant === 'wide' ? '16 / 9' : '3 / 4'}
              onSelect={() => onSelect(item)}
              priority={index < 3}
              progress={progress?.(item)}
              label={label?.(item)}
            />
            {caption && <div className="d-rail-caption">{caption(item)}</div>}
          </div>
        ))}
      </Rail>
    </section>
  )
}
