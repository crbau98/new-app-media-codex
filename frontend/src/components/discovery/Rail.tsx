import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMotionOk } from './motion'
import '@/styles/discovery.css'

interface RailProps {
  children: ReactNode
  ariaLabel: string
  className?: string
  /** Scroll-snap alignment of items. */
  snap?: 'start' | 'center'
  /** Called (rAF-throttled) on scroll/resize and once on mount — for scroll-linked effects. */
  onFrame?: (scroller: HTMLElement) => void
}

/**
 * Horizontal snap rail: edge fades, desktop arrow buttons, mouse drag with
 * momentum, arrow-key focus travel, native momentum on iOS. Vertical wheel is
 * never hijacked; trackpad/shift-wheel scroll natively.
 */
export default function Rail({ children, ariaLabel, className, snap = 'start', onFrame }: RailProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: false })
  const motionOk = useMotionOk()
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0, lastX: 0, velocity: 0, id: -1 })
  const frame = useRef(0)
  const momentum = useRef(0)
  const onFrameRef = useRef(onFrame)
  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const start = el.scrollLeft <= 2
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    onFrameRef.current?.(el)
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const schedule = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(measure)
    }
    schedule()
    el.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => {
      cancelAnimationFrame(frame.current)
      cancelAnimationFrame(momentum.current)
      el.removeEventListener('scroll', schedule)
      observer.disconnect()
    }
  }, [measure])

  const scrollByPage = (direction: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.82, behavior: motionOk ? 'smooth' : 'auto' })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return
    const el = scroller.current
    if (!el) return
    cancelAnimationFrame(momentum.current)
    drag.current = { active: true, moved: false, startX: event.clientX, startLeft: el.scrollLeft, lastX: event.clientX, velocity: 0, id: event.pointerId }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    const el = scroller.current
    if (!state.active || !el) return
    const dx = event.clientX - state.startX
    if (!state.moved && Math.abs(dx) > 6) {
      state.moved = true
      el.setPointerCapture(state.id)
      el.dataset.drag = 'true'
    }
    if (!state.moved) return
    state.velocity = event.clientX - state.lastX
    state.lastX = event.clientX
    el.scrollLeft = state.startLeft - dx
  }
  const endDrag = () => {
    const state = drag.current
    const el = scroller.current
    if (!state.active || !el) return
    state.active = false
    if (!state.moved) return
    let velocity = -state.velocity
    const glide = () => {
      if (!motionOk || Math.abs(velocity) < 0.4) {
        delete el.dataset.drag
        return
      }
      el.scrollLeft += velocity
      velocity *= 0.94
      momentum.current = requestAnimationFrame(glide)
    }
    glide()
    // The click that ends a drag must not open a card.
    window.setTimeout(() => {
      state.moved = false
    }, 0)
  }
  const onClickCapture = (event: React.MouseEvent) => {
    if (drag.current.moved) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const el = scroller.current
    if (!el) return
    const focusables = Array.from(el.querySelectorAll<HTMLElement>('button, a[href]')).filter((node) => !node.hasAttribute('disabled'))
    const index = focusables.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    const next = focusables[index + (event.key === 'ArrowRight' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
    next.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: motionOk ? 'smooth' : 'auto' })
  }

  return (
    <div className={cn('d-rail', className)} data-start={edges.start} data-end={edges.end}>
      <div
        ref={scroller}
        className="d-rail-scroller hide-scrollbar"
        data-snap={snap}
        role="group"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
      <button
        type="button"
        className="d-rail-btn d-rail-prev"
        onClick={() => scrollByPage(-1)}
        aria-label={`Scroll ${ariaLabel} left`}
        tabIndex={-1}
        hidden={edges.start}
      >
        <ChevronLeft size={20} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        className="d-rail-btn d-rail-next"
        onClick={() => scrollByPage(1)}
        aria-label={`Scroll ${ariaLabel} right`}
        tabIndex={-1}
        hidden={edges.end}
      >
        <ChevronRight size={20} strokeWidth={1.75} />
      </button>
    </div>
  )
}
