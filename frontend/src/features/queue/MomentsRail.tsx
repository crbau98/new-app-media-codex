import { lazy, Suspense, useSyncExternalStore } from 'react'
import { PRIVATE_DATA_CLEARED_EVENT } from '@/lib/collections'
import type { MediaItem } from '@/lib/types'
import { MOMENTS_EVENT, readRaw, STORAGE_KEYS } from './persist'

export interface MomentsRailProps {
  /** The live feed; a moment opens through it when its item is still present. */
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
}

// The rail's UI (cards, export/import, the moments model) loads only once something is saved.
const MomentsRailImpl = lazy(() => import('./MomentsRailImpl'))

let hasMoments: boolean | null = null
const listeners = new Set<() => void>()
let hooked = false

function setHas(next: boolean) {
  if (next === hasMoments) return
  hasMoments = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  if (!hooked && typeof window !== 'undefined') {
    hooked = true
    window.addEventListener(MOMENTS_EVENT, (event) => setHas(((event as CustomEvent<{ count?: number }>).detail?.count ?? 0) > 0))
    window.addEventListener(PRIVATE_DATA_CLEARED_EVENT, () => setHas(false))
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getHas(): boolean {
  if (hasMoments === null) hasMoments = Boolean(readRaw(STORAGE_KEYS.moments)?.includes('"itemId"'))
  return hasMoments
}

/**
 * "Moments" rail for Home: the timestamps and A–B clips the viewer bookmarked.
 * Renders nothing (and loads nothing) until at least one moment is saved.
 *
 *   <MomentsRail items={allItems} onSelect={setSelectedItem} />
 */
export default function MomentsRail({ items, onSelect }: MomentsRailProps) {
  const has = useSyncExternalStore(subscribe, getHas, () => false)
  if (!has) return null
  return (
    <Suspense fallback={null}>
      <MomentsRailImpl items={items} onSelect={onSelect} />
    </Suspense>
  )
}
