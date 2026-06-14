import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { crawlWebSocketUrl } from "../lib/backendOrigin"
import { useAppStore } from "../store"

export type CrawlEvent = { type: "crawl_start" | "crawl_done" | "source_start" | "ping"; source?: string; theme?: string; items_added?: number }

export function useCrawlSocket(onEvent?: (e: CrawlEvent) => void) {
  const setCrawlRunning = useAppStore((s) => s.setCrawlRunning)
  const queryClient = useQueryClient()
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    let cleanedUp = false
    const ws = new WebSocket(crawlWebSocketUrl())
    ws.onmessage = (ev) => {
      try {
        const event: CrawlEvent = JSON.parse(ev.data)
        if (event.type === "crawl_start") setCrawlRunning(true)
        if (event.type === "crawl_done") {
          setCrawlRunning(false)
          // Refresh only the views that matter — avoids thundering herd on backend
          queryClient.invalidateQueries({ queryKey: ["screenshots"] })
          queryClient.invalidateQueries({ queryKey: ["performers"] })
          queryClient.invalidateQueries({ queryKey: ["media-stats"] })
          queryClient.invalidateQueries({ queryKey: ["screenshot-terms"] })
          queryClient.invalidateQueries({ queryKey: ["screenshot-sources"] })
          queryClient.invalidateQueries({ queryKey: ["capture-queue"] })
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
