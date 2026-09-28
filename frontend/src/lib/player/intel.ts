/**
 * Defensive reader for the "media-intelligence contract": optional fields the
 * ingestion pipeline may attach to a MediaItem. Everything is parsed from an
 * untyped record so the player works whether or not (and however precisely)
 * the shared type declares them. No aliases / JSX: unit-testable in Node.
 */

export interface SpriteGrid {
  cols: number
  rows: number
  /** Width/height of one tile in the sprite sheet, when known. */
  tileWidth?: number
  tileHeight?: number
}

export interface GalleryFrame {
  url: string
  width?: number
  height?: number
  lqip?: string
  dominantColor?: string
}

export interface MediaIntel {
  width?: number
  height?: number
  aspect?: number
  durationSeconds?: number
  dominantColor?: string
  lqip?: string
  hlsUrl?: string
  posterUrl?: string
  spriteUrl?: string
  spriteGrid?: SpriteGrid
  gallery: GalleryFrame[]
  mimeType?: string
  codec?: string
  hasAudio?: boolean
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function parseSpriteGrid(value: unknown): SpriteGrid | undefined {
  if (!value) return undefined
  if (typeof value === 'string') {
    const match = /^(\d+)\s*[x×,]\s*(\d+)$/i.exec(value.trim())
    if (!match) return undefined
    const cols = Number(match[1])
    const rows = Number(match[2])
    return cols > 0 && rows > 0 ? { cols, rows } : undefined
  }
  if (Array.isArray(value) && value.length >= 2) {
    const cols = num(value[0])
    const rows = num(value[1])
    return cols && rows ? { cols, rows, tileWidth: num(value[2]), tileHeight: num(value[3]) } : undefined
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const cols = num(record.cols ?? record.columns ?? record.x)
    const rows = num(record.rows ?? record.y)
    if (!cols || !rows) return undefined
    return {
      cols: Math.floor(cols),
      rows: Math.floor(rows),
      tileWidth: num(record.tileWidth ?? record.tile_width ?? record.w ?? record.width),
      tileHeight: num(record.tileHeight ?? record.tile_height ?? record.h ?? record.height),
    }
  }
  return undefined
}

export function parseGallery(value: unknown): GalleryFrame[] {
  if (!Array.isArray(value)) return []
  const frames: GalleryFrame[] = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      const url = str(entry)
      if (url) frames.push({ url })
      continue
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      const url = str(record.url ?? record.src ?? record.mediaUrl)
      if (!url) continue
      frames.push({
        url,
        width: num(record.width),
        height: num(record.height),
        lqip: str(record.lqip),
        dominantColor: str(record.dominantColor),
      })
    }
  }
  return frames
}

export function readMediaIntel(item: unknown): MediaIntel {
  const record = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
  const width = num(record.width)
  const height = num(record.height)
  const aspect = num(record.aspect) ?? (width && height ? width / height : undefined)
  return {
    width,
    height,
    aspect,
    durationSeconds: num(record.durationSeconds),
    dominantColor: str(record.dominantColor),
    lqip: str(record.lqip),
    hlsUrl: str(record.hlsUrl),
    posterUrl: str(record.posterUrl),
    spriteUrl: str(record.spriteUrl),
    spriteGrid: parseSpriteGrid(record.spriteGrid),
    gallery: parseGallery(record.gallery),
    mimeType: str(record.mimeType),
    codec: str(record.codec),
    hasAudio: typeof record.hasAudio === 'boolean' ? record.hasAudio : undefined,
  }
}

/** Accept only colors that are safe to inline in a style attribute. */
export function safeColor(value: string | undefined): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v
  if (/^(?:rgb|hsl)a?\([\d\s.,%/-]+\)$/i.test(v)) return v
  return undefined
}

/** Accept only inline-safe image URLs for LQIP (data: images, https:, relative). */
export function safeImageSrc(value: string | undefined): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^data:image\/(?:png|jpe?g|webp|avif|gif);base64,[a-z0-9+/=]+$/i.test(v)) return v
  if (/^https:\/\//i.test(v) || v.startsWith('/')) return v
  return undefined
}
