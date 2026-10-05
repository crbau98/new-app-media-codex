/**
 * "Clear everything now": enumerate and erase every trace this app keeps in the
 * browser — localStorage / sessionStorage keys, IndexedDB databases, Cache
 * Storage (including service-worker caches) and service-worker registrations.
 *
 * The environment is injected so the enumeration and the order of operations
 * are unit-tested without a browser.
 */

export const APP_KEY_PREFIX = 'media-codex'

export function isAppKey(key: string): boolean {
  return key.startsWith(APP_KEY_PREFIX)
}

/** The phrase typed to confirm an erase from the lock screen ("forgot PIN"). */
export const ERASE_PHRASE = 'ERASE EVERYTHING'

export function phraseMatches(input: string): boolean {
  return input.trim().replace(/\s+/g, ' ').toUpperCase() === ERASE_PHRASE
}

export interface StorageLike {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void
}

/** Every app-owned key currently in a storage area (snapshot; safe to delete while iterating the result). */
export function appKeys(storage: Pick<StorageLike, 'length' | 'key'>): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key !== null && isAppKey(key)) keys.push(key)
  }
  return keys
}

export interface IdbLike {
  databases?: () => Promise<Array<{ name?: string }>>
  deleteDatabase(name: string): { onsuccess: unknown; onerror: unknown; onblocked: unknown }
}

export interface CachesLike {
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
}

export interface SwRegistrationLike {
  unregister(): Promise<boolean>
  active?: { postMessage(message: unknown): void } | null
}

export interface WipeEnv {
  local?: StorageLike
  session?: StorageLike
  indexedDB?: IdbLike
  caches?: CachesLike
  getRegistrations?: () => Promise<readonly SwRegistrationLike[]>
  /** Names to try when the browser cannot enumerate IndexedDB databases. */
  knownDatabases?: readonly string[]
  /** Hook called before anything is erased (e.g. to block further storage writes). */
  beforeWipe?: () => void
  clearCookies?: () => void
}

export interface WipeReport {
  localKeys: string[]
  sessionKeys: string[]
  databases: string[]
  caches: string[]
  registrations: number
  errors: string[]
}

function deleteDatabase(idb: IdbLike, name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = idb.deleteDatabase(name) as { onsuccess: unknown; onerror: unknown; onblocked: unknown }
      const done = () => resolve()
      request.onsuccess = done
      request.onerror = done
      // A blocked delete completes once other connections close (we are about to reload); don't hang on it.
      request.onblocked = () => setTimeout(done, 400)
    } catch {
      resolve()
    }
  })
}

export async function wipeEverything(env: WipeEnv): Promise<WipeReport> {
  const report: WipeReport = { localKeys: [], sessionKeys: [], databases: [], caches: [], registrations: 0, errors: [] }
  const attempt = async (label: string, work: () => Promise<void> | void) => {
    try { await work() } catch (error) { report.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
  }

  await attempt('beforeWipe', () => env.beforeWipe?.())

  await attempt('localStorage', () => {
    if (!env.local) return
    report.localKeys = appKeys(env.local)
    for (const key of report.localKeys) env.local.removeItem(key)
  })
  await attempt('sessionStorage', () => {
    if (!env.session) return
    report.sessionKeys = appKeys(env.session)
    for (const key of report.sessionKeys) env.session.removeItem(key)
  })

  await attempt('indexedDB', async () => {
    const idb = env.indexedDB
    if (!idb) return
    let names: string[] = []
    if (typeof idb.databases === 'function') {
      names = (await idb.databases()).map((db) => db.name).filter((name): name is string => typeof name === 'string' && name.length > 0)
    } else {
      names = [...(env.knownDatabases ?? [])]
    }
    report.databases = names
    await Promise.all(names.map((name) => deleteDatabase(idb, name)))
  })

  // Ask a live service worker to drop its own caches first, then remove every cache we can see.
  await attempt('serviceWorker', async () => {
    if (!env.getRegistrations) return
    const registrations = await env.getRegistrations()
    for (const registration of registrations) {
      try { registration.active?.postMessage({ type: 'CLEAR_CACHES' }) } catch { /* ignore */ }
    }
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)))
    report.registrations = registrations.length
  })

  await attempt('caches', async () => {
    if (!env.caches) return
    report.caches = await env.caches.keys()
    await Promise.all(report.caches.map((name) => env.caches!.delete(name)))
  })

  await attempt('cookies', () => env.clearCookies?.())
  return report
}

/** The real browser environment. */
export function browserWipeEnv(beforeWipe?: () => void): WipeEnv {
  const safe = <T,>(get: () => T): T | undefined => { try { return get() } catch { return undefined } }
  return {
    local: safe(() => window.localStorage),
    session: safe(() => window.sessionStorage),
    indexedDB: safe(() => window.indexedDB) as IdbLike | undefined,
    caches: safe(() => ('caches' in window ? window.caches : undefined)),
    getRegistrations: safe(() => ('serviceWorker' in navigator ? () => navigator.serviceWorker.getRegistrations() : undefined)),
    knownDatabases: [],
    beforeWipe,
    clearCookies: () => {
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.split('=')[0]?.trim()
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      }
    },
  }
}
