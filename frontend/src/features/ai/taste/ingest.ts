/**
 * Turns the app's existing local state (likes, follows, views, hides, watch
 * progress) into taste signals — idempotently, via a ledger stored in the
 * profile itself. No other module needs to know the taste engine exists.
 */

import { creatorFollowId } from '../../../lib/discovery.ts'
import { applySignal, type SignalItem, type TasteProfile } from './engine.ts'

export interface ProgressLike { seconds: number; duration: number; updatedAt: number }

export interface AppSignalSnapshot {
  likes: Record<string, boolean | undefined>
  follows: Record<string, boolean | undefined>
  recentlyViewed: string[]
  hidden: string[]
  progress: Record<string, ProgressLike | undefined>
}

const MAX_LEDGER = 900
const SESSION_GAP_MS = 10 * 60_000

/**
 * Apply any not-yet-seen signals for the items we can currently resolve.
 * Returns the same profile object when nothing changed.
 */
export function ingestSnapshot(
  profile: TasteProfile,
  snapshot: AppSignalSnapshot,
  items: SignalItem[],
  now = Date.now(),
): TasteProfile {
  let next = profile
  let changed = false
  const ensureOwnLedger = () => {
    if (next === profile) next = { ...profile, applied: { ...profile.applied } }
  }
  const apply = (kind: Parameters<typeof applySignal>[1], item: SignalItem, opts?: Parameters<typeof applySignal>[3]) => {
    const ledger = { ...next.applied }
    next = applySignal(next, kind, item, { now, ...opts })
    next.applied = ledger
    changed = true
  }
  const seenCreators = new Set<string>()

  for (const item of items) {
    const id = item.id
    ensureOwnLedger()

    // Likes (and un-likes)
    const likeKey = `like:${id}`
    if (snapshot.likes[id] && !next.applied[likeKey]) { apply('like', item); next.applied[likeKey] = now }
    else if (!snapshot.likes[id] && next.applied[likeKey]) { apply('unlike', item); delete next.applied[likeKey] }

    // Follows are per creator, applied once per creator handle.
    const followId = creatorFollowId(item.creator)
    if (!seenCreators.has(followId)) {
      seenCreators.add(followId)
      const followKey = `follow:${followId}`
      if (snapshot.follows[followId] && !next.applied[followKey]) { apply('follow', item); next.applied[followKey] = now }
      else if (!snapshot.follows[followId] && next.applied[followKey]) { apply('unfollow', item); delete next.applied[followKey] }
    }

    // Opened in the detail sheet
    const viewKey = `view:${id}`
    if (snapshot.recentlyViewed.includes(id) && !next.applied[viewKey]) { apply('view', item); next.applied[viewKey] = now }

    // Hidden
    const hideKey = `hide:${id}`
    if (snapshot.hidden.includes(id) && !next.applied[hideKey]) { apply('hide', item); next.applied[hideKey] = now }

    // Watch progress: dwell, completion, skips
    const entry = snapshot.progress[id]
    if (entry) {
      const progKey = `prog:${id}`
      const before = next.applied[progKey] ?? 0
      const delta = entry.seconds - before
      if (delta >= 15) { apply('dwell', item, { amount: Math.min(3, delta / 60) }); next.applied[progKey] = entry.seconds }
      const doneKey = `done:${id}`
      if (entry.duration > 0 && entry.seconds / entry.duration >= 0.85 && !next.applied[doneKey]) { apply('complete', item); next.applied[doneKey] = now }
      const skipKey = `skip:${id}`
      if (entry.seconds < 8 && now - entry.updatedAt > SESSION_GAP_MS && !next.applied[skipKey] && !next.applied[progKey]) { apply('skip', item); next.applied[skipKey] = now }
    }
  }

  if (!changed) return profile
  const keys = Object.keys(next.applied)
  if (keys.length > MAX_LEDGER) {
    const applied: Record<string, number> = {}
    for (const key of keys.slice(keys.length - MAX_LEDGER)) applied[key] = next.applied[key]
    next = { ...next, applied }
  }
  return next
}
