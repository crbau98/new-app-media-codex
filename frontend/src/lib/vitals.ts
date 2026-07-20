type VitalName = 'LCP' | 'CLS' | 'INP' | 'feed_response' | 'first_tile' | 'video_start'

type VitalSample = {
  name: VitalName
  value: number
  at: number
  path: string
  meta?: Record<string, string | number | boolean>
}

const FLUSH_MS = 5000
const MAX_SAMPLES = 40
const samples: VitalSample[] = []
let installed = false
let flushTimer: number | null = null

function push(sample: VitalSample) {
  samples.push(sample)
  if (samples.length >= MAX_SAMPLES) flush()
  else scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_MS)
}

function flush() {
  if (!samples.length) return
  const payload = JSON.stringify({ samples: samples.splice(0, samples.length) })
  const blob = new Blob([payload], { type: 'application/json' })
  if (!navigator.sendBeacon('/api/diagnostics', blob)) {
    fetch('/api/diagnostics', { method: 'POST', body: payload, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {})
  }
}

function observeMetric(name: VitalName, entryTypes: string[], value: (entry: PerformanceEntry) => number | null) {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const metric = value(entry)
        if (metric !== null && Number.isFinite(metric)) {
          push({ name, value: Math.round(metric), at: Date.now(), path: location.pathname })
        }
      }
    })
    observer.observe({ type: entryTypes[0], buffered: true } as PerformanceObserverInit)
  } catch {
    // Older browsers / edge cases: vitals are best-effort and must never break the app.
  }
}

export function markVital(name: Exclude<VitalName, 'LCP' | 'CLS' | 'INP'>, value: number, meta?: VitalSample['meta']) {
  if (!installed || !Number.isFinite(value)) return
  push({ name, value: Math.round(value), at: Date.now(), path: location.pathname, meta })
}

export function installVitals() {
  if (installed || typeof window === 'undefined' || !('PerformanceObserver' in window)) return
  installed = true

  observeMetric('LCP', ['largest-contentful-paint'], (entry) => entry.startTime)
  observeMetric('CLS', ['layout-shift'], (entry) => {
    const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
    return shift.hadRecentInput ? null : (shift.value || 0) * 1000
  })
  observeMetric('INP', ['event'], (entry) => {
    const timing = entry as PerformanceEntry & { duration?: number; interactionId?: number }
    return timing.interactionId ? timing.duration || null : null
  })

  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
