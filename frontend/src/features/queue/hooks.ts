import { useMemo, useSyncExternalStore } from 'react'
import { momentsForItem, type Moment } from './momentsModel.ts'
import { getMoments, subscribeMoments } from './momentsStore.ts'
import { emptyQueue, type QueueState } from './queueModel.ts'
import { getQueue, subscribeQueue } from './queueStore.ts'
import { surface, type SurfaceState } from './surface.ts'

const EMPTY_QUEUE = emptyQueue()
const EMPTY_MOMENTS: Moment[] = []
const SERVER_SURFACE: SurfaceState = { sheets: 0, panelOpen: false, helpOpen: false, dockDismissed: false }

export function useQueue(): QueueState {
  return useSyncExternalStore(subscribeQueue, getQueue, () => EMPTY_QUEUE)
}

export function useMoments(): Moment[] {
  return useSyncExternalStore(subscribeMoments, getMoments, () => EMPTY_MOMENTS)
}

/** This item's moments, earliest first. */
export function useItemMoments(itemId: string | null | undefined): Moment[] {
  const all = useMoments()
  return useMemo(() => (itemId ? momentsForItem(all, itemId) : EMPTY_MOMENTS), [all, itemId])
}

export function useSurface(): SurfaceState {
  return useSyncExternalStore(surface.subscribe, surface.get, () => SERVER_SURFACE)
}
