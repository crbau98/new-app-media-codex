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
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [paused, setPaused] = useState(false)
  const startRef = useRef<number>(Date.now())
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissedRef = useRef(false)
  const remainingRef = useRef(TOAST_DURATION)

  // Slide-in on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const startTimer = (duration: number) => {
    clearTimer()
    startRef.current = Date.now()
    timeoutRef.current = setTimeout(dismiss, duration)
  }

  const dismiss = () => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    clearTimer()
    setExiting(true)
    // Wait for slide-out animation before removing from DOM
    setTimeout(() => removeToast(id), 240)
  }

  const pause = () => {
    if (paused || dismissedRef.current) return
    clearTimer()
    const elapsed = Date.now() - startRef.current
    remainingRef.current = Math.max(0, remainingRef.current - elapsed)
    setPaused(true)
  }

  const resume = () => {
    if (!paused || dismissedRef.current) return
    setPaused(false)
    startTimer(Math.max(remainingRef.current, 0))
  }

  // Progress bar countdown
  useEffect(() => {
    remainingRef.current = TOAST_DURATION
    startTimer(TOAST_DURATION)

    return () => {
      clearTimer()
    }
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
        "bg-white/5 backdrop-blur-[2px] shadow-md shadow-black/20",
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
        className={cn("toast-progress absolute bottom-0 left-0 h-[2px] origin-left", style.progressColor)}
        style={{
          opacity: 0.6,
          animationDuration: `${TOAST_DURATION}ms`,
          animationPlayState: paused ? "paused" : "running",
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
      className="fixed bottom-20 right-5 z-50 flex w-80 flex-col gap-2 pointer-events-none"
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
