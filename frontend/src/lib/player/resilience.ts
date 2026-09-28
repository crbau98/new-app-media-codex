/** Media error classification + retry policy, framework-free. */

export type MediaErrorKind = 'aborted' | 'network' | 'decode' | 'unsupported' | 'stalled' | 'unknown'

export interface ClassifiedError {
  kind: MediaErrorKind
  /** Worth retrying the same source (with backoff) before moving on. */
  retrySame: boolean
  /** Skip straight to the next candidate. */
  nextSource: boolean
  /** User-facing explanation. */
  message: string
}

/** Map HTMLMediaElement MediaError codes (1–4) onto recovery behaviour. */
export function classifyMediaError(code: number | null | undefined): ClassifiedError {
  switch (code) {
    case 1:
      return { kind: 'aborted', retrySame: false, nextSource: false, message: 'Playback was interrupted.' }
    case 2:
      return { kind: 'network', retrySame: true, nextSource: false, message: 'Network hiccup while loading the video.' }
    case 3:
      return { kind: 'decode', retrySame: false, nextSource: true, message: 'This device could not decode that stream.' }
    case 4:
      return { kind: 'unsupported', retrySame: false, nextSource: true, message: 'That stream format is not supported here.' }
    default:
      return { kind: 'unknown', retrySame: false, nextSource: true, message: 'The stream failed to load.' }
  }
}

export const STALL_KIND: ClassifiedError = {
  kind: 'stalled',
  retrySame: true,
  nextSource: false,
  message: 'The stream stalled.',
}

/**
 * Exponential backoff with a cap. `jitter` in [0,1) lets callers inject
 * determinism in tests; default adds up to 25% random spread.
 */
export function backoffDelay(attempt: number, baseMs = 700, capMs = 8000, jitter = Math.random()): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt))
  return Math.round(exp * (1 + 0.25 * Math.min(1, Math.max(0, jitter))))
}

export interface NetworkProfile {
  saveData: boolean
  slow: boolean
  effectiveType?: string
}

export function readNetworkProfile(connection?: { saveData?: boolean; effectiveType?: string } | null): NetworkProfile {
  const effectiveType = connection?.effectiveType
  return {
    saveData: connection?.saveData === true,
    slow: effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g',
    effectiveType,
  }
}

/** `preload` attribute policy: never burn data on constrained links. */
export function preloadFor(profile: NetworkProfile, autoplay: boolean): 'none' | 'metadata' | 'auto' {
  if (profile.saveData) return autoplay ? 'metadata' : 'none'
  if (profile.slow) return 'metadata'
  return autoplay ? 'auto' : 'metadata'
}

/** Resume only for meaningful, unfinished positions. */
export function resumePosition(entry: { seconds: number; duration: number } | undefined, mediaDuration: number): number | null {
  if (!entry || entry.seconds <= 15) return null
  const duration = Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : entry.duration
  if (duration > 0 && entry.seconds >= duration * 0.92) return null
  return entry.seconds
}
