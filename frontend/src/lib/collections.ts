import type { MediaItem } from './types.ts'
import { PRIVATE_MEDIA_KEYS, readJson, removeKey, STORAGE_KEYS, writeJson } from '../features/queue/persist.ts'

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

/** Fired on window whenever watch progress is recorded, so rails can refresh. */
export const PROGRESS_EVENT = 'media-codex:progress'

/** Fired on window whenever collections change, so surfaces can refresh. */
export const COLLECTIONS_EVENT = 'media-codex:collections'

/** Fired after a wipe so in-memory stores (queue, moments) drop their cached state too. */
export const PRIVATE_DATA_CLEARED_EVENT = 'media-codex:private-data-cleared'

/** Watch progress is bounded: only the most recently touched entries are kept. */
export const MAX_PROGRESS_ENTRIES = 300

/** Resume is only offered/kept for unfinished videos; at or past this ratio an item counts as watched. */
export const WATCHED_RATIO = 0.92

export function durationToSeconds(duration: string): number {
  if (typeof duration !== 'string' || !duration) return 0
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function emit(name: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name))
}

export function loadCollections(): MediaCollection[] {
  const value = readJson<unknown>(STORAGE_KEYS.collections, [])
  return Array.isArray(value) ? (value as MediaCollection[]) : []
}

export function saveCollections(collections: MediaCollection[]) {
  writeJson(STORAGE_KEYS.collections, collections)
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
  writeJson(STORAGE_KEYS.collections, collections)
  emit(COLLECTIONS_EVENT)
}

/** A new collection holding `itemIds` in the given order (used by "save queue as collection"). */
export function collectionFromIds(name: string, itemIds: string[]): MediaCollection {
  const collection = createCollection(name)
  return { ...collection, name: collection.name.slice(0, 60), itemIds: Array.from(new Set(itemIds)) }
}

/* ── watch progress ───────────────────────────────────────────── */

export function loadProgress(): Record<string, ProgressEntry> {
  const value = readJson<unknown>(STORAGE_KEYS.progress, {})
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, ProgressEntry>) : {}
}

function saveProgress(progress: Record<string, ProgressEntry>) {
  const entries = Object.values(progress)
  const bounded =
    entries.length > MAX_PROGRESS_ENTRIES
      ? Object.fromEntries(entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROGRESS_ENTRIES).map((entry) => [entry.itemId, entry]))
      : progress
  writeJson(STORAGE_KEYS.progress, bounded)
}

export function recordProgress(item: MediaItem, seconds: number) {
  if (!item.isVideo) return
  const progress = loadProgress()
  progress[item.id] = { itemId: item.id, seconds: Math.max(0, Math.floor(seconds)), duration: durationToSeconds(item.duration), updatedAt: Date.now() }
  saveProgress(progress)
  emit(PROGRESS_EVENT)
}

/** Fraction watched (0–1) or null when the duration is unknown. */
export function progressRatio(entry: Pick<ProgressEntry, 'seconds' | 'duration'> | undefined): number | null {
  if (!entry || !(entry.duration > 0)) return null
  return Math.max(0, Math.min(1, entry.seconds / entry.duration))
}

/** Unfinished videos from a progress map, most recently watched first. */
export function unfinishedEntries(progress: Record<string, ProgressEntry>, limit = 12): ProgressEntry[] {
  return Object.values(progress)
    .filter((entry) => entry.seconds > 20 && entry.seconds < entry.duration * WATCHED_RATIO)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
}

/** Unfinished videos, most recently watched first. */
export function continueWatching(limit = 12): ProgressEntry[] {
  return unfinishedEntries(loadProgress(), limit)
}

/** Drop one item from "Continue watching" (its resume position is forgotten too). */
export function removeProgress(itemId: string) {
  const progress = loadProgress()
  if (!(itemId in progress)) return
  delete progress[itemId]
  saveProgress(progress)
  emit(PROGRESS_EVENT)
}

/** Forget every resume position. */
export function clearProgress() {
  removeKey(STORAGE_KEYS.progress)
  emit(PROGRESS_EVENT)
}

/** Settings → "clear private data": viewing history, collections, queue, moments and per-item memories. */
export function clearPrivateMediaData() {
  if (typeof window === 'undefined') return
  for (const key of PRIVATE_MEDIA_KEYS) removeKey(key, { force: true })
  emit(COLLECTIONS_EVENT)
  emit(PROGRESS_EVENT)
  emit(PRIVATE_DATA_CLEARED_EVENT)
}
