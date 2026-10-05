/**
 * Pure creator-lookup logic (no React, no DOM): input parsing, bulk lists, merging and the
 * radar cap. Kept dependency-free so it runs under `node --test`.
 */
import type { Creator } from '../../lib/types.ts'

/** Maximum handles on the radar (the feed endpoint batches them). */
export const RADAR_CAP = 40

/** Canonical lowercase key for a creator name or handle (mirrors lib/discovery creatorKey). */
export function handleKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export type CreatorInputKind = 'empty' | 'name' | 'handle' | 'url'

export interface ParsedCreatorInput {
  kind: CreatorInputKind
  /** What to send to the resolver. */
  query: string
  /** Best-guess handle for handle/url input. */
  handle?: string
  /** Lowercase platform hint for urls (e.g. "redgifs"). */
  platform?: string
}

const URL_HOSTS: Record<string, string> = {
  'redgifs.com': 'redgifs',
  'x.com': 'x',
  'twitter.com': 'x',
  'instagram.com': 'instagram',
  'onlyfans.com': 'onlyfans',
  'fansly.com': 'fansly',
  'tiktok.com': 'tiktok',
  'reddit.com': 'reddit',
  'pornhub.com': 'pornhub',
  'xvideos.com': 'xvideos',
  'youtube.com': 'youtube',
  'twitch.tv': 'twitch',
  'linktr.ee': 'linktree',
  'bsky.app': 'bluesky',
  'justfor.fans': 'justforfans',
  'justforfans.com': 'justforfans',
  'fanvue.com': 'fanvue',
  'patreon.com': 'patreon',
  'beacons.ai': 'beacons',
  'allmylinks.com': 'allmylinks',
}
/** Path prefixes that precede the handle (`/users/x`, `/u/x`). */
const PREFIX_SEGMENTS = new Set(['users', 'user', 'u', 'creators', 'model', 'models', 'channels', 'c', 'channel', 'profile', 'pornstar', 'pornstars'])
/** Site sections that are never a handle. */
const RESERVED_SEGMENTS = new Set([
  'i', 'home', 'browse', 'trending', 'latest', 'top', 'new', 'popular', 'categories', 'category', 'explore', 'search', 'watch', 'gifs', 'tags', 'niches', 'hashtag', 'intent', 'share', 'settings', 'about',
  ...PREFIX_SEGMENTS,
])
const HANDLE_RE = /^[a-z0-9][a-z0-9_.-]{1,39}$/i

function cleanHandle(value: string): string {
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // keep the raw segment
  }
  return decoded.trim().replace(/^@+/, '').replace(/[?#].*$/, '')
}

/** Parse a pasted profile URL into { handle, platform }, or null when it is not a profile link. */
export function parseProfileUrl(input: string): { handle: string; platform: string } | null {
  const text = input.trim()
  if (!/^(https?:\/\/|www\.)/i.test(text) && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|tv|app|ee)\//i.test(text)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|old|new)\./, '')
  const platform = URL_HOSTS[host]
  if (!platform) return null
  let segments = url.pathname.split('/').filter(Boolean)
  if (segments.length > 1 && PREFIX_SEGMENTS.has(segments[0].toLowerCase())) segments = segments.slice(1)
  const candidate = segments[0] ? cleanHandle(segments[0]) : ''
  if (!candidate || RESERVED_SEGMENTS.has(candidate.toLowerCase()) || !HANDLE_RE.test(candidate)) return null
  return { handle: candidate, platform }
}

/** Classify what the user typed: a name, an @handle / bare handle, or a pasted profile URL. */
export function parseCreatorInput(raw: string): ParsedCreatorInput {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return { kind: 'empty', query: '' }
  const fromUrl = parseProfileUrl(text)
  if (fromUrl) return { kind: 'url', query: fromUrl.handle, handle: fromUrl.handle, platform: fromUrl.platform }
  if (text.startsWith('@')) {
    const handle = cleanHandle(text.split(' ')[0])
    if (handle) return { kind: 'handle', query: handle, handle }
  }
  if (!text.includes(' ') && HANDLE_RE.test(text) && /[_.\d-]/.test(text)) return { kind: 'handle', query: text, handle: text }
  return { kind: 'name', query: text.replace(/^@/, '') }
}

/** Split a bulk list (commas / newlines / semicolons) into unique, parsed lookups. Caps at `max`. */
export function parseBulkList(raw: string, max = 200): ParsedCreatorInput[] {
  const seen = new Set<string>()
  const out: ParsedCreatorInput[] = []
  for (const piece of (raw ?? '').split(/[\n\r,;]+/)) {
    const parsed = parseCreatorInput(piece)
    if (parsed.kind === 'empty') continue
    const key = handleKey(parsed.query)
    if (key.length < 2 || seen.has(key)) continue
    seen.add(key)
    out.push(parsed)
    if (out.length >= max) break
  }
  return out
}

export function sanitizeHandle(value: string): string {
  return value.trim().replace(/^@/, '').replace(/\s+/g, ' ').slice(0, 50)
}

/** Add handles to a radar list: de-duped by key, capped. Reports what was added and what did not fit. */
export function addToRadar(
  current: string[],
  additions: string[],
  cap = RADAR_CAP
): { next: string[]; added: string[]; skippedFull: string[] } {
  const next = [...current]
  const keys = new Set(next.map(handleKey))
  const added: string[] = []
  const skippedFull: string[] = []
  for (const raw of additions) {
    const display = sanitizeHandle(raw)
    const key = handleKey(display)
    if (key.length < 2 || keys.has(key)) continue
    if (next.length >= cap) {
      skippedFull.push(display)
      continue
    }
    keys.add(key)
    next.push(display)
    added.push(display)
  }
  return { next, added, skippedFull }
}

/** The handle a Creator is addressed by everywhere (feed cards use the name when no username). */
export function creatorHandle(creator: Pick<Creator, 'name' | 'username'>): string {
  return (creator.username || creator.name || '').replace(/^@/, '')
}

/** Union of creator lists keyed by lowercase handle; the earlier list wins, gaps are back-filled. */
export function mergeCreators(...lists: Creator[][]): Creator[] {
  const byKey = new Map<string, Creator>()
  for (const list of lists) {
    for (const creator of list) {
      const key = handleKey(creatorHandle(creator))
      if (!key) continue
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, creator)
        continue
      }
      byKey.set(key, {
        ...existing,
        avatar: existing.avatar || creator.avatar,
        followers: existing.followers ?? creator.followers,
        mediaCount: Math.max(existing.mediaCount ?? 0, creator.mediaCount ?? 0) || undefined,
        profileUrl: existing.profileUrl || creator.profileUrl,
        discoveryTags: [...new Set([...(existing.discoveryTags ?? []), ...(creator.discoveryTags ?? [])])],
        media: existing.media?.length ? existing.media : creator.media,
      })
    }
  }
  return [...byKey.values()]
}

export interface CreatorCandidate {
  handle: string
  displayName: string
  platform: string
  profileUrl?: string
  avatar?: string
  followers?: number | null
  mediaCount?: number | null
  confidence: number
  matchedBy: string
  sourceAttribution?: string
}

const MATCH_LABELS: Record<string, string> = {
  alias: 'Known alias',
  registry: 'Known alias',
  variant: 'Handle variant',
  handle: 'Exact handle',
  exact: 'Exact handle',
  lookup: 'Exact handle',
  search: 'Search hit',
  text: 'Search hit',
  source: 'Search hit',
}

export function matchedByLabel(matchedBy: string | undefined): string {
  return MATCH_LABELS[(matchedBy ?? '').toLowerCase()] ?? 'Possible match'
}

/** Playable/enumerable catalogs exist only for Redgifs; everything else is a profile link. */
export function isCatalogPlatform(platform: string | undefined, profileUrl?: string): boolean {
  if ((platform ?? '').toLowerCase().includes('redgifs')) return true
  try {
    return /(^|\.)redgifs\.com$/i.test(new URL(profileUrl || '').hostname)
  } catch {
    return false
  }
}

/** Build a drawer-ready Creator from a resolver candidate (media stays empty; the catalog loads on open). */
export function candidateToCreator(candidate: CreatorCandidate): Creator {
  const handle = candidate.handle.replace(/^@/, '')
  return {
    id: `resolved-${handle.toLowerCase()}`,
    name: candidate.displayName || handle,
    username: handle,
    avatar: candidate.avatar || '',
    followers: candidate.followers ?? null,
    platform: candidate.platform,
    profileUrl: candidate.profileUrl,
    mediaCount: candidate.mediaCount ?? undefined,
    sourceAttribution: candidate.sourceAttribution || candidate.platform,
    matchReasons: [matchedByLabel(candidate.matchedBy)],
    media: [],
  }
}

/** Drawer-ready Creator for a related-creator card (catalog loads when the drawer opens it). */
export function relatedToCreator(related: {
  handle: string; displayName?: string; avatar?: string; platform?: string; reason?: string; sharedTags?: string[]
}): Creator {
  const handle = related.handle.replace(/^@/, '')
  return {
    id: `resolved-${handle.toLowerCase()}`,
    name: related.displayName || handle,
    username: handle,
    avatar: related.avatar || '',
    platform: related.platform || 'Redgifs',
    profileUrl: `https://www.redgifs.com/users/${encodeURIComponent(handle)}`,
    sourceAttribution: related.platform || 'Redgifs',
    matchReasons: related.reason ? [related.reason] : undefined,
    discoveryTags: related.sharedTags,
    media: [],
  }
}

export const DRAWER_STACK_MAX = 8

/** Push onto the drawer history; re-opening the creator already on top is a no-op, depth is bounded. */
export function pushDrawerStack(stack: Creator[], current: Creator, next: Creator): Creator[] {
  if (handleKey(creatorHandle(next)) === handleKey(creatorHandle(current))) return stack
  return [...stack, next].slice(-DRAWER_STACK_MAX)
}

/** Follow-id source:resolved candidates follow by handle so follows match the media's creator field. */
export function followName(creator: Pick<Creator, 'id' | 'name' | 'username'>): string {
  return creator.id?.startsWith('resolved-') ? creatorHandle(creator) : creator.name
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i

/** Rehydrate a persisted radar list: strings only, no emails, de-duped by key, capped at `cap`. */
export function sanitizeRadarList(values: unknown, cap = RADAR_CAP): string[] {
  if (!Array.isArray(values)) return []
  const unique = new Map<string, string>()
  for (const raw of values) {
    if (typeof raw !== 'string' || EMAIL_RE.test(raw)) continue
    const display = sanitizeHandle(raw)
    const key = handleKey(display)
    if (key.length >= 2 && !unique.has(key)) unique.set(key, display)
    if (unique.size >= cap) break
  }
  return [...unique.values()]
}

/** Normalise an untrusted resolver payload. */
export function normalizeCandidates(payload: unknown): CreatorCandidate[] {
  const raw = (payload as { candidates?: unknown })?.candidates
  if (!Array.isArray(raw)) return []
  const out: CreatorCandidate[] = []
  const seen = new Set<string>()
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  for (const entry of raw as Record<string, unknown>[]) {
    const handle = typeof entry?.handle === 'string' ? entry.handle.replace(/^@/, '').trim() : ''
    const key = handle.toLowerCase()
    if (!handle || seen.has(key)) continue
    seen.add(key)
    out.push({
      handle,
      displayName: typeof entry.displayName === 'string' && entry.displayName.trim() ? entry.displayName.trim() : handle,
      platform: typeof entry.platform === 'string' && entry.platform ? entry.platform : 'Redgifs',
      profileUrl: typeof entry.profileUrl === 'string' ? entry.profileUrl : undefined,
      avatar: typeof entry.avatar === 'string' ? entry.avatar : undefined,
      followers: num(entry.followers),
      mediaCount: num(entry.mediaCount),
      confidence: num(entry.confidence) ?? 0,
      matchedBy: typeof entry.matchedBy === 'string' ? entry.matchedBy : 'search',
      sourceAttribution: typeof entry.sourceAttribution === 'string' ? entry.sourceAttribution : undefined,
    })
  }
  return out
}
