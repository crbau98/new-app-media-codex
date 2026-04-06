import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-[fade-in_200ms_ease-out]"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        className={cn(
          'bg-bg-elevated border border-border rounded-2xl shadow-2xl',
          'w-full max-w-2xl max-h-[85vh] overflow-y-auto animate-[zoomIn_200ms_ease-out]',
          className
        )}
      >
        {children}
      </div>
    </div>
  )
}

interface DialogHeaderProps {
  title: string
  onClose: () => void
}

export function DialogHeader({ title, onClose }: DialogHeaderProps) {
  return (
    <div className="flex items-center justify-between p-5 border-b border-border">
      <h2 id="dialog-title" className="text-base font-semibold text-text-primary">{title}</h2>
      <button
        onClick={onClose}
        aria-label="Close dialog"
        className="text-text-muted hover:text-text-primary transition-colors text-xl leading-none"
      >
        ×
      </button>
    </div>
  )
}
