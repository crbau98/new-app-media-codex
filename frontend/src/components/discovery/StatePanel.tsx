import type { LucideIcon } from 'lucide-react'
import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

interface StatePanelProps {
  icon?: LucideIcon
  title: string
  description?: string
  tone?: 'empty' | 'error'
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
  children?: ReactNode
  className?: string
}

/** Premium empty / error state: haloed icon, calm copy, one clear action. */
export default function StatePanel({
  icon: Icon = Search,
  title,
  description,
  tone = 'empty',
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  children,
  className,
}: StatePanelProps) {
  return (
    <div className={cn('d-state', tone === 'error' && 'd-state-error', className)} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="d-state-halo" aria-hidden="true">
        <Icon size={22} strokeWidth={1.5} />
      </span>
      <h3 className="d-state-title">{title}</h3>
      {description && <p className="d-state-desc">{description}</p>}
      {children}
      {(actionLabel || secondaryLabel) && (
        <div className="d-state-actions">
          {actionLabel && onAction && (
            <button type="button" onClick={onAction} className="btn-primary">
              {actionLabel}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button type="button" onClick={onSecondary} className="btn-secondary">
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
