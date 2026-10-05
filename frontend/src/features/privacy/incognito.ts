/**
 * Incognito mode: while on, the app records no *history* on this device —
 * recently viewed, continue-watching progress, taste-profile signals, search
 * recents and AI concierge history stay in memory for the session only.
 * (Things you do on purpose — likes, follows, collections, settings — still save.)
 *
 * Two layers, so it works today and stays correct as modules evolve:
 *   1. A storage write-guard (`installStorageGuard`) that drops/rewrites writes
 *      to the history keys below. No other module needs to change.
 *   2. This tiny public API, so modules can also skip the work up front:
 *        import { isIncognito } from '@/features/privacy/incognito'
 *        if (isIncognito()) return   // one line at the top of a recorder
 *
 * The flag lives in sessionStorage: it survives a reload, ends with the tab.
 */

export const INCOGNITO_KEY = 'media-codex-incognito-v1'
export const STORE_KEY = 'media-codex-store'

/** localStorage keys that hold pure history/signals: writes are dropped while incognito. */
export const INCOGNITO_DROP_KEYS: readonly string[] = [
  'media-codex-progress-v1', // continue-watching positions
  'media-codex-taste-v1', // on-device taste profile
  'media-codex-ai-recent-v1', // recent command-bar / AI searches
  'media-codex-concierge-v1', // concierge conversation history
]

/** Fields inside the persisted zustand store (`media-codex-store`) that are history/signals. */
export const STORE_HISTORY_FIELDS: readonly string[] = ['recentlyViewed', 'tagPreferences', 'creatorPreferences']

export type StoreBaseline = Record<string, unknown>

const EMPTY_FOR: Record<string, unknown> = { recentlyViewed: [], tagPreferences: {}, creatorPreferences: {} }

/** Pick the history fields out of a persisted store JSON string (the "before incognito" snapshot). */
export function snapshotStoreHistory(raw: string | null): StoreBaseline {
  const baseline: StoreBaseline = {}
  if (!raw) return baseline
  try {
    const parsed: unknown = JSON.parse(raw)
    const state = (parsed as { state?: Record<string, unknown> } | null)?.state
    if (state && typeof state === 'object') {
      for (const field of STORE_HISTORY_FIELDS) if (field in state) baseline[field] = state[field]
    }
  } catch { /* unreadable store: fall back to empty fields */ }
  return baseline
}

/**
 * Decide what a storage write becomes while incognito is on.
 * Returns the value to actually write, or null to drop the write entirely.
 */
export function filterIncognitoWrite(key: string, value: string, baseline: StoreBaseline): string | null {
  if (INCOGNITO_DROP_KEYS.includes(key)) return null
  if (key !== STORE_KEY) return value
  try {
    const parsed = JSON.parse(value) as { state?: Record<string, unknown> } | null
    if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.state !== 'object') return value
    for (const field of STORE_HISTORY_FIELDS) {
      parsed.state[field] = field in baseline ? baseline[field] : EMPTY_FOR[field]
    }
    return JSON.stringify(parsed)
  } catch {
    return value
  }
}

// ── runtime state ───────────────────────────────────────────────────────────

let active = false
let baseline: StoreBaseline = {}
let writesBlocked = false
let guardInstalled = false
let originalGet: ((key: string) => string | null) | null = null
const listeners = new Set<() => void>()

function readSession(): boolean {
  try { return typeof window !== 'undefined' && window.sessionStorage.getItem(INCOGNITO_KEY) === '1' } catch { return false }
}

function rawStoreValue(): string | null {
  try { return (originalGet ?? ((k: string) => window.localStorage.getItem(k)))(STORE_KEY) } catch { return null }
}

/** Sync read of the current mode. Cheap; safe to call on every recorder invocation. */
export function isIncognito(): boolean {
  return active
}

export function subscribeIncognito(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setIncognito(on: boolean) {
  if (on === active) return
  if (on) baseline = snapshotStoreHistory(rawStoreValue())
  active = on
  try {
    if (on) window.sessionStorage.setItem(INCOGNITO_KEY, '1')
    else window.sessionStorage.removeItem(INCOGNITO_KEY)
  } catch { /* in-memory only */ }
  listeners.forEach((listener) => listener())
}

/** Block *every* app write (used by "clear everything" so nothing re-persists before the reload). */
export function blockAllWrites() {
  writesBlocked = true
}

/**
 * Patch Storage.prototype.setItem once. Writes made while incognito (or after
 * `blockAllWrites`) are filtered by `filterIncognitoWrite`. Also restores the
 * flag from sessionStorage so a reload stays incognito.
 */
export function installStorageGuard() {
  if (guardInstalled || typeof window === 'undefined' || typeof Storage === 'undefined') return
  guardInstalled = true
  const proto = Storage.prototype
  const realSet = proto.setItem
  const realGet = proto.getItem
  originalGet = (key: string) => realGet.call(window.localStorage, key)

  proto.setItem = function patchedSetItem(this: Storage, key: string, value: string) {
    if (this === window.localStorage && typeof key === 'string' && key.startsWith('media-codex')) {
      if (writesBlocked) return
      if (active) {
        const next = filterIncognitoWrite(key, String(value), baseline)
        if (next === null) return
        return realSet.call(this, key, next)
      }
    }
    return realSet.call(this, key, value)
  }

  if (readSession()) {
    baseline = snapshotStoreHistory(rawStoreValue())
    active = true
  }
}
