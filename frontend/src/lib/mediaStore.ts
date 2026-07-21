import type { MediaItem } from '@/lib/types'

export type MediaDelta = {
  saved?: boolean
  reaction?: 'like' | 'dislike' | null
  progressSeconds?: number
  updatedAt: number
}

export type NormalizedMediaStore = {
  byId: Record<string, MediaItem>
  order: string[]
  deltas: Record<string, MediaDelta>
  recent: string[]
}

const RECENT_LIMIT = 80

export function createMediaStore(): NormalizedMediaStore {
  return { byId: {}, order: [], deltas: {}, recent: [] }
}

export function upsertItems(store: NormalizedMediaStore, items: MediaItem[]): NormalizedMediaStore {
  const byId = { ...store.byId }
  const order = [...store.order]
  for (const item of items) {
    if (!byId[item.id]) order.push(item.id)
    byId[item.id] = item
  }
  return { ...store, byId, order }
}

export function applyDelta(store: NormalizedMediaStore, id: string, delta: Omit<MediaDelta, 'updatedAt'>): NormalizedMediaStore {
  return {
    ...store,
    deltas: {
      ...store.deltas,
      [id]: { ...store.deltas[id], ...delta, updatedAt: Date.now() },
    },
  }
}

export function rememberRecent(store: NormalizedMediaStore, id: string): NormalizedMediaStore {
  const recent = [id, ...store.recent.filter((existing) => existing !== id)].slice(0, RECENT_LIMIT)
  return { ...store, recent }
}

export function materialize(store: NormalizedMediaStore, ids = store.order): MediaItem[] {
  return ids
    .map((id) => store.byId[id])
    .filter((item): item is MediaItem => Boolean(item))
}
