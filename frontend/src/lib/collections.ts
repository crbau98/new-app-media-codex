import type { MediaItem } from '@/lib/types'

export type MediaCollection = {
  id: string
  name: string
  itemIds: string[]
  createdAt: number
  updatedAt: number
}

export type ProgressEntry = {
  itemId: string
  seconds: number
  duration: number
  updatedAt: number
}

const COLLECTIONS_KEY = 'media-codex-collections-v1'
const PROGRESS_KEY = 'media-codex-progress-v1'

/** Fired on window whenever watch progress is recorded, so rails can refresh. */
export const PROGRESS_EVENT = 'media-codex:progress'

/** Fired on window whenever collections change, so surfaces can refresh. */
export const COLLECTIONS_EVENT = 'media-codex:collections'

function durationToSeconds(duration: string): number {
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}

export function loadCollections(): MediaCollection[] {
  return readJson<MediaCollection[]>(COLLECTIONS_KEY, [])
}

export function saveCollections(collections: MediaCollection[]) {
  writeJson(COLLECTIONS_KEY, collections)
}

export function createCollection(name: string): MediaCollection {
  const now = Date.now()
  return { id: `col-${now.toString(36)}`, name: name.trim() || 'Untitled collection', itemIds: [], createdAt: now, updatedAt: now }
}

export function addToCollection(collection: MediaCollection, itemId: string): MediaCollection {
  if (collection.itemIds.includes(itemId)) return collection
  return { ...collection, itemIds: [itemId, ...collection.itemIds], updatedAt: Date.now() }
}

export function removeFromCollection(collection: MediaCollection, itemId: string): MediaCollection {
  if (!collection.itemIds.includes(itemId)) return collection
  return { ...collection, itemIds: collection.itemIds.filter((id) => id !== itemId), updatedAt: Date.now() }
}

export function renameCollection(collection: MediaCollection, name: string): MediaCollection {
  const next = name.trim()
  if (!next || next === collection.name) return collection
  return { ...collection, name: next.slice(0, 60), updatedAt: Date.now() }
}

export function upsertCollection(collections: MediaCollection[], updated: MediaCollection): MediaCollection[] {
  return collections.map((entry) => (entry.id === updated.id ? updated : entry))
}

/** Persist collections and notify open surfaces (rail, detail popover). */
export function persistCollections(collections: MediaCollection[]) {
  writeJson(COLLECTIONS_KEY, collections)
  window.dispatchEvent(new CustomEvent(COLLECTIONS_EVENT))
}

export function loadProgress(): Record<string, ProgressEntry> {
  return readJson<Record<string, ProgressEntry>>(PROGRESS_KEY, {})
}

export function recordProgress(item: MediaItem, seconds: number) {
  if (!item.isVideo) return
  const progress = readJson<Record<string, ProgressEntry>>(PROGRESS_KEY, {})
  progress[item.id] = { itemId: item.id, seconds: Math.max(0, Math.floor(seconds)), duration: durationToSeconds(item.duration), updatedAt: Date.now() }
  writeJson(PROGRESS_KEY, progress)
  window.dispatchEvent(new CustomEvent(PROGRESS_EVENT))
}

export function continueWatching(limit = 12): ProgressEntry[] {
  return Object.values(readJson<Record<string, ProgressEntry>>(PROGRESS_KEY, {}))
    .filter((entry) => entry.seconds > 20 && entry.seconds < entry.duration * 0.92)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

export function clearPrivateMediaData() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(COLLECTIONS_KEY)
  window.localStorage.removeItem(PROGRESS_KEY)
}
