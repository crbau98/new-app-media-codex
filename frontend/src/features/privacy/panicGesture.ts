/** Pure gesture detectors for the panic shortcut. */

/**
 * Double-press detector (default: Escape twice within 450 ms). Call `press(now)`
 * on every qualifying keydown; it returns true on the second press and resets.
 */
export function createDoublePress(windowMs = 450) {
  let last = -Infinity
  return {
    press(now: number): boolean {
      if (now - last <= windowMs) {
        last = -Infinity
        return true
      }
      last = now
      return false
    },
    reset() { last = -Infinity },
  }
}

export interface TouchGesture {
  startedAt: number
  maxTouches: number
  moved: number
}

export const THREE_FINGER_MAX_MS = 450
export const THREE_FINGER_MAX_MOVE_PX = 28

/** A "tap" with exactly three fingers: short, nearly stationary, never more than three down. */
export function isThreeFingerTap(gesture: TouchGesture, endedAt: number): boolean {
  return gesture.maxTouches === 3 && endedAt - gesture.startedAt <= THREE_FINGER_MAX_MS && gesture.moved <= THREE_FINGER_MAX_MOVE_PX
}

/** True for a keydown that should count toward the Escape double-press. */
export function isEscapePress(event: { key: string; repeat?: boolean; isComposing?: boolean }): boolean {
  return event.key === 'Escape' && !event.repeat && !event.isComposing
}
