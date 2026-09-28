/**
 * Pure helpers for the edge media proxy. Kept dependency-free so they can be
 * unit-tested with `node --experimental-strip-types` and reused by the HLS
 * manifest rewriter.
 */

/**
 * Strict first-party allowlist. Only public RedGifs media/thumbnail CDNs are
 * proxied today: they are the only provider adapter that emits
 * `/api/archiver-proxy` URLs (see api/live-media.ts). Other providers
 * (X/Tumblr) are already permitted for direct playback by the CSP `media-src`
 * and are intentionally NOT proxied, so no additional hosts were added.
 */
const EXACT_HOSTS = new Set(['media.redgifs.com'])
const HOST_PATTERNS = [/^(?:media|thumbs\d*)\.redgifs\.com$/i]

export function allowedProxyHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (EXACT_HOSTS.has(host)) return true
  return HOST_PATTERNS.some((pattern) => pattern.test(host))
}

/** Parse + validate an upstream target: https only, no credentials/hash/odd ports, allowlisted host. */
export function safeProxyTarget(value: string): URL | null {
  try {
    const target = new URL(value)
    if (target.protocol !== 'https:') return null
    if (target.username || target.password || target.hash) return null
    if (target.port && target.port !== '443') return null
    if (!allowedProxyHost(target.hostname)) return null
    return target
  } catch {
    return null
  }
}

const EXTENSION_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  ts: 'video/mp2t',
  m4s: 'video/mp4',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  m3u8: 'application/vnd.apple.mpegurl',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
}

const GENERIC_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/x-octet-stream'])

export function extensionOf(pathname: string): string {
  const match = /\.([a-z0-9]{2,5})$/i.exec(pathname.split('?')[0])
  return match ? match[1].toLowerCase() : ''
}

/**
 * Resolve the content type to serve. Providers occasionally answer with
 * `application/octet-stream` for known media extensions; with `nosniff` set,
 * browsers then refuse to play/render the bytes, so we restore the type from
 * the extension. Real, specific upstream types always win.
 */
export function resolveContentType(upstreamType: string | null | undefined, pathname: string): string {
  const base = (upstreamType || '').split(';')[0].trim().toLowerCase()
  if (!GENERIC_TYPES.has(base)) return base
  return EXTENSION_TYPES[extensionOf(pathname)] || base
}

export function isHlsPlaylist(contentType: string, pathname: string): boolean {
  const type = contentType.split(';')[0].trim().toLowerCase()
  return (
    type === 'application/vnd.apple.mpegurl' ||
    type === 'application/x-mpegurl' ||
    type === 'audio/mpegurl' ||
    type === 'audio/x-mpegurl' ||
    extensionOf(pathname) === 'm3u8'
  )
}

export type ProxyKind = 'image' | 'video' | 'audio' | 'manifest' | 'key' | 'unsupported'

/** Classify a resolved content type into what the proxy is willing to relay. */
export function classifyProxyResponse(contentType: string, pathname: string): ProxyKind {
  if (isHlsPlaylist(contentType, pathname)) return 'manifest'
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (extensionOf(pathname) === 'key') return 'key'
  return 'unsupported'
}

const CONDITIONAL_HEADERS = ['if-range', 'if-none-match', 'if-modified-since'] as const

/**
 * Validators the browser may send. They are forwarded verbatim (after a
 * conservative sanity check) so upstream can answer 304 / honour If-Range.
 * If-Range is only meaningful together with Range.
 */
export function conditionalHeaders(source: { get(name: string): string | null }, hasRange: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of CONDITIONAL_HEADERS) {
    if (name === 'if-range' && !hasRange) continue
    const value = source.get(name)
    // eslint-disable-next-line no-control-regex
    if (value && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) out[name] = value
  }
  return out
}

const PASSTHROUGH = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'age', 'expires']

/** Copy only the response headers that are safe and meaningful to relay. */
export function relayHeaders(upstream: { get(name: string): string | null }): Headers {
  const out = new Headers()
  for (const name of PASSTHROUGH) {
    const value = upstream.get(name)
    if (value) out.set(name, value)
  }
  return out
}

export const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
} as const

const IMAGE_SHARED = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'

export function allowsSharedImageCaching(cacheControl: string | null | undefined): boolean {
  if (!cacheControl) return true
  const normalized = cacheControl.toLowerCase()
  return !normalized.includes('no-store') && !normalized.includes('private')
}

/**
 * Cache policy: images are immutable-ish public assets and may sit in shared
 * caches; video/audio/segments/manifests/ranged or failed responses never do.
 */
export function cacheHeadersFor(input: {
  kind: ProxyKind
  ok: boolean
  hasRange: boolean
  upstreamCacheControl: string | null | undefined
}): Record<string, string> {
  if (!input.ok) return { ...NO_STORE }
  if (input.kind !== 'image' || input.hasRange) return { ...NO_STORE }
  if (!allowsSharedImageCaching(input.upstreamCacheControl)) return { ...NO_STORE }
  return {
    'Cache-Control': IMAGE_SHARED,
    'CDN-Cache-Control': IMAGE_SHARED,
    'Vercel-CDN-Cache-Control': IMAGE_SHARED,
  }
}

/** Total size (bytes) from `Content-Range: bytes a-b/total`, or null. */
export function totalFromContentRange(value: string | null): number | null {
  if (!value) return null
  const match = /\/(\d+)\s*$/.exec(value)
  if (!match) return null
  const total = Number(match[1])
  return Number.isSafeInteger(total) ? total : null
}
