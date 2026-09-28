/**
 * Universal URL classification for the edge (mirrors the Python
 * app/media_pipeline/classify.py contract). Pure helpers + an injectable
 * fetcher so everything is unit-testable without a network.
 */
import { assertPublicHttpUrl, isPrivateHost, safeFetch, type SafeFetchResult } from './net-safe.js'

export type Sniff = { kind: 'image' | 'video' | 'hls' | 'dash' | 'html' | 'feed' | 'json' | 'unknown'; mime?: string }

export type Candidate = {
  url: string
  kind: 'video' | 'image' | 'hls' | 'dash'
  protocol: 'progressive' | 'hls' | 'dash'
  mime?: string
  width?: number
  height?: number
  durationSeconds?: number
  origin: string
  verified?: boolean
}

export type FeedItem = { id: string; title: string; url: string; publishedAt?: string; mediaUrl?: string; thumbnail?: string; kind: 'video' | 'image' | 'link' }

export type Classification = {
  inputUrl: string
  finalUrl: string
  canonicalUrl: string
  kind: 'video' | 'image' | 'gallery' | 'page' | 'feed' | 'unsupported'
  strategy: string
  title?: string
  description?: string
  source: string
  siteName?: string
  thumbnailUrl?: string
  durationSeconds?: number
  width?: number
  height?: number
  aspect?: number
  mimeType?: string
  candidates: Candidate[]
  streamCandidates: string[]
  mediaUrl?: string
  gallery: string[]
  feedItems: FeedItem[]
  embedUrls: string[]
  protected: boolean
  playable: boolean
  warnings: string[]
}

export type Fetcher = (url: string, opts?: { rangeBytes?: number; maxBytes?: number; method?: string }) => Promise<SafeFetchResult>

const TRACKING = new Set(['fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', 'igsh', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'referrer', 'feature', 'si', 'spm', 'share', 'amp', 'twclid', 'ttclid'])
const ALIASES: Record<string, string> = { 'mobile.twitter.com': 'x.com', 'twitter.com': 'x.com', 'mobile.x.com': 'x.com', 'old.reddit.com': 'reddit.com', 'np.reddit.com': 'reddit.com', 'm.youtube.com': 'youtube.com' }

export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  let host = url.hostname.toLowerCase().replace(/\.$/, '')
  host = ALIASES[host] || host.replace(/^(?:www|m|mobile|amp)\.(?=.+\..+)/, '')
  host = ALIASES[host] || host
  let path = url.pathname.replace(/\/{2,}/g, '/')
  let pairs = [...url.searchParams.entries()].filter(([k]) => !TRACKING.has(k.toLowerCase()) && !/^(utm_|pk_|hsa_|vero_)/i.test(k))
  if (host === 'youtu.be') {
    const id = path.split('/').filter(Boolean)[0]
    if (id) { host = 'youtube.com'; path = '/watch'; pairs = [['v', id], ...pairs.filter(([k]) => k === 't')] }
  } else if (host === 'youtube.com') {
    const m = path.match(/^\/(?:shorts|embed|live)\/([^/]+)/)
    if (m) { path = '/watch'; pairs = [['v', m[1]]] } else if (path === '/watch') pairs = pairs.filter(([k]) => ['v', 'list', 't'].includes(k))
  } else if (host === 'x.com' || host === 'reddit.com') pairs = []
  else if (host === 'redgifs.com') {
    const m = path.match(/^\/(?:ifr|watch)\/([A-Za-z0-9]+)/)
    if (m) { path = `/watch/${m[1].toLowerCase()}`; pairs = [] }
  }
  pairs.sort(([a], [b]) => a.localeCompare(b))
  if (path.length > 1) path = path.replace(/\/$/, '')
  const port = url.port && !((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) ? `:${url.port}` : ''
  const query = pairs.length ? `?${new URLSearchParams(pairs).toString()}` : ''
  return `${url.protocol}//${host}${port}${path}${query}`
}

const startsWith = (b: Uint8Array, s: string, at = 0) => s.split('').every((c, i) => b[at + i] === c.charCodeAt(0))

export function sniffBytes(b: Uint8Array): Sniff {
  if (b.length < 4) return { kind: 'unknown' }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' }
  if (b[0] === 0x89 && startsWith(b, 'PNG', 1)) return { kind: 'image', mime: 'image/png' }
  if (startsWith(b, 'GIF8')) return { kind: 'image', mime: 'image/gif' }
  if (startsWith(b, 'RIFF') && b.length >= 12) {
    if (startsWith(b, 'WEBP', 8)) return { kind: 'image', mime: 'image/webp' }
    if (startsWith(b, 'AVI ', 8)) return { kind: 'video', mime: 'video/x-msvideo' }
  }
  if (b.length >= 12 && startsWith(b, 'ftyp', 4)) {
    const brand = String.fromCharCode(...b.subarray(8, 12))
    const head = String.fromCharCode(...b.subarray(8, Math.min(b.length, 64)))
    if (/avif|avis/.test(head)) return { kind: 'image', mime: 'image/avif' }
    if (/^(heic|heix|hevc|mif1|msf1)/.test(brand) && !/isom|mp41|mp42/.test(head)) return { kind: 'image', mime: 'image/heic' }
    return { kind: 'video', mime: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' }
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    const text = String.fromCharCode(...b.subarray(0, Math.min(b.length, 64))).toLowerCase()
    return { kind: 'video', mime: text.includes('webm') ? 'video/webm' : 'video/x-matroska' }
  }
  if (startsWith(b, 'FLV')) return { kind: 'video', mime: 'video/x-flv' }
  if (startsWith(b, 'OggS')) return { kind: 'video', mime: 'video/ogg' }
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).replace(/^\uFEFF/, '').trimStart().toLowerCase()
  if (text.startsWith('#extm3u')) return { kind: 'hls', mime: 'application/vnd.apple.mpegurl' }
  if (text.includes('<mpd')) return { kind: 'dash', mime: 'application/dash+xml' }
  if (/^<!doctype html|^<html|^<head|<html[\s>]/.test(text)) return { kind: 'html', mime: 'text/html' }
  if (/^<\?xml|^<rss|^<feed/.test(text) && /<rss|<feed|<channel/.test(text)) return { kind: 'feed', mime: 'application/xml' }
  if (text.startsWith('{') || text.startsWith('[')) return { kind: 'json', mime: 'application/json' }
  return { kind: 'unknown' }
}

/* ── HTML ─────────────────────────────────────────────── */

function decodeEntities(v: string): string {
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return out
}

function abs(base: string, v?: string): string | undefined {
  if (!v || /^(data|blob|javascript):/i.test(v.trim())) return undefined
  try {
    const u = new URL(v.trim(), base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined
  } catch { return undefined }
}

export function parseIsoDuration(v?: string): number | undefined {
  const m = v?.trim().toUpperCase().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/)
  if (!m || !m.slice(1).some(Boolean)) return undefined
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0)
}

const kindFor = (url: string, mime?: string): Candidate['kind'] => {
  const p = url.toLowerCase().split('?')[0]
  if (p.endsWith('.m3u8') || /mpegurl/i.test(mime || '')) return 'hls'
  if (p.endsWith('.mpd') || /dash\+xml/i.test(mime || '')) return 'dash'
  if (/^image\//i.test(mime || '') || /\.(jpe?g|png|gif|webp|avif)$/.test(p)) return 'image'
  return 'video'
}

const mk = (url: string, origin: string, mime?: string, extra: Partial<Candidate> = {}): Candidate => {
  const kind = kindFor(url, mime)
  return { url, kind, protocol: kind === 'hls' ? 'hls' : kind === 'dash' ? 'dash' : 'progressive', mime, origin, ...extra }
}

export type HtmlMeta = { title?: string; description?: string; siteName?: string; canonical?: string; durationSeconds?: number; candidates: Candidate[]; embedUrls: string[]; oembedUrls: string[] }

export function extractHtml(html: string, pageUrl: string): HtmlMeta {
  const head = html.slice(0, 600_000)
  const metas: Array<Record<string, string>> = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0]))
  const prop = (...names: string[]) => metas.filter((m) => names.includes((m.property || m.name || '').toLowerCase()) && m.content).map((m) => m.content)
  const first = (...names: string[]) => prop(...names)[0]
  const baseTag = head.match(/<base\b[^>]*>/i)
  const base = (baseTag && abs(pageUrl, attrs(baseTag[0]).href)) || pageUrl
  const out: HtmlMeta = { candidates: [], embedUrls: [], oembedUrls: [] }
  out.title = first('og:title', 'twitter:title') || decodeEntities(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '') || undefined
  out.description = first('og:description', 'twitter:description', 'description')
  out.siteName = first('og:site_name')
  const canonicalTag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0])).find((a) => (a.rel || '').toLowerCase().split(/\s+/).includes('canonical'))
  out.canonical = abs(base, canonicalTag?.href) || abs(base, first('og:url'))
  const dur = Number(first('video:duration', 'og:video:duration'))
  if (Number.isFinite(dur) && dur > 0) out.durationSeconds = dur
  const ogType = first('og:video:type')
  const w = Number(first('og:video:width')) || undefined
  const h = Number(first('og:video:height')) || undefined
  prop('og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream').forEach((raw, index) => {
    const url = abs(base, raw)
    if (!url) return
    const path = url.toLowerCase().split('?')[0]
    const media = /\.(mp4|webm|m4v|mov|m3u8|mpd)$/.test(path) || (/^video\//i.test(ogType || '') && index === 0 && !path.includes('/embed'))
    if (media) out.candidates.push(mk(url, 'og:video', ogType, { width: w, height: h, durationSeconds: out.durationSeconds }))
    else out.embedUrls.push(url)
  })
  prop('twitter:player').forEach((raw) => { const u = abs(base, raw); if (u && !out.candidates.length) out.embedUrls.push(u) })
  prop('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src').forEach((raw) => {
    const u = abs(base, raw)
    if (u) out.candidates.push({ ...mk(u, 'og:image', undefined, { width: Number(first('og:image:width')) || undefined, height: Number(first('og:image:height')) || undefined }), kind: 'image', protocol: 'progressive' })
  })
  for (const m of head.matchAll(/<script\b[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try { data = JSON.parse(m[1]) } catch { continue }
    const nodes: Record<string, unknown>[] = []
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk)
      else if (n && typeof n === 'object') {
        nodes.push(n as Record<string, unknown>)
        for (const k of ['@graph', 'mainEntity', 'video', 'image', 'hasPart']) if ((n as Record<string, unknown>)[k]) walk((n as Record<string, unknown>)[k])
      }
    }
    walk(data)
    for (const n of nodes) {
      const types = ([] as unknown[]).concat(n['@type'] ?? []).map(String)
      const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : Array.isArray(v) ? str(v[0]) : v && typeof v === 'object' ? str((v as Record<string, unknown>).url ?? (v as Record<string, unknown>).contentUrl) : undefined)
      if (types.includes('VideoObject')) {
        const d = parseIsoDuration(str(n.duration))
        out.durationSeconds = out.durationSeconds || d
        out.title = out.title || str(n.name)
        const cu = abs(base, str(n.contentUrl))
        if (cu) out.candidates.push(mk(cu, 'jsonld:VideoObject', str(n.encodingFormat), { width: Number(n.width) || undefined, height: Number(n.height) || undefined, durationSeconds: d }))
        const eu = abs(base, str(n.embedUrl)); if (eu) out.embedUrls.push(eu)
        const tu = abs(base, str(n.thumbnailUrl)); if (tu) out.candidates.push({ ...mk(tu, 'jsonld:thumbnail'), kind: 'image', protocol: 'progressive' })
      } else if (types.includes('ImageObject')) {
        const cu = abs(base, str(n.contentUrl ?? n.url))
        if (cu) out.candidates.push({ ...mk(cu, 'jsonld:ImageObject', undefined, { width: Number(n.width) || undefined, height: Number(n.height) || undefined }), kind: 'image', protocol: 'progressive' })
      }
    }
  }
  for (const v of head.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)) {
    const va = attrs(v[0].slice(0, v[0].indexOf('>') + 1))
    const poster = abs(base, va.poster); if (poster) out.candidates.push({ ...mk(poster, 'video:poster'), kind: 'image', protocol: 'progressive' })
    const srcs = [[va.src, va.type], ...[...v[1].matchAll(/<source\b[^>]*>/gi)].map((s) => { const a = attrs(s[0]); return [a.src, a.type] })]
    for (const [src, type] of srcs) { const u = abs(base, src); if (u) out.candidates.push(mk(u, 'video:source', type, { width: Number(va.width) || undefined, height: Number(va.height) || undefined })) }
  }
  for (const l of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(l[0])
    if (!(a.rel || '').toLowerCase().includes('alternate')) continue
    const href = abs(base, a.href)
    if (href && /oembed/i.test(a.type || '')) out.oembedUrls.push(href)
  }
  const seen = new Set<string>()
  out.candidates = out.candidates.filter((c) => (seen.has(`${c.kind}|${c.url}`) ? false : (seen.add(`${c.kind}|${c.url}`), true)))
  return out
}

/* ── manifests / feeds ────────────────────────────────── */

export function parseHls(text: string, base: string): { protected: boolean; live: boolean; durationSeconds?: number; bestHeight?: number; bestWidth?: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  let drm = false, total = 0, end = false, segs = false
  const heights: Array<[number, number]> = []
  for (const l of lines) {
    if (/^#EXT-X-(SESSION-)?KEY/.test(l)) {
      const method = l.match(/METHOD=([A-Z0-9-]+)/)?.[1]
      const fmt = (l.match(/KEYFORMAT="([^"]+)"/)?.[1] || 'identity').toLowerCase()
      if (fmt !== 'identity' && (method === 'SAMPLE-AES' || /streamingkeydelivery|playready|widevine|edef8ba9/.test(fmt))) drm = true
    } else if (l.startsWith('#EXTINF')) { segs = true; total += parseFloat(l.split(':')[1]) || 0 }
    else if (l.startsWith('#EXT-X-ENDLIST')) end = true
    else if (l.startsWith('#EXT-X-STREAM-INF')) {
      const r = l.match(/RESOLUTION=(\d+)x(\d+)/)
      if (r && Number(r[2]) <= 1080) heights.push([Number(r[1]), Number(r[2])])
    }
  }
  void base
  heights.sort((a, b) => b[1] - a[1])
  return { protected: drm, live: segs && !end, durationSeconds: segs && end ? total : undefined, bestWidth: heights[0]?.[0], bestHeight: heights[0]?.[1] }
}

export function parseDash(text: string): { protected: boolean; durationSeconds?: number; bestHeight?: number; bestWidth?: number } {
  if (/<!ENTITY/i.test(text)) return { protected: false }
  const drm = /ContentProtection[^>]*schemeIdUri="[^"]*(urn:uuid:|widevine|playready|fairplay)/i.test(text)
  const dur = parseIsoDuration(text.match(/mediaPresentationDuration="([^"]+)"/)?.[1])
  let best: [number, number] | undefined
  for (const m of text.matchAll(/<Representation\b[^>]*>/gi)) {
    const a = attrs(m[0]); const h = Number(a.height); const w = Number(a.width)
    if (h && h <= 1080 && (!best || h > best[1])) best = [w, h]
  }
  return { protected: drm, durationSeconds: dur, bestWidth: best?.[0], bestHeight: best?.[1] }
}

const feedKind = (url?: string, mime?: string): FeedItem['kind'] => {
  const v = `${mime || ''} ${(url || '').split('?')[0]}`.toLowerCase()
  if (/video|\.(mp4|webm|mov|m3u8|m4v)\b/.test(v)) return 'video'
  if (/image|\.(jpe?g|png|webp|gif|avif)\b/.test(v)) return 'image'
  return 'link'
}

export function parseFeed(text: string, feedUrl: string): { title: string; items: FeedItem[] } {
  const t = text.trim()
  if (t.startsWith('{')) {
    const d = JSON.parse(t) as { title?: string; items?: Array<{ id?: string; url?: string; external_url?: string; title?: string; image?: string; date_published?: string; attachments?: Array<{ url?: string; title?: string; mime_type?: string }> }> }
    return {
      title: d.title || 'JSON Feed',
      items: (d.items || []).slice(0, 60).map((i, n) => {
        const att = (i.attachments || []).find((a) => a.url)
        const media = att?.url || i.image
        const url = i.url || i.external_url || feedUrl
        return { id: String(i.id || `${url}#${n}`), title: i.title || att?.title || 'Feed item', url, publishedAt: i.date_published, mediaUrl: media, thumbnail: i.image, kind: feedKind(media, att?.mime_type) }
      }),
    }
  }
  if (/<!ENTITY/i.test(t)) throw new Error('feed_invalid')
  const pick = (block: string, re: RegExp) => decodeEntities(block.match(re)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '')
  const blocks = [...t.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi)].map((m) => m[0]).slice(0, 60)
  return {
    title: pick(t, /<title[^>]*>([\s\S]*?)<\/title>/i) || 'Feed',
    items: blocks.map((b, n) => {
      const url = abs(feedUrl, pick(b, /<link[^>]+href=["']([^"']+)["']/i) || pick(b, /<link[^>]*>([\s\S]*?)<\/link>/i) || pick(b, /<guid[^>]*>([\s\S]*?)<\/guid>/i)) || feedUrl
      const media = pick(b, /<media:content[^>]+url=["']([^"']+)["']/i) || pick(b, /<enclosure[^>]+url=["']([^"']+)["']/i)
      const mime = pick(b, /<enclosure[^>]+type=["']([^"']+)["']/i) || pick(b, /<media:content[^>]+type=["']([^"']+)["']/i)
      return { id: `${url}#${n}`, title: pick(b, /<title[^>]*>([\s\S]*?)<\/title>/i) || `Feed item ${n + 1}`, url, publishedAt: pick(b, /<(?:pubdate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubdate|published|updated)>/i) || undefined, mediaUrl: abs(feedUrl, media), thumbnail: abs(feedUrl, pick(b, /<media:thumbnail[^>]+url=["']([^"']+)["']/i)), kind: feedKind(media, mime) }
    }),
  }
}

export function scoreCandidate(c: Candidate): number {
  if (c.kind === 'image') return Math.min(((c.width || 0) * (c.height || 0)) / 10_000, 500) + (c.verified ? 50 : 0)
  let s = { video: 1000, hls: 700, dash: 300 }[c.kind]
  if (c.kind === 'video') {
    const p = c.url.toLowerCase().split('?')[0]
    if (/mp4|quicktime/.test(c.mime || '') || /\.(mp4|m4v|mov)$/.test(p)) s += 120
    else if (/webm/.test(c.mime || '')) s += 60
    else if (/matroska/.test(c.mime || '') || /\.(mkv|avi|flv)$/.test(p)) s -= 250
  }
  if (c.height) s += c.height <= 1080 ? c.height / 10 : -150 - (c.height - 1080) / 10
  if (c.verified) s += 80
  return s
}

const rank = (list: Candidate[]): Candidate[] => {
  const scored = list.map((c) => ({ c, s: scoreCandidate(c) }))
  const vids = scored.filter((x) => x.c.kind !== 'image').sort((a, b) => b.s - a.s)
  const imgs = scored.filter((x) => x.c.kind === 'image').sort((a, b) => b.s - a.s)
  return [...vids, ...imgs].map((x) => x.c)
}

const empty = (input: string, finalUrl: string, canonicalUrl: string): Classification => ({
  inputUrl: input, finalUrl, canonicalUrl, kind: 'unsupported', strategy: 'none', source: new URL(finalUrl).hostname.replace(/^www\./, ''),
  candidates: [], streamCandidates: [], gallery: [], feedItems: [], embedUrls: [], protected: false, playable: false, warnings: [],
})

export class ClassifyError extends Error {
  code: string
  status?: number
  constructor(code: string, message?: string, status?: number) {
    super(message || code)
    this.code = code
    this.status = status
  }
}

const text = (b: Uint8Array) => new TextDecoder().decode(b)

export async function probeCandidate(fetcher: Fetcher, c: Candidate): Promise<Candidate | null> {
  try {
    const r = await fetcher(c.url, { rangeBytes: 64 * 1024, maxBytes: 64 * 1024 })
    if (!(r.status >= 200 && r.status < 300)) return null
    const sn = sniffBytes(r.body)
    if (c.kind === 'image') return sn.kind === 'image' ? { ...c, mime: sn.mime, verified: true } : null
    if (sn.kind === 'hls' || sn.kind === 'dash') return { ...c, kind: sn.kind, protocol: sn.kind, verified: true }
    return sn.kind === 'video' ? { ...c, mime: sn.mime, verified: true } : null
  } catch { return null }
}

export async function classifyUrl(rawUrl: string, fetcher: Fetcher = (u, o) => safeFetch(u, o)): Promise<Classification> {
  let start: URL
  try { start = assertPublicHttpUrl(rawUrl) } catch (e) { throw new ClassifyError((e as Error).message) }
  const canonical = canonicalizeUrl(start.toString())
  let head: SafeFetchResult
  try {
    head = await fetcher(start.toString(), { rangeBytes: 512 * 1024, maxBytes: 512 * 1024 })
    if ([400, 405, 416, 501].includes(head.status)) head = await fetcher(start.toString(), { maxBytes: 512 * 1024 })
  } catch (e) { throw new ClassifyError((e as Error).message || 'connect_failed') }
  if (head.status === 401 || head.status === 402) throw new ClassifyError('auth_required', 'This URL requires authentication.', head.status)
  if (head.status === 404 || head.status === 410) throw new ClassifyError('not_found', 'The URL returned 404.', head.status)
  if (head.status >= 400) throw new ClassifyError('http_error', `HTTP ${head.status}`, head.status)
  const out = empty(rawUrl.trim(), head.url, canonicalizeUrl(head.url) || canonical)
  const sn = sniffBytes(head.body)
  const contentType = (head.headers.get('content-type') || '').split(';')[0].toLowerCase()
  void contentType

  if (sn.kind === 'image' || sn.kind === 'video') {
    out.strategy = 'direct'
    out.mimeType = sn.mime
    out.candidates.push({ ...mk(head.url, 'direct', sn.mime), kind: sn.kind, verified: true })
    if (sn.kind === 'image') out.thumbnailUrl = head.url
    if (sn.mime === 'video/x-matroska' || sn.mime === 'video/x-msvideo') out.warnings.push('needs_transcode_for_browser')
  } else if (sn.kind === 'hls' || sn.kind === 'dash') {
    out.strategy = 'manifest'
    const body = text(head.body)
    const info = sn.kind === 'hls' ? parseHls(body, head.url) : parseDash(body)
    if (info.protected) { out.protected = true; out.warnings.push('drm_protected') } else {
      out.durationSeconds = info.durationSeconds
      out.width = 'bestWidth' in info ? info.bestWidth : undefined
      out.height = info.bestHeight
      out.candidates.push({ ...mk(head.url, 'manifest', sn.mime), kind: sn.kind, protocol: sn.kind, height: info.bestHeight, width: out.width, durationSeconds: info.durationSeconds, verified: true })
    }
  } else if (sn.kind === 'html') {
    out.strategy = 'html'
    const meta = extractHtml(text(head.body), head.url)
    out.title = meta.title; out.description = meta.description; out.siteName = meta.siteName; out.durationSeconds = meta.durationSeconds
    out.embedUrls = [...new Set(meta.embedUrls)]
    if (meta.canonical) { try { assertPublicHttpUrl(meta.canonical); out.canonicalUrl = canonicalizeUrl(meta.canonical) } catch { /* keep */ } }
    let cands = meta.candidates.filter((c) => { try { return !isPrivateHost(new URL(c.url).hostname) } catch { return false } })
    if (!cands.some((c) => c.kind !== 'image') && meta.oembedUrls[0]) {
      try {
        const r = await fetcher(meta.oembedUrls[0], { maxBytes: 128 * 1024 })
        const d = JSON.parse(text(r.body)) as { title?: string; provider_name?: string; thumbnail_url?: unknown; html?: unknown }
        out.title = out.title || d.title
        out.siteName = out.siteName || d.provider_name
        if (typeof d.thumbnail_url === 'string') cands.push({ ...mk(d.thumbnail_url, 'oembed:thumbnail'), kind: 'image', protocol: 'progressive' })
        const src = typeof d.html === 'string' ? d.html.match(/src=["']([^"']+)["']/)?.[1] : undefined
        if (src) out.embedUrls.push(src)
      } catch { out.warnings.push('oembed_failed') }
    }
    const probes = await Promise.all([...cands.filter((c) => c.kind !== 'image').slice(0, 4), ...cands.filter((c) => c.kind === 'image').slice(0, 3)].map((c) => probeCandidate(fetcher, c)))
    cands = probes.filter((c): c is Candidate => Boolean(c))
    out.candidates = cands
    if (!cands.length && !out.embedUrls.length) out.warnings.push('no_media_found')
  } else if (sn.kind === 'feed' || sn.kind === 'json') {
    try {
      const feed = parseFeed(text(head.body), head.url)
      out.strategy = 'feed'; out.title = feed.title; out.feedItems = feed.items; out.kind = 'feed'
      out.playable = feed.items.some((i) => i.mediaUrl && i.kind !== 'link')
      return out
    } catch { out.warnings.push('feed_parse_failed') }
  } else out.warnings.push('unrecognized_content')

  out.candidates = rank(out.candidates.filter((c, i, l) => l.findIndex((x) => x.url === c.url) === i))
  const video = out.candidates.find((c) => c.kind !== 'image')
  const images = out.candidates.filter((c) => c.kind === 'image')
  out.streamCandidates = out.candidates.filter((c) => c.kind === 'video' || c.kind === 'hls').map((c) => c.url)
  out.mediaUrl = (video || images[0])?.url
  if (out.protected) { out.candidates = []; out.streamCandidates = []; out.mediaUrl = undefined }
  else if (video) {
    out.kind = 'video'; out.playable = true
    out.width = out.width || video.width; out.height = out.height || video.height
    out.mimeType = out.mimeType || video.mime
    out.durationSeconds = out.durationSeconds || video.durationSeconds
    out.thumbnailUrl = out.thumbnailUrl || images[0]?.url
  } else if (images.length) {
    out.kind = images.length > 1 && out.strategy === 'direct' ? 'gallery' : 'image'; out.playable = true
    out.width = images[0].width; out.height = images[0].height; out.thumbnailUrl = images[0].url; out.mimeType = images[0].mime
  } else if (out.strategy === 'html') out.kind = 'page'
  if (out.width && out.height) out.aspect = Math.round((out.width / out.height) * 10_000) / 10_000
  return out
}
