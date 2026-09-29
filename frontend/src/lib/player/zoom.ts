/** Pure pinch/pan/inertia math for the photo viewer. */

export interface ViewState {
  scale: number
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 6
export const DOUBLE_TAP_SCALE = 2.5

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Pan limits: at scale s the (already fitted) content overflows the viewport
 * by (s-1)*size, so translation may reach half of that either way.
 */
export function panLimits(scale: number, viewport: Size, content: Size = viewport): { x: number; y: number } {
  return {
    x: Math.max(0, (content.width * scale - viewport.width) / 2),
    y: Math.max(0, (content.height * scale - viewport.height) / 2),
  }
}

export function clampView(view: ViewState, viewport: Size, allowOvershoot = 0, content: Size = viewport): ViewState {
  const scale = clamp(view.scale, MIN_SCALE * (1 - allowOvershoot), MAX_SCALE * (1 + allowOvershoot))
  const limits = panLimits(Math.max(scale, 1), viewport, content)
  return {
    scale,
    x: clamp(view.x, -limits.x, limits.x),
    y: clamp(view.y, -limits.y, limits.y),
  }
}

/**
 * Zoom keeping the content point under `focal` (viewport-centre-relative px)
 * stationary. Transform model: translate(x,y) scale(s) about the centre.
 */
export function zoomAt(view: ViewState, nextScale: number, focal: { x: number; y: number }, viewport: Size, content: Size = viewport): ViewState {
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE)
  const ratio = scale / view.scale
  return clampView(
    {
      scale,
      x: focal.x - (focal.x - view.x) * ratio,
      y: focal.y - (focal.y - view.y) * ratio,
    },
    viewport,
    0,
    content,
  )
}

/** Double-tap toggles between fit and DOUBLE_TAP_SCALE at the tapped point. */
export function toggleZoom(view: ViewState, focal: { x: number; y: number }, viewport: Size, content: Size = viewport): ViewState {
  if (view.scale > 1.05) return { scale: 1, x: 0, y: 0 }
  return zoomAt(view, DOUBLE_TAP_SCALE, focal, viewport, content)
}

export const FRICTION = 0.92

/** One inertia frame (dt in ms). Returns the new view and updated velocity, or null when settled. */
export function inertiaStep(
  view: ViewState,
  velocity: { x: number; y: number },
  viewport: Size,
  dt: number,
  content: Size = viewport,
): { view: ViewState; velocity: { x: number; y: number } } | null {
  const decay = Math.pow(FRICTION, dt / 16)
  const vx = velocity.x * decay
  const vy = velocity.y * decay
  if (Math.hypot(vx, vy) < 0.02) return null
  const moved = clampView({ ...view, x: view.x + vx * dt, y: view.y + vy * dt }, viewport, 0, content)
  // Kill velocity along an axis that hit its edge so it does not "stick".
  const nvx = moved.x === view.x + vx * dt ? vx : 0
  const nvy = moved.y === view.y + vy * dt ? vy : 0
  return { view: moved, velocity: { x: nvx, y: nvy } }
}

export function pinchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Decide a horizontal swipe between frames at fit scale. Returns -1 (previous),
 * 1 (next) or 0 when the gesture was too short/slow or mostly vertical.
 */
export function swipeDirection(dx: number, dy: number, dtMs: number, viewportWidth: number): -1 | 0 | 1 {
  if (Math.abs(dx) < Math.abs(dy) * 1.2) return 0
  const velocity = Math.abs(dx) / Math.max(1, dtMs)
  const farEnough = Math.abs(dx) > viewportWidth * 0.22
  if (!farEnough && velocity < 0.5) return 0
  if (Math.abs(dx) < 36) return 0
  return dx < 0 ? 1 : -1
}

/** Size of an image of the given natural aspect when object-contain-fitted into a viewport. */
export function fittedSize(viewport: Size, aspect: number): Size {
  if (!(aspect > 0)) return viewport
  const byWidth = { width: viewport.width, height: viewport.width / aspect }
  return byWidth.height <= viewport.height ? byWidth : { width: viewport.height * aspect, height: viewport.height }
}
