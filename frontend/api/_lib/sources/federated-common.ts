/**
 * Shared plumbing for the federated public-source collectors (Bluesky,
 * Mastodon-compatible hashtag timelines, Lemmy). Public, unauthenticated APIs only.
 *
 * Every collector: never throws, soft-fails, <=4s per request, <=8 requests per
 * call (RequestBudget), bounded parallelism, SSRF-safe hosts, nothing persisted.
 */
import type { CreatorLead, SourceStatus, UnifiedMediaItem } from '../discovery-types.js'
import { isPrivateHost } from '../net-safe.js'
import { withContract } from '../media-normalize.js'
import { safeHost } from './http.js'

export const FED_REQUEST_TIMEOUT_MS = 4000
export const FED_MAX_REQUESTS = 8
export const FED_PARALLELISM = 3
export const FED_MAX_MEDIA = 60

export type CollectorOpts = {
  query?: string
  watchlist?: string[]
  signal?: AbortSignal
  /** Test/ops override; defaults to process.env. */
  env?: Record<string, string | undefined>
  maxRequests?: number
}

export type CollectorResult = {
  media: UnifiedMediaItem[]
  leads: CreatorLead[]
  status: SourceStatus
  attempted: number
  succeeded: number
}

/* ------------------------------ text hygiene ----------------------------- */

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_RE = /(?<![\w/])\+?\d[\d\s().-]{7,}\d(?![\w/])/g

/** Strip e-mail addresses and phone-like strings; collapse whitespace. */
export function redact(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(EMAIL_RE, '').replace(PHONE_RE, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }
export function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return ''
  return redact(value.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m))
}

/** Query/watchlist entry safe to send to a third party: no e-mail/phone/URL, 2..60 chars. */
export function cleanTerm(input: unknown): string | null {
  const q = redact(typeof input === 'string' ? input : '').replace(/^@/, '')
  if (q.length < 2 || q.length > 60) return null
  if (/^https?:\/\//i.test(q) || /@/.test(q)) return null
  return q
}

export const normKey = (v: string): string => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')

/* --------------------------------- urls ---------------------------------- */

/** https URL without credentials that does not point at a private/internal host. */
export function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || isPrivateHost(url.hostname)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

/* ------------------------------ env parsing ------------------------------ */

export function parseHostList(raw: string | undefined, fallback: readonly string[], max = 4): string[] {
  const source = raw && raw.trim() ? raw.split(/[\s,]+/) : [...fallback]
  const out: string[] = []
  for (const entry of source) {
    const host = safeHost(entry)
    if (host && !out.includes(host)) out.push(host)
  }
  return out.slice(0, max)
}

export function parseTokenList(raw: string | undefined, fallback: readonly string[], pattern: RegExp, max = 8): string[] {
  const source = raw && raw.trim() ? raw.split(/[\s,]+/) : [...fallback]
  const out: string[] = []
  for (const entry of source) {
    const token = entry.trim().replace(/^[#!]/, '').toLowerCase()
    if (token && pattern.test(token) && !out.includes(token)) out.push(token)
  }
  return out.slice(0, max)
}

/* --------------------------------- http ---------------------------------- */

export async function fetchJsonStatus(
  url: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ status: number; json: unknown | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? FED_REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'application/json', 'User-Agent': 'MediaCodexFederated/1.0 (+public-metadata-only)' },
    })
    if (!response.ok) return { status: response.status, json: null }
    try {
      return { status: response.status, json: await response.json() }
    } catch {
      return { status: response.status, json: null }
    }
  } catch {
    return { status: 0, json: null }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** Counts requests against a hard cap and remembers why things failed. */
export class RequestBudget {
  attempted = 0
  succeeded = 0
  authBlocked = 0
  failed = 0
  readonly max: number
  private readonly signal?: AbortSignal
  constructor(max: number = FED_MAX_REQUESTS, signal?: AbortSignal) {
    this.max = max
    this.signal = signal
  }

  get remaining(): number { return Math.max(0, this.max - this.attempted) }

  /** Fetch JSON if budget remains; null on cap, abort, HTTP error or bad JSON. */
  async json(url: string): Promise<unknown | null> {
    if (this.attempted >= this.max || this.signal?.aborted) return null
    this.attempted += 1
    const { status, json } = await fetchJsonStatus(url, { signal: this.signal })
    if (json !== null && json !== undefined) { this.succeeded += 1; return json }
    if (status === 401 || status === 403) this.authBlocked += 1
    else this.failed += 1
    return null
  }
}

/* -------------------------------- results -------------------------------- */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
export const str = (value: unknown): string => (typeof value === 'string' ? value : '')
export const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)

export type FedItemInput = {
  id: string
  source: string
  category: string
  title: string
  creator: string
  thumbnail?: string
  isVideo: boolean
  streams?: string[]
  imageUrl?: string
  pageUrl: string
  profileUrl?: string
  description?: string
  tags?: string[]
  createdAt?: string
  likes?: number
  comments?: number
  views?: number
  width?: number
  height?: number
  durationSeconds?: number
  reason: string
  watched?: boolean
}

export function buildFedItem(input: FedItemInput): UnifiedMediaItem {
  const whole = Math.max(0, Math.floor(input.durationSeconds || 0))
  const created = input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : new Date().toISOString()
  const item: UnifiedMediaItem = {
    id: input.id,
    title: redact(input.title).slice(0, 96) || `${input.source} post by ${input.creator}`,
    thumbnail: input.thumbnail,
    source: input.source,
    duration: `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`,
    isVideo: input.isVideo,
    category: input.category,
    creator: redact(input.creator).slice(0, 80) || `${input.source} creator`,
    tags: (input.tags || []).map(redact).filter(Boolean).slice(0, 8),
    rating: 0,
    createdAt: created,
    views: input.views || 0,
    streamCandidates: input.isVideo ? (input.streams || []) : [],
    pageUrl: input.pageUrl,
    profileUrl: input.profileUrl,
    description: redact(input.description).slice(0, 400) || undefined,
    likes: input.likes || 0,
    comments: input.comments || 0,
    isLiked: false,
    isNew: false,
    isTrending: false,
    curationScore: 0,
    curationReasons: [input.reason],
    isWatchedCreator: Boolean(input.watched),
  }
  if (!input.isVideo && input.imageUrl) item.mediaUrl = input.imageUrl
  return withContract(item, { width: input.width, height: input.height, durationSeconds: input.durationSeconds, posterUrl: input.isVideo ? input.thumbnail : undefined })
}

export function fedStatus(
  base: Pick<SourceStatus, 'id' | 'name' | 'searchUrl'>,
  budget: RequestBudget,
  counts: { media: number; creators: number },
  details: { ok: string; blocked: string; down: string; nothing: string },
): SourceStatus {
  let state: SourceStatus['state']
  let detail: string
  if (!budget.attempted) { state = 'limited'; detail = details.nothing }
  else if (!budget.succeeded) { state = budget.authBlocked > 0 && budget.authBlocked >= budget.failed ? 'limited' : 'error'; detail = budget.authBlocked ? details.blocked : details.down }
  else if (budget.failed + budget.authBlocked > 0) { state = 'limited'; detail = `${details.ok} (${budget.succeeded}/${budget.attempted} requests succeeded)` }
  else { state = 'connected'; detail = details.ok }
  return { ...base, mode: 'stream', state, mediaFound: counts.media, creatorsFound: counts.creators, detail }
}

/** Dedupe by id keeping first occurrence. */
export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
}

/** Run `fn` over items with at most `limit` in flight (never rejects). */
export async function settleBounded<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      try { await fn(item) } catch { /* soft-fail */ }
    }
  }))
}
