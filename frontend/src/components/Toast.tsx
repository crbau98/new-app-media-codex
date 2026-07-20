import { X } from 'lucide-react'
import { useAppStore } from '@/store'

/**
 * Bottom-center stack. Matte sunken bg, hairline border, mono text —
 * no colored borders or glow. CSS-only entry animation.
 */
export default function Toast() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)

  return (
    <div className="pointer-events-none fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-[500] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="toast-enter pointer-events-auto relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-md border border-line bg-sunken px-4 py-3 shadow-overlay"
        >
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-medium text-ink">{toast.title}</p>
            {toast.message && (
              <p className="mt-0.5 font-mono text-[10px] leading-4 text-ink-2">{toast.message}</p>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
            aria-label="Dismiss notification"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
          <span className="toast-progress" aria-hidden="true" />
        </div>
      ))}
    </div>
  )
}
