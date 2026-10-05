/**
 * PIN attempt throttling with exponential backoff. Pure functions plus a tiny
 * persisted record so a reload does not reset the counter.
 *
 * Policy: the first two wrong PINs are free; from the third on the wait is
 * 30 s, doubling each time (30 s, 1 m, 2 m, 4 m, ...) up to one hour.
 */

export const LOCKOUT_KEY = 'media-codex-lockout-v1'
export const FREE_ATTEMPTS = 2
export const BASE_DELAY_MS = 30_000
export const MAX_DELAY_MS = 60 * 60 * 1000

export interface LockoutState {
  failures: number
  lockedUntil: number
}

export const NO_LOCKOUT: LockoutState = { failures: 0, lockedUntil: 0 }

export function delayForFailures(failures: number): number {
  if (!Number.isFinite(failures) || failures <= FREE_ATTEMPTS) return 0
  const exponent = Math.min(failures - FREE_ATTEMPTS - 1, 20)
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS)
}

export function registerFailure(state: LockoutState, now: number): LockoutState {
  const failures = Math.min(state.failures + 1, 1000)
  const delay = delayForFailures(failures)
  return { failures, lockedUntil: delay ? now + delay : 0 }
}

/**
 * Milliseconds still to wait. Clamped to MAX_DELAY_MS so a tampered or
 * forward-dated `lockedUntil` can never lock the user out for longer than the
 * policy maximum.
 */
export function remainingMs(state: LockoutState, now: number): number {
  if (!state.lockedUntil) return 0
  return Math.min(Math.max(state.lockedUntil - now, 0), MAX_DELAY_MS)
}

/** Wrong guesses still allowed before the next pause starts. */
export function freeAttemptsLeft(state: LockoutState): number {
  return Math.max(FREE_ATTEMPTS - state.failures, 0)
}

export function parseLockout(raw: string | null | undefined): LockoutState {
  if (!raw) return NO_LOCKOUT
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return NO_LOCKOUT
    const { failures, lockedUntil } = data as Record<string, unknown>
    if (typeof failures !== 'number' || typeof lockedUntil !== 'number') return NO_LOCKOUT
    if (!Number.isFinite(failures) || !Number.isFinite(lockedUntil) || failures < 0 || lockedUntil < 0) return NO_LOCKOUT
    return { failures: Math.min(Math.floor(failures), 1000), lockedUntil }
  } catch {
    return NO_LOCKOUT
  }
}

export function loadLockout(): LockoutState {
  try { return parseLockout(window.localStorage.getItem(LOCKOUT_KEY)) } catch { return NO_LOCKOUT }
}

export function saveLockout(state: LockoutState) {
  try {
    if (state.failures === 0) window.localStorage.removeItem(LOCKOUT_KEY)
    else window.localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state))
  } catch { /* in-memory only */ }
}

export function formatWait(ms: number): string {
  const total = Math.ceil(ms / 1000)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
