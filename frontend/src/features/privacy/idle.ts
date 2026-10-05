/**
 * Auto-lock timer as a pure state machine. The gate feeds it activity /
 * visibility / tick events with timestamps; it answers "lock now?".
 *
 * Timestamps (not timers) are the source of truth, so background-tab timer
 * throttling and device sleep cannot delay a lock: the first event after
 * returning re-evaluates against the wall clock.
 */

export interface IdleConfig {
  /** Inactivity before locking, in ms. 0 = never. */
  idleMs: number
  /** Time hidden before locking, in ms. -1 = never, 0 = lock as soon as hidden. */
  hiddenMs: number
}

export interface IdleState {
  lastActivity: number
  hiddenAt: number | null
}

export type IdleEvent =
  | { type: 'activity'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'hidden'; now: number }
  | { type: 'visible'; now: number }
  | { type: 'reset'; now: number }

export interface IdleResult {
  state: IdleState
  lock: boolean
}

export function initialIdle(now: number): IdleState {
  return { lastActivity: now, hiddenAt: null }
}

export function idleConfigFrom(idleMinutes: number, hiddenSeconds: number): IdleConfig {
  return {
    idleMs: idleMinutes > 0 ? idleMinutes * 60_000 : 0,
    hiddenMs: hiddenSeconds < 0 ? -1 : hiddenSeconds * 1000,
  }
}

function idleExpired(state: IdleState, cfg: IdleConfig, now: number): boolean {
  return cfg.idleMs > 0 && now - state.lastActivity >= cfg.idleMs
}

function hiddenExpired(state: IdleState, cfg: IdleConfig, now: number): boolean {
  return state.hiddenAt !== null && cfg.hiddenMs >= 0 && now - state.hiddenAt >= cfg.hiddenMs
}

export function stepIdle(state: IdleState, event: IdleEvent, cfg: IdleConfig): IdleResult {
  const { now } = event
  switch (event.type) {
    case 'reset':
      return { state: initialIdle(now), lock: false }
    case 'activity':
      // Input while hidden cannot be a real person at the screen; ignore it.
      if (state.hiddenAt !== null) return { state, lock: false }
      return { state: { ...state, lastActivity: now }, lock: false }
    case 'hidden': {
      const next = state.hiddenAt === null ? { ...state, hiddenAt: now } : state
      return { state: next, lock: cfg.hiddenMs === 0 }
    }
    case 'visible': {
      const lock = hiddenExpired(state, cfg, now) || idleExpired(state, cfg, now)
      return { state: { lastActivity: lock ? state.lastActivity : now, hiddenAt: null }, lock }
    }
    case 'tick':
      return { state, lock: hiddenExpired(state, cfg, now) || (state.hiddenAt === null && idleExpired(state, cfg, now)) }
  }
}

/** Milliseconds until the next moment a lock could be due (for scheduling a single timer). */
export function nextDeadline(state: IdleState, cfg: IdleConfig, now: number): number | null {
  let deadline: number | null = null
  if (state.hiddenAt !== null) {
    if (cfg.hiddenMs > 0) deadline = state.hiddenAt + cfg.hiddenMs
  } else if (cfg.idleMs > 0) {
    deadline = state.lastActivity + cfg.idleMs
  }
  return deadline === null ? null : Math.max(deadline - now, 0)
}
