import { useEffect, useRef, useState } from "react"
import { useAppStore } from "../store"
import type { ToastAction } from "../store"
import { cn } from "@/lib/cn"

const TOAST_DURATION = 4000
const MAX_TOASTS = 3

/* ------------------------------------------------------------------ */
/*  SVG icons                                                          */
/* ------------------------------------------------------------------ */
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/*  Per-type visual configuration                                      */
/* ------------------------------------------------------------------ */
interface TypeStyle {
  border: string
  iconColor: string
  progressColor: string
  Icon: () => React.JSX.Element
}

const TYPE_STYLES: Record<string, TypeStyle> = {
  success: {
    border: "border-l-emerald-500",
    iconColor: "text-emerald-400",
    progressColor: "bg-emerald-400",
    Icon: CheckIcon,
  },
  error: {
    border: "border-l-red-500",
    iconColor: "text-red-400",
    progressColor: "bg-red-400",
    Icon: ErrorIcon,
  },
  info: {
    border: "border-l-blue-500",
    iconColor: "text-blue-400",
    progressColor: "bg-blue-400",
    Icon: InfoIcon,
  },
}

/* ------------------------------------------------------------------ */
/*  Single toast item                                                  */
/* ------------------------------------------------------------------ */
function ToastItem({
  id,
  message,
  type,
  action,
}: {
  id: string
  message: string
  type?: string
  action?: ToastAction
}) {
  const removeToast = useAppStore((s) => s.removeToast)
  const [progress, setProgress] = useState(100)
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const startRef = useRef<number>(Date.now())
  const rafRef = useRef<number | null>(null)
  const dismissedRef = useRef(false)
  const pausedRef = useRef(false)
  const remainingRef = useRef(TOAST_DURATION)

  // Slide-in on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const dismiss = () => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    setExiting(true)
    // Wait for slide-out animation before removing from DOM
    setTimeout(() => removeToast(id), 280)
  }

  const pause = () => {
    if (pausedRef.current) return
    pausedRef.current = true
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    // Save how much time is left
    const elapsed = Date.now() - startRef.current
    remainingRef.current = Math.max(0, remainingRef.current - elapsed)
  }

  const resume = () => {
    if (!pausedRef.current) return
    pausedRef.current = false
    startRef.current = Date.now()
    startTick()
  }

  const startTick = () => {
    const tick = () => {
      if (pausedRef.current || dismissedRef.current) return
      const elapsed = Date.now() - startRef.current
      const remaining = Math.max(0, remainingRef.current - elapsed)
      const pct = (remaining / TOAST_DURATION) * 100
      setProgress(pct)
      if (remaining <= 0) {
        dismiss()
      } else {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // Progress bar countdown
  useEffect(() => {
    startRef.current = Date.now()
    remainingRef.current = TOAST_DURATION
    startTick()

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const style = TYPE_STYLES[type ?? "info"] ?? TYPE_STYLES.info
  const { Icon } = style

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
      onMouseEnter={pause}
      onMouseLeave={resume}
      style={{
        transform: !visible || exiting ? "translateX(calc(100% + 1.25rem))" : "translateX(0)",
        opacity: !visible || exiting ? 0 : 1,
        transition: "transform 300ms cubic-bezier(.4,0,.2,1), opacity 300ms cubic-bezier(.4,0,.2,1)",
      }}
      className={cn(
        "relative flex items-start gap-3 pl-4 pr-3 py-3 rounded-lg",
        "border-l-4 border border-white/10",
        "bg-white/5 backdrop-blur-xl shadow-xl",
        "text-sm text-text-primary select-none overflow-hidden",
        style.border,
      )}
    >
      {/* Icon */}
      <span className={cn("mt-0.5 shrink-0", style.iconColor)} aria-hidden="true">
        <Icon />
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <span className="break-words leading-snug">{message}</span>

        {/* Action button (e.g. Undo) */}
        {action && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              action.onClick()
              dismiss()
            }}
            className={cn(
              "ml-2 font-semibold underline underline-offset-2 transition-colors",
              style.iconColor,
              "hover:brightness-125",
            )}
          >
            {action.label}
          </button>
        )}
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          dismiss()
        }}
        className="mt-0.5 shrink-0 text-text-muted hover:text-text-primary transition-colors p-0.5 rounded hover:bg-white/10"
        aria-label="Dismiss notification"
      >
        <CloseIcon />
      </button>

      {/* Progress bar */}
      <div
        aria-hidden="true"
        className={cn("absolute bottom-0 left-0 h-[2px]", style.progressColor)}
        style={{
          width: `${progress}%`,
          opacity: 0.6,
          transition: "width 100ms linear",
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Container                                                          */
/* ------------------------------------------------------------------ */
export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  const visible = toasts.slice(-MAX_TOASTS)

  if (visible.length === 0) return null

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-20 right-5 z-50 flex flex-col gap-2 w-80 pointer-events-none"
      aria-label="Notifications"
    >
      {visible.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem {...t} />
        </div>
      ))}
    </div>
  )
}
