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
 * Dashed-hairline panel with mono heading and one action — the honest
 * empty state used across every surface.
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
      <Icon size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden="true" />
      <h3 className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-ink">{title}</h3>
      {description && (
        <p className="max-w-md text-[13px] leading-5 text-ink-2">{description}</p>
      )}
      {actionLabel && onAction && (
        <button onClick={onAction} className="btn-primary mt-1">
          {actionLabel}
        </button>
      )}
    </div>
  )
}
