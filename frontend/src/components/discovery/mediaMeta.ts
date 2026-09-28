import type { MediaItem } from '@/lib/types'

/**
 * Optional media-contract fields (owned by the data stream). They may be
 * absent on any item, so every read here is defensive and typed loosely.
 */
interface ContractFields {
  width?: number
  height?: number
  aspect?: number | string
  dominantColor?: string
  lqip?: string
  previewUrl?: string
  durationSeconds?: number
  gallery?: unknown[]
}

export interface MediaMeta {
  /** width / height, clamped to a layout-safe range. */
  aspect: number
  hasRealAspect: boolean
  dominantColor?: string
  lqip?: string
  previewUrl?: string
  durationSeconds?: number
  galleryCount: number
  quality?: '4K' | 'HD'
}

const MIN_ASPECT = 0.55
const MAX_ASPECT = 2.2
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/-]+\))$/i

function parseAspect(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string') {
    const parts = value.split(/[/:]/).map(Number)
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1]
    const single = Number(value)
    if (Number.isFinite(single) && single > 0) return single
  }
  return null
}

export function fallbackAspect(item: Pick<MediaItem, 'isVideo'>): number {
  return item.isVideo ? 16 / 9 : 2 / 3
}

export function clampAspect(value: number): number {
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, value))
}

export function readMediaMeta(item: MediaItem): MediaMeta {
  const raw = item as MediaItem & ContractFields
  let aspect = parseAspect(raw.aspect)
  if (aspect === null && raw.width && raw.height && raw.width > 0 && raw.height > 0) aspect = raw.width / raw.height
  const short = raw.width && raw.height ? Math.min(raw.width, raw.height) : 0
  const color = typeof raw.dominantColor === 'string' && COLOR_RE.test(raw.dominantColor.trim()) ? raw.dominantColor.trim() : undefined
  const lqip = typeof raw.lqip === 'string' && /^(data:image\/|https?:\/\/|\/)/.test(raw.lqip) ? raw.lqip : undefined
  const preview = typeof raw.previewUrl === 'string' && raw.previewUrl ? raw.previewUrl : undefined
  return {
    aspect: clampAspect(aspect ?? fallbackAspect(item)),
    hasRealAspect: aspect !== null,
    dominantColor: color,
    lqip,
    previewUrl: preview,
    durationSeconds: typeof raw.durationSeconds === 'number' ? raw.durationSeconds : undefined,
    galleryCount: Array.isArray(raw.gallery) ? raw.gallery.length : 0,
    quality: item.isVideo && short >= 2160 ? '4K' : item.isVideo && short >= 1080 ? 'HD' : undefined,
  }
}

/** Stable 0-359 hue derived from a string, for deterministic placeholders. */
export function hueFor(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  return hash % 360
}

/** First playable candidate for the hover preview (never the poster). */
export function previewSource(item: MediaItem): string | null {
  if (!item.isVideo) return null
  const meta = readMediaMeta(item)
  return meta.previewUrl ?? item.streamCandidates?.[0] ?? null
}

/** New flag, or created within 6 hours. */
export function isFresh(item: MediaItem): boolean {
  if (item.isNew) return true
  const stamp = Date.parse(item.createdAt)
  return Number.isFinite(stamp) && Date.now() - stamp < 6 * 3600_000
}
