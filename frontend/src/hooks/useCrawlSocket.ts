import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAppStore } from "../store"

export type CrawlEvent = { type: "crawl_start" | "crawl_done" | "source_start" | "ping"; source?: string; theme?: string; items_added?: number }

export function useCrawlSocket(onEvent?: (e: CrawlEvent) => void) {
  const setCrawlRunning = useAppStore((s) => s.setCrawlRunning)
  const queryClient = useQueryClient()
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    let cleanedUp = false
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/crawl`)
    ws.onmessage = (ev) => {
      try {
        const event: CrawlEvent = JSON.parse(ev.data)
        if (event.type === "crawl_start") setCrawlRunning(true)
        if (event.type === "crawl_done") {
          setCrawlRunning(false)
          // Refresh all views so new items, hypotheses, and stats are visible immediately
          queryClient.invalidateQueries()
        }
        cbRef.current?.(event)
      } catch (e) {
        console.error("[useCrawlSocket] parse error", e)
      }
    }
    ws.onerror = () => ws.close()
    ws.onclose = () => {
      // Reset running state so the UI doesn't get stuck on a dead socket
      if (!cleanedUp) setCrawlRunning(false)
    }
    return () => {
      cleanedUp = true
      ws.close()
    }
  }, [setCrawlRunning, queryClient])
}
