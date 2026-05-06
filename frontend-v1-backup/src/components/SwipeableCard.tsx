import { useRef, useCallback, type ReactNode } from 'react'

export interface SwipeableCardProps {
  children: ReactNode
  onSwipeRight?: () => void
  onSwipeLeft?: () => void
  rightLabel?: string
  leftLabel?: string
  rightColor?: string
  leftColor?: string
}

const THRESHOLD_RATIO = 0.3
const IS_TOUCH = typeof window !== 'undefined' && 'ontouchstart' in window

export function SwipeableCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel = 'Save',
  leftLabel = 'Reviewed',
  rightColor = '#22c55e',
  leftColor = '#3b82f6',
}: SwipeableCardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const currentX = useRef(0)
  const swiping = useRef(false)
  const directionLocked = useRef(false)
  const rafId = useRef(0)

  const resetPosition = useCallback(() => {
    const el = innerRef.current
    if (!el) return
    el.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    el.style.transform = 'translateX(0)'
    currentX.current = 0
    const onEnd = () => {
      el.style.transition = ''
      el.removeEventListener('transitionend', onEnd)
    }
    el.addEventListener('transitionend', onEnd)
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!IS_TOUCH) return
    const touch = e.touches[0]
    startX.current = touch.clientX
    startY.current = touch.clientY
    currentX.current = 0
    swiping.current = false
    directionLocked.current = false
    const el = innerRef.current
    if (el) el.style.transition = ''
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!IS_TOUCH) return
    const touch = e.touches[0]
    const deltaX = touch.clientX - startX.current
    const deltaY = touch.clientY - startY.current

    if (!directionLocked.current) {
      if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        // Vertical scroll — bail out
        directionLocked.current = true
        swiping.current = false
        return
      }
      directionLocked.current = true
      swiping.current = true
    }

    if (!swiping.current) return

    // Prevent vertical scroll while swiping horizontally
    e.preventDefault()

    // Only allow swipe in directions that have handlers
    if (deltaX > 0 && !onSwipeRight) return
    if (deltaX < 0 && !onSwipeLeft) return

    currentX.current = deltaX

    cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      const el = innerRef.current
      if (el) {
        el.style.transform = `translateX(${deltaX}px)`
      }
    })
  }, [onSwipeRight, onSwipeLeft])

  const handleTouchEnd = useCallback(() => {
    if (!IS_TOUCH || !swiping.current) return
    swiping.current = false
    directionLocked.current = false
    cancelAnimationFrame(rafId.current)

    const container = containerRef.current
    if (!container) {
      resetPosition()
      return
    }
    const width = container.offsetWidth
    const threshold = width * THRESHOLD_RATIO
    const dx = currentX.current

    if (dx > threshold && onSwipeRight) {
      if (navigator.vibrate) navigator.vibrate(10)
      onSwipeRight()
      resetPosition()
    } else if (dx < -threshold && onSwipeLeft) {
      if (navigator.vibrate) navigator.vibrate(10)
      onSwipeLeft()
      resetPosition()
    } else {
      resetPosition()
    }
  }, [onSwipeRight, onSwipeLeft, resetPosition])

  // On non-touch devices, just render children directly
  if (!IS_TOUCH) {
    return <>{children}</>
  }

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-xl">
      {/* Swipe-right reveal (save) */}
      {onSwipeRight && (
        <div
          className="absolute inset-0 flex items-center justify-start pl-6 rounded-xl"
          style={{ backgroundColor: rightColor }}
        >
          <span className="text-white text-sm font-semibold tracking-wide">
            {rightLabel}
          </span>
        </div>
      )}
      {/* Swipe-left reveal (review) */}
      {onSwipeLeft && (
        <div
          className="absolute inset-0 flex items-center justify-end pr-6 rounded-xl"
          style={{ backgroundColor: leftColor }}
        >
          <span className="text-white text-sm font-semibold tracking-wide">
            {leftLabel}
          </span>
        </div>
      )}
      {/* Foreground card */}
      <div
        ref={innerRef}
        className="relative z-10"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'pan-y' }}
      >
        {children}
      </div>
    </div>
  )
}
