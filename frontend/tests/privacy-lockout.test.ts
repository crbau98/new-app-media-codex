import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BASE_DELAY_MS, FREE_ATTEMPTS, LOCKOUT_KEY, MAX_DELAY_MS, NO_LOCKOUT, delayForFailures, formatWait, freeAttemptsLeft, loadLockout, parseLockout, registerFailure, remainingMs, saveLockout,
} from '../src/features/privacy/lockout.ts'
import { attemptPin, currentWaitMs } from '../src/features/privacy/auth.ts'
import { hashPin } from '../src/features/privacy/pin.ts'
import { PRIVACY_KEY, _resetPrefsCache, getPrefs } from '../src/features/privacy/prefs.ts'

test('backoff: free attempts, then 30s doubling up to the cap', () => {
  assert.equal(FREE_ATTEMPTS, 2)
  assert.deepEqual([0, 1, 2].map(delayForFailures), [0, 0, 0])
  assert.equal(delayForFailures(3), BASE_DELAY_MS)
  assert.equal(delayForFailures(4), BASE_DELAY_MS * 2)
  assert.equal(delayForFailures(5), BASE_DELAY_MS * 4)
  assert.equal(delayForFailures(6), BASE_DELAY_MS * 8)
  assert.equal(delayForFailures(50), MAX_DELAY_MS)
  assert.equal(delayForFailures(10_000), MAX_DELAY_MS)
  assert.equal(delayForFailures(Number.NaN), 0)
})

test('registerFailure escalates and remainingMs counts down to zero', () => {
  let state = NO_LOCKOUT
  const now = 1_000_000
  state = registerFailure(state, now)
  state = registerFailure(state, now)
  assert.equal(remainingMs(state, now), 0, 'two free guesses')
  assert.equal(freeAttemptsLeft(state), 0)
  state = registerFailure(state, now)
  assert.equal(state.failures, 3)
  assert.equal(remainingMs(state, now), 30_000)
  assert.equal(remainingMs(state, now + 12_000), 18_000)
  assert.equal(remainingMs(state, now + 30_000), 0)
  assert.equal(remainingMs(state, now + 99_000), 0)
  state = registerFailure(state, now + 31_000)
  assert.equal(remainingMs(state, now + 31_000), 60_000)
})

test('remainingMs never exceeds the maximum even for a forward-dated or tampered lockedUntil', () => {
  assert.equal(remainingMs({ failures: 9, lockedUntil: Date.now() + 10 * 365 * 24 * 3600 * 1000 }, Date.now()), MAX_DELAY_MS)
})

test('parseLockout sanitises stored state', () => {
  assert.deepEqual(parseLockout(null), NO_LOCKOUT)
  assert.deepEqual(parseLockout('garbage'), NO_LOCKOUT)
  assert.deepEqual(parseLockout(JSON.stringify({ failures: -1, lockedUntil: 5 })), NO_LOCKOUT)
  assert.deepEqual(parseLockout(JSON.stringify({ failures: 'x', lockedUntil: 5 })), NO_LOCKOUT)
  assert.deepEqual(parseLockout(JSON.stringify({ failures: 4.9, lockedUntil: 77 })), { failures: 4, lockedUntil: 77 })
  assert.equal(parseLockout(JSON.stringify({ failures: 1e9, lockedUntil: 1 })).failures, 1000)
})

test('formatWait is human readable', () => {
  assert.equal(formatWait(1), '1s')
  assert.equal(formatWait(30_000), '30s')
  assert.equal(formatWait(60_000), '1m')
  assert.equal(formatWait(90_000), '1m 30s')
  assert.equal(formatWait(3_600_000), '1h 00m')
})

/* ---- integration: attemptPin against a fake localStorage ---- */

function installFakeWindow() {
  const data = new Map<string, string>()
  const localStorage = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, String(v)) },
    removeItem: (k: string) => { data.delete(k) },
  }
  ;(globalThis as unknown as { window: unknown }).window = { localStorage, addEventListener() {}, removeEventListener() {} }
  _resetPrefsCache()
  return data
}

test('attemptPin: wrong guesses trigger persisted backoff, success clears it', async () => {
  const data = installFakeWindow()
  const record = await hashPin('5920', { iterations: 1000 })
  data.set(PRIVACY_KEY, JSON.stringify({ pin: record }))
  _resetPrefsCache()
  assert.equal(getPrefs().pin?.len, 4)

  let clock = 5_000_000
  const now = () => clock

  assert.deepEqual(await attemptPin('0000', now), { ok: false, reason: 'wrong', remainingMs: 0, freeLeft: 1 })
  assert.deepEqual(await attemptPin('1111', now), { ok: false, reason: 'wrong', remainingMs: 0, freeLeft: 0 })
  const third = await attemptPin('2222', now)
  assert.equal(third.ok, false)
  assert.equal(third.ok === false && third.reason === 'wrong' && third.remainingMs, 30_000)

  // Persisted: a "reload" (fresh read) still sees the pause, and even the RIGHT PIN is refused during it.
  assert.equal(JSON.parse(data.get(LOCKOUT_KEY)!).failures, 3)
  assert.equal(currentWaitMs(clock), 30_000)
  const during = await attemptPin('5920', now)
  assert.deepEqual(during, { ok: false, reason: 'locked', remainingMs: 30_000 })

  clock += 31_000
  assert.equal(currentWaitMs(clock), 0)
  assert.deepEqual(await attemptPin('5920', now), { ok: true })
  assert.equal(data.has(LOCKOUT_KEY), false, 'success clears the counter')
  assert.deepEqual(loadLockout(), NO_LOCKOUT)
})

test('attemptPin without a PIN reports no-pin', async () => {
  installFakeWindow()
  assert.deepEqual(await attemptPin('1234'), { ok: false, reason: 'no-pin' })
  saveLockout({ failures: 0, lockedUntil: 0 })
})
