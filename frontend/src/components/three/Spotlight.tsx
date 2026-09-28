import { useCallback, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react'
import { useMotionOk } from '@/hooks/useMotionOk'
import { cn } from '@/lib/utils'

interface SpotlightProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Light radius in px (default 320). */
  radius?: number
  /** Any CSS color; default is a soft champagne glow. */
  color?: string
  /** Element to render (default div). */
  as?: ElementType
}

/**
 * Cursor-follow spotlight: a radial light (the `.spotlight::before` layer)
 * tracks the pointer inside the wrapper. Updates CSS variables in rAF — no
 * React re-render, no layout. Inert on touch and with reduced motion.
 * Children that need to sit above the light should be `relative z-[2]`.
 */
export default function Spotlight({ children, className, style, radius = 320, color, as: Tag = 'div' }: SpotlightProps) {
  const ref = useRef<HTMLElement>(null)
  const frame = useRef(0)
  const motionOk = useMotionOk()

  const onMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!motionOk || event.pointerType === 'touch') return
    const { clientX, clientY } = event
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const node = ref.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      node.style.setProperty('--spot-x', `${clientX - rect.left}px`)
      node.style.setProperty('--spot-y', `${clientY - rect.top}px`)
      node.style.setProperty('--spot-o', '1')
    })
  }, [motionOk])

  const onLeave = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current)
    ref.current?.style.setProperty('--spot-o', '0')
  }, [])

  const vars = { '--spot-r': `${radius}px`, ...(color ? { '--spot-color': color } : null), ...style } as CSSProperties

  return (
    <Tag ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={cn('spotlight', className)} style={vars}>
      {children}
    </Tag>
  )
}
