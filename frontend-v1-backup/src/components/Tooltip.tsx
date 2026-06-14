import { useState, useId } from 'react'
import { cn } from '@/lib/cn'

export function Tooltip({ children, content, className }: {
  children: React.ReactNode
  content: string
  className?: string
}) {
  const [show, setShow] = useState(false)
  const id = useId()
  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      aria-describedby={show ? id : undefined}
    >
      {children}
      {show && (
        <span id={id} role="tooltip" className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 px-2 py-1 text-xs text-text-primary bg-bg-elevated border border-border rounded-md whitespace-nowrap pointer-events-none">
          {content}
        </span>
      )}
    </span>
  )
}
