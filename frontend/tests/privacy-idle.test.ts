import assert from 'node:assert/strict'
import test from 'node:test'

import { idleConfigFrom, initialIdle, nextDeadline, stepIdle, type IdleEvent, type IdleState } from '../src/features/privacy/idle.ts'
import { THREE_FINGER_MAX_MOVE_PX, THREE_FINGER_MAX_MS, createDoublePress, isEscapePress, isThreeFingerTap } from '../src/features/privacy/panicGesture.ts'
import { initialMode, nextMode } from '../src/features/privacy/vaultMachine.ts'
import { INITIAL_CALC, pressCalc, type CalcKey } from '../src/features/privacy/calc.ts'

const run = (state: IdleState, cfg: ReturnType<typeof idleConfigFrom>, events: IdleEvent[]) => {
  let locked = false
  for (const event of events) {
    const result = stepIdle(state, event, cfg)
    state = result.state
    locked ||= result.lock
  }
  return { state, locked }
}

test('idleConfigFrom maps minutes/seconds, with 0 = never idle and -1 = never hidden', () => {
  assert.deepEqual(idleConfigFrom(5, 60), { idleMs: 300_000, hiddenMs: 60_000 })
  assert.deepEqual(idleConfigFrom(0, -1), { idleMs: 0, hiddenMs: -1 })
  assert.deepEqual(idleConfigFrom(1, 0), { idleMs: 60_000, hiddenMs: 0 })
})

test('idle: locks only after the full timeout with no activity; activity resets the clock', () => {
  const cfg = idleConfigFrom(1, -1)
  const t0 = 1_000
  assert.equal(run(initialIdle(t0), cfg, [{ type: 'tick', now: t0 + 59_999 }]).locked, false)
  assert.equal(run(initialIdle(t0), cfg, [{ type: 'tick', now: t0 + 60_000 }]).locked, true)
  const withActivity = run(initialIdle(t0), cfg, [
    { type: 'activity', now: t0 + 50_000 },
    { type: 'tick', now: t0 + 100_000 },
  ])
  assert.equal(withActivity.locked, false, 'activity at 50s pushes the deadline to 110s')
  assert.equal(run(withActivity.state, cfg, [{ type: 'tick', now: t0 + 110_000 }]).locked, true)
})

test('idle never locks when disabled', () => {
  const cfg = idleConfigFrom(0, -1)
  const result = run(initialIdle(0), cfg, [
    { type: 'tick', now: 10 ** 9 }, { type: 'hidden', now: 10 ** 9 }, { type: 'tick', now: 10 ** 10 }, { type: 'visible', now: 10 ** 11 },
  ])
  assert.equal(result.locked, false)
  assert.equal(nextDeadline(initialIdle(0), cfg, 0), null)
})

test('hidden: "right away" locks on hide (covers the app switcher)', () => {
  const cfg = idleConfigFrom(0, 0)
  assert.equal(stepIdle(initialIdle(0), { type: 'hidden', now: 5 }, cfg).lock, true)
})

test('hidden for N seconds: locks on return, not before; short trips do not lock', () => {
  const cfg = idleConfigFrom(0, 30)
  const hidden = stepIdle(initialIdle(0), { type: 'hidden', now: 1_000 }, cfg)
  assert.equal(hidden.lock, false)
  assert.equal(stepIdle(hidden.state, { type: 'visible', now: 20_000 }, cfg).lock, false, 'back after 19s')
  assert.equal(stepIdle(hidden.state, { type: 'visible', now: 31_000 }, cfg).lock, true, 'back after 30s')
  // Background timer throttling: a late tick while still hidden also locks.
  assert.equal(stepIdle(hidden.state, { type: 'tick', now: 31_500 }, cfg).lock, true)
})

test('returning to a visible tab clears the hidden marker and counts as fresh activity', () => {
  const cfg = idleConfigFrom(1, 60)
  const hidden = stepIdle(initialIdle(0), { type: 'hidden', now: 1_000 }, cfg)
  const back = stepIdle(hidden.state, { type: 'visible', now: 10_000 }, cfg)
  assert.equal(back.lock, false)
  assert.equal(back.state.hiddenAt, null)
  assert.equal(back.state.lastActivity, 10_000)
})

test('idle also counts time spent hidden when the hidden timeout is "never"', () => {
  const cfg = idleConfigFrom(1, -1)
  const hidden = stepIdle(initialIdle(0), { type: 'hidden', now: 1_000 }, cfg)
  assert.equal(stepIdle(hidden.state, { type: 'visible', now: 90_000 }, cfg).lock, true)
})

test('activity while hidden is ignored and nextDeadline schedules the earliest due time', () => {
  const cfg = idleConfigFrom(5, 60)
  const hidden = stepIdle(initialIdle(0), { type: 'hidden', now: 1_000 }, cfg)
  assert.equal(stepIdle(hidden.state, { type: 'activity', now: 2_000 }, cfg).state, hidden.state)
  assert.equal(nextDeadline(hidden.state, cfg, 1_000), 60_000)
  assert.equal(nextDeadline(initialIdle(0), cfg, 100_000), 200_000)
  assert.equal(nextDeadline(initialIdle(0), cfg, 10 ** 9), 0)
})

test('double-press: second Escape inside the window triggers; slow or repeated presses do not', () => {
  const d = createDoublePress(450)
  assert.equal(d.press(1_000), false)
  assert.equal(d.press(1_300), true)
  assert.equal(d.press(1_400), false, 'detector resets after firing')
  assert.equal(d.press(2_000), false)
  assert.equal(d.press(2_451), false, 'outside the window')
  assert.equal(d.press(2_800), true)
  d.reset()
  assert.equal(d.press(2_900), false)
})

test('isEscapePress ignores auto-repeat, IME composition and other keys', () => {
  assert.equal(isEscapePress({ key: 'Escape' }), true)
  assert.equal(isEscapePress({ key: 'Escape', repeat: true }), false)
  assert.equal(isEscapePress({ key: 'Escape', isComposing: true }), false)
  assert.equal(isEscapePress({ key: 'Enter' }), false)
})

test('three-finger tap: exactly three fingers, quick and nearly still', () => {
  const g = { startedAt: 0, maxTouches: 3, moved: 4 }
  assert.equal(isThreeFingerTap(g, 200), true)
  assert.equal(isThreeFingerTap(g, THREE_FINGER_MAX_MS + 1), false)
  assert.equal(isThreeFingerTap({ ...g, moved: THREE_FINGER_MAX_MOVE_PX + 1 }, 200), false)
  assert.equal(isThreeFingerTap({ ...g, maxTouches: 2 }, 200), false)
  assert.equal(isThreeFingerTap({ ...g, maxTouches: 4 }, 200), false)
})

test('vault machine: lock on load, panic from anywhere, reveal asks for the PIN when set', () => {
  assert.equal(initialMode({ pinSet: true, lockOnLoad: true }), 'locked')
  assert.equal(initialMode({ pinSet: true, lockOnLoad: false }), 'open')
  assert.equal(initialMode({ pinSet: false, lockOnLoad: true }), 'open')

  const withPin = { pinSet: true }
  const noPin = { pinSet: false }
  assert.equal(nextMode('open', 'panic', withPin), 'decoy')
  assert.equal(nextMode('locked', 'panic', withPin), 'decoy')
  assert.equal(nextMode('open', 'panic', noPin), 'decoy')
  assert.equal(nextMode('open', 'lock', withPin), 'locked')
  assert.equal(nextMode('open', 'lock', noPin), 'open', 'no credential, nothing to lock behind')
  assert.equal(nextMode('decoy', 'lock', withPin), 'decoy', 'a lock never reveals the decoy')
  assert.equal(nextMode('decoy', 'reveal', withPin), 'locked')
  assert.equal(nextMode('decoy', 'reveal', noPin), 'open')
  assert.equal(nextMode('open', 'reveal', withPin), 'open')
  assert.equal(nextMode('locked', 'unlock', withPin), 'open')
})

test('calculator decoy actually calculates', () => {
  const type = (keys: CalcKey[]) => keys.reduce(pressCalc, INITIAL_CALC)
  assert.equal(type(['1', '2', '+', '3', '=']).display, '15')
  assert.equal(type(['9', '*', '9', '=']).display, '81')
  assert.equal(type(['1', '0', '/', '4', '=']).display, '2.5')
  assert.equal(type(['0', '.', '1', '+', '0', '.', '2', '=']).display, '0.3', 'no float noise')
  assert.equal(type(['5', '/', '0', '=']).display, 'Error')
  assert.equal(type(['5', '/', '0', '=', '7']).display, 'Error', 'stuck until AC')
  assert.equal(type(['5', '/', '0', '=', 'C', '7']).display, '7')
  assert.equal(type(['2', '+', '3', '+', '4', '=']).display, '9', 'chains left to right')
  assert.equal(type(['8', '±']).display, '-8')
  assert.equal(type(['5', '0', '%']).display, '0.5')
  assert.equal(type(['1', '.', '.', '5']).display, '1.5', 'one decimal point only')
  assert.equal(type(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1']).display, '123456789', 'nine digits max')
})
