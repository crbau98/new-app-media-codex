import { useSyncExternalStore } from 'react'
import { loadProgress, PRIVATE_DATA_CLEARED_EVENT, PROGRESS_EVENT, type ProgressEntry } from '../../lib/collections.ts'
import { STORAGE_KEYS } from './persist.ts'

/* ── watch progress: one shared parse for every card on screen ───── */

const EMPTY_PROGRESS: Record<string, ProgressEntry> = {}
let progressCache: Record<string, ProgressEntry> | null = null
const progressListeners = new Set<() => void>()
let progressHooked = false

function refreshProgress() {
  progressCache = null
  progressListeners.forEach((listener) => listener())
}

function subscribeProgress(listener: () => void): () => void {
  if (!progressHooked && typeof window !== 'undefined') {
    progressHooked = true
    window.addEventListener(PROGRESS_EVENT, refreshProgress)
    window.addEventListener(PRIVATE_DATA_CLEARED_EVENT, refreshProgress)
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEYS.progress) refreshProgress()
    })
  }
  progressListeners.add(listener)
  return () => {
    progressListeners.delete(listener)
  }
}

function getProgress(): Record<string, ProgressEntry> {
  if (progressCache === null) progressCache = loadProgress()
  return progressCache
}

/** All stored resume positions, refreshed whenever progress is recorded or cleared. Parsed once, shared by every consumer. */
export function useProgressMap(): Record<string, ProgressEntry> {
  return useSyncExternalStore(subscribeProgress, getProgress, () => EMPTY_PROGRESS)
}
