/**
 * Persistence + public API for the on-device taste profile.
 *
 * Everything lives in this browser's localStorage under `media-codex-taste-v1`.
 * Every read/write is wrapped in try/catch so private windows, blocked storage
 * or quota errors degrade to an in-memory profile.
 *
 * Settings-page integration (all synchronous, all safe to call anywhere):
 *   getTasteSummary()            -> what the engine has learned (for display)
 *   exportTasteProfile()         -> JSON string the user can download
 *   importTasteProfile(json)     -> boolean, validates before replacing
 *   resetTasteProfile()          -> wipes the profile (and recent AI queries/chats)
 *   isTasteLearningEnabled()     -> boolean
 *   setTasteLearningEnabled(on)  -> pause/resume learning without deleting
 *   subscribeTaste(listener)     -> unsubscribe fn, fired on any change
 */

import { emptyTasteProfile, applySignal, summarizeTaste, type SignalItem, type SignalKind, type TasteProfile, type TasteSummary } from './engine.ts'

export const TASTE_KEY = 'media-codex-taste-v1'
export const TASTE_ENABLED_KEY = 'media-codex-taste-enabled-v1'
/** Other AI-owned local keys that "reset" also clears. */
export const AI_LOCAL_KEYS = ['media-codex-ai-recent-v1', 'media-codex-concierge-v1', 'media-codex-ai-prefs-v1'] as const
export const TASTE_EVENT = 'media-codex:taste'

let memory: TasteProfile | null = null
let enabledMemory: boolean | null = null

function readStorage(key: string): string | null {
  try { return typeof window === 'undefined' ? null : window.localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string) {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, value) } catch { /* quota/private mode */ }
}
function removeStorage(key: string) {
  try { if (typeof window !== 'undefined') window.localStorage.removeItem(key) } catch { /* ignore */ }
}
function emit() {
  try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TASTE_EVENT)) } catch { /* ignore */ }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Structural validation; anything invalid returns null so callers fall back to an empty profile. */
export function validateProfile(value: unknown): TasteProfile | null {
  if (!isRecord(value) || value.v !== 1) return null
  const base = emptyTasteProfile()
  const bucket = (v: unknown): TasteProfile['tags'] => {
    const out: TasteProfile['tags'] = {}
    if (!isRecord(v)) return out
    for (const [k, a] of Object.entries(v).slice(0, 600)) {
      if (isRecord(a) && [a.w, a.t, a.p, a.q].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        out[k.slice(0, 80)] = { w: a.w as number, t: a.t as number, p: a.p as number, q: a.q as number }
      }
    }
    return out
  }
  const profile: TasteProfile = {
    ...base,
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : base.createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : base.updatedAt,
    events: typeof value.events === 'number' && value.events >= 0 ? Math.floor(value.events) : 0,
    tags: bucket(value.tags), creators: bucket(value.creators), sources: bucket(value.sources), searches: bucket(value.searches),
    applied: {},
  }
  if (isRecord(value.lengths)) {
    for (const key of ['xs', 's', 'm', 'l', 'xl'] as const) {
      const a = bucket({ x: value.lengths[key] }).x
      if (a) profile.lengths[key] = a
    }
  }
  if (isRecord(value.dayparts)) {
    for (const key of ['morning', 'day', 'evening', 'night'] as const) profile.dayparts[key] = bucket(value.dayparts[key])
  }
  if (isRecord(value.applied)) {
    for (const [k, n] of Object.entries(value.applied).slice(0, 1000)) if (typeof n === 'number') profile.applied[k.slice(0, 120)] = n
  }
  return profile
}

export function loadTasteProfile(): TasteProfile {
  if (memory) return memory
  let parsed: TasteProfile | null = null
  const raw = readStorage(TASTE_KEY)
  if (raw) { try { parsed = validateProfile(JSON.parse(raw)) } catch { parsed = null } }
  memory = parsed ?? emptyTasteProfile()
  return memory
}

/** Non-throwing cached accessor for synchronous rankers (`rankForYou`). Null when learning is off or there is no signal. */
export function getCachedTasteProfile(): TasteProfile | null {
  if (!isTasteLearningEnabled()) return null
  const profile = loadTasteProfile()
  return profile.events > 0 ? profile : null
}

export function saveTasteProfile(profile: TasteProfile, notify = true) {
  memory = profile
  writeStorage(TASTE_KEY, JSON.stringify(profile))
  if (notify) emit()
}

export function isTasteLearningEnabled(): boolean {
  if (enabledMemory !== null) return enabledMemory
  enabledMemory = readStorage(TASTE_ENABLED_KEY) !== '0'
  return enabledMemory
}

export function setTasteLearningEnabled(enabled: boolean) {
  enabledMemory = enabled
  writeStorage(TASTE_ENABLED_KEY, enabled ? '1' : '0')
  emit()
}

/** Record a one-off signal (e.g. "more like this" from the command bar). No-op while learning is paused. */
export function recordTasteSignal(kind: SignalKind, item: SignalItem | null, opts: { term?: string; amount?: number } = {}) {
  if (!isTasteLearningEnabled()) return
  saveTasteProfile(applySignal(loadTasteProfile(), kind, item, opts))
}

export function recordSearchTerm(term: string) {
  const clean = term.trim().slice(0, 120)
  if (clean.length < 3) return
  recordTasteSignal('search', null, { term: clean })
}

export function getTasteSummary(now = Date.now()): TasteSummary { return summarizeTaste(loadTasteProfile(), now) }

export function exportTasteProfile(): string {
  return JSON.stringify({ app: 'media-codex', kind: 'taste-profile', exportedAt: new Date().toISOString(), profile: loadTasteProfile(), summary: getTasteSummary() }, null, 2)
}

export function importTasteProfile(json: string): boolean {
  try {
    const parsed: unknown = JSON.parse(json)
    const candidate = isRecord(parsed) && 'profile' in parsed ? parsed.profile : parsed
    const profile = validateProfile(candidate)
    if (!profile) return false
    saveTasteProfile(profile)
    return true
  } catch { return false }
}

/** Wipe the taste profile plus recent AI queries and concierge history. */
export function resetTasteProfile() {
  memory = emptyTasteProfile()
  removeStorage(TASTE_KEY)
  for (const key of AI_LOCAL_KEYS) removeStorage(key)
  emit()
}

export function subscribeTaste(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(TASTE_EVENT, listener)
  const onStorage = (e: StorageEvent) => { if (e.key === TASTE_KEY) { memory = null; listener() } }
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(TASTE_EVENT, listener); window.removeEventListener('storage', onStorage) }
}

/** Test seam: drop the in-memory copies so the next read hits storage. */
export function _resetTasteMemory() { memory = null; enabledMemory = null }
