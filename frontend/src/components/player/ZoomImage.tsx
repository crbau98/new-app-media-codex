import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react'
import { AlertCircle, LoaderCircle } from 'lucide-react'
import { isDoubleTap } from '@/lib/player/controls'
import { safeColor, safeImageSrc } from '@/lib/player/intel'
import {
  MAX_SCALE,
  clampView,
  fittedSize,
  inertiaStep,
  midpoint,
  pinchDistance,
  swipeDirection,
  toggleZoom,
  zoomAt,
  type Size,
  type ViewState,
} from '@/lib/player/zoom'
import './player.css'

export interface ZoomHandle {
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
}

interface ZoomImageProps {
  /** Full-quality candidates in preference order. */
  sources: string[]
  /** Small, likely-cached image shown blurred until the full image is decoded. */
  placeholderSrc?: string
  lqip?: string
  dominantColor?: string
  alt: string
  /** width/height when known so the frame reserves the right shape. */
  aspect?: number
  /** Whether a swipe in this direction can move to another frame/item (else rubber-band back). */
  canSwipe: (direction: -1 | 1) => boolean
  onSwipe: (direction: -1 | 1) => void
  onZoomChange?: (zoomed: boolean) => void
  onLoaded?: () => void
  ref?: Ref<ZoomHandle>
}

type LoadState = { phase: 'loading' } | { phase: 'ready'; src: string; aspect: number } | { phase: 'error' }

/** Try each candidate: load, decode off-thread, then reveal. */
function loadFirst(sources: string[], isCancelled: () => boolean): Promise<{ src: string; aspect: number } | null> {
  const attempt = async (index: number): Promise<{ src: string; aspect: number } | null> => {
    if (index >= sources.length || isCancelled()) return null
    const image = new Image()
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
    image.src = sources[index]
    try {
      await image.decode()
      return { src: sources[index], aspect: image.naturalWidth / Math.max(1, image.naturalHeight) }
    } catch {
      return attempt(index + 1)
    }
  }
  return attempt(0)
}

const DOUBLE_TAP_MS = 300

/**
 * Pinch / double-tap / wheel zoom with pointer-driven pan and inertia. The
 * transform is written straight to the DOM (no React re-render per pointer
 * event). At fit scale a horizontal swipe hands off to the host for frame
 * navigation, with rubber-banding at the ends.
 */
export default function ZoomImage({
  sources, placeholderSrc, lqip, dominantColor, alt, aspect, canSwipe, onSwipe, onZoomChange, onLoaded, ref,
}: ZoomImageProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const view = useRef<ViewState>({ scale: 1, x: 0, y: 0 })
  const zoomedRef = useRef(false)
  const aspectRef = useRef(aspect ?? 0)
  const raf = useRef<number | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; mid: { x: number; y: number }; view: ViewState } | null>(null)
  const pan = useRef<{ x: number; y: number; t: number; vx: number; vy: number; startX: number; startY: number; startT: number } | null>(null)
  const tap = useRef<{ t: number; x: number; y: number } | null>(null)
  const swipeOffset = useRef(0)

  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)

  const sourcesKey = sources.join('\n')
  useEffect(() => {
    let cancelled = false
    void loadFirst(sourcesKey.split('\n').filter(Boolean), () => cancelled).then((result) => {
      if (cancelled) return
      if (result) {
        aspectRef.current = result.aspect
        setState({ phase: 'ready', src: result.src, aspect: result.aspect })
        onLoaded?.()
      } else {
        setState({ phase: 'error' })
      }
    })
    return () => {
      cancelled = true
    }
    // onLoaded intentionally excluded: it is a notification, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesKey, attempt])

  const measure = useCallback((): { viewport: Size; content: Size } => {
    const el = surfaceRef.current
    const viewport = { width: el?.clientWidth || 1, height: el?.clientHeight || 1 }
    return { viewport, content: fittedSize(viewport, aspectRef.current) }
  }, [])

  const apply = useCallback(
    (animate = false) => {
      const el = contentRef.current
      if (!el) return
      const { scale, x, y } = view.current
      el.style.transition = animate ? 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)' : 'none'
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
      const zoomed = scale > 1.02
      if (zoomed !== zoomedRef.current) {
        zoomedRef.current = zoomed
        onZoomChange?.(zoomed)
      }
    },
    [onZoomChange],
  )

  const stopInertia = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
  }

  useEffect(() => stopInertia, [])

  const centred = useCallback((clientX: number, clientY: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
  }, [])

  const zoomTo = useCallback(
    (scale: number, focal = { x: 0, y: 0 }) => {
      const { viewport, content } = measure()
      view.current = zoomAt(view.current, scale, focal, viewport, content)
      apply(true)
    },
    [apply, measure],
  )

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomTo(view.current.scale * 1.6),
      zoomOut: () => zoomTo(view.current.scale / 1.6),
      reset: () => {
        view.current = { scale: 1, x: 0, y: 0 }
        apply(true)
      },
    }),
    [apply, zoomTo],
  )

  // Wheel / trackpad-pinch zoom needs a non-passive listener to preventDefault.
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      stopInertia()
      const { viewport, content } = measure()
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018))
      view.current = zoomAt(view.current, view.current.scale * factor, centred(event.clientX, event.clientY), viewport, content)
      apply(false)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [apply, centred, measure])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    stopInertia()
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const list = [...pointers.current.values()]
    if (list.length === 2) {
      pinch.current = { dist: pinchDistance(list[0], list[1]), mid: midpoint(list[0], list[1]), view: { ...view.current } }
      pan.current = null
    } else if (list.length === 1) {
      const now = performance.now()
      pan.current = { x: event.clientX, y: event.clientY, t: now, vx: 0, vy: 0, startX: event.clientX, startY: event.clientY, startT: now }
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const list = [...pointers.current.values()]
    const { viewport, content } = measure()

    if (list.length >= 2 && pinch.current) {
      const start = pinch.current
      const dist = pinchDistance(list[0], list[1])
      const rect = surfaceRef.current?.getBoundingClientRect()
      const mid = midpoint(list[0], list[1])
      const cx = rect ? rect.left + rect.width / 2 : 0
      const cy = rect ? rect.top + rect.height / 2 : 0
      const scale = Math.min(MAX_SCALE * 1.15, Math.max(0.85, (start.view.scale * dist) / Math.max(1, start.dist)))
      const startMid = { x: start.mid.x - cx, y: start.mid.y - cy }
      const curMid = { x: mid.x - cx, y: mid.y - cy }
      // Keep the content point that started under the fingers under them now.
      const point = { x: (startMid.x - start.view.x) / start.view.scale, y: (startMid.y - start.view.y) / start.view.scale }
      view.current = clampView({ scale, x: curMid.x - point.x * scale, y: curMid.y - point.y * scale }, viewport, 0.15, content)
      apply(false)
      return
    }

    const current = pan.current
    if (!current || list.length !== 1) return
    const now = performance.now()
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    const dt = Math.max(1, now - current.t)
    current.vx = 0.8 * (dx / dt) + 0.2 * current.vx
    current.vy = 0.8 * (dy / dt) + 0.2 * current.vy
    current.x = event.clientX
    current.y = event.clientY
    current.t = now

    if (view.current.scale > 1.02) {
      view.current = clampView({ ...view.current, x: view.current.x + dx, y: view.current.y + dy }, viewport, 0, content)
      apply(false)
    } else {
      // Fit scale: drag the frame horizontally as swipe feedback.
      swipeOffset.current += dx
      const total = event.clientX - current.startX
      const direction: -1 | 1 = total < 0 ? 1 : -1
      const resist = canSwipe(direction) ? 0.9 : 0.25
      view.current = { scale: 1, x: swipeOffset.current * resist, y: 0 }
      apply(false)
    }
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const remaining = [...pointers.current.values()]
    if (pinch.current && remaining.length < 2) {
      pinch.current = null
      const { viewport, content } = measure()
      view.current = clampView(view.current, viewport, 0, content)
      if (view.current.scale < 1.02) view.current = { scale: 1, x: 0, y: 0 }
      apply(true)
      if (remaining.length === 1) {
        const now = performance.now()
        pan.current = { x: remaining[0].x, y: remaining[0].y, t: now, vx: 0, vy: 0, startX: remaining[0].x, startY: remaining[0].y, startT: now }
      }
      return
    }
    const current = pan.current
    if (remaining.length > 0 || !current) return
    pan.current = null
    const totalX = event.clientX - current.startX
    const totalY = event.clientY - current.startY
    const elapsed = performance.now() - current.startT
    const moved = Math.hypot(totalX, totalY)
    const { viewport, content } = measure()

    // Tap / double-tap.
    if (!cancelled && moved < 8 && elapsed < 320) {
      swipeOffset.current = 0
      const point = { t: Date.now(), x: event.clientX, y: event.clientY }
      if (isDoubleTap(tap.current, point, DOUBLE_TAP_MS, 40)) {
        tap.current = null
        view.current = toggleZoom(view.current, centred(event.clientX, event.clientY), viewport, content)
        apply(true)
      } else {
        tap.current = point
      }
      return
    }

    if (view.current.scale > 1.02) {
      // Inertial glide, clamped to the image edges.
      let velocity = { x: current.vx, y: current.vy }
      let last = performance.now()
      const step = (now: number) => {
        const result = inertiaStep(view.current, velocity, viewport, Math.min(48, now - last), content)
        last = now
        if (!result) {
          raf.current = null
          return
        }
        view.current = result.view
        velocity = result.velocity
        apply(false)
        raf.current = requestAnimationFrame(step)
      }
      raf.current = requestAnimationFrame(step)
      return
    }

    // Fit scale: commit a swipe or spring back.
    const direction = cancelled ? 0 : swipeDirection(totalX, totalY, elapsed, viewport.width)
    swipeOffset.current = 0
    if (direction !== 0 && canSwipe(direction)) {
      onSwipe(direction)
      return
    }
    view.current = { scale: 1, x: 0, y: 0 }
    apply(true)
  }

  const color = safeColor(dominantColor)
  const preview = safeImageSrc(lqip)
  const placeholder = safeImageSrc(placeholderSrc)
  const ready = state.phase === 'ready'

  return (
    <div
      ref={surfaceRef}
      className="mc-zoom-surface relative h-full w-full overflow-hidden"
      style={{ backgroundColor: color }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onDoubleClick={(event) => {
        // Mouse users: native dblclick (touch is handled by the tap tracker above).
        if (event.nativeEvent instanceof MouseEvent && (event.nativeEvent as PointerEvent).pointerType === 'touch') return
        const { viewport, content } = measure()
        view.current = toggleZoom(view.current, centred(event.clientX, event.clientY), viewport, content)
        apply(true)
      }}
    >
      {/* Progressive blur-up underlay: lqip → cached thumbnail → colour. */}
      {!ready && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {(preview || placeholder) && (
            <div
              className="absolute -inset-4 bg-contain bg-center bg-no-repeat"
              style={{ backgroundImage: `url("${(preview || placeholder || '').replace(/"/g, '%22')}")`, filter: 'blur(16px) saturate(1.1)' }}
            />
          )}
        </div>
      )}
      <div ref={contentRef} className="absolute inset-0 grid place-items-center will-change-transform" style={{ transformOrigin: '50% 50%' }}>
        {ready && (
          <img
            src={state.src}
            alt={alt}
            draggable={false}
            decoding="async"
            referrerPolicy="no-referrer"
            className="mc-img-in max-h-full max-w-full select-none object-contain"
          />
        )}
      </div>
      {state.phase === 'loading' && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2" role="status" aria-label="Loading photo">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur-md">
            <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> Loading full quality
          </span>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="absolute inset-0 grid place-items-center" role="alert">
          <div className="max-w-xs px-4 text-center">
            <AlertCircle size={18} className="mx-auto text-white/70" aria-hidden="true" />
            <p className="mt-2 text-sm text-white/90">This image could not be loaded.</p>
            <button
              type="button"
              className="btn-secondary mt-3"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                setState({ phase: 'loading' })
                setAttempt((value) => value + 1)
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
