export const config = { runtime: 'edge', maxDuration: 30 }

const DEFAULT_RENDER_ORIGIN = 'https://codex-research-radar.onrender.com'
const SAFE_RESPONSE_HEADERS = new Set([
  'accept-ranges', 'cache-control', 'content-length', 'content-range',
  'content-type', 'etag', 'last-modified', 'retry-after', 'x-request-id',
])

function backendOrigin(): string {
  const configured = (process.env.RENDER_BACKEND_ORIGIN || '').trim()
  try {
    const url = new URL(configured || DEFAULT_RENDER_ORIGIN)
    if (url.protocol !== 'https:' || url.username || url.password) return DEFAULT_RENDER_ORIGIN
    return url.origin
  } catch {
    return DEFAULT_RENDER_ORIGIN
  }
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function backendPath(url: URL): string | null {
  const raw = url.searchParams.get('path') || '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  // `.` / `..` segments and control characters are normalised away by the URL parser downstream, which would
  // let a path slip past the allow-lists below ("/api/v1/./creators/admin/..."): refuse them outright.
  if (!decoded.startsWith('/') || decoded.includes('\\') || hasControlCharacters(decoded)) return null
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) return null
  if (decoded === '/healthz' || decoded === '/api/version' || decoded.startsWith('/api/')) return decoded
  return null
}

/**
 * Everything under /api/v1/creators/ is a closed namespace: only the two public index reads (GET/HEAD) and the two
 * public submission endpoints (POST) pass. The index write endpoints (crawl/observe), the `hidden` list and every
 * admin route (/api/v1/creators/admin/..., feed approval, takedown restore, suppressions, lane stats) are never
 * reachable through this gateway, whatever the method.
 */
const CREATOR_INDEX_READ = /^\/api\/v1\/creators\/index(\/stats)?$/
const CREATOR_NAMESPACE = /^\/api\/v1\/creators(\/|$)/
const FEED_SUBMIT_PATH = '/api/v1/creators/feeds/submit'
const TAKEDOWN_PATH = '/api/v1/creators/takedown'
const PUBLIC_POST_PATHS: ReadonlySet<string> = new Set([FEED_SUBMIT_PATH, TAKEDOWN_PATH])
/** Both public forms are tiny JSON documents; anything larger is refused before it reaches the backend. */
const MAX_PUBLIC_POST_BYTES = 8 * 1024

function methodAllowed(method: string, path: string): boolean {
  if (CREATOR_NAMESPACE.test(path)) {
    if (method === 'GET' || method === 'HEAD') return CREATOR_INDEX_READ.test(path)
    return method === 'POST' && PUBLIC_POST_PATHS.has(path)
  }
  if (method === 'GET' || method === 'HEAD') {
    return ![
      /^\/api\/screenshots\/proxy-media$/,
      /^\/api\/screenshots\/cached-video\//,
      /^\/api\/screenshots\/video-poster\//,
      /^\/api\/telegram\/media\/[^/]+\/stream$/,
    ].some((pattern) => pattern.test(path))
  }
  if (/^\/api\/v1\/ingest\/(classify|jobs(\/[a-f0-9]{8,64}\/(cancel|retry))?)$/.test(path)) return method === 'POST'
  return method === 'POST' && (
    path === '/api/discovery/providers' ||
    /^\/api\/screenshots\/[^/]+\/resolve-stream$/.test(path)
  )
}

/** Visitor address as the Vercel edge saw it (the backend only ever sees this gateway), or '' when unusable. */
function visitorIp(request: Request): string {
  const chain = (request.headers.get('x-forwarded-for') || '').split(',').map((v) => v.trim()).filter(Boolean)
  const candidate = request.headers.get('x-real-ip') || chain[chain.length - 1] || ''
  return /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : ''
}

/** Read at most `limit` bytes; null when the body is larger (also for chunked uploads without Content-Length). */
async function readCappedBody(request: Request, limit: number): Promise<string | null> {
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { Allow: 'GET, HEAD, POST, OPTIONS' } })
  }

  const incoming = new URL(request.url)
  const path = backendPath(incoming)
  if (!path) return Response.json({ error: 'invalid_backend_path' }, { status: 400 })
  if (!methodAllowed(request.method, path)) {
    return Response.json({ error: 'method_or_stream_not_allowed' }, { status: 405 })
  }

  const target = new URL(path, backendOrigin())
  const query = new URLSearchParams(incoming.search)
  query.delete('path')
  target.search = query.toString()
  const headers = new Headers({ Accept: request.headers.get('accept') || 'application/json' })
  for (const name of ['content-type', 'if-none-match', 'range', 'x-request-id', 'x-admin-token', 'idempotency-key']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  let body: BodyInit | null | undefined = request.method === 'POST' ? request.body : undefined
  if (request.method === 'POST' && PUBLIC_POST_PATHS.has(path)) {
    // Public, unauthenticated forms: JSON only, hard body cap, never carry an admin token, and tell the backend
    // which visitor this is (its rate limits are per client; without this every visitor would share the gateway's address).
    if (!/^application\/json\b/i.test(request.headers.get('content-type') || '')) {
      return Response.json({ error: 'unsupported_media_type' }, { status: 415, headers: { 'Cache-Control': 'no-store' } })
    }
    const text = await readCappedBody(request, MAX_PUBLIC_POST_BYTES)
    if (text === null) {
      return Response.json({ error: 'payload_too_large' }, { status: 413, headers: { 'Cache-Control': 'no-store' } })
    }
    body = text
    headers.delete('x-admin-token')
    headers.delete('idempotency-key')
    const ip = visitorIp(request)
    if (ip) headers.set('x-client-ip', ip)
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: 'manual',
    })
    const responseHeaders = new Headers()
    upstream.headers.forEach((value, key) => {
      if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value)
    })
    responseHeaders.set('X-Media-Codex-Backend', 'render')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch {
    return Response.json(
      { error: 'render_backend_unavailable', detail: 'The backend did not respond in time.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
