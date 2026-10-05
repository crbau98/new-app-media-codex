/**
 * The single choke-point for every localStorage WRITE made by the queue,
 * moments, watch-progress, collections, smart-start and player-memory
 * features. Nothing in those modules touches `localStorage.setItem` directly.
 *
 * INCOGNITO HOOK (for the integrator)
 * -----------------------------------
 * `writeAllowed()` is the one place that decides whether this device may
 * persist viewing data. It returns `true` today. When the incognito mode
 * lands, connect it in ONE of two ways (both are equivalent):
 *
 *   1. at app bootstrap:   setWriteGate(() => !isIncognito())
 *   2. or edit the body of `writeAllowed()` below to `return !isIncognito()`
 *
 * While the gate is closed every `writeJson`/`writeRaw`/`removeKey` is a
 * silent no-op; the in-memory stores keep working for the session, so the
 * queue, moments and progress still function — they just are not remembered.
 * Reads are never gated.
 */

type WriteGate = () => boolean

let gate: WriteGate | null = null

/** Register (or clear with `null`) the predicate that decides if writes are allowed. */
export function setWriteGate(next: WriteGate | null): void {
  gate = next
}

/** True when this session may persist viewing data. Fails CLOSED if the gate throws. */
export function writeAllowed(): boolean {
  if (!gate) return true
  try {
    return gate() !== false
  } catch {
    return false
  }
}

/** Fired on window whenever the saved moments change; `detail.count` is the new total. */
export const MOMENTS_EVENT = 'media-codex:moments'

/** Every key this feature set owns (used by the "clear private data" wipe). */
export const STORAGE_KEYS = {
  queue: 'media-codex-queue-v1',
  moments: 'media-codex-moments-v1',
  itemRates: 'media-codex-item-rates-v1',
  smartStart: 'media-codex-smart-start-v1',
  collections: 'media-codex-collections-v1',
  progress: 'media-codex-progress-v1',
  player: 'media-codex-player-v1',
  theatre: 'media-codex-theatre-v1',
} as const

/** Keys holding viewing history / saved moments — removed by "clear private media data". */
export const PRIVATE_MEDIA_KEYS: readonly string[] = [
  STORAGE_KEYS.queue,
  STORAGE_KEYS.moments,
  STORAGE_KEYS.itemRates,
  STORAGE_KEYS.smartStart,
  STORAGE_KEYS.collections,
  STORAGE_KEYS.progress,
]

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Returns true when the value was actually stored. Never throws. */
export function writeRaw(key: string, value: string): boolean {
  if (!writeAllowed()) return false
  try {
    const store = storage()
    if (!store) return false
    store.setItem(key, value)
    return true
  } catch {
    // quota exceeded / storage blocked — everything here is best-effort
    return false
  }
}

export function writeJson(key: string, value: unknown): boolean {
  let raw: string
  try {
    raw = JSON.stringify(value)
  } catch {
    return false
  }
  return writeRaw(key, raw)
}

/** `force` is for explicit user wipes ("clear private data"), which must work even while writes are gated. */
export function removeKey(key: string, options: { force?: boolean } = {}): void {
  if (!options.force && !writeAllowed()) return
  try {
    storage()?.removeItem(key)
  } catch {
    // ignore
  }
}
