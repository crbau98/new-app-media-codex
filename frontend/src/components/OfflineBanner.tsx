import { useEffect, useRef, useState } from "react"
import { useAppStore } from "../store"

const WifiOffIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M16.72 11.06A10.94 10.94 0 0119 12.55" />
    <path d="M5 12.55a10.94 10.94 0 015.17-2.39" />
    <path d="M10.71 5.05A16 16 0 0122.56 9" />
    <path d="M1.42 9a15.91 15.91 0 014.7-2.88" />
    <path d="M8.53 16.11a6 6 0 016.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
)

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

type BannerState = "hidden" | "offline" | "api-error" | "back-online"

const AlertIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

export function OfflineBanner() {
  const isOnline = useAppStore((s) => s.isOnline)
  const apiUnreachable = useAppStore((s) => s.apiUnreachable)
  const [state, setState] = useState<BannerState>("hidden")
  const [dismissed, setDismissed] = useState(false)
  const prevOnline = useRef(isOnline)
  const prevApiUnreachable = useRef(apiUnreachable)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const wasOnline = prevOnline.current
    const wasApiUnreachable = prevApiUnreachable.current
    prevOnline.current = isOnline
    prevApiUnreachable.current = apiUnreachable

    if (!isOnline) {
      setDismissed(false)
      setState("offline")
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
    } else if (apiUnreachable) {
      setDismissed(false)
      setState("api-error")
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
    } else if ((wasApiUnreachable || !wasOnline) && isOnline && !apiUnreachable) {
      // Just recovered
      setState("back-online")
      setDismissed(false)
      fadeTimer.current = setTimeout(() => {
        setState("hidden")
      }, 3000)
    }

    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
    }
  }, [isOnline, apiUnreachable])

  if (state === "hidden" || dismissed) return null

  const showWarning = state === "offline" || state === "api-error"

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium shadow-md",
        "offline-banner-enter",
        showWarning
          ? "bg-amber-500/90 text-amber-950 dark:bg-amber-600/90 dark:text-amber-50"
          : "bg-emerald-500/90 text-emerald-950 dark:bg-emerald-600/90 dark:text-emerald-50",
        state === "back-online" ? "offline-banner-enter" : "",
      ].join(" ")}
    >
      {state === "offline" ? <WifiOffIcon /> : state === "api-error" ? <AlertIcon /> : <CheckIcon />}
      <span>
        {state === "offline"
          ? "You're offline \u2014 some features may be unavailable"
          : state === "api-error"
          ? "Unable to reach the server \u2014 retrying automatically"
          : "Back online"}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="ml-2 rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        aria-label="Dismiss"
      >
        <CloseIcon />
      </button>

    </div>
  )
}
