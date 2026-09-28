import { orderPlaybackCandidates } from '../playback.ts'

export type QualityPref = 'auto' | '720p' | '1080p'

export interface PlaybackSource {
  url: string
  kind: 'hls' | 'file'
  /** Human label for the quality menu ("1080p", "HD", "Source 2"). */
  label: string
  /** Vertical resolution when it can be inferred from the URL. */
  height?: number
  mime?: string
}

export function isHlsUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://media-codex.local')
    if (/\.m3u8$/i.test(parsed.pathname)) return true
    // Proxied manifests carry the real target in ?url=
    const inner = parsed.searchParams.get('url')
    return Boolean(inner && /\.m3u8(?:$|\?)/i.test(inner))
  } catch {
    return false
  }
}

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  m3u8: 'application/vnd.apple.mpegurl',
}

/** Best-effort MIME from the (possibly proxied) URL extension. */
export function mimeFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, 'https://media-codex.local')
    const target = parsed.searchParams.get('url')
    const path = target ? new URL(target).pathname : parsed.pathname
    const ext = /\.([a-z0-9]{2,4})$/i.exec(path)?.[1]?.toLowerCase()
    return ext ? EXT_MIME[ext] : undefined
  } catch {
    return undefined
  }
}

/** Vertical resolution guessed from filename tokens; undefined when unknowable. */
export function heightFromUrl(url: string): number | undefined {
  let haystack = url
  try {
    const parsed = new URL(url, 'https://media-codex.local')
    haystack = decodeURIComponent(parsed.searchParams.get('url') || parsed.pathname)
  } catch {
    // keep raw
  }
  const lower = haystack.toLowerCase()
  const explicit = /(?:^|[^0-9])(2160|1440|1080|720|540|480|360|240)p?(?:[^0-9]|$)/.exec(lower)
  if (explicit) return Number(explicit[1])
  if (/(?:^|[^a-z])4k(?:[^a-z]|$)/.test(lower)) return 2160
  if (/(?:^|[^a-z])hd(?:[^a-z]|$)/.test(lower)) return 1080
  if (/(?:^|[^a-z])(?:sd|mobile)(?:[^a-z]|$)/.test(lower)) return 480
  return undefined
}

export function labelForHeight(height: number | undefined, url: string, index: number): string {
  if (height) {
    const lower = url.toLowerCase()
    // Token-only matches read better as HD/SD than as an invented resolution.
    if (!/(?:2160|1440|1080|720|540|480|360|240)/.test(lower) && !/4k/.test(lower)) {
      return height >= 1080 ? 'HD' : 'SD'
    }
    return height >= 2160 ? '4K' : `${height}p`
  }
  return `Source ${index + 1}`
}

export interface CanPlayProbe {
  canPlayType(type: string): string
}

/** Whether the device claims to decode a MIME (+ optional codec string). */
export function deviceCanPlay(probe: CanPlayProbe | null | undefined, mime?: string, codec?: string): boolean {
  if (!probe || !mime) return true
  if (mime === 'application/vnd.apple.mpegurl') return true // handled by native HLS or hls.js
  const type = codec ? `${mime}; codecs="${codec}"` : mime
  return probe.canPlayType(type) !== ''
}

export interface BuildSourcesInput {
  /** Item's mediaUrl. */
  mediaUrl?: string
  streamCandidates?: string[]
  hlsUrl?: string
  mimeType?: string
  codec?: string
  quality: QualityPref
  preferMobile: boolean
  /** Resolves a possibly-relative URL to one the browser can fetch. */
  resolve: (url: string) => string
  probe?: CanPlayProbe | null
}

/**
 * Turn an item into an ordered, de-duplicated, decodable source chain.
 * HLS leads (adaptive) when supplied; file candidates follow in the existing
 * proxy-first / quality-aware order. Candidates the device cannot decode are
 * skipped, but if that would leave nothing we keep the original chain so the
 * error UI reports the real failure instead of an empty player.
 */
export function buildSources(input: BuildSourcesInput): PlaybackSource[] {
  const supplied = input.streamCandidates?.length ? input.streamCandidates : input.mediaUrl ? [input.mediaUrl] : []
  const files = supplied
    .map(input.resolve)
    .filter((url): url is string => Boolean(url))
    .filter((url, position, list) => list.indexOf(url) === position)

  const hls = input.hlsUrl ? input.resolve(input.hlsUrl) : ''
  const all = [...(hls ? [hls] : []), ...files.filter((url) => url !== hls)]
  const manifests = all.filter(isHlsUrl)
  const plain = orderPlaybackCandidates(all.filter((url) => !isHlsUrl(url)), input.quality, input.preferMobile)

  const decodable = plain.filter((url) => deviceCanPlay(input.probe, input.mimeType && plain.length === 1 ? input.mimeType : mimeFromUrl(url), plain.length === 1 ? input.codec : undefined))
  const usablePlain = decodable.length ? decodable : plain

  const toSource = (url: string, index: number): PlaybackSource => {
    const height = heightFromUrl(url)
    return {
      url,
      kind: isHlsUrl(url) ? 'hls' : 'file',
      height,
      mime: isHlsUrl(url) ? 'application/vnd.apple.mpegurl' : mimeFromUrl(url),
      label: isHlsUrl(url) ? 'Adaptive' : labelForHeight(height, url, index),
    }
  }
  return [...manifests, ...usablePlain].map(toSource)
}

/**
 * Extract the numeric screenshot id from legacy archived-media identifiers:
 * plain numeric strings or `shot-123` / `screenshot-123`. Returns null for
 * modern public-source ids such as `rg-...` or `x-...`, which exhaust their
 * provider candidates and then fall back to the source page instead of
 * hitting the archived-media resolve-stream endpoint.
 */
export function legacyScreenshotId(id: string): string | null {
  const value = id.trim()
  if (/^\d+$/.test(value)) return value
  return value.match(/^(?:shot|screenshot)-(\d+)$/)?.[1] || null
}

/** Distinct, user-facing quality entries for file sources (keeps first of each label). */
export function fileQualityOptions(sources: PlaybackSource[]): Array<{ url: string; label: string }> {
  const seen = new Set<string>()
  const out: Array<{ url: string; label: string }> = []
  for (const source of sources) {
    if (source.kind !== 'file' || seen.has(source.label)) continue
    seen.add(source.label)
    out.push({ url: source.url, label: source.label })
  }
  return out
}

/** Move a chosen URL to the front, keeping the rest of the chain as fallbacks. */
export function preferSource(sources: PlaybackSource[], url: string): PlaybackSource[] {
  const chosen = sources.find((source) => source.url === url)
  if (!chosen) return sources
  return [chosen, ...sources.filter((source) => source !== chosen)]
}
