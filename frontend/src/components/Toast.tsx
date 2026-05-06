import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, Info, Award, X } from 'lucide-react'

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  achievement: Award,
}

const colorMap = {
  success: 'text-[var(--success)]',
  error: 'text-[var(--error)]',
  info: 'text-[var(--accent)]',
  achievement: 'text-[var(--warning)]',
}

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 w-full max-w-sm px-4 md:px-0 md:left-auto md:right-4 md:translate-x-0 left-0 md:top-4 top-4 items-center md:items-end">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = iconMap[toast.type]
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 100, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
              className={cn(
                'relative w-full md:w-auto min-w-[280px] max-w-sm',
                'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]',
                'shadow-lg p-3 flex items-start gap-3 overflow-hidden'
              )}
            >
              <Icon size={18} className={cn('shrink-0 mt-0.5', colorMap[toast.type])} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{toast.title}</p>
                {toast.message && (
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">{toast.message}</p>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] transition-colors shrink-0"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
              {/* Progress bar */}
              <div className="toast-progress" />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
