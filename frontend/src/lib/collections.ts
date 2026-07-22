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

export function recordProgress(item: MediaItem, seconds: number) {
  if (!item.isVideo) return
  const progress = readJson<Record<string, ProgressEntry>>(PROGRESS_KEY, {})
  progress[item.id] = { itemId: item.id, seconds: Math.max(0, Math.floor(seconds)), duration: durationToSeconds(item.duration), updatedAt: Date.now() }
  writeJson(PROGRESS_KEY, progress)
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
