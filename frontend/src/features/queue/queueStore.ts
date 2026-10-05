/**
 * The watch queue as a singleton, framework-free store. It survives route
 * changes (it lives outside React) and page reloads (persisted through
 * `persist.ts`, restored paused). React reads it via `useQueue()` in hooks.ts.
 */
import { collectionFromIds, loadCollections, persistCollections, PRIVATE_DATA_CLEARED_EVENT, type MediaCollection } from '../../lib/collections.ts'
import type { MediaItem } from '../../lib/types.ts'
import { readRaw, STORAGE_KEYS, writeRaw } from './persist.ts'
import {
  clear as clearModel,
  clearHistory as clearHistoryModel,
  cycleRepeat as cycleRepeatModel,
  effectiveAutoplay,
  emptyQueue,
  enqueue as enqueueModel,
  jumpTo as jumpToModel,
  moveUpcomingBy,
  next as nextModel,
  parseQueue,
  previous as previousModel,
  queueIds,
  removeUpcoming,
  serializeQueue,
  setAutoplay as setAutoplayModel,
  setRepeat as setRepeatModel,
  setShuffle as setShuffleModel,
  setUpcomingOrder,
  startFrom,
  type AutoplayPref,
  type EnqueueOutcome,
  type QueueState,
  type RepeatMode,
  type StepOutcome,
  type StepResult,
} from './queueModel.ts'
import { createStore, createWriter } from './storeKit.ts'

/** Dispatched on window after the queue moves to a different item (next, previous, jump, auto-advance). */
export const QUEUE_NAV_EVENT = 'media-codex:queue-nav'

export interface QueueNavDetail {
  item: MediaItem
  outcome: StepOutcome
  /** 'auto' when a video ended on its own — the next player should start playing. */
  reason: 'manual' | 'auto'
}

const store = createStore<QueueState>(() => parseQueue(readRaw(STORAGE_KEYS.queue)))
const writer = createWriter(() => {
  writeRaw(STORAGE_KEYS.queue, serializeQueue(store.get()))
})

let crossTabHooked = false
function hookCrossTab() {
  if (crossTabHooked || typeof window === 'undefined') return
  crossTabHooked = true
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEYS.queue) store.set(parseQueue(event.newValue))
  })
  window.addEventListener(PRIVATE_DATA_CLEARED_EVENT, () => store.set(emptyQueue()))
}

export function getQueue(): QueueState {
  return store.get()
}

export function subscribeQueue(listener: () => void): () => void {
  hookCrossTab()
  return store.subscribe(listener)
}

function commit(next: QueueState) {
  if (next === store.get()) return
  store.set(next)
  writer.schedule()
}

function announce(result: StepResult, reason: 'manual' | 'auto') {
  if (!result.item || (result.outcome !== 'moved' && result.outcome !== 'wrapped')) return
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<QueueNavDetail>(QUEUE_NAV_EVENT, { detail: { item: result.item, outcome: result.outcome, reason } }))
}

/** Test/maintenance seam: write any pending change right now. */
export function flushQueue(): void {
  writer.flush()
}

/** Test seam: drop the cached state so the next read reloads from storage. */
export function resetQueueCache(): void {
  store.reset()
}

export const queueActions = {
  get: getQueue,

  /** Add an item after the current one ('next') or at the end ('last'). `anchor` = the item being watched. */
  enqueue(item: MediaItem, where: 'last' | 'next', anchor?: MediaItem | null): EnqueueOutcome {
    const result = enqueueModel(getQueue(), item, where, anchor)
    commit(result.state)
    return result.outcome
  },

  /** Replace the queue with `items` (first one becomes the current item). Returns the new head. */
  playFrom(items: MediaItem[]): MediaItem | null {
    const state = startFrom(getQueue(), items)
    commit(state)
    return state.nowPlaying
  },

  next(reason: 'manual' | 'auto' = 'manual'): StepOutcome {
    const result = nextModel(getQueue(), reason)
    commit(result.state)
    announce(result, reason)
    return result.outcome
  },

  previous(): StepOutcome {
    const result = previousModel(getQueue())
    commit(result.state)
    announce(result, 'manual')
    return result.outcome
  },

  jumpTo(id: string): StepOutcome {
    const result = jumpToModel(getQueue(), id)
    commit(result.state)
    announce(result, 'manual')
    return result.outcome
  },

  remove(id: string) {
    commit(removeUpcoming(getQueue(), id))
  },

  moveBy(id: string, delta: number) {
    commit(moveUpcomingBy(getQueue(), id, delta))
  },

  reorder(ids: readonly string[]) {
    commit(setUpcomingOrder(getQueue(), ids))
  },

  clear(scope: 'upcoming' | 'all') {
    commit(clearModel(getQueue(), scope))
  },

  clearHistory() {
    commit(clearHistoryModel(getQueue()))
  },

  setShuffle(on: boolean) {
    commit(setShuffleModel(getQueue(), on))
  },

  setRepeat(mode: RepeatMode) {
    commit(setRepeatModel(getQueue(), mode))
  },

  cycleRepeat() {
    commit(cycleRepeatModel(getQueue()))
  },

  setAutoplay(pref: AutoplayPref) {
    commit(setAutoplayModel(getQueue(), pref))
  },

  /** Flip the *effective* autoplay-next for `playingId` to an explicit on/off preference. */
  toggleAutoplay(playingId: string | null | undefined) {
    const state = getQueue()
    commit(setAutoplayModel(state, effectiveAutoplay(state, playingId) ? 'off' : 'on'))
  },

  /** Save the current queue (now playing first) as a new on-device collection. */
  saveAsCollection(name: string): MediaCollection | null {
    const ids = queueIds(getQueue())
    if (ids.length === 0) return null
    const collection = collectionFromIds(name || 'Saved queue', ids)
    persistCollections([collection, ...loadCollections()])
    return collection
  },
}
