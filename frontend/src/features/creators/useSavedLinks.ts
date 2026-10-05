import { useSyncExternalStore } from 'react'
import type { ParsedProfile } from './platforms.ts'
import {
  SAVED_LINKS_KEY,
  addSavedLinks,
  loadSavedLinks,
  mergeSavedLinks,
  persistSavedLinks,
  removeSavedLink,
  setSavedNote,
  type AddResult,
  type SavedLink,
} from './savedLinks.ts'

/**
 * Tiny external store for the on-device saved-links list. Reads/writes `localStorage` under
 * `media-codex-saved-links-v1` (every access guarded) and stays in sync across tabs. If storage
 * is blocked the list still works for the life of the tab and `storageOk` turns false.
 */
interface Snapshot {
  links: readonly SavedLink[]
  storageOk: boolean
}

const EMPTY: Snapshot = { links: [], storageOk: true }
let snapshot: Snapshot | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function current(): Snapshot {
  if (snapshot === null) {
    const loaded = loadSavedLinks(storage())
    snapshot = { links: loaded.links, storageOk: loaded.available }
  }
  return snapshot
}

function emit() {
  for (const listener of listeners) listener()
}

function commit(next: readonly SavedLink[]) {
  const ok = persistSavedLinks(storage(), next)
  snapshot = { links: next, storageOk: ok }
  emit()
}

/** Re-read storage (another tab wrote it). Skipped when storage is unreadable so memory is never lost. */
function resync() {
  const loaded = loadSavedLinks(storage())
  if (!loaded.available) return
  const now = current()
  if (JSON.stringify(loaded.links) === JSON.stringify(now.links) && now.storageOk) return
  snapshot = { links: loaded.links, storageOk: true }
  emit()
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === SAVED_LINKS_KEY) resync()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export function useSavedLinks(): Snapshot {
  return useSyncExternalStore(subscribe, current, () => EMPTY)
}

/** Imperative actions (safe to call from event handlers; they read the latest list). */
export function saveProfiles(profiles: readonly ParsedProfile[], note = ''): AddResult {
  const result = addSavedLinks(current().links, profiles, { note })
  if (result.added.length) commit(result.next)
  return result
}

export function importSavedLinks(imported: readonly SavedLink[]): AddResult {
  const result = mergeSavedLinks(current().links, imported)
  if (result.added.length || result.next.some((link, index) => link !== current().links[index])) commit(result.next)
  return result
}

export function removeSaved(id: string) {
  commit(removeSavedLink(current().links, id))
}

export function updateSavedNote(id: string, note: string) {
  const next = setSavedNote(current().links, id, note)
  if (next.some((link, index) => link !== current().links[index])) commit(next)
}

export function clearSaved() {
  commit([])
}
