/**
 * The one place a PIN guess is checked: applies the persisted exponential
 * backoff, verifies against the stored PBKDF2 hash, and records the outcome.
 * Used by the lock screen and by Settings (change / remove PIN).
 */

import { getPrefs } from './prefs.ts'
import { verifyPin } from './pin.ts'
import { loadLockout, NO_LOCKOUT, registerFailure, remainingMs, saveLockout, freeAttemptsLeft } from './lockout.ts'

export type AttemptResult =
  | { ok: true }
  | { ok: false; reason: 'locked'; remainingMs: number }
  | { ok: false; reason: 'wrong'; remainingMs: number; freeLeft: number }
  | { ok: false; reason: 'no-pin' }

export async function attemptPin(pin: string, now: () => number = Date.now): Promise<AttemptResult> {
  const record = getPrefs().pin
  if (!record) return { ok: false, reason: 'no-pin' }
  const before = loadLockout()
  const wait = remainingMs(before, now())
  if (wait > 0) return { ok: false, reason: 'locked', remainingMs: wait }

  if (await verifyPin(pin, record)) {
    saveLockout(NO_LOCKOUT)
    return { ok: true }
  }
  const after = registerFailure(loadLockout(), now())
  saveLockout(after)
  return { ok: false, reason: 'wrong', remainingMs: remainingMs(after, now()), freeLeft: freeAttemptsLeft(after) }
}

/** Current wait imposed by earlier failures (0 when free to try). */
export function currentWaitMs(now: number = Date.now()): number {
  return remainingMs(loadLockout(), now)
}
