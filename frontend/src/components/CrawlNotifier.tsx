import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { crawlWebSocketUrl } from "@/lib/backendOrigin"
import { useAppStore } from "../store"
import { sharedQueryKeys } from "@/features/sharedQueries"

/**
 * Side-effect-only component: connects to /ws/crawl WebSocket,
 * updates store state and shows toast notifications for crawl events.
 * Auto-reconnects with exponential backoff (max 30s).
 * Renders nothing.
 */

interface CrawlMessage {
  type: string
  items_added?: number
  source?: string
  theme?: string
  message?: string
  count?: number
}

export function CrawlNotifier(): null {
  const queryClient = useQueryClient()
  const activeView = useAppStore((s) => s.activeView)
  const setCrawlRunning = useAppStore((s) => s.setCrawlRunning)
  const setScreenshotRunning = useAppStore((s) => s.setScreenshotRunning)
  const addToast = useAppStore((s) => s.addToast)
  const addNotification = useAppStore((s) => s.addNotification)

  // Keep stable refs so the effect doesn't re-run on every render
  const setCrawlRunningRef = useRef(setCrawlRunning)
  const setScreenshotRunningRef = useRef(setScreenshotRunning)
  const addToastRef = useRef(addToast)
  const addNotificationRef = useRef(addNotification)
  const activeViewRef = useRef(activeView)
  setCrawlRunningRef.current = setCrawlRunning
  setScreenshotRunningRef.current = setScreenshotRunning
  addToastRef.current = addToast
  addNotificationRef.current = addNotification
  activeViewRef.current = activeView

  const pendingInvalidationsRef = useRef(new Map<string, readonly unknown[]>())
  const invalidateTimerRef = useRef<number | null>(null)

  function flushInvalidations() {
    const keys = [...pendingInvalidationsRef.current.values()]
    pendingInvalidationsRef.current.clear()
    invalidateTimerRef.current = null
    if (!keys.length) return

    void Promise.all(
      keys.map((queryKey) =>
        queryClient.invalidateQueries({
          queryKey,
          refetchType: "active",
        }),
      ),
    )
  }

  function invalidateQueries(keys: readonly (readonly unknown[])[]) {
    for (const queryKey of keys) {
      pendingInvalidationsRef.current.set(JSON.stringify(queryKey), queryKey)
    }
    if (invalidateTimerRef.current != null) return
    invalidateTimerRef.current = window.setTimeout(flushInvalidations, 120)
  }

  function invalidateAfterCrawl() {
    invalidateQueries([
      ["dashboard"],
      ["app-shell-summary"],
      ["screenshots"],
      sharedQueryKeys.mediaStats(),
    ])
  }

  function invalidateAfterCapture() {
    invalidateQueries([
      ["dashboard"],
      ["app-shell-summary"],
      ["screenshots"],
      ["screenshot-status"],
      sharedQueryKeys.mediaStats(),
      sharedQueryKeys.captureQueue(),
    ])
    if (activeViewRef.current === "images") {
      invalidateQueries([
        sharedQueryKeys.screenshotTerms(),
        ["screenshot-sources"],
        sharedQueryKeys.screenshotAllTags(),
        ["performers-for-media"],
      ])
    }
    if (activeViewRef.current === "performers" || activeViewRef.current === "images") {
      invalidateQueries([sharedQueryKeys.performerStats()])
    }
  }

  useEffect(() => {
    let unmounted = false
    let ws: WebSocket | null = null
    let reconnectDelay = 1000 // start at 1s

    function connect() {
      if (unmounted) return

      ws = new WebSocket(crawlWebSocketUrl())

      ws.onopen = () => {
        // Reset backoff on successful connection
        reconnectDelay = 1000
      }

      ws.onmessage = (ev) => {
        try {
          const msg: CrawlMessage = JSON.parse(ev.data)

          switch (msg.type) {
            case "crawl_start":
              setCrawlRunningRef.current(true)
              addToastRef.current("Crawl started", "info")
              addNotificationRef.current("Crawl started", "crawl")
              break

            case "crawl_done": {
              setCrawlRunningRef.current(false)
              const doneMsg = `Crawl complete: ${msg.items_added ?? 0} new images`
              addToastRef.current(doneMsg, "success")
              addNotificationRef.current(doneMsg, "crawl")
              invalidateAfterCrawl()
              break
            }

            case "crawl_error": {
              setCrawlRunningRef.current(false)
              const errMsg = `Crawl error: ${msg.message ?? "unknown error"}`
              addToastRef.current(errMsg, "error")
              addNotificationRef.current(errMsg, "system")
              break
            }

            case "screenshot_start":
              setScreenshotRunningRef.current(true)
              addToastRef.current("Screenshot capture started", "info")
              addNotificationRef.current("Screenshot capture started", "capture")
              break

            case "screenshot_done": {
              setScreenshotRunningRef.current(false)
              const capMsg = `Captured ${msg.count ?? 0} screenshots`
              addToastRef.current(capMsg, "success")
              addNotificationRef.current(capMsg, "capture")
              invalidateAfterCapture()
              break
            }

            case "ping":
            case "source_start":
              // No toast for pings or per-source progress
              break

            default:
              break
          }
        } catch (e) {
          console.error("[CrawlNotifier] parse error", e)
        }
      }

      ws.onerror = () => {
        ws?.close()
      }

      ws.onclose = () => {
        if (unmounted) return
        // Schedule reconnect with exponential backoff, max 30s
        const delay = reconnectDelay
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
        setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      unmounted = true
      if (invalidateTimerRef.current != null) {
        window.clearTimeout(invalidateTimerRef.current)
        invalidateTimerRef.current = null
      }
      ws?.close()
    }
  }, [queryClient])

  return null
}
