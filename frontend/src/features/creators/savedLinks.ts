/**
 * "Saved profile links": a personal, on-device list of creator profile links the user already
 * knows (OnlyFans, Fansly, JustFor.Fans, X, Bluesky, Reddit, Tumblr, link-in-bio ...).
 *
 * Pure reducer-style helpers plus defensive (de)serialisation. Everything that enters the list —
 * pasted text, imported JSON, stored JSON — is re-parsed through the platform registry, so the
 * stored URL is always canonical, https and safe. Nothing here touches the network; subscription
 * platforms are never fetched, only linked out to.
 */
import type { Creator } from '../../lib/types.ts'
import { parseProfileInput, platformById, type AnyPlatformId, type ParsedProfile } from './platforms.ts'

export const SAVED_LINKS_KEY = 'media-codex-saved-links-v1'
export const SAVED_LINKS_CAP = 300
export const SAVED_NOTE_MAX = 140
/** Import files larger than this are rejected before parsing. */
export const IMPORT_MAX_CHARS = 1_000_000
const DAY_MS = 86_400_000

export interface SavedLink {
  /** Same as the registry dedupe key (`platform:handle`). */
  id: string
  platform: AnyPlatformId
  handle: string
  /** Canonical outbound URL (re-derived from the registry on every load/import). */
  url: string
  note: string
  addedAt: number
}

export function sanitizeNote(value: unknown): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SAVED_NOTE_MAX)
}

export function savedFromProfile(profile: ParsedProfile, now: number, note = ''): SavedLink {
  return {
    id: profile.key,
    platform: profile.platform,
    handle: profile.handle,
    url: profile.url,
    note: sanitizeNote(note),
    addedAt: now,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validate one untrusted entry (stored or imported). Returns null for anything unusable. */
export function normalizeSavedEntry(raw: unknown, now: number): SavedLink | null {
  if (!isRecord(raw)) return null
  let profile: ParsedProfile | null = null
  if (typeof raw.url === 'string') {
    const parsed = parseProfileInput(raw.url)
    if (parsed.ok) profile = parsed.profile
  }
  const def = typeof raw.platform === 'string' ? platformById(raw.platform) : undefined
  if (!profile && def && typeof raw.handle === 'string') {
    // Federated handles are `user@instance`; the leading "@" keeps them from reading as an email.
    const parsed = parseProfileInput(def.federated ? `@${raw.handle.replace(/^@/, '')}` : raw.handle, def.id)
    if (parsed.ok && parsed.profile.platform === raw.platform) profile = parsed.profile
  }
  if (!profile) return null
  const at = typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) && raw.addedAt > 0 && raw.addedAt <= now + DAY_MS ? Math.floor(raw.addedAt) : now
  return savedFromProfile(profile, at, sanitizeNote(raw.note))
}

/** Rehydrate a stored list: entries validated, de-duplicated by id (first wins), capped. */
export function sanitizeSavedList(values: unknown, now: number, cap = SAVED_LINKS_CAP): SavedLink[] {
  if (!Array.isArray(values)) return []
  const out: SavedLink[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (out.length >= cap) break
    const entry = normalizeSavedEntry(value, now)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out
}

export interface AddResult {
  next: SavedLink[]
  added: SavedLink[]
  /** Already saved (same platform + handle). */
  duplicates: number
  /** Did not fit under the cap. */
  skippedFull: number
}

/** Save parsed profiles: newest first, de-duplicated by platform+handle, capped. */
export function addSavedLinks(
  current: readonly SavedLink[],
  profiles: readonly ParsedProfile[],
  opts: { now?: number; cap?: number; note?: string } = {},
): AddResult {
  const now = opts.now ?? Date.now()
  const cap = opts.cap ?? SAVED_LINKS_CAP
  const seen = new Set(current.map((link) => link.id))
  const added: SavedLink[] = []
  let duplicates = 0
  let skippedFull = 0
  for (const profile of profiles) {
    if (seen.has(profile.key)) {
      duplicates += 1
      continue
    }
    if (current.length + added.length >= cap) {
      skippedFull += 1
      continue
    }
    seen.add(profile.key)
    added.push(savedFromProfile(profile, now, opts.note ?? ''))
  }
  return { next: [...added, ...current], added, duplicates, skippedFull }
}

export function removeSavedLink(current: readonly SavedLink[], id: string): SavedLink[] {
  return current.filter((link) => link.id !== id)
}

export function setSavedNote(current: readonly SavedLink[], id: string, note: string): SavedLink[] {
  const clean = sanitizeNote(note)
  return current.map((link) => (link.id === id && link.note !== clean ? { ...link, note: clean } : link))
}

/* ───────── Export / import ───────── */

interface ExportFile {
  app: 'media-codex'
  kind: 'saved-profile-links'
  version: 1
  exportedAt: string
  links: { platform: AnyPlatformId; handle: string; url: string; note?: string; addedAt: number }[]
}

export function serializeSavedLinks(links: readonly SavedLink[], now = Date.now()): string {
  const file: ExportFile = {
    app: 'media-codex',
    kind: 'saved-profile-links',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    links: links.map((link) => ({
      platform: link.platform,
      handle: link.handle,
      url: link.url,
      ...(link.note ? { note: link.note } : {}),
      addedAt: link.addedAt,
    })),
  }
  return JSON.stringify(file, null, 2)
}

export type ImportParse =
  | { ok: true; links: SavedLink[]; rejected: number; truncated: boolean }
  | { ok: false; error: string }

/** Validate an exported (or hand-written) JSON file. Never throws. */
export function parseSavedLinksImport(text: string, now = Date.now(), cap = SAVED_LINKS_CAP): ImportParse {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'That file is empty.' }
  if (text.length > IMPORT_MAX_CHARS) return { ok: false, error: 'That file is too large to be a saved-links export.' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  let entries: unknown
  if (Array.isArray(data)) entries = data
  else if (isRecord(data)) {
    if (typeof data.version === 'number' && data.version > 1) return { ok: false, error: 'That export is from a newer version of the app.' }
    if (data.kind !== undefined && data.kind !== 'saved-profile-links') return { ok: false, error: 'That file is not a saved-profile-links export.' }
    entries = data.links
  }
  if (!Array.isArray(entries)) return { ok: false, error: 'No links found in that file.' }

  const links: SavedLink[] = []
  const seen = new Set<string>()
  let rejected = 0
  let truncated = false
  // Look at no more than twice the cap so a hostile file cannot make this loop unbounded.
  const scan = entries.slice(0, cap * 2)
  if (entries.length > scan.length) truncated = true
  for (const entry of scan) {
    const link = normalizeSavedEntry(entry, now)
    if (!link) {
      rejected += 1
      continue
    }
    if (seen.has(link.id)) continue
    if (links.length >= cap) {
      truncated = true
      continue
    }
    seen.add(link.id)
    links.push(link)
  }
  if (links.length === 0) return { ok: false, error: rejected ? 'None of the links in that file could be read.' : 'No links found in that file.' }
  return { ok: true, links, rejected, truncated }
}

/** Merge imported links into the saved list: existing entries win, notes back-fill, newest first. */
export function mergeSavedLinks(
  current: readonly SavedLink[],
  imported: readonly SavedLink[],
  cap = SAVED_LINKS_CAP,
): AddResult {
  const byId = new Map(current.map((link) => [link.id, link]))
  const added: SavedLink[] = []
  let duplicates = 0
  let skippedFull = 0
  for (const link of imported) {
    const existing = byId.get(link.id)
    if (existing) {
      duplicates += 1
      if (!existing.note && link.note) byId.set(link.id, { ...existing, note: link.note })
      continue
    }
    if (byId.size >= cap) {
      skippedFull += 1
      continue
    }
    byId.set(link.id, link)
    added.push(link)
  }
  const next = [...byId.values()]
    .map((link, index) => ({ link, index }))
    .sort((a, b) => b.link.addedAt - a.link.addedAt || a.index - b.index)
    .map((entry) => entry.link)
  return { next, added, duplicates, skippedFull }
}

/* ───────── Storage (every access guarded) ───────── */

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export interface LoadedSavedLinks {
  links: SavedLink[]
  /** False when storage could not be read at all (private window, blocked site data). */
  available: boolean
}

export function loadSavedLinks(storage: StorageLike | null | undefined, now = Date.now()): LoadedSavedLinks {
  if (!storage) return { links: [], available: false }
  let raw: string | null
  try {
    raw = storage.getItem(SAVED_LINKS_KEY)
  } catch {
    return { links: [], available: false }
  }
  if (!raw) return { links: [], available: true }
  try {
    const data: unknown = JSON.parse(raw)
    const entries = isRecord(data) && data.v === 1 ? data.links : null
    return { links: sanitizeSavedList(entries, now), available: true }
  } catch {
    return { links: [], available: true }
  }
}

/** Returns false when the write failed (quota, blocked storage); the in-memory list still works. */
export function persistSavedLinks(storage: StorageLike | null | undefined, links: readonly SavedLink[]): boolean {
  if (!storage) return false
  try {
    storage.setItem(
      SAVED_LINKS_KEY,
      JSON.stringify({
        v: 1,
        links: links.map((link) => ({
          platform: link.platform,
          handle: link.handle,
          url: link.url,
          note: link.note || undefined,
          addedAt: link.addedAt,
        })),
      }),
    )
    return true
  } catch {
    return false
  }
}

/* ───────── Bridges to the rest of the creators feature ───────── */

/** The Redgifs handle whose public catalog the app can browse, or null for every other platform. */
export function savedCatalogHandle(link: Pick<SavedLink, 'platform' | 'handle'>): string | null {
  return link.platform === 'redgifs' ? link.handle : null
}

/** Drawer-ready Creator for a saved Redgifs handle (the catalog loads when the drawer opens it). */
export function savedToCreator(link: SavedLink): Creator {
  return {
    id: `resolved-${link.handle.toLowerCase()}`,
    name: link.handle,
    username: link.handle,
    avatar: '',
    platform: 'Redgifs',
    profileUrl: link.url,
    sourceAttribution: 'Saved profile link',
    media: [],
  }
}

/** Filter saved links by platform id and a free-text needle (handle, note, platform id). */
export function filterSavedLinks(links: readonly SavedLink[], platform: string | null, needle: string): SavedLink[] {
  const text = needle.trim().toLowerCase()
  return links.filter((link) => {
    if (platform && link.platform !== platform) return false
    if (!text) return true
    return link.handle.toLowerCase().includes(text) || link.note.toLowerCase().includes(text) || link.platform.includes(text)
  })
}
