import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronLeft, ChevronRight, Play } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import MediaImage from '@/components/MediaImage'
import { useMotionOk } from '@/hooks/useMotionOk'
import { useAppStore } from '@/store'
import { useInViewport } from './useInViewport'
import { cn } from '@/lib/utils'

export interface Coverflow3DProps {
  items: MediaItem[]
  /** Called with the item id when the centered card is activated. */
  onSelect: (id: string) => void
  /** Start on this slide (default 0). */
  initialIndex?: number
  /** Rotate automatically; pauses on hover, focus, drag, hidden tab and offscreen. Default true. */
  autoplay?: boolean
  autoplayMs?: number
  /** Mirror reflection under each card (WebKit/Blink only). Default true. */
  reflection?: boolean
  /** Show the caption (title, creator, duration) under the stage. Default true. */
  showCaption?: boolean
  /** Report the centered slide (for syncing external state such as a hero backdrop). */
  onActiveChange?: (index: number) => void
  className?: string
  'aria-label'?: string
}

const MAX_VISIBLE = 3.4

/**
 * 3D coverflow built from plain CSS transforms (perspective / rotateY /
 * translateZ). Drag or swipe, horizontal wheel, arrow keys, Home/End, click a
 * side card to bring it forward, click the centered card to select it.
 * Exposes the WAI-ARIA carousel pattern. Without motion, it stays a static
 * 3D arrangement (no transitions, no autoplay).
 */
export default function Coverflow3D({
  items,
  onSelect,
  initialIndex = 0,
  autoplay = true,
  autoplayMs = 4600,
  reflection = true,
  showCaption = true,
  onActiveChange,
  className,
  'aria-label': ariaLabel = 'Featured media coverflow',
}: Coverflow3DProps) {
  const count = items.length
  const motionOk = useMotionOk()
  // Reflections read as a pale slab on ivory: dark theme only. Subscribing re-renders on toggle.
  const theme = useAppStore((s) => s.theme)
  const lightTheme = theme === 'light' || (theme === 'auto' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches)
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const inView = useInViewport(rootRef)
  const [active, setActive] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, count - 1)))
  const [drag, setDrag] = useState(0) // in slots, positive = dragged right
  const [dragging, setDragging] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [width, setWidth] = useState(720)
  const [visible, setVisible] = useState(true)
  const dragState = useRef({ id: -1, startX: 0, startIdx: 0, moved: 0 })

  const safeActive = count ? Math.min(active, count - 1) : 0

  useEffect(() => {
    onActiveChange?.(safeActive)
  }, [safeActive, onActiveChange])

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width))
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onVis = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const go = useCallback((next: number, wrap = false) => {
    if (!count) return
    setActive(() => {
      if (wrap) return ((next % count) + count) % count
      return Math.min(count - 1, Math.max(0, next))
    })
  }, [count])

  // Autoplay
  useEffect(() => {
    if (!autoplay || !motionOk || count < 2 || hovered || focused || dragging || !visible || !inView) return
    const timer = window.setInterval(() => setActive((value) => (value + 1) % count), autoplayMs)
    return () => window.clearInterval(timer)
  }, [autoplay, autoplayMs, count, dragging, focused, hovered, inView, motionOk, visible])

  // Horizontal wheel (non-passive so the page does not swipe-navigate)
  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    let acc = 0
    let lastStep = 0
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
      event.preventDefault()
      acc += event.deltaX
      const now = performance.now()
      if (Math.abs(acc) > 48 && now - lastStep > 220) {
        setActive((value) => Math.min(count - 1, Math.max(0, value + (acc > 0 ? 1 : -1))))
        lastStep = now
        acc = 0
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [count])

  const cardW = Math.round(Math.min(300, Math.max(148, width * 0.4)))
  const cardH = Math.round(cardW * 1.34)
  const step = cardW * (width < 520 ? 0.5 : 0.56)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragState.current = { id: event.pointerId, startX: event.clientX, startIdx: safeActive, moved: 0 }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (state.id !== event.pointerId) return
    const dx = event.clientX - state.startX
    state.moved = Math.max(state.moved, Math.abs(dx))
    // Capture only once a real drag starts, so plain taps still reach the card button.
    if (state.moved > 6 && !dragging) {
      setDragging(true)
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    if (state.moved <= 6) return
    // resist at the ends
    const slots = dx / step
    const target = state.startIdx - slots
    const clamped = Math.min(count - 1, Math.max(0, target))
    const rubber = (target - clamped) * 0.25
    setDrag(state.startIdx - (clamped + rubber))
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (state.id !== event.pointerId) return
    const dx = event.clientX - state.startX
    const shift = Math.round(-dx / step)
    dragState.current.id = -1
    setDragging(false)
    setDrag(0)
    if (state.moved > 6) go(state.startIdx + shift)
    // Keep `moved` through the trailing click (so a drag never activates a card), then clear.
    window.setTimeout(() => {
      dragState.current.moved = 0
    }, 0)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      go(safeActive + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      go(safeActive - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      go(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      go(count - 1)
    }
  }

  const slides = useMemo(() => items, [items])
  if (!count) return null
  const current = slides[safeActive]
  // fractional position of the strip: drag moves it live
  const pos = safeActive - drag

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn('relative select-none rounded-xl outline-offset-4', className)}
    >
      <div
        ref={stageRef}
        className="relative mx-auto w-full overflow-hidden"
        style={{ height: cardH + (reflection && motionOk && !lightTheme ? 64 : 36), perspective: 1100, touchAction: 'pan-y', cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="absolute left-0 top-4 h-full w-full"
          style={{ transformStyle: 'preserve-3d', perspectiveOrigin: '50% 40%' }}
        >
          {slides.map((item, index) => {
            const off = index - pos
            const abs = Math.abs(off)
            if (abs > MAX_VISIBLE + 1) return null
            const sign = off < 0 ? -1 : 1
            const near = Math.min(abs, 1)
            const x = off * step + sign * cardW * 0.34 * near
            const z = -Math.min(abs, 3) * 110 + (abs < 1 ? (1 - abs) * 60 : 0)
            const rot = -Math.max(-1, Math.min(1, off)) * 52
            const scale = 1 - Math.min(abs, 3) * 0.035
            const isCenter = index === safeActive
            const style: CSSProperties & { WebkitBoxReflect?: string } = {
              width: cardW,
              height: cardH,
              left: `calc(50% - ${cardW / 2}px)`,
              transform: `translate3d(${x.toFixed(1)}px, 0, ${z.toFixed(1)}px) rotateY(${rot.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
              zIndex: 100 - Math.round(abs * 10),
              opacity: abs > MAX_VISIBLE ? 0 : 1,
              transition: dragging || !motionOk ? 'none' : 'transform 0.7s cubic-bezier(0.16,1,0.3,1), opacity 0.5s ease',
              pointerEvents: abs > MAX_VISIBLE ? 'none' : undefined,
            }
            if (reflection && motionOk && !lightTheme) style.WebkitBoxReflect = 'below 6px linear-gradient(transparent 76%, rgba(255,255,255,0.1))'
            return (
              <div
                key={item.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
                className="absolute top-0"
                style={style}
              >
                <button
                  type="button"
                  tabIndex={isCenter ? 0 : -1}
                  aria-label={isCenter ? `Open ${item.title}` : `Show ${item.title}`}
                  data-testid={isCenter ? 'coverflow-active' : undefined}
                  onClick={() => {
                    if (dragState.current.moved > 6) return
                    if (isCenter) onSelect(item.id)
                    else go(index)
                  }}
                  className={cn(
                    'group relative block h-full w-full overflow-hidden rounded-xl bg-sunken text-left',
                    isCenter ? 'ring-1 ring-gold/60 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.75),0_0_50px_-10px_rgb(var(--gold)/0.3)]' : 'ring-1 ring-white/10 shadow-[0_24px_40px_-24px_rgba(0,0,0,0.8)]',
                  )}
                >
                  <MediaImage
                    sources={[item.thumbnail]}
                    alt=""
                    loading={Math.abs(index - safeActive) < 3 ? 'eager' : 'lazy'}
                    className="absolute inset-0 h-full w-full object-cover"
                    skeletonClassName="absolute inset-0 h-full w-full"
                  />
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" aria-hidden="true" />
                  <span
                    className="pointer-events-none absolute inset-0 bg-[rgb(var(--canvas))] transition-opacity duration-500"
                    style={{ opacity: Math.min(abs, 2.4) * 0.26 }}
                    aria-hidden="true"
                  />
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" aria-hidden="true" />
                  {isCenter && (
                    <span className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-black opacity-90 shadow-lg backdrop-blur-sm transition-transform duration-300 group-hover:scale-110" aria-hidden="true">
                      <Play size={16} fill="currentColor" strokeWidth={0} />
                    </span>
                  )}
                  {item.isVideo && item.duration && (
                    <span className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] tracking-wider text-white backdrop-blur-sm" aria-hidden="true">
                      {item.duration}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(safeActive - 1)}
              disabled={safeActive === 0}
              aria-label="Previous slide"
              className="glass absolute left-2 top-1/2 z-[200] grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-ink transition-opacity hover:border-gold-line disabled:opacity-30"
            >
              <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(safeActive + 1)}
              disabled={safeActive === count - 1}
              aria-label="Next slide"
              className="glass absolute right-2 top-1/2 z-[200] grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full text-ink transition-opacity hover:border-gold-line disabled:opacity-30"
            >
              <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {showCaption && (
        <div className="mt-1 text-center" aria-live={autoplay && motionOk && !hovered && !focused ? 'off' : 'polite'}>
          <p className="font-display text-xl text-ink sm:text-2xl">{current.title}</p>
          <p className="mono-meta mt-1.5 uppercase">
            @{current.creator}
            {current.duration ? `  ·  ${current.duration}` : ''}
            {'  ·  '}
            {String(safeActive + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
          </p>
        </div>
      )}
    </div>
  )
}
