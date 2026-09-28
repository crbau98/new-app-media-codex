import type { MediaItem } from '@/lib/types'
import type { GridDensity } from '@/store'
import MediaGrid from './MediaGrid'
import MediaList from './MediaList'
import type { LayoutMode } from './prefs'

interface MediaBrowserProps {
  items: MediaItem[]
  layout: LayoutMode
  density: GridDensity
  onSelect: (id: string) => void
  loading?: boolean
  resetKey?: string
  ariaLabel?: string
  hideCreator?: boolean
}

/** Picks the right presentation (Cinema / Grid / List) for a set of items. */
export default function MediaBrowser({ items, layout, density, onSelect, loading, resetKey, ariaLabel, hideCreator }: MediaBrowserProps) {
  if (layout === 'list') {
    return <MediaList items={items} onSelect={onSelect} loading={loading} resetKey={resetKey} ariaLabel={ariaLabel} />
  }
  return (
    <MediaGrid
      items={items}
      layout={layout}
      density={density}
      onSelect={onSelect}
      loading={loading}
      resetKey={resetKey}
      ariaLabel={ariaLabel}
      hideCreator={hideCreator}
    />
  )
}
