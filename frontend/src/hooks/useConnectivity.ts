import { useEffect, useRef, useState } from "react"
import { useAppStore } from "../store"

const PING_INTERVAL = 60_000 // 60s
const PING_TIMEOUT_MS = 5_000

export function useConnectivity() {
  const setOnline = useAppStore((s) => s.setOnline)
  const isOnline = useAppStore((s) => s.isOnline)
  const [lastPingAt, setLastPingAt] = useState<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Browser online/offline events
  useEffect(() => {
    function handleOnline() {
      setOnline(true)
    }
    function handleOffline() {
      setOnline(false)
    }
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [setOnline])

  // Periodic /healthz ping
  useEffect(() => {
    async function ping() {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
      try {
        const res = await fetch("/healthz", {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        })
        setOnline(res.ok)
        setLastPingAt(Date.now())
      } catch {
        setOnline(false)
        setLastPingAt(Date.now())
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    // Initial ping
    ping()

    intervalRef.current = setInterval(ping, PING_INTERVAL)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [setOnline])

  return { isOnline, lastPingAt }
}
