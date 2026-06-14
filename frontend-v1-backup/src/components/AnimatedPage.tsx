import { motion, type Variants } from "framer-motion"
import type { ReactNode } from "react"

const pageVariants: Variants = {
  initial: {
    opacity: 0,
    y: 12,
    scale: 0.985,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.35,
      ease: [0.16, 1, 0.3, 1],
    },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 0.99,
    transition: {
      duration: 0.2,
      ease: "easeIn",
    },
  },
}

export function AnimatedPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={className}
    >
      {children}
    </motion.div>
  )
}

const staggerContainer: Variants = {
  animate: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.05,
    },
  },
}

const staggerItem: Variants = {
  initial: { opacity: 0, y: 20, scale: 0.96 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.16, 1, 0.3, 1],
    },
  },
}

export function StaggerGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="initial"
      animate="animate"
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  )
}

// Smooth hover scale wrapper for media cards
export function HoverScale({
  children,
  className,
  scale = 1.02,
}: {
  children: ReactNode
  className?: string
  scale?: number
}) {
  return (
    <motion.div
      whileHover={{ scale, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } }}
      whileTap={{ scale: 0.98, transition: { duration: 0.1 } }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// Fade in on scroll / mount
export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
