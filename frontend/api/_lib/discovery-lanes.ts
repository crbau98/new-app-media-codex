/**
 * Discovery lanes: the curated set of public provider tags (Redgifs niches) that
 * together cover male / gay content broadly, plus the pure planning helpers that
 * make paging deterministic and resumable.
 *
 * Nothing here infers identity, orientation or appearance of a person. A lane is
 * simply a provider tag query; creators are whoever the provider returns for it.
 *
 * Tier meaning:
 *  - `core`        tag names known to exist on the provider and to return volume.
 *  - `best-effort` tag names that are probable but unverified offline (the sandbox
 *                  cannot reach the provider). A tag the provider does not know
 *                  simply returns nothing/4xx; every request soft-fails, so an
 *                  unknown tag can never break a page.
 */
import { canonicalCreator, type RedgifsItem } from './redgifs.js'

export type LaneOrder = 'trending' | 'top28' | 'recent' | 'latest'
export type LaneTier = 'core' | 'best-effort'

export interface DiscoveryLane {
  /** Provider tag sent as `tags=`. */
  tag: string
  tier: LaneTier
  /** Rotation orders, most valuable first. */
  orders: readonly LaneOrder[]
  /** Deepest provider page scanned for this lane. */
  maxPages: number
}

const CORE_ORDERS: readonly LaneOrder[] = ['trending', 'top28', 'recent', 'latest']
const LIGHT_ORDERS: readonly LaneOrder[] = ['trending', 'top28', 'recent']

const core = (tag: string, maxPages = 6): DiscoveryLane => ({ tag, tier: 'core', orders: CORE_ORDERS, maxPages })
const best = (tag: string, maxPages = 3): DiscoveryLane => ({ tag, tier: 'best-effort', orders: LIGHT_ORDERS, maxPages })

/**
 * Order matters: the primary `Gay` lane first, then broad body/role niches, then
 * narrower ones. Page-major enumeration means page 1 of every lane is scanned
 * before page 2 of any lane, so breadth arrives before depth.
 */
export const DISCOVERY_LANES: readonly DiscoveryLane[] = [
  core('Gay', 8),
  core('Gay Porn'),
  core('Twink'),
  core('Bear'),
  core('Muscle'),
  core('Jock'),
  core('Daddy'),
  core('Hunk'),
  best('Otter'),
  best('Bisexual'),
  best('Amateur Gay'),
  best('Solo Male'),
  best('Gay Couple'),
  best('Trans Man'),
  best('Hairy'),
  best('Uncut'),
  best('Gay Threesome'),
  best('Gay Amateur'),
  best('Latino'),
  best('Asian Gay'),
  best('Black Gay'),
  best('Gay Solo'),
  // Round 3: wider niches. Mirrored in app/creator_index/lanes.py (a backend test keeps both lists in sync);
  // names are best-effort provider tags: an unknown tag soft-fails and, in the backend crawler, backs off.
  best('Gay Bear'),
  best('Gay Muscle'),
  best('Gay Twink'),
  best('Gay Daddy'),
  best('Gay Jock'),
  best('Gay Hunk'),
  best('Chub'),
  best('Silver Fox'),
  best('Gay Feet'),
  best('Gay Kink'),
  best('Gay Leather'),
  best('Gay Cam'),
]

export const PROVIDER_PAGE_SIZE = 80
export const MAX_BATCH_UNITS = 8
/** Hard ceiling on directory pages per cursor chain (bounds cursor size and cost). */
export const MAX_DIRECTORY_PAGES = 30
export const MAX_SEEN_HASHES = 500

const LANE_BY_KEY = new Map(DISCOVERY_LANES.map((lane) => [lane.tag.toLowerCase(), lane]))

/**
 * Lane for a user-supplied tag. Known tags map to their curated lane; anything else
 * becomes a bounded ad-hoc best-effort lane (fails soft if the provider has no such tag).
 */
export function laneForTag(input: string): DiscoveryLane | null {
  const tag = input.replace(/[^\p{L}\p{N} +&'-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (tag.length < 2) return null
  return LANE_BY_KEY.get(tag.toLowerCase()) || { tag, tier: 'best-effort', orders: LIGHT_ORDERS, maxPages: 3 }
}

export interface LaneUnit { tag: string; order: LaneOrder; page: number }

/** Deterministic page-major enumeration of every (lane, order, page) unit. */
export function planUnits(lanes: readonly DiscoveryLane[] = DISCOVERY_LANES): LaneUnit[] {
  const deepest = Math.max(0, ...lanes.map((lane) => lane.maxPages))
  const units: LaneUnit[] = []
  for (let page = 1; page <= deepest; page += 1) {
    for (const lane of lanes) {
      if (page > lane.maxPages) continue
      for (const order of lane.orders) units.push({ tag: lane.tag, order, page })
    }
  }
  return units
}

export function batchAt(units: readonly LaneUnit[], index: number, size = MAX_BATCH_UNITS): LaneUnit[] {
  return units.slice(Math.max(0, index), Math.max(0, index) + size)
}

/* ── Opaque cursor (base64url JSON) ── */

export interface DirectoryCursor {
  /** Index of the next unit to scan. */
  i: number
  /** Pages already served in this chain. */
  n: number
  /** Short hashes of creators already returned (bounded). */
  s: string[]
  /** Tag the chain is bound to ('' = all lanes). */
  t: string
}

export function creatorHash(canonical: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash & 0xffffff).toString(16).padStart(6, '0')
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

export function encodeCursor(cursor: DirectoryCursor): string {
  return toBase64Url(JSON.stringify({ v: 1, ...cursor, s: cursor.s.slice(-MAX_SEEN_HASHES) }))
}

/** Returns null for anything malformed; never throws. */
export function decodeCursor(value: string): DirectoryCursor | null {
  if (!value || value.length > 12_000 || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const raw = JSON.parse(fromBase64Url(value)) as Record<string, unknown>
    if (raw.v !== 1 || !Number.isInteger(raw.i) || !Number.isInteger(raw.n) || typeof raw.t !== 'string') return null
    const i = raw.i as number
    const n = raw.n as number
    if (i < 0 || i > 10_000 || n < 0 || n > MAX_DIRECTORY_PAGES) return null
    if (!Array.isArray(raw.s) || raw.s.length > MAX_SEEN_HASHES || !raw.s.every((hash) => typeof hash === 'string' && /^[0-9a-f]{6}$/.test(hash))) return null
    return { i, n, s: raw.s as string[], t: raw.t.slice(0, 40) }
  } catch {
    return null
  }
}

/* ── Feed rotation ── */

/**
 * A rotating subset of non-primary lanes for the feed. `seed` advances by the
 * cron entry / time bucket so different runs warm different lanes.
 */
export function rotateLanes(seed: number, count: number, exclude = 'gay'): DiscoveryLane[] {
  const pool = DISCOVERY_LANES.filter((lane) => lane.tag.toLowerCase() !== exclude)
  const size = Math.min(count, pool.length)
  const start = ((Math.floor(seed) % pool.length) + pool.length) % pool.length
  return Array.from({ length: size }, (_, offset) => pool[(start + offset * 3) % pool.length])
    .filter((lane, index, all) => all.indexOf(lane) === index)
}

/* ── Eligibility hygiene ── */

// Exclusion markers (strictly female/straight tokens). Kept local so broad discovery
// can apply them to structured fields only; see isEligibleCreatorItem.
const EXCLUDED_MARKERS = new Set([
  'female', 'woman', 'women', 'girl', 'lesbian', 'straight', 'pussy', 'vagina', 'hetero',
  'girlfriend', 'wife', 'b/g', 'm/f', 'boob', 'breast', 'tits', 'milf', 'femdom',
  'girls', 'chick', 'chicks', 'females',
])

/**
 * Item-level eligibility for broad discovery. Exclusion markers are matched only on
 * structured fields (userName, tags, niches), never on the free-text description:
 * a caption such as "straight guy gets a massage" or "his girlfriend took this" is
 * male-context prose and must not hide a creator. Only that single item is ever
 * dropped, never the whole creator.
 */
export function isEligibleCreatorItem(item: RedgifsItem): boolean {
  const niches = (item.niches || []).map((niche) => typeof niche === 'string' ? niche : niche.name || '')
  const tokens = [item.userName || '', ...(item.tags || []), ...niches]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9/]+/)
    .filter(Boolean)
  return !tokens.some((token) => EXCLUDED_MARKERS.has(token))
}

/** Creator key usable as a matching identity; empty for placeholder/blank names. */
export function creatorKeyOf(item: RedgifsItem): string {
  if (!item.userName || item.userName === 'Public creator') return ''
  return canonicalCreator(item.userName)
}

/* ── Bounded parallelism ── */

/**
 * Run tasks with at most `concurrency` in flight. Tasks not started before
 * `deadlineAt` (epoch ms) settle as rejected instead of running. Never throws.
 */
export async function runBounded<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
  deadlineAt: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next
      next += 1
      if (Date.now() >= deadlineAt) {
        results[index] = { status: 'rejected', reason: new Error('deadline') }
        continue
      }
      try {
        results[index] = { status: 'fulfilled', value: await tasks[index]() }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker))
  return results
}
