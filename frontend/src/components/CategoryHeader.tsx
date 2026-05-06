import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'
import { motion, useInView } from 'framer-motion'

interface CategoryHeaderProps {
  name: string
  count: number
  onToggle?: () => void
  expanded?: boolean
}

export default function CategoryHeader({ name, count, onToggle, expanded = true }: CategoryHeaderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-50px' })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
      className={cn(
        'flex items-center justify-between w-full h-[72px] px-4 rounded-[var(--radius-md)]',
        'bg-[var(--bg-elevated)] border border-[var(--border-subtle)]',
        'cursor-pointer select-none transition-colors hover:bg-[var(--bg-surface)]/50'
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, var(--accent-dim) 0%, transparent 60%)`,
      }}
      onClick={onToggle}
      role="button"
      aria-expanded={expanded}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
          {name}
        </h2>
        <span className="text-xs font-mono text-[var(--text-tertiary)]">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
        <span className="text-sm hidden sm:inline">View all</span>
        <ChevronRight
          size={18}
          className={cn('transition-transform duration-200', expanded ? 'rotate-90' : '')}
        />
      </div>
    </motion.div>
  )
}
