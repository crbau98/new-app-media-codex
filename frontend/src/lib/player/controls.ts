/** Pure helpers for the custom player controls: time, keys, sprites, ambient colour. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function formatRate(rate: number): string {
  return rate === 1 ? 'Normal' : `${rate}×`
}

export type PlayerAction =
  | { type: 'toggle' }
  | { type: 'seek'; delta: number }
  | { type: 'seekPercent'; percent: number }
  | { type: 'volume'; delta: number }
  | { type: 'mute' }
  | { type: 'fullscreen' }
  | { type: 'theatre' }
  | { type: 'pip' }
  | { type: 'capture' }
  | { type: 'loop' }
  | { type: 'abLoop' }
  | { type: 'frame'; direction: 1 | -1 }
  | { type: 'rate'; delta: number }

export interface KeyLike {
  key: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/**
 * Keyboard map for the player. Returns null for keys it does not own so the
 * host (sheet navigation, follow/save) can still handle them.
 * Frame-step (`,` `.`) only applies while paused.
 */
export function resolveKeyAction(event: KeyLike, paused: boolean): PlayerAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  switch (event.key) {
    case ' ':
    case 'k':
    case 'K':
      return { type: 'toggle' }
    case 'j':
    case 'J':
      return { type: 'seek', delta: -10 }
    case 'l':
    case 'L':
      return { type: 'seek', delta: 10 }
    case 'ArrowLeft':
      return { type: 'seek', delta: -5 }
    case 'ArrowRight':
      return { type: 'seek', delta: 5 }
    case 'ArrowUp':
      return { type: 'volume', delta: 0.05 }
    case 'ArrowDown':
      return { type: 'volume', delta: -0.05 }
    case 'm':
    case 'M':
      return { type: 'mute' }
    case 'f':
    case 'F':
      return { type: 'fullscreen' }
    case 't':
    case 'T':
      return { type: 'theatre' }
    case 'p':
    case 'P':
      return { type: 'pip' }
    case 'c':
    case 'C':
      return { type: 'capture' }
    case 'o':
    case 'O':
      return { type: 'loop' }
    case 'b':
    case 'B':
      return { type: 'abLoop' }
    case ',':
      return paused ? { type: 'frame', direction: -1 } : null
    case '.':
      return paused ? { type: 'frame', direction: 1 } : null
    case '<':
      return { type: 'rate', delta: -1 }
    case '>':
      return { type: 'rate', delta: 1 }
    default:
      if (/^[0-9]$/.test(event.key)) return { type: 'seekPercent', percent: Number(event.key) * 10 }
      return null
  }
}

/** Step to the next/previous entry of PLAYBACK_RATES, saturating at the ends. */
export function stepRate(current: number, delta: number): number {
  const list = PLAYBACK_RATES as readonly number[]
  let index = list.findIndex((rate) => rate >= current)
  if (index === -1) index = list.length - 1
  return list[clamp(index + delta, 0, list.length - 1)]
}

export interface SpriteTile {
  /** Background-position in percent, for a `background-size: cols*100% rows*100%` sheet. */
  x: number
  y: number
  index: number
}

/**
 * Locate the storyboard tile for a hover time. Tiles are laid out row-major
 * and evenly spaced across the duration.
 */
export function spriteTile(time: number, duration: number, cols: number, rows: number): SpriteTile | null {
  if (!(duration > 0) || cols < 1 || rows < 1) return null
  const total = cols * rows
  const index = clamp(Math.floor((clamp(time, 0, duration) / duration) * total), 0, total - 1)
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    index,
    x: cols === 1 ? 0 : (col / (cols - 1)) * 100,
    y: rows === 1 ? 0 : (row / (rows - 1)) * 100,
  }
}

export interface BufferedRange {
  start: number
  end: number
}

/** Convert TimeRanges-like data to fractional [0..1] segments for painting. */
export function bufferedSegments(ranges: BufferedRange[], duration: number): Array<{ left: number; width: number }> {
  if (!(duration > 0)) return []
  return ranges
    .map((range) => ({
      left: clamp(range.start / duration, 0, 1),
      width: clamp((range.end - range.start) / duration, 0, 1),
    }))
    .filter((segment) => segment.width > 0)
}

/** Average an RGBA pixel buffer into an [r,g,b] triple, boosting vibrance slightly. */
export function averageRgb(data: ArrayLike<number>): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    count += 1
  }
  if (!count) return [24, 20, 32]
  r /= count
  g /= count
  b /= count
  const mean = (r + g + b) / 3
  const boost = 1.25
  const lift = (v: number) => Math.round(clamp(mean + (v - mean) * boost, 0, 255))
  return [lift(r), lift(g), lift(b)]
}

export function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
}

/** Parse #rgb/#rrggbb into rgb triple (for dominantColor fallbacks). */
export function parseHexColor(hex: string | undefined): [number, number, number] | null {
  if (!hex) return null
  const match = /^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(hex.trim())
  if (!match) return null
  const raw = match[1].length === 3 ? match[1].split('').map((c) => c + c).join('') : match[1]
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)]
}

/** Detect a double-tap: second tap within `windowMs` and `radius` px of the first. */
export function isDoubleTap(
  previous: { t: number; x: number; y: number } | null,
  next: { t: number; x: number; y: number },
  windowMs = 320,
  radius = 60,
): boolean {
  if (!previous) return false
  return next.t - previous.t <= windowMs && Math.hypot(next.x - previous.x, next.y - previous.y) <= radius
}

/** Which third of the frame a tap landed in — sides seek, centre toggles. */
export function tapZone(x: number, width: number): 'left' | 'center' | 'right' {
  if (width <= 0) return 'center'
  const ratio = x / width
  if (ratio < 0.36) return 'left'
  if (ratio > 0.64) return 'right'
  return 'center'
}
