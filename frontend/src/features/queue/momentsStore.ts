/**
 * Moments as a singleton store: item id + minimal display metadata + timestamps,
 * persisted on-device through `persist.ts`. React reads it via hooks.ts.
 */
import { durationToSeconds, PRIVATE_DATA_CLEARED_EVENT } from '../../lib/collections.ts'
import type { MediaItem } from '../../lib/types.ts'
import {
  addMoment,
  exportMoments,
  mergeMoments,
  MOMENTS_VERSION,
  parseMomentsImport,
  removeMoment,
  removeMomentsForItem,
  renameMoment,
  sanitizeMoments,
  type AddResult,
  type Moment,
} from './momentsModel.ts'
import { MOMENTS_EVENT, readRaw, STORAGE_KEYS, writeJson } from './persist.ts'
import { createStore, createWriter } from './storeKit.ts'

function load(): Moment[] {
  const raw = readRaw(STORAGE_KEYS.moments)
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as { v?: number; moments?: unknown } | unknown[]
    return sanitizeMoments(Array.isArray(data) ? data : data?.moments)
  } catch {
    return []
  }
}

const store = createStore<Moment[]>(load)
const writer = createWriter(() => {
  writeJson(STORAGE_KEYS.moments, { v: MOMENTS_VERSION, moments: store.get() })
})

let hooked = false
function hook() {
  if (hooked || typeof window === 'undefined') return
  hooked = true
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.moments) {
      store.set(load())
      announce(store.get().length)
    }
  })
  window.addEventListener(PRIVATE_DATA_CLEARED_EVENT, () => {
    store.set([])
    announce(0)
  })
}

export function getMoments(): Moment[] {
  return store.get()
}

export function subscribeMoments(listener: () => void): () => void {
  hook()
  return store.subscribe(listener)
}

function announce(count: number) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MOMENTS_EVENT, { detail: { count } }))
}

function commit(next: Moment[]) {
  store.set(next)
  writer.schedule()
  announce(next.length)
}

export function flushMoments(): void {
  writer.flush()
}

export function resetMomentsCache(): void {
  store.reset()
}

type MomentSource = Pick<MediaItem, 'id' | 'title' | 'creator' | 'thumbnail' | 'duration' | 'durationSeconds' | 'source'>

export const momentsActions = {
  get: getMoments,

  /** Bookmark `t` (or the clip t→end) on an item. */
  save(item: MomentSource, t: number, options: { end?: number | null; label?: string } = {}): AddResult {
    const result = addMoment(getMoments(), {
      itemId: item.id,
      t,
      end: options.end,
      label: options.label,
      title: item.title,
      creator: item.creator,
      thumbnail: item.thumbnail,
      duration: item.durationSeconds ?? (durationToSeconds(item.duration) || undefined),
      source: item.source,
    })
    if (result.outcome === 'added' || result.outcome === 'updated') commit(result.list)
    return result
  },

  remove(id: string) {
    commit(removeMoment(getMoments(), id))
  },

  rename(id: string, label: string) {
    commit(renameMoment(getMoments(), id, label))
  },

  removeForItem(itemId: string) {
    commit(removeMomentsForItem(getMoments(), itemId))
  },

  /** JSON text for a file download. */
  exportJson(): string {
    return exportMoments(getMoments())
  },

  /** Merge an exported file's text. Returns counts for the toast, or an error message. */
  importJson(text: string): { ok: true; added: number; duplicates: number; skipped: number } | { ok: false; error: string } {
    const parsed = parseMomentsImport(text)
    if (!parsed.ok) return parsed
    const merged = mergeMoments(getMoments(), parsed.moments)
    if (merged.added > 0) commit(merged.list)
    return { ok: true, added: merged.added, duplicates: merged.duplicates, skipped: parsed.skipped }
  },
}
