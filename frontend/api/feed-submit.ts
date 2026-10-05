/**
 * Same-origin entry point for the two public creator-index forms (the UI posts here instead of talking to the
 * backend gateway directly):
 *
 *   POST /api/feed-submit                       { url | handle+kind, kind?, name?, email?, website }   submit a feed
 *   POST /api/feed-submit { "action": "takedown", platform+handle | url, reason, email, website }       hide a creator/post
 *
 * Success bodies are the backend's (`{ id, status: 'pending', ... }` / `{ id, status: 'hidden', matched... }`);
 * failures are `{ error: { code, message, errors?: [{ field, message }] } }` with the matching HTTP status
 * (422 invalid, 429 + Retry-After rate limited, 413/415 body problems, 502 backend unavailable).
 *
 * Strict validation happens here first (no backend call for invalid input), the body is capped at 8 KB, a filled
 * honeypot (`website`) is answered with a silent 202, and a small per-visitor bucket sits in front of the backend's
 * own limits. No admin route is reachable from here.
 */
export const config = { runtime: 'edge', maxDuration: 30 }

import {
  readCappedText, submitFeed, submitTakedown, validateFeedSubmission, validateTakedown, visitorIp,
  type ClientResult,
} from './_lib/creator-feeds-client.js'

const RATE_LIMIT = 10
const RATE_WINDOW_MS = 10 * 60_000
const buckets = new Map<string, { count: number; resetAt: number }>()

function consume(key: string): boolean {
  const now = Date.now()
  if (buckets.size > 4096) buckets.clear()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (bucket.count >= RATE_LIMIT) return false
  bucket.count += 1
  return true
}

const BASE_HEADERS = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }

function fail(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message } }, { status, headers: { ...BASE_HEADERS, ...extra } })
}

function respond(result: ClientResult<object>): Response {
  const headers: Record<string, string> = { ...BASE_HEADERS }
  if (result.retryAfter) headers['Retry-After'] = String(result.retryAfter)
  if (result.ok) return Response.json(result.data ?? {}, { status: result.status, headers })
  return Response.json({ error: result.error ?? { code: 'error', message: 'The request was not accepted.' } }, { status: result.status, headers })
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } })
  if (request.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.', { Allow: 'POST, OPTIONS' })
  if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) {
    return fail(415, 'unsupported_media_type', 'Send application/json.')
  }
  const text = await readCappedText(request)
  if (text === null) return fail(413, 'payload_too_large', 'The request body may be at most 8 KB.')
  let body: unknown
  try {
    body = JSON.parse(text || 'null')
  } catch {
    return fail(400, 'invalid_json', 'The request body is not valid JSON.')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(422, 'validation_error', 'The request body must be a JSON object.')
  }
  const { action, ...fields } = body as Record<string, unknown>
  if (action !== undefined && action !== 'feed' && action !== 'takedown') {
    return fail(422, 'validation_error', "action must be 'feed' or 'takedown'.")
  }
  const takedown = action === 'takedown'

  const checked = takedown ? validateTakedown(fields) : validateFeedSubmission(fields)
  if (!checked.ok) {
    return Response.json(
      { error: { code: 'validation_error', message: 'Please check the highlighted fields.', errors: checked.issues } },
      { status: 422, headers: BASE_HEADERS },
    )
  }
  if ((checked.value as { website?: string }).website) {  // honeypot: pretend it worked, send nothing
    return Response.json({ accepted: true, status: takedown ? 'hidden' : 'pending' }, { status: 202, headers: BASE_HEADERS })
  }

  const ip = visitorIp(request)
  if (!consume(ip || 'unknown')) return fail(429, 'rate_limited', 'Too many requests; please try again later.', { 'Retry-After': '600' })
  const result = takedown
    ? await submitTakedown(checked.value, { clientIp: ip })
    : await submitFeed(checked.value, { clientIp: ip })
  return respond(result as ClientResult<object>)
}
