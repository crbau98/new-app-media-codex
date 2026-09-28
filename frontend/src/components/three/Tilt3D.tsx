import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react'
import { useMotionOk } from '@/hooks/useMotionOk'
import { cn } from '@/lib/utils'

interface Tilt3DProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Max rotation in degrees on each axis. */
  max?: number
  /** Scale applied while hovered. */
  scale?: number
  /** Render a moving specular glare over the surface. */
  glare?: boolean
  /** Perspective distance in px. */
  perspective?: number
}

/**
 * Pointer-driven 3D tilt with specular glare. Pure CSS transforms updated via
 * requestAnimationFrame; no layout thrash. Inert on touch / reduced motion.
 */
export default function Tilt3D({
  children,
  className,
  style,
  max = 9,
  scale = 1.025,
  glare = true,
  perspective = 900,
}: Tilt3DProps) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef<number | null>(null)
  const motionOk = useMotionOk()

  const apply = useCallback((rx: number, ry: number, gx: number, gy: number, s: number, glareOpacity: number) => {
    const node = ref.current
    if (!node) return
    node.style.setProperty('--tilt-rx', `${rx}deg`)
    node.style.setProperty('--tilt-ry', `${ry}deg`)
    node.style.setProperty('--tilt-s', String(s))
    node.style.setProperty('--glare-x', `${gx}%`)
    node.style.setProperty('--glare-y', `${gy}%`)
    node.style.setProperty('--glare-o', String(glareOpacity))
  }, [])

  const onMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!motionOk || event.pointerType === 'touch') return
    const node = ref.current
    if (!node) return
    const { clientX, clientY } = event
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect()
      const px = (clientX - rect.left) / rect.width
      const py = (clientY - rect.top) / rect.height
      apply((0.5 - py) * max * 2, (px - 0.5) * max * 2, px * 100, py * 100, scale, 0.55)
    })
  }, [apply, max, motionOk, scale])

  const onLeave = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    apply(0, 0, 50, 50, 1, 0)
  }, [apply])

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cn('tilt-3d', className)}
      style={{
        perspective: `${perspective}px`,
        ...style,
      }}
    >
      <div
        className="tilt-3d-inner relative h-full w-full"
        style={{
          transform: 'rotateX(var(--tilt-rx, 0deg)) rotateY(var(--tilt-ry, 0deg)) scale(var(--tilt-s, 1))',
          transformStyle: 'preserve-3d',
          transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: motionOk ? 'transform' : undefined,
        }}
      >
        {children}
        {glare && motionOk && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-soft-light"
            style={{
              opacity: 'var(--glare-o, 0)',
              background: 'radial-gradient(circle at var(--glare-x, 50%) var(--glare-y, 50%), rgba(255,255,255,0.75), transparent 55%)',
              transition: 'opacity 220ms ease',
            }}
          />
        )}
      </div>
    </div>
  )
}
