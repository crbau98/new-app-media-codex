/**
 * Browser binding for the persisted metadata cache (see cache.ts for the rules).
 *
 *   restoreDiscoveryCache(client, watchlist)  — before first render: hydrate the feed
 *   startQueryPersistence(client)             — after first render: write on idle, throttled
 *   clearQueryCache()                         — Settings: wipe every persisted copy
 *
 * Storage is localStorage on purpose: the read is synchronous, so the very
 * first React render can paint cached data (IndexedDB would force a loading
 * state first). Every access is try/catch'd — storage can be blocked,
 * full, or throw in private windows — and failure always means "no cache".
 */

import type { QueryClient } from '@tanstack/react-query'
import { DISCOVERY_STALE_MS, discoveryKey } from './discovery-keys.ts'
import {
  HINT_KEY,
  LAST_SAVE_KEY,
  STORAGE_PREFIX,
  isPersistableKey,
  makeHint,
  parseEntry,
  planEviction,
  serializeEntry,
  storageKeyFor,
} from './cache.ts'

const WRITE_DELAY_MS = 2500
/** Hard floor between writes for the same key: the 2-min poll must not thrash storage. */
const MIN_WRITE_INTERVAL_MS = 30_000

let activeClient: QueryClient | null = null

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function ownKeys(store: Storage): string[] {
  const keys: string[] = []
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index)
    if (key && key.startsWith('mc.qc.')) keys.push(key)
  }
  return keys
}

/** Hydrate the discovery feed for `watchlist` from storage. Returns true when something was restored. */
export function restoreDiscoveryCache(client: QueryClient, watchlist: string[]): boolean {
  const store = storage()
  if (!store) return false
  let restored = false
  try {
    // Home / Explore / Search share one key; the Creators page keeps its own copy of the same request.
    for (const queryKey of [discoveryKey(watchlist), ['live-discovery', 'creators', watchlist] as const]) {
      const hit = parseEntry(store.getItem(storageKeyFor(queryKey)), queryKey)
      if (!hit) continue
      if (client.getQueryData(queryKey) !== undefined) continue
      // updatedAt = save time, so anything older than staleTime revalidates on mount.
      client.setQueryData(queryKey, hit.data, { updatedAt: hit.savedAt })
      restored = true
    }
  } catch {
    // corrupt entry: treated as a miss
  }
  return restored
}

function writeEntry(client: QueryClient, queryKey: readonly unknown[]) {
  const store = storage()
  if (!store) return
  const data = client.getQueryData(queryKey)
  const now = Date.now()
  const text = serializeEntry(queryKey, data, now)
  if (!text) return
  try {
    store.setItem(storageKeyFor(queryKey), text)
    store.setItem(LAST_SAVE_KEY, String(now))
    const hint = makeHint(data, now)
    if (hint) store.setItem(HINT_KEY, JSON.stringify(hint))
    sweep(store, now)
  } catch {
    // Quota or blocked storage: drop our own entries so we never crowd out app state, then give up quietly.
    try {
      for (const key of ownKeys(store)) store.removeItem(key)
    } catch {
      // nothing else to do
    }
  }
}

function sweep(store: Storage, now: number) {
  const entries = ownKeys(store)
    .filter((key) => key.startsWith(STORAGE_PREFIX))
    .map((key) => {
      let savedAt: number | null = null
      try {
        const raw = store.getItem(key)
        // savedAt sits right after the version in the serialized prefix; parse only the head cheaply.
        const match = raw ? /"savedAt":(\d+)/.exec(raw.slice(0, 80)) : null
        savedAt = match ? Number(match[1]) : null
      } catch {
        savedAt = null
      }
      return { key, savedAt }
    })
  // Entries from other versions share the `mc.qc.` namespace and are removed outright.
  const legacy = ownKeys(store).filter((key) => /^mc\.qc\.v\d+:/.test(key) && !key.startsWith(STORAGE_PREFIX))
  for (const key of [...legacy, ...planEviction(entries, now)]) store.removeItem(key)
}

/** Writes discovery payloads (and only those) to storage after they change. Returns an unsubscribe. */
export function startQueryPersistence(client: QueryClient): () => void {
  activeClient = client
  const lastWrite = new Map<string, number>()
  const timers = new Map<string, number>()

  const flush = (serialKey: string, queryKey: readonly unknown[]) => {
    timers.delete(serialKey)
    const run = () => {
      lastWrite.set(serialKey, Date.now())
      writeEntry(client, queryKey)
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 6000 })
    else run()
  }

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    const queryKey = event.query.queryKey
    if (!isPersistableKey(queryKey)) return
    const serialKey = storageKeyFor(queryKey)
    if (timers.has(serialKey)) return
    const sinceLast = Date.now() - (lastWrite.get(serialKey) ?? 0)
    const delay = Math.max(WRITE_DELAY_MS, MIN_WRITE_INTERVAL_MS - sinceLast)
    timers.set(serialKey, window.setTimeout(() => flush(serialKey, queryKey), delay))
  })

  return () => {
    unsubscribe()
    for (const timer of timers.values()) window.clearTimeout(timer)
    timers.clear()
  }
}

/**
 * Settings hook: remove every persisted copy of feed metadata (and the
 * service worker's API cache). Pass `{ memory: true }` to also drop the
 * in-memory queries so the next render refetches.
 */
export function clearQueryCache(options: { memory?: boolean } = {}): void {
  const store = storage()
  if (store) {
    try {
      for (const key of ownKeys(store)) store.removeItem(key)
    } catch {
      // storage blocked: nothing persisted anyway
    }
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: 'CLEAR_API_CACHE' })).catch(() => undefined)
    }
  } catch {
    // no service worker support
  }
  if (options.memory && activeClient) activeClient.clear()
}

export { DISCOVERY_STALE_MS }
