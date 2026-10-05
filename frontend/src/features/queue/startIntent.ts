/**
 * Hand-offs between surfaces that cannot call each other directly:
 *
 *  - "start intent": the next player created for an item should start at a
 *    given time / play immediately / loop a clip. Set by a moment card, by
 *    queue auto-advance, and by the dock <-> sheet hand-off; consumed (via
 *    `clearStartIntent`) by the VideoPlayer that mounts for that item.
 *  - "seek request": a player that is already mounted should jump (moment
 *    list rows in the detail sheet).
 *
 * Intents expire so a stale one can never hijack a later, unrelated open.
 */

export interface StartIntent {
  id: string
  /** Start position in seconds. */
  at?: number
  /** Begin playing even if the viewer's autoplay setting is off. */
  play?: boolean
  /** Loop this range from the start (a saved clip). */
  loop?: { a: number; b: number }
  stamp: number
}

export const START_INTENT_TTL_MS = 20_000

let pending: StartIntent | null = null

export function setStartIntent(intent: Omit<StartIntent, 'stamp'>, now = Date.now()): void {
  pending = { ...intent, stamp: now }
}

/** Pure read (safe under React StrictMode's double render). Returns null when absent, for another item, or expired. */
export function peekStartIntent(id: string, now = Date.now()): StartIntent | null {
  if (!pending || pending.id !== id || now - pending.stamp > START_INTENT_TTL_MS) return null
  return pending
}

export function clearStartIntent(intent: StartIntent | null): void {
  if (intent && pending === intent) pending = null
}

/* ── live playback hand-off (sheet <-> dock) ───────────────────── */

export interface PlaybackSnapshot {
  id: string
  at: number
  playing: boolean
  stamp: number
}

let lastPlayback: PlaybackSnapshot | null = null

/**
 * The sheet's player reports where it is (on timeupdate/pause/seek) while it plays
 * a queue item. Closing the sheet then needs no cooperation from the unmounting
 * player: the dock simply reads the freshest snapshot when it mounts.
 */
export function recordPlayback(id: string, at: number, playing: boolean, now = Date.now()): void {
  lastPlayback = { id, at, playing, stamp: now }
}

/** The freshest snapshot for `id`, as a start intent, when recent enough to still describe what the viewer was doing. */
export function peekHandoff(id: string, now = Date.now()): StartIntent | null {
  if (!lastPlayback || lastPlayback.id !== id || now - lastPlayback.stamp > START_INTENT_TTL_MS || lastPlayback.at < 1) return null
  return { id, at: lastPlayback.at, play: lastPlayback.playing, stamp: lastPlayback.stamp }
}

export function clearHandoff(id: string): void {
  if (lastPlayback?.id === id) lastPlayback = null
}

/** A player mounting for `id` drops any pending intent meant for a different item so it cannot linger. */
export function discardOtherIntents(id: string): void {
  if (pending && pending.id !== id) pending = null
}

/** Drop whatever is pending (tests, wipes). */
export function resetStartIntent(): void {
  pending = null
  lastPlayback = null
}

export const SEEK_EVENT = 'media-codex:player-seek'

export interface SeekDetail {
  id: string
  t: number
  /** When set, loop t→end (a saved clip). */
  end?: number
  play?: boolean
}

/** Ask the mounted player for `id` to seek (and optionally loop a clip). */
export function requestSeek(detail: SeekDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<SeekDetail>(SEEK_EVENT, { detail }))
}
