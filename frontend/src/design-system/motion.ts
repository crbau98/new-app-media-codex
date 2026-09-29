/** Shared Framer Motion presets so every surface moves the same way. */
export const spring = {
  press: { type: 'spring', stiffness: 520, damping: 30, mass: 0.6 },
  soft: { type: 'spring', stiffness: 260, damping: 28 },
  indicator: { type: 'spring', stiffness: 420, damping: 34 },
} as const

export const easeOutExpo = [0.16, 1, 0.3, 1] as const

export const routeVariants = {
  initial: { opacity: 0, y: 14, scale: 0.992, filter: 'blur(6px)' },
  animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { duration: 0.5, ease: easeOutExpo } },
  exit: { opacity: 0, y: -6, scale: 0.996, filter: 'blur(4px)', transition: { duration: 0.16, ease: 'easeIn' } },
} as const
