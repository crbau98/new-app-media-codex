/**
 * Persisted metadata cache for TanStack Query (pure helpers — no React, no DOM).
 *
 * Goal: a repeat visit paints the last feed instantly while the normal query
 * revalidates in the background. Hard rules:
 *   - METADATA ONLY: the discovery payload (titles, thumbnails URLs, creator
 *     handles from public sources). Never media bytes, never playback / view /
 *     like history, never search text.
 *   - Short TTL (<= 6 h), versioned, size-capped; any parse problem = a miss.
 *   - Keys are stored as a hash; the user's radar (watchlist) is never written
 *     a second time in plain text.
 *
 * Storage access lives in persist.ts so everything here can be unit tested.
 */

/** Bump when the stored shape (or the payload contract the UI relies on) changes. */
export const CACHE_VERSION = 1
/** Hard TTL for a persisted entry. */
export const MAX_AGE_MS = 6 * 60 * 60 * 1000
/** Serialized entries above this are not written (localStorage is ~5 MB total). */
export const MAX_ENTRY_CHARS = 600_000
/** Persisted entries kept at once (default feed + one personalised variant). */
export const MAX_ENTRIES = 2
/** localStorage key prefix; the version is part of the key so old versions are easy to sweep. */
export const STORAGE_PREFIX = `mc.qc.v${CACHE_VERSION}:`
/** Timestamp of the last successful write (lets the boot script skip a redundant early fetch). */
export const LAST_SAVE_KEY = 'mc.qc.last'
/** Tiny sidecar read by the boot script: the hero poster URL, so it can be preloaded before JS runs. */
export const HINT_KEY = 'mc.qc.hint'
/** Creators that keep a sample media item in the persisted copy (the "On the feed" rail). */
export const PERSISTED_CREATOR_MEDIA = 16

export type QueryKeyLike = readonly unknown[]

export interface PersistedEntry<T = unknown> {
  v: number
  savedAt: number
  /** Hash of the query key (collision/mismatch guard). */
  k: string
  data: T
}

/** Query keys that may be persisted. Anything else (search text, creator lookups, directories) never is. */
export function isPersistableKey(queryKey: QueryKeyLike): boolean {
  return queryKey[0] === 'live-discovery' && !queryKey.some((part, index) => index > 0 && typeof part === 'string' && part.length > 0 && part !== 'creators')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

/** FNV-1a (32 bit) of the stable JSON form, as 8 hex chars. */
export function hashKey(queryKey: QueryKeyLike): string {
  const text = stableStringify(queryKey)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function storageKeyFor(queryKey: QueryKeyLike): string {
  return STORAGE_PREFIX + hashKey(queryKey)
}

interface DiscoveryLike {
  items?: unknown[]
  performers?: Array<Record<string, unknown>>
  [field: string]: unknown
}

/**
 * Shrinks a discovery payload for storage. Creator `media` arrays (up to 12
 * full item copies per creator on the wire) are the bulk of the payload and
 * the home screen only needs a cover for the creators rail, so only the first
 * creators keep a single sample item. The fresh network response replaces this
 * within seconds.
 */
export function trimDiscoveryForPersist<T>(data: T): T {
  if (!data || typeof data !== 'object') return data
  const payload = data as unknown as DiscoveryLike
  if (!Array.isArray(payload.performers)) return data
  const performers = payload.performers.map((creator, index) => {
    if (!creator || typeof creator !== 'object') return creator
    const media = Array.isArray(creator.media) ? creator.media : undefined
    const keep = index < PERSISTED_CREATOR_MEDIA && media ? media.slice(0, 1) : []
    return { ...creator, media: keep }
  })
  // The radar (watchlist) already lives in the app store; never copy it into the cache.
  return { ...payload, performers, watchlist: { requested: [], matched: [] } } as unknown as T
}

/** Returns the string to store, or null when the entry should not be persisted. */
export function serializeEntry(queryKey: QueryKeyLike, data: unknown, now = Date.now()): string | null {
  if (!isPersistableKey(queryKey) || data === undefined || data === null) return null
  try {
    const entry: PersistedEntry = { v: CACHE_VERSION, savedAt: now, k: hashKey(queryKey), data: trimDiscoveryForPersist(data) }
    const text = JSON.stringify(entry)
    return text.length > MAX_ENTRY_CHARS ? null : text
  } catch {
    return null
  }
}

export interface ParsedEntry<T = unknown> {
  data: T
  savedAt: number
}

/** Validates version, key, TTL and basic shape. Any failure is a cache miss. */
export function parseEntry<T = unknown>(raw: string | null | undefined, queryKey: QueryKeyLike, now = Date.now(), maxAgeMs = MAX_AGE_MS): ParsedEntry<T> | null {
  if (!raw || !isPersistableKey(queryKey)) return null
  try {
    const entry = JSON.parse(raw) as Partial<PersistedEntry<T>> | null
    if (!entry || typeof entry !== 'object') return null
    if (entry.v !== CACHE_VERSION) return null
    if (entry.k !== hashKey(queryKey)) return null
    if (typeof entry.savedAt !== 'number' || !Number.isFinite(entry.savedAt)) return null
    const age = now - entry.savedAt
    if (age < 0 || age > maxAgeMs) return null
    if (entry.data === undefined || entry.data === null || typeof entry.data !== 'object') return null
    const items = (entry.data as DiscoveryLike).items
    if (!Array.isArray(items)) return null
    return { data: entry.data, savedAt: entry.savedAt }
  } catch {
    return null
  }
}

/** Storage keys to remove: stale versions, expired entries and anything past MAX_ENTRIES (oldest first). */
export function planEviction(entries: Array<{ key: string; savedAt: number | null }>, now = Date.now(), maxAgeMs = MAX_AGE_MS): string[] {
  const drop: string[] = []
  const live: Array<{ key: string; savedAt: number }> = []
  for (const entry of entries) {
    if (!entry.key.startsWith(STORAGE_PREFIX) || entry.savedAt === null || now - entry.savedAt > maxAgeMs || entry.savedAt > now + 60_000) drop.push(entry.key)
    else live.push({ key: entry.key, savedAt: entry.savedAt })
  }
  live.sort((a, b) => b.savedAt - a.savedAt)
  for (const stale of live.slice(MAX_ENTRIES)) drop.push(stale.key)
  return drop
}

export interface HeroHint {
  v: number
  at: number
  /** Proxy (`/api/archiver-proxy…`) or https poster URL of the top-ranked item. */
  hero: string
}

/** Top-ranked item (curation score) thumbnail — the Home hero — as a preloadable URL. */
export function heroThumbnail(data: unknown): string | null {
  const items = (data as DiscoveryLike | null | undefined)?.items
  if (!Array.isArray(items) || !items.length) return null
  let best: { thumbnail?: unknown; curationScore?: unknown } | null = null
  let bestScore = -Infinity
  for (const item of items as Array<{ thumbnail?: unknown; curationScore?: unknown }>) {
    if (!item || typeof item.thumbnail !== 'string' || !item.thumbnail) continue
    const score = typeof item.curationScore === 'number' ? item.curationScore : 0
    // Stable: the first item wins ties, exactly like Array.prototype.sort in Home's `byScore`.
    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }
  const url = best?.thumbnail
  // Only URLs that resolveMediaAssetUrl() leaves untouched, so the preloaded request is the one <img> makes.
  return typeof url === 'string' && (url.startsWith('/api/archiver-proxy') || url.startsWith('https://')) ? url : null
}

export function makeHint(data: unknown, now = Date.now()): HeroHint | null {
  const hero = heroThumbnail(data)
  return hero ? { v: CACHE_VERSION, at: now, hero } : null
}

export function parseHint(raw: string | null | undefined, now = Date.now(), maxAgeMs = MAX_AGE_MS): HeroHint | null {
  if (!raw) return null
  try {
    const hint = JSON.parse(raw) as Partial<HeroHint> | null
    if (!hint || hint.v !== CACHE_VERSION || typeof hint.at !== 'number' || typeof hint.hero !== 'string') return null
    if (now - hint.at > maxAgeMs || hint.at > now + 60_000) return null
    return { v: hint.v, at: hint.at, hero: hint.hero }
  } catch {
    return null
  }
}
