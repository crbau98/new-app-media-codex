import { useEffect, useSyncExternalStore } from 'react'

/* ââ Constants ââââââââââââââââââââââââââââââââââââââââââââââââââââ */
const PING_INTERVAL = 300_000          // 5 min between pings
const PING_TIMEOUT  = 8_000            // abort after 8 s
const PING_URL      = '/healthz'

/* ââ Shared external store ââââââââââââââââââââââââââââââââââââââââ */
let online = navigator.onLine
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
function getSnapshot() { return online }

function setOnline(v: boolean) {
  if (v === online) return
  online = v
  listeners.forEach((l) => l())
}

/* ââ Lightweight HEAD ping ââââââââââââââââââââââââââââââââââââââââ */
async function ping() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT)
  try {
    const res = await fetch(PING_URL, {
      method: 'HEAD',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    setOnline(res.ok)
  } catch {
    setOnline(false)
  } finally {
    clearTimeout(timer)
  }
}

/* ââ Hook âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */
export function useConnectivity() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    const onOn  = () => { setOnline(true);  ping() }
    const onOff = () => { setOnline(false) }
    window.addEventListener('online',  onOn)
    window.addEventListener('offline', onOff)

    // Periodic background ping
    const id = setInterval(ping, PING_INTERVAL)
    ping() // initial

    return () => {
      window.removeEventListener('online',  onOn)
      window.removeEventListener('offline', onOff)
      clearInterval(id)
    }
  }, [])

  return isOnline
}
