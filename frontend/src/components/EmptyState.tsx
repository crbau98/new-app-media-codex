import type { LucideIcon } from 'lucide-react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}

/**
 * Velvet empty state: a gold-haloed icon medallion, mono heading, one action.
 * The honest empty state used across every surface.
 */
export default function EmptyState({
  icon: Icon = Search,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('empty-state-panel', className)} role="status">
      <span className="relative grid h-14 w-14 place-items-center rounded-full glass hairline-gold" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-gradient-to-b from-gold/20 to-transparent blur-md" />
        <Icon size={20} strokeWidth={1.5} className="relative text-gold-ink" />
      </span>
      <h3 className="font-display text-xl font-normal tracking-[-0.01em] text-ink">{title}</h3>
      {description && (
        <p className="max-w-md text-[13px] leading-6 text-ink-2">{description}</p>
      )}
      {actionLabel && onAction && (
        <button onClick={onAction} className="btn-primary mt-2">
          {actionLabel}
        </button>
      )}
    </div>
  )
}
