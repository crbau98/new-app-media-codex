import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

interface SectionHeaderProps {
  title: string
  eyebrow?: string
  icon?: ReactNode
  note?: string
  actionLabel?: string
  onAction?: () => void
  /** Extra controls aligned to the right. */
  children?: ReactNode
  as?: 'h1' | 'h2'
  className?: string
}

/** Shared section heading: mono eyebrow, tight display title, optional action. */
export default function SectionHeader({ title, eyebrow, icon, note, actionLabel, onAction, children, as = 'h2', className }: SectionHeaderProps) {
  const Heading = as
  return (
    <header className={cn('d-sec-head', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="d-eyebrow">
            {icon}
            {eyebrow}
          </p>
        )}
        <Heading className={as === 'h1' ? 'd-page-title' : 'd-sec-title'}>{title}</Heading>
        {note && <p className="d-sec-note">{note}</p>}
      </div>
      <div className="d-sec-actions">
        {children}
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="d-link">
            {actionLabel} <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  )
}
