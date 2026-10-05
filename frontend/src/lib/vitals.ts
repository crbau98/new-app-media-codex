import { isLiteGraphics } from '@/lib/lite'
import { currentNetworkTier } from '@/lib/perf/connection'
import { cumulativeShift, estimateInp, type ShiftEntry } from '@/lib/perf/vitals-math'

type VitalName = 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB' | 'feed_response' | 'first_tile' | 'video_start'

type VitalMeta = Record<string, string | number | boolean>

type VitalSample = {
  name: VitalName
  value: number
  at: number
  path: string
  meta?: VitalMeta
}

const FLUSH_MS = 5000
const MAX_SAMPLES = 40
const samples: VitalSample[] = []
/** Latest value per metric for the current session (Settings readout). CLS is x1000, everything else ms. */
const latestByName: Partial<Record<VitalName, number>> = {}
/** What has already been sent, so each visibility change only reports what moved. */
const reported: Partial<Record<VitalName, number>> = {}
let installed = false
let flushTimer: number | null = null

/* Live state, folded into one sample per metric when the page is hidden. */
let lcp: { value: number; meta: VitalMeta } | null = null
let lcpFinal = false
const shifts: ShiftEntry[] = []
const interactionDurations = new Map<number, number>()
let interactionCount = 0
let maxInteractionId = 0
let inpMeta: VitalMeta | undefined
let worstInteraction = 0

function baseMeta(): VitalMeta {
  const meta: VitalMeta = { lite: isLiteGraphics(), net: currentNetworkTier() }
  const nav = navigator as Navigator & { deviceMemory?: number }
  if (typeof nav.deviceMemory === 'number') meta.mem = nav.deviceMemory
  if (typeof nav.hardwareConcurrency === 'number') meta.cores = nav.hardwareConcurrency
  return meta
}

function push(sample: VitalSample) {
  samples.push(sample)
  latestByName[sample.name] = sample.value
  if (samples.length >= MAX_SAMPLES) flush()
  else scheduleFlush()
}

/** Latest value per metric for the current session (Settings readout). */
export function getSessionVitals(): Partial<Record<VitalName, number>> {
  return { ...latestByName }
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

function currentCls(): number {
  return Math.round(cumulativeShift(shifts) * 1000)
}

function currentInp(): number {
  return estimateInp([...interactionDurations.values()], interactionCount)
}

/** Selector-ish description of an element, never text content (search boxes can hold private queries). */
function describe(node: unknown): string {
  if (!(node instanceof Element)) return ''
  const tag = node.tagName.toLowerCase()
  const first = (node.getAttribute('class') || '').split(/\s+/).find((name) => /^[a-z][a-z0-9-]{2,24}$/i.test(name))
  return first ? `${tag}.${first}` : tag
}

/**
 * Metrics that are only meaningful as a final number (LCP candidates, layout
 * shifts, interaction latencies) are folded locally and reported once when the
 * page is hidden, instead of one beacon sample per observer entry.
 */
function reportFinal() {
  lcpFinal = true
  const candidates: Array<[VitalName, number | null, VitalMeta | undefined]> = [
    ['LCP', lcp ? Math.round(lcp.value) : null, lcp?.meta],
    ['CLS', shifts.length ? currentCls() : 0, undefined],
    ['INP', interactionDurations.size ? currentInp() : null, inpMeta],
  ]
  for (const [name, value, meta] of candidates) {
    if (value === null || !Number.isFinite(value)) continue
    if (reported[name] === value) continue
    reported[name] = value
    push({ name, value, at: Date.now(), path: location.pathname, meta: { ...baseMeta(), ...meta } })
  }
  flush()
}

function observe(type: string, callback: (entries: PerformanceEntryList) => void, extra: Record<string, unknown> = {}) {
  try {
    const observer = new PerformanceObserver((list) => callback(list.getEntries()))
    observer.observe({ type, buffered: true, ...extra } as PerformanceObserverInit)
  } catch {
    // Older browsers / edge cases: vitals are best-effort and must never break the app.
  }
}

export function markVital(name: Exclude<VitalName, 'LCP' | 'CLS' | 'INP'>, value: number, meta?: VitalMeta) {
  if (!installed || !Number.isFinite(value)) return
  push({ name, value: Math.round(value), at: Date.now(), path: location.pathname, meta })
}

export function installVitals() {
  if (installed || typeof window === 'undefined' || !('PerformanceObserver' in window)) return
  installed = true

  observe('largest-contentful-paint', (entries) => {
    if (lcpFinal) return
    for (const entry of entries) {
      const element = (entry as PerformanceEntry & { element?: Element | null }).element
      lcp = { value: entry.startTime, meta: { el: describe(element) } }
      latestByName.LCP = Math.round(entry.startTime)
    }
  })

  observe('paint', (entries) => {
    for (const entry of entries) {
      if (entry.name === 'first-contentful-paint' && reported.FCP === undefined) {
        reported.FCP = Math.round(entry.startTime)
        push({ name: 'FCP', value: reported.FCP, at: Date.now(), path: location.pathname, meta: baseMeta() })
      }
    }
  })

  observe('navigation', (entries) => {
    for (const entry of entries) {
      const timing = entry as PerformanceNavigationTiming
      if (reported.TTFB === undefined && timing.responseStart > 0) {
        reported.TTFB = Math.round(timing.responseStart)
        push({ name: 'TTFB', value: reported.TTFB, at: Date.now(), path: location.pathname, meta: baseMeta() })
      }
    }
  })

  observe('layout-shift', (entries) => {
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }
      if (shift.hadRecentInput || !shift.value) continue
      shifts.push({ startTime: shift.startTime, value: shift.value })
    }
    latestByName.CLS = currentCls()
  })

  observe(
    'event',
    (entries) => {
      for (const entry of entries) {
        const timing = entry as PerformanceEntry & { duration?: number; interactionId?: number; target?: Node | null }
        if (!timing.interactionId || !timing.duration) continue
        // Interaction ids only grow, so a larger id is a new interaction.
        if (timing.interactionId > maxInteractionId) {
          maxInteractionId = timing.interactionId
          interactionCount += 1
        }
        const previous = interactionDurations.get(timing.interactionId) ?? 0
        if (timing.duration > previous) interactionDurations.set(timing.interactionId, timing.duration)
        if (timing.duration > worstInteraction) {
          worstInteraction = timing.duration
          inpMeta = { event: entry.name, target: describe(timing.target) }
        }
      }
      // Bound memory on very long sessions: keep the 10 slowest interactions (the estimator needs no more).
      if (interactionDurations.size > 60) {
        const keep = [...interactionDurations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
        interactionDurations.clear()
        for (const [id, duration] of keep) interactionDurations.set(id, duration)
      }
      latestByName.INP = currentInp()
    },
    { durationThreshold: 40 },
  )

  // A first user input ends LCP candidate selection (matches how browsers finalise it).
  for (const type of ['keydown', 'pointerdown'] as const) {
    window.addEventListener(type, () => { lcpFinal = true }, { once: true, passive: true, capture: true })
  }

  window.addEventListener('pagehide', reportFinal)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') reportFinal()
  })
}
