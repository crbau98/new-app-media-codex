export const config = { runtime: 'edge', maxDuration: 30 }

const DEFAULT_RENDER_ORIGIN = 'https://codex-research-radar.onrender.com'
const SAFE_RESPONSE_HEADERS = new Set([
  'accept-ranges', 'cache-control', 'content-length', 'content-range',
  'content-type', 'etag', 'last-modified', 'x-request-id',
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

function backendPath(url: URL): string | null {
  const raw = url.searchParams.get('path') || '/'
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.split('/').includes('..')) return null
  if (decoded === '/healthz' || decoded === '/api/version' || decoded.startsWith('/api/')) return decoded
  return null
}

function methodAllowed(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') {
    return ![
      /^\/api\/screenshots\/proxy-media$/,
      /^\/api\/screenshots\/cached-video\//,
      /^\/api\/screenshots\/video-poster\//,
      /^\/api\/telegram\/media\/[^/]+\/stream$/,
    ].some((pattern) => pattern.test(path))
  }
  return method === 'POST' && (
    path === '/api/discovery/providers' ||
    /^\/api\/screenshots\/[^/]+\/resolve-stream$/.test(path)
  )
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
  for (const name of ['content-type', 'if-none-match', 'range', 'x-request-id']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'POST' ? request.body : undefined,
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
