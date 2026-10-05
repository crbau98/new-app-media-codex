/**
 * Small on-device memories that make the player feel personal, all bounded
 * and transparent:
 *
 *  - per-item playback speed ("this one I watch at 1.5×")
 *  - per-creator typical start offset ("skip to where you usually start")
 *
 * Pure functions first, then thin storage wrappers that go through
 * `persist.ts` (so incognito can silence them).
 */
import { cleanNumber, cleanString, isRecord } from './sanitize.ts'
import { readJson, STORAGE_KEYS, writeJson } from './persist.ts'

/* ── playback speed per item ──────────────────────────────────── */

export const MAX_RATE_ENTRIES = 150
export type RateMap = Record<string, [rate: number, updatedAt: number]>

export function sanitizeRates(raw: unknown): RateMap {
  if (!isRecord(raw)) return {}
  const entries: Array<[string, [number, number]]> = []
  for (const [id, value] of Object.entries(raw)) {
    if (!Array.isArray(value) || id.length > 300) continue
    const rate = cleanNumber(value[0], 0.25, 4)
    if (rate === undefined) continue
    entries.push([id, [rate, cleanNumber(value[1], 0, 8.64e15) ?? 0]])
  }
  entries.sort((a, b) => b[1][1] - a[1][1])
  return Object.fromEntries(entries.slice(0, MAX_RATE_ENTRIES))
}

export function withRate(map: RateMap, id: string, rate: number, now = Date.now()): RateMap {
  const clamped = cleanNumber(rate, 0.25, 4)
  if (!id || clamped === undefined) return map
  return sanitizeRates({ ...map, [id]: [clamped, now] })
}

export function rateFor(map: RateMap, id: string): number | undefined {
  return map[id]?.[0]
}

export function loadItemRates(): RateMap {
  return sanitizeRates(readJson<unknown>(STORAGE_KEYS.itemRates, {}))
}

export function saveItemRate(id: string, rate: number): void {
  writeJson(STORAGE_KEYS.itemRates, withRate(loadItemRates(), id, rate))
}

/* ── per-creator typical start (smart start) ──────────────────── */

export const MAX_CREATORS = 80
export const MAX_SAMPLES = 6
export const MIN_SAMPLES = 3
/** Only forward jumps that land between these many seconds count as "skipping an intro". */
export const MIN_SKIP_TARGET = 4
export const MAX_SKIP_TARGET = 180

export interface CreatorStarts {
  samples: number[]
  updatedAt: number
}
export interface SmartStartState {
  v: 1
  creators: Record<string, CreatorStarts>
}

export const emptySmartStart = (): SmartStartState => ({ v: 1, creators: {} })

export function creatorStartKey(creator: string): string {
  return cleanString(creator, 80).toLowerCase()
}

export function sanitizeSmartStart(raw: unknown): SmartStartState {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.creators)) return emptySmartStart()
  const entries: Array<[string, CreatorStarts]> = []
  for (const [key, value] of Object.entries(raw.creators)) {
    if (!isRecord(value) || !Array.isArray(value.samples) || key.length > 80) continue
    // Out-of-window samples are dropped, not clamped: a skip to 1 s is not an intro skip.
    const samples = value.samples
      .filter((sample): sample is number => typeof sample === 'number' && Number.isFinite(sample) && sample >= MIN_SKIP_TARGET && sample <= MAX_SKIP_TARGET)
      .slice(0, MAX_SAMPLES)
    if (samples.length) entries.push([key, { samples, updatedAt: cleanNumber(value.updatedAt, 0, 8.64e15) ?? 0 }])
  }
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  return { v: 1, creators: Object.fromEntries(entries.slice(0, MAX_CREATORS)) }
}

/** Remember that the viewer skipped forward to `seconds` near the start of one of this creator's videos. */
export function recordSkip(state: SmartStartState, creator: string, seconds: number, now = Date.now()): SmartStartState {
  const key = creatorStartKey(creator)
  const target = cleanNumber(seconds, 0, 1e6)
  if (!key || target === undefined || target < MIN_SKIP_TARGET || target > MAX_SKIP_TARGET) return state
  const previous = state.creators[key]?.samples ?? []
  const samples = [Math.round(target), ...previous].slice(0, MAX_SAMPLES)
  return sanitizeSmartStart({ v: 1, creators: { ...state.creators, [key]: { samples, updatedAt: now } } })
}

export interface StartSuggestion {
  seconds: number
  samples: number
}

/**
 * Suggest a start offset only when the viewer has done the same thing
 * repeatedly: at least MIN_SAMPLES recorded skips, and enough of them agree
 * (within ±25% / 6 s of the median) to call it a habit rather than a whim.
 */
export function suggestStart(state: SmartStartState, creator: string): StartSuggestion | null {
  const samples = state.creators[creatorStartKey(creator)]?.samples ?? []
  if (samples.length < MIN_SAMPLES) return null
  const sorted = samples.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const tolerance = Math.max(6, median * 0.25)
  const agreeing = sorted.filter((sample) => Math.abs(sample - median) <= tolerance)
  if (agreeing.length < MIN_SAMPLES) return null
  const seconds = Math.round(agreeing.reduce((sum, sample) => sum + sample, 0) / agreeing.length)
  return { seconds, samples: agreeing.length }
}

export function forgetCreatorStart(state: SmartStartState, creator: string): SmartStartState {
  const key = creatorStartKey(creator)
  if (!state.creators[key]) return state
  const creators = { ...state.creators }
  delete creators[key]
  return { v: 1, creators }
}

export function loadSmartStart(): SmartStartState {
  return sanitizeSmartStart(readJson<unknown>(STORAGE_KEYS.smartStart, null))
}

export function saveSmartStart(state: SmartStartState): void {
  writeJson(STORAGE_KEYS.smartStart, state)
}
