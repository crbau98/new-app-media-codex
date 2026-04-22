import { useEffect, useRef, useState } from "react"
import { apiUrl } from "../lib/backendOrigin"
import { useAppStore } from "../store"

const PING_INTERVAL = 60_000 // 60s
const PING_TIMEOUT_MS = 5_000

export function useConnectivity() {
  const setOnline = useAppStore((s) => s.setOnline)
  const setApiUnreachable = useAppStore((s) => s.setApiUnreachable)
  const isOnline = useAppStore((s) => s.isOnline)
  const apiUnreachable = useAppStore((s) => s.apiUnreachable)
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
        const res = await fetch(apiUrl("/healthz"), {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        })
        if (res.ok) {
          setOnline(true)
          setApiUnreachable(false)
        } else {
          // API returned an error (e.g. 503) but browser is still online
          setApiUnreachable(true)
        }
        setLastPingAt(Date.now())
      } catch {
        // Network failure — could be fully offline or API unreachable
        if (!navigator.onLine) {
          setOnline(false)
        }
        setApiUnreachable(true)
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
  }, [setOnline, setApiUnreachable])

  return { isOnline, apiUnreachable, lastPingAt }
}
