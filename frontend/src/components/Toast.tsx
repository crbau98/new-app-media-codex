import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { useMotionOk } from '@/hooks/useMotionOk'
import { spring } from '@/design-system/motion'

const icons = {
  success: { Icon: CheckCircle2, className: 'text-success' },
  error: { Icon: AlertCircle, className: 'text-error' },
  info: { Icon: Info, className: 'text-gold-ink' },
} as const

/**
 * Bottom-center stack of glass toasts with a typed icon and a spectrum
 * countdown hairline. Springs in/out; plain when motion is reduced.
 */
export default function Toast() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)
  const motionOk = useMotionOk()

  return (
    <div className="pointer-events-none fixed bottom-[calc(96px+env(safe-area-inset-bottom))] left-1/2 z-[500] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 md:bottom-8">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const { Icon, className } = icons[toast.type] ?? icons.info
          return (
            <motion.div
              key={toast.id}
              layout={motionOk}
              initial={motionOk ? { opacity: 0, y: 18, scale: 0.94 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={motionOk ? { opacity: 0, scale: 0.94, transition: { duration: 0.16 } } : { opacity: 0 }}
              transition={motionOk ? spring.soft : { duration: 0 }}
              role="status"
              aria-live="polite"
              className="glass-strong pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-4 py-3 shadow-overlay"
            >
              <Icon size={18} strokeWidth={1.75} className={`shrink-0 ${className}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{toast.title}</p>
                {toast.message && (
                  <p className="mt-0.5 text-[12px] leading-4 text-ink-2">{toast.message}</p>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
              <span className="toast-progress" aria-hidden="true" />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
