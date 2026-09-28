import { memo, useMemo } from 'react'
import { Layers3 } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { resolveMediaAssetUrl } from '@/lib/backendOrigin'
import Rail from './Rail'
import SectionHeader from './SectionHeader'
import { hueFor } from './mediaMeta'
import '@/styles/discovery.css'

interface CategoryShelfProps {
  items: MediaItem[]
  onOpen: (category: string) => void
  title?: string
}

interface CategoryEntry {
  name: string
  count: number
  thumbs: string[]
}

/** Categories (falling back to top tags) as depth-fanned poster stacks. */
function CategoryShelfImpl({ items, onOpen, title = 'Browse categories' }: CategoryShelfProps) {
  const entries = useMemo<CategoryEntry[]>(() => {
    const map = new Map<string, CategoryEntry>()
    const add = (name: string, item: MediaItem) => {
      const entry = map.get(name) ?? { name, count: 0, thumbs: [] }
      entry.count += 1
      if (entry.thumbs.length < 3 && item.thumbnail && !entry.thumbs.includes(item.thumbnail)) entry.thumbs.push(item.thumbnail)
      map.set(name, entry)
    }
    for (const item of items) if (item.category) add(item.category, item)
    if (map.size < 4) for (const item of items) for (const tag of item.tags.slice(0, 2)) add(tag, item)
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12)
  }, [items])

  if (entries.length === 0) return null
  return (
    <section aria-label={title}>
      <SectionHeader title={title} eyebrow="Explore by mood" icon={<Layers3 size={12} strokeWidth={1.75} aria-hidden="true" />} />
      <Rail ariaLabel={title}>
        {entries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className="d-cat tap-highlight-none"
            style={{ ['--h' as string]: hueFor(entry.name) }}
            onClick={() => onOpen(entry.name)}
            aria-label={`Browse ${entry.name}, ${entry.count} items`}
          >
            <span className="d-cat-name">{entry.name}</span>
            <span className="d-cat-count">{entry.count} items</span>
            <span className="d-cat-fan" aria-hidden="true">
              {entry.thumbs.map((thumb, index) => (
                <span key={thumb} style={{ ['--k' as string]: index, zIndex: 3 - index }}>
                  <img src={resolveMediaAssetUrl(thumb)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />
                </span>
              ))}
            </span>
          </button>
        ))}
      </Rail>
    </section>
  )
}

export default memo(CategoryShelfImpl)
