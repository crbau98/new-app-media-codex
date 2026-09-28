import { useRef, type PointerEvent, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ArtworkTiltProps {
  children: ReactNode
  className?: string
  /** Max rotation in degrees. */
  max?: number
  disabled?: boolean
}

/**
 * Lightweight pointer-driven 3D tilt with a soft specular glare. Pure
 * transform/opacity (compositor only). Touch pointers never tilt.
 */
export default function ArtworkTilt({ children, className, max = 9, disabled }: ArtworkTiltProps) {
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const sx = useSpring(px, { stiffness: 220, damping: 22, mass: 0.6 })
  const sy = useSpring(py, { stiffness: 220, damping: 22, mass: 0.6 })
  const rotateY = useTransform(sx, [0, 1], [-max, max])
  const rotateX = useTransform(sy, [0, 1], [max, -max])
  const glareX = useTransform(sx, [0, 1], ['10%', '90%'])
  const glareY = useTransform(sy, [0, 1], ['10%', '90%'])
  const glare = useTransform([glareX, glareY], ([x, y]) => `radial-gradient(circle at ${x} ${y}, rgb(255 255 255 / 0.22), transparent 55%)`)
  const glareOpacity = useTransform(sx, (value) => (Math.abs(value - 0.5) < 0.001 ? 0 : 1))

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.pointerType === 'touch') return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    px.set((event.clientX - rect.left) / rect.width)
    py.set((event.clientY - rect.top) / rect.height)
  }
  const onLeave = () => {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <div className={cn('[perspective:900px]', className)} onPointerMove={onMove} onPointerLeave={onLeave}>
      <motion.div
        ref={ref}
        className="relative h-full w-full [transform-style:preserve-3d]"
        style={disabled ? undefined : { rotateX, rotateY }}
      >
        {children}
        {!disabled && <motion.div className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-soft-light" style={{ background: glare, opacity: glareOpacity }} aria-hidden="true" />}
      </motion.div>
    </div>
  )
}
