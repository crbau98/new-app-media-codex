/**
 * "Lite graphics" decides whether this device gets the expensive visual layer
 * (WebGL background, blur/backdrop filters, dozens of 3D + will-change layers).
 *
 * Phone browsers (iOS Safari above all) kill a tab that holds too many
 * compositor layers or too much GPU memory; the user sees "A problem
 * repeatedly occurred". Touch-first devices therefore get the same layout and
 * colours with a static background and flat cards. Overrides, checked in order:
 *   ?lite=1 / ?lite=0 in the URL, then localStorage `media-codex-lite` = '1' | '0'.
 */
const KEY = 'media-codex-lite'

function stored(): '1' | '0' | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lite')
    if (fromUrl === '1' || fromUrl === '0') {
      try { localStorage.setItem(KEY, fromUrl) } catch { /* storage blocked */ }
      return fromUrl
    }
    const value = localStorage.getItem(KEY)
    return value === '1' || value === '0' ? value : null
  } catch {
    return null
  }
}

export function detectLiteGraphics(): boolean {
  if (typeof window === 'undefined') return false
  const override = stored()
  if (override) return override === '1'
  const nav = navigator as Navigator & { deviceMemory?: number; maxTouchPoints?: number }
  const ua = navigator.userAgent || ''
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4
  return ios || coarse || lowMemory
}

let cached: boolean | null = null

/** Memoised: the answer cannot change during a session. */
export function isLiteGraphics(): boolean {
  if (cached === null) cached = detectLiteGraphics()
  return cached
}

/** Mark <html data-lite="true|false"> so CSS can strip effects before first paint. */
export function applyLiteGraphics() {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.lite = isLiteGraphics() ? 'true' : 'false'
}
