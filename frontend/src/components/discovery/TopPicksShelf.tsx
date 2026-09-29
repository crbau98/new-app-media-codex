import { useCallback } from 'react'
import { Gem } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import MediaCard from '@/components/MediaCard'
import Rail from './Rail'
import SectionHeader from './SectionHeader'
import { useMotionOk } from './motion'
import '@/styles/discovery.css'

interface TopPicksShelfProps {
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
  title?: string
  eyebrow?: string
  note?: string
}

/**
 * Depth-stacked "Top Picks" shelf: cards recede in Z and rotate toward the
 * viewport centre as the rail scrolls (a coverflow built from plain CSS 3D and
 * one rAF-throttled scroll pass — no per-card React state). Falls back to a
 * flat snap rail under reduced motion.
 */
export default function TopPicksShelf({
  items,
  onSelect,
  title = 'Top picks',
  eyebrow = 'Curated tonight',
  note = 'Highest curation score across connected sources.',
}: TopPicksShelfProps) {
  const motionOk = useMotionOk()

  const onFrame = useCallback(
    (scroller: HTMLElement) => {
      const pad = parseFloat(getComputedStyle(scroller).paddingLeft) || 0
      const focus = scroller.getBoundingClientRect().left + pad
      const children = scroller.children
      for (let index = 0; index < children.length; index += 1) {
        const node = children[index] as HTMLElement
        if (!motionOk) {
          node.style.transform = ''
          node.style.opacity = ''
          continue
        }
        const rect = node.getBoundingClientRect()
        const t = (rect.left - focus) / rect.width
        const abs = Math.min(Math.abs(t), 3)
        const rotate = Math.max(-46, Math.min(46, -t * 24))
        node.style.transform = `translateZ(${(-abs * 70).toFixed(1)}px) rotateY(${rotate.toFixed(2)}deg) scale(${(1 - abs * 0.035).toFixed(3)})`
        node.style.opacity = String(Math.max(0.35, 1 - abs * 0.16).toFixed(2))
      }
    },
    [motionOk]
  )

  if (items.length === 0) return null
  return (
    <section aria-label={title} className="d-stack-section">
      <SectionHeader title={title} eyebrow={eyebrow} icon={<Gem size={12} strokeWidth={1.75} aria-hidden="true" />} note={note} />
      <Rail ariaLabel={title} onFrame={onFrame} className="d-stack">
        {items.map((item, index) => (
          <div key={item.id} className="d-stack-item">
            <MediaCard item={item} aspectRatio="3 / 4" onSelect={() => onSelect(item)} priority={index < 3} />
            <span className="d-rank" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>
        ))}
      </Rail>
    </section>
  )
}
