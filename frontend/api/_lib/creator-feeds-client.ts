/**
 * Client + validation helpers for the two public creator-index forms served by the Render backend:
 *
 *   POST /api/v1/creators/feeds/submit   a creator / agency submits the public feed they publish themselves
 *   POST /api/v1/creators/takedown       a creator asks for a profile or post to be hidden (acted on at once)
 *
 * `validateFeedSubmission` / `validateTakedown` mirror the backend's strict checks so obvious mistakes never leave
 * the edge; the backend re-validates everything (it is the source of truth). `submitFeed` / `submitTakedown` never
 * throw: they resolve to a `ClientResult` with the HTTP status, the parsed body or a coded error, and `retryAfter`
 * seconds when rate limited. Only https backends are used (same origin rules as `index-client.ts`).
 *
 * Contact e-mails are forwarded to the backend, which stores only a salted hash; nothing here logs or persists them.
 */
import { indexBackendOrigin } from './index-client.js'

export const FEED_KINDS = ['rss', 'atom', 'jsonfeed', 'peertube-channel', 'bluesky', 'mastodon'] as const
export type FeedKind = (typeof FEED_KINDS)[number]
const HANDLE_KINDS: readonly FeedKind[] = ['peertube-channel', 'bluesky', 'mastodon']

export const FEED_SUBMIT_PATH = '/api/v1/creators/feeds/submit'
export const TAKEDOWN_PATH = '/api/v1/creators/takedown'
/** Both forms are tiny JSON documents; larger bodies are refused at the edge and again by the backend. */
export const MAX_FORM_BYTES = 8 * 1024
export const FORM_TIMEOUT_MS = 25_000

export interface FeedSubmission {
  url?: string
  handle?: string
  kind?: FeedKind
  name?: string
  email?: string
  /** Honeypot: must stay empty. Real forms never render it. */
  website?: string
}

export interface TakedownRequest {
  platform?: string
  handle?: string
  url?: string
  reason: string
  email: string
  website?: string
}

export interface ValidationIssue { field: string; message: string }
/** `ok` results carry `value`, failed ones carry `issues` (explicit `undefined` keeps access type-safe without `strict`). */
export type Validated<T> =
  | { ok: true; value: T; issues?: undefined }
  | { ok: false; issues: ValidationIssue[]; value?: undefined }

export interface ClientError { code: string; message: string; errors?: ValidationIssue[] }
export interface ClientResult<T = Record<string, unknown>> {
  ok: boolean
  status: number
  data?: T
  error?: ClientError
  /** Seconds to wait before retrying (429 / queue full). */
  retryAfter?: number
}

export interface FeedSubmitResponse {
  id?: number | null
  status?: 'pending' | 'approved' | 'rejected' | 'paused'
  kind?: FeedKind
  displayName?: string
  itemCount?: number
  duplicate?: boolean
  accepted?: boolean
}

export interface TakedownResponse {
  id?: number
  status?: string
  matchedCreators?: number
  matchedItems?: number
  message?: string
  accepted?: boolean
}

interface CallOptions {
  /** The visitor's address (forwarded as X-Client-IP so the backend can rate limit per visitor). */
  clientIp?: string
  timeoutMs?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i
const IPV4_LIKE = /^[\d.]+$/

function readString(
  source: Record<string, unknown>, field: string, max: number, issues: ValidationIssue[], min = 0,
): string | undefined {
  const raw = source[field]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') {
    issues.push({ field, message: 'must be a string' })
    return undefined
  }
  const value = raw.trim()
  if (value.length > max) issues.push({ field, message: `must be at most ${max} characters` })
  else if (value.length < min) issues.push({ field, message: `must be at least ${min} characters` })
  return value || undefined
}

/** https URL with a real hostname: no credentials, no whitespace, no IP literal, no non-standard port. */
function httpsUrlIssue(value: string): string | null {
  if (/\s/.test(value)) return 'must not contain spaces'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'must be a valid URL'
  }
  if (url.protocol !== 'https:') return 'must start with https://'
  if (url.username || url.password) return 'must not contain credentials'
  if (url.port && url.port !== '443') return 'must use the standard https port'
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || host.includes(':') || IPV4_LIKE.test(host)) return 'must use a host name, not an IP address'
  if (!host.includes('.')) return 'must use a public host name'
  return null
}

function rejectUnknown(source: Record<string, unknown>, allowed: readonly string[], issues: ValidationIssue[]): void {
  for (const key of Object.keys(source)) if (!allowed.includes(key)) issues.push({ field: key, message: 'is not an accepted field' })
}

export function validateFeedSubmission(input: unknown): Validated<FeedSubmission> {
  if (!isRecord(input)) return { ok: false, issues: [{ field: '', message: 'expected a JSON object' }] }
  const issues: ValidationIssue[] = []
  rejectUnknown(input, ['url', 'handle', 'kind', 'name', 'email', 'website'], issues)
  const url = readString(input, 'url', 600, issues)
  const handle = readString(input, 'handle', 120, issues)
  const name = readString(input, 'name', 80, issues)
  const email = readString(input, 'email', 254, issues)
  const website = readString(input, 'website', 500, issues)
  let kind: FeedKind | undefined
  if (input.kind !== undefined && input.kind !== null && input.kind !== '') {
    if (typeof input.kind === 'string' && (FEED_KINDS as readonly string[]).includes(input.kind)) kind = input.kind as FeedKind
    else issues.push({ field: 'kind', message: `must be one of ${FEED_KINDS.join(', ')}` })
  }
  if (!url && !handle) issues.push({ field: 'url', message: 'provide a feed url, or a handle together with its kind' })
  if (url) {
    const problem = httpsUrlIssue(url)
    if (problem) issues.push({ field: 'url', message: problem })
  } else if (handle && (!kind || !HANDLE_KINDS.includes(kind))) {
    issues.push({ field: 'kind', message: 'a handle needs kind bluesky, mastodon or peertube-channel' })
  }
  if (email && !EMAIL_RE.test(email)) issues.push({ field: 'email', message: 'must be a valid e-mail address' })
  if (issues.length) return { ok: false, issues }
  const value: FeedSubmission = {}
  if (url) value.url = url
  if (handle) value.handle = handle
  if (kind) value.kind = kind
  if (name) value.name = name
  if (email) value.email = email
  if (website) value.website = website
  return { ok: true, value }
}

export function validateTakedown(input: unknown): Validated<TakedownRequest> {
  if (!isRecord(input)) return { ok: false, issues: [{ field: '', message: 'expected a JSON object' }] }
  const issues: ValidationIssue[] = []
  rejectUnknown(input, ['platform', 'handle', 'url', 'reason', 'email', 'website'], issues)
  const platform = readString(input, 'platform', 20, issues)
  const handle = readString(input, 'handle', 120, issues)
  const url = readString(input, 'url', 500, issues)
  const reason = readString(input, 'reason', 500, issues, 3)
  const email = readString(input, 'email', 254, issues)
  const website = readString(input, 'website', 500, issues)
  if (!reason) issues.push({ field: 'reason', message: 'tell us briefly why (at least 3 characters)' })
  if (!email) issues.push({ field: 'email', message: 'a contact e-mail is required' })
  else if (!EMAIL_RE.test(email)) issues.push({ field: 'email', message: 'must be a valid e-mail address' })
  if (url) {
    const problem = httpsUrlIssue(url)
    if (problem) issues.push({ field: 'url', message: problem })
  } else if (!(platform && handle)) {
    issues.push({ field: 'url', message: 'provide a profile or post URL, or a platform and handle' })
  }
  if (issues.length) return { ok: false, issues }
  const value: TakedownRequest = { reason: reason as string, email: email as string }
  if (platform) value.platform = platform
  if (handle) value.handle = handle
  if (url) value.url = url
  if (website) value.website = website
  return { ok: true, value }
}

/** Visitor address from the Vercel edge headers, or '' when unusable. */
export function visitorIp(request: Request): string {
  const chain = (request.headers.get('x-forwarded-for') || '').split(',').map((v) => v.trim()).filter(Boolean)
  const candidate = request.headers.get('x-real-ip') || chain[chain.length - 1] || ''
  return /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : ''
}

/** Read at most `limit` bytes of a request body; null when it is larger (also without Content-Length). */
export async function readCappedText(request: Request, limit = MAX_FORM_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function invalid<T>(issues: ValidationIssue[]): ClientResult<T> {
  return { ok: false, status: 422, error: { code: 'validation_error', message: 'Please check the highlighted fields.', errors: issues } }
}

async function post<T>(path: string, body: unknown, options: CallOptions): Promise<ClientResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FORM_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (options.clientIp) headers['X-Client-IP'] = options.clientIp
    const res = await fetch(`${indexBackendOrigin()}${path}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', redirect: 'manual',
    })
    const retry = Number(res.headers.get('retry-after'))
    const retryAfter = Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : undefined
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
    if (res.ok) {
      return isRecord(parsed)
        ? { ok: true, status: res.status, data: parsed as T }
        : { ok: false, status: 502, error: { code: 'bad_backend_response', message: 'The server answered in an unexpected way.' } }
    }
    const detail = isRecord(parsed) && isRecord(parsed.detail) ? parsed.detail : null
    const issues = detail && Array.isArray(detail.errors)
      ? detail.errors.filter(isRecord).map((e) => ({ field: String(e.field ?? ''), message: String(e.message ?? '') }))
      : undefined
    return {
      ok: false,
      status: res.status,
      retryAfter,
      error: {
        code: typeof detail?.code === 'string' ? detail.code : `http_${res.status}`,
        message: typeof detail?.message === 'string' ? detail.message : 'The request was not accepted.',
        ...(issues?.length ? { errors: issues } : {}),
      },
    }
  } catch {
    return { ok: false, status: 502, error: { code: 'backend_unavailable', message: 'The service did not respond; please try again shortly.' } }
  } finally {
    clearTimeout(timer)
  }
}

export async function submitFeed(input: unknown, options: CallOptions = {}): Promise<ClientResult<FeedSubmitResponse>> {
  const checked = validateFeedSubmission(input)
  if (!checked.ok) return invalid(checked.issues)
  return post<FeedSubmitResponse>(FEED_SUBMIT_PATH, checked.value, options)
}

export async function submitTakedown(input: unknown, options: CallOptions = {}): Promise<ClientResult<TakedownResponse>> {
  const checked = validateTakedown(input)
  if (!checked.ok) return invalid(checked.issues)
  return post<TakedownResponse>(TAKEDOWN_PATH, checked.value, options)
}
