/**
 * Shared public-provider (Redgifs) helpers used by the discovery feed
 * (`api/live-media.ts`) and the per-creator catalog (`api/creator-media.ts`).
 * One implementation of eligibility, sanitising and item mapping keeps both
 * endpoints consistent. Uses only the provider's public API.
 */
import type { UnifiedMediaItem } from './discovery-types.js'
import { orderStreamCandidates, withContract } from './media-normalize.js'

export const REDGIFS_API = 'https://api.redgifs.com/v2'
export const PROVIDER_TIMEOUT_MS = 6_500
const TOKEN_TTL_MS = 20 * 60 * 1_000

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

// Exclusion-only blocklist: strictly female/straight markers. Trans-related
// terms were removed — trans men are in scope, and identity terms must never
// be used as exclusion signals.
const FEMALE_MARKERS = [
  'female', 'woman', 'women', 'girl', 'lesbian', 'straight', 'pussy',
  'vagina', 'hetero',
  'girlfriend', 'wife', 'b/g', 'm/f', 'boob', 'breast', 'tits',
  'milf', 'femdom',
  'girls', 'chick', 'chicks', 'females',
]

export type RedgifsItem = {
  id?: string
  userName?: string
  description?: string
  tags?: string[]
  niches?: Array<string | { name?: string }>
  duration?: number
  width?: number
  height?: number
  hasAudio?: boolean
  likes?: number
  views?: number
  createDate?: number
  urls?: {
    hd?: string
    sd?: string
    poster?: string
    thumbnail?: string
  }
}

export function redactEmails(value = ''): string {
  return value
    .replace(EMAIL_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

export function canonicalCreator(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Provider username for a user-typed handle. Redgifs usernames are lowercase and
 * may contain `_`, `.` and `-`, so unlike `canonicalCreator` (used for matching)
 * separators are preserved here; otherwise `top_dry` would be looked up as `topdry`.
 */
export function providerHandle(value: string): string {
  return redactEmails(value).trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_.-]+/g, '').slice(0, 50)
}

export function sanitizeProviderItem(item: RedgifsItem): RedgifsItem {
  const creator = redactEmails(item.userName || '') || 'Public creator'
  return {
    ...item,
    userName: creator,
    description: redactEmails(item.description || '') || undefined,
    tags: (item.tags || []).map(redactEmails).filter(Boolean),
    niches: (item.niches || []).map((niche) => {
      if (typeof niche === 'string') return redactEmails(niche)
      return { ...niche, name: redactEmails(niche.name || '') }
    }).filter((niche) => typeof niche === 'string' ? Boolean(niche) : Boolean(niche.name)),
  }
}

export function textFor(item: RedgifsItem): string {
  const niches = (item.niches || []).map((niche) =>
    typeof niche === 'string' ? niche : niche.name || ''
  )
  return [item.userName || '', ...(item.tags || []), ...niches, item.description || '']
    .join(' ')
    .toLowerCase()
}

export function isEligibleScopedItem(item: RedgifsItem): boolean {
  // Provider tag-scoped searches (tags=Gay) and exact creator-profile lookups
  // are scope-proofed by the provider query itself; only exclusion markers are
  // applied here. We never infer identity, body, gender, or orientation.
  const tokens = new Set(textFor(item).split(/[^a-z0-9/]+/).filter(Boolean))
  return !FEMALE_MARKERS.some((marker) => tokens.has(marker))
}

export function safeProviderMediaUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
    if (!/^(?:media|thumbs\d*)\.redgifs\.com$/i.test(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function durationLabel(seconds = 0): string {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

export function toIsoDate(value?: number): string {
  if (!value || !Number.isFinite(value)) return ''
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

export function proxiedMediaUrl(url?: string): string | undefined {
  return url ? `/api/archiver-proxy?url=${encodeURIComponent(url)}` : undefined
}

/** True when the provider item has a poster and at least one playable stream. */
export function hasPlayableUrls(item: RedgifsItem): boolean {
  return Boolean(
    item.id
      && safeProviderMediaUrl(item.urls?.poster || item.urls?.thumbnail)
      && (safeProviderMediaUrl(item.urls?.hd) || safeProviderMediaUrl(item.urls?.sd)),
  )
}

/** Map one (already sanitized + eligible) provider item to the shared media shape. */
export function mapRedgifsItem(item: RedgifsItem, isWatchedCreator = false): UnifiedMediaItem {
  const tags = (item.tags || []).filter(Boolean).slice(0, 12)
  const creator = item.userName || 'Redgifs creator'
  const createdAt = toIsoDate(item.createDate)
  const directCandidates = [safeProviderMediaUrl(item.urls?.hd), safeProviderMediaUrl(item.urls?.sd)]
    .filter((url): url is string => Boolean(url))
  const streamCandidates = orderStreamCandidates(
    [...directCandidates.map(proxiedMediaUrl), ...directCandidates].filter((url): url is string => Boolean(url)),
  )
  // Grids and avatars use the provider's small thumbnail; the full-size poster rides in
  // `posterUrl` for the detail sheet and player. Decoding a full poster per card is what
  // exhausts memory on phones.
  const poster = proxiedMediaUrl(safeProviderMediaUrl(item.urls?.poster || item.urls?.thumbnail))
  const thumb = proxiedMediaUrl(safeProviderMediaUrl(item.urls?.thumbnail)) || poster
  const base: UnifiedMediaItem = {
    id: `rg-${item.id}`,
    title: item.description?.trim() || tags.slice(0, 3).join(' · ') || `Video by ${creator}`,
    thumbnail: thumb || '',
    source: 'Redgifs',
    duration: durationLabel(item.duration),
    isVideo: true,
    category: tags[0] || 'gay male',
    creator,
    tags,
    rating: 0,
    createdAt,
    views: Math.max(0, item.views || 0),
    mediaUrl: proxiedMediaUrl(directCandidates[0]),
    streamCandidates,
    pageUrl: `https://www.redgifs.com/watch/${item.id}`,
    profileUrl: `https://www.redgifs.com/users/${encodeURIComponent(creator)}`,
    description: item.description || undefined,
    likes: Math.max(0, item.likes || 0),
    comments: 0,
    isLiked: false,
    isNew: Boolean(createdAt) && Date.now() - Date.parse(createdAt) < 86_400_000,
    isTrending: false,
    curationScore: 0,
    curationReasons: [],
    isWatchedCreator,
  }
  return withContract(base, {
    width: item.width, height: item.height, durationSeconds: item.duration, hasAudio: item.hasAudio,
    mimeType: 'video/mp4', posterUrl: poster,
  })
}

/* ── Provider access ── */

let tokenCache: { token: string; expiresAt: number } | null = null
let tokenPromise: Promise<string> | null = null

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function getRedgifsToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token
  if (tokenPromise) return tokenPromise
  tokenPromise = (async () => {
    const auth = await fetchWithTimeout(`${REDGIFS_API}/auth/temporary`, {
      headers: { Accept: 'application/json', 'User-Agent': 'MediaCodex/1.0' },
      cache: 'no-store',
    })
    if (!auth.ok) throw new Error(`Redgifs auth returned ${auth.status}`)
    const token = String((await auth.json() as { token?: string }).token || '')
    if (!token) throw new Error('Redgifs did not return a temporary token')
    tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS }
    return token
  })().finally(() => {
    tokenPromise = null
  })
  return tokenPromise
}

export type CreatorCatalogPage = {
  gifs: RedgifsItem[]
  page: number
  pages: number
  total: number
}

/** One page of a creator's full public catalog (provider order: recent | top | trending). */
export async function fetchCreatorCatalogPage(
  handle: string,
  page: number,
  count: number,
  order: 'recent' | 'top' | 'trending' = 'recent',
): Promise<CreatorCatalogPage> {
  const token = await getRedgifsToken()
  const params = new URLSearchParams({ count: String(count), page: String(page), order })
  const result = await fetchWithTimeout(`${REDGIFS_API}/users/${encodeURIComponent(handle)}/search?${params}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'MediaCodex/1.0' },
    cache: 'no-store',
  })
  if (result.status === 404) return { gifs: [], page, pages: 0, total: 0 }
  if (!result.ok) throw new Error(`Public provider returned ${result.status}`)
  const body = await result.json() as { gifs?: RedgifsItem[]; page?: number; pages?: number; total?: number }
  const gifs = body.gifs || []
  return {
    gifs,
    page: Number(body.page) || page,
    pages: Number(body.pages) || (gifs.length >= count ? page + 1 : page),
    total: Number(body.total) || gifs.length,
  }
}
