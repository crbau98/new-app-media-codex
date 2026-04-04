import { useState, useCallback, useRef, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAppStore, type ActiveView } from "../store"
import { api } from "../lib/api"

/* ------------------------------------------------------------------ */
/*  Per-view config                                                    */
/* ------------------------------------------------------------------ */

interface FabAction {
  icon: React.ReactNode
  label: string
  action: (ctx: ActionCtx) => void | Promise<void>
}

interface ActionCtx {
  addToast: (msg: string, type?: "success" | "error" | "info") => void
  setCrawlRunning: (v: boolean) => void
  setScreenshotRunning: (v: boolean) => void
  queryClient: ReturnType<typeof useQueryClient>
}

const PlayIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const DownloadIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const CameraIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
)

const SparkleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
  </svg>
)

const RefreshIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
  </svg>
)

function viewAction(view: ActiveView): FabAction {
  switch (view) {
    case "overview":
      return {
        icon: <PlayIcon />,
        label: "Run Crawl",
        action: async (ctx) => {
          ctx.setCrawlRunning(true)
          try {
            await api.triggerCrawl()
            ctx.addToast("Crawl started", "success")
          } catch {
            ctx.addToast("Failed to start crawl", "error")
            ctx.setCrawlRunning(false)
          }
        },
      }
    case "images":
      return {
        icon: <CameraIcon />,
        label: "Capture",
        action: async (ctx) => {
          ctx.setScreenshotRunning(true)
          try {
            const res = await api.triggerCapture()
            if (res.status === "already_running") {
              ctx.addToast("Capture already running", "info")
            } else {
              ctx.addToast("Screenshot capture started", "success")
            }
          } catch {
            ctx.addToast("Failed to start capture", "error")
            ctx.setScreenshotRunning(false)
          }
        },
      }
    case "settings":
      return {
        icon: <RefreshIcon />,
        label: "Reload",
        action: async (ctx) => {
          await ctx.queryClient.invalidateQueries()
          ctx.addToast("Settings reloaded", "info")
        },
      }
    case "performers":
      return {
        icon: <SparkleIcon />,
        label: "Add Creator",
        action: () => {
          const btn = document.querySelector<HTMLButtonElement>("[data-add-performer]")
          if (btn) btn.click()
        },
      }
    default:
      return {
        icon: <RefreshIcon />,
        label: "Refresh",
        action: async (ctx) => {
          await ctx.queryClient.invalidateQueries()
          ctx.addToast("Refreshed", "info")
        },
      }
  }
}

/* ------------------------------------------------------------------ */
/*  Speed-dial secondary actions                                       */
/* ------------------------------------------------------------------ */

interface SpeedDialItem {
  icon: React.ReactNode
  label: string
  action: (ctx: ActionCtx) => void | Promise<void>
}

const SPEED_DIAL: SpeedDialItem[] = [
  {
    icon: <PlayIcon />,
    label: "Run Crawl",
    action: async (ctx) => {
      ctx.setCrawlRunning(true)
      try {
        await api.triggerCrawl()
        ctx.addToast("Crawl started", "success")
      } catch {
        ctx.addToast("Failed to start crawl", "error")
        ctx.setCrawlRunning(false)
      }
    },
  },
  {
    icon: <CameraIcon />,
    label: "Capture Screenshots",
    action: async (ctx) => {
      ctx.setScreenshotRunning(true)
      try {
        const res = await api.triggerCapture()
        if (res.status === "already_running") {
          ctx.addToast("Capture already running", "info")
        } else {
          ctx.addToast("Screenshot capture started", "success")
        }
      } catch {
        ctx.addToast("Failed to start capture", "error")
        ctx.setScreenshotRunning(false)
      }
    },
  },
  {
    icon: <SparkleIcon />,
    label: "Open Creators",
    action: () => {
      useAppStore.getState().setActiveView("performers")
    },
  },
]

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FloatingActionButton() {
  const activeView = useAppStore((s) => s.activeView)
  const isOnline = useAppStore((s) => s.isOnline)
  const crawlRunning = useAppStore((s) => s.crawlRunning)
  const screenshotRunning = useAppStore((s) => s.screenshotRunning)
  const addToast = useAppStore((s) => s.addToast)
  const setCrawlRunning = useAppStore((s) => s.setCrawlRunning)
  const setScreenshotRunning = useAppStore((s) => s.setScreenshotRunning)
  const queryClient = useQueryClient()

  const [busy, setBusy] = useState(false)
  const [dialOpen, setDialOpen] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const pulsing = crawlRunning || screenshotRunning

  const ctx: ActionCtx = { addToast, setCrawlRunning, setScreenshotRunning, queryClient }
  const fab = viewAction(activeView)

  /* Close speed dial on outside click */
  useEffect(() => {
    if (!dialOpen) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDialOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [dialOpen])

  /* Close speed dial on Escape */
  useEffect(() => {
    if (!dialOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDialOpen(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [dialOpen])

  const handlePrimary = useCallback(async () => {
    if (busy || dialOpen) {
      setDialOpen(false)
      return
    }
    setBusy(true)
    try {
      await fab.action(ctx)
    } finally {
      setBusy(false)
    }
  }, [busy, dialOpen, fab, ctx])

  const handleSpeedDialAction = useCallback(
    async (item: SpeedDialItem) => {
      setDialOpen(false)
      setBusy(true)
      try {
        await item.action(ctx)
      } finally {
        setBusy(false)
      }
    },
    [ctx],
  )

  /* Long-press handlers */
  const onPointerDown = useCallback(() => {
    longPressTimer.current = setTimeout(() => {
      setDialOpen((v) => !v)
    }, 500)
  }, [])

  const onPointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setDialOpen((v) => !v)
  }, [])

  const disabled = busy || pulsing || !isOnline

  return (
    <div ref={containerRef} className="fixed bottom-20 right-4 z-50 md:bottom-6 md:right-6">
      {/* Speed dial items */}
      {dialOpen && (
        <div className="absolute bottom-16 right-0 mb-2 flex flex-col-reverse items-end gap-2">
          {SPEED_DIAL.map((item, i) => (
            <button
              key={item.label}
              onClick={() => handleSpeedDialAction(item)}
              className="flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-sm font-medium text-text-primary shadow-lg shadow-black/20 transition-all hover:bg-surface-3"
              style={{
                animation: `fab-fan-in 200ms ease-out ${i * 50}ms both`,
              }}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-accent">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Main FAB */}
      <div className="relative">
        {showTooltip && !dialOpen && (
          <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-primary shadow-lg">
            {!isOnline ? "Offline" : fab.label}
          </span>
        )}

        <button
          type="button"
          aria-label={!isOnline ? "Offline" : fab.label}
          disabled={disabled}
          onClick={handlePrimary}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onContextMenu={onContextMenu}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className={[
            "flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-black/30",
            "transition-transform duration-150",
            "hover:scale-110 hover:brightness-110",
            "active:scale-95",
            "disabled:opacity-60 disabled:cursor-not-allowed",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            pulsing ? "animate-pulse" : "",
          ].join(" ")}
        >
          {fab.icon}
        </button>
      </div>

      {/* Keyframes injected once */}
      <style>{`
        @keyframes fab-fan-in {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  )
}
