import assert from 'node:assert/strict'
import test from 'node:test'

import { installBrowserEnv } from './queue-env.ts'
import type { MediaItem } from '../src/lib/types.ts'
import {
  MAX_PROGRESS_ENTRIES,
  clearPrivateMediaData,
  clearProgress,
  continueWatching,
  loadCollections,
  loadProgress,
  progressRatio,
  recordProgress,
  removeProgress,
  unfinishedEntries,
  type ProgressEntry,
} from '../src/lib/collections.ts'
import { PRIVATE_MEDIA_KEYS, STORAGE_KEYS, readJson, removeKey, setWriteGate, writeAllowed, writeJson, writeRaw } from '../src/features/queue/persist.ts'
import {
  MAX_CREATORS,
  MAX_RATE_ENTRIES,
  emptySmartStart,
  forgetCreatorStart,
  loadItemRates,
  loadSmartStart,
  rateFor,
  recordSkip,
  saveItemRate,
  saveSmartStart,
  sanitizeRates,
  sanitizeSmartStart,
  suggestStart,
  withRate,
} from '../src/features/queue/playerMemory.ts'
import { loadPlayerPrefs, savePlayerPrefs } from '../src/lib/player/prefs.ts'
import {
  START_INTENT_TTL_MS,
  clearHandoff,
  clearStartIntent,
  discardOtherIntents,
  peekHandoff,
  peekStartIntent,
  recordPlayback,
  resetStartIntent,
  setStartIntent,
} from '../src/features/queue/startIntent.ts'
import { surface, overlayOpen } from '../src/features/queue/surface.ts'

function video(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id, title: `T ${id}`, thumbnail: `https://img.example/${id}.jpg`, source: 'S', duration: '10:00', isVideo: true, category: 'c', creator: 'cr', tags: [], rating: 1, createdAt: '2026-01-01', views: 0, ...over,
  }
}

test('writeAllowed defaults to true, the gate can close it, and a throwing gate fails closed', () => {
  assert.equal(writeAllowed(), true)
  setWriteGate(() => false)
  assert.equal(writeAllowed(), false)
  setWriteGate(() => {
    throw new Error('boom')
  })
  assert.equal(writeAllowed(), false)
  setWriteGate(() => true)
  assert.equal(writeAllowed(), true)
  setWriteGate(null)
  assert.equal(writeAllowed(), true)
})

test('persist helpers: gated writes, guarded reads, quota errors, forced wipes', () => {
  const storage = installBrowserEnv()
  assert.equal(writeJson('k', { a: 1 }), true)
  assert.deepEqual(readJson('k', null), { a: 1 })
  assert.equal(readJson('missing', 'fallback'), 'fallback')
  storage.data.set('bad', '{nope')
  assert.equal(readJson('bad', 7), 7)

  setWriteGate(() => false)
  assert.equal(writeRaw('k', 'changed'), false)
  assert.deepEqual(readJson('k', null), { a: 1 }, 'a gated write changes nothing')
  removeKey('k')
  assert.ok(storage.data.has('k'), 'a gated remove changes nothing')
  removeKey('k', { force: true })
  assert.ok(!storage.data.has('k'), 'an explicit wipe always works')
  setWriteGate(null)

  storage.failWrites = true
  assert.equal(writeJson('k2', 1), false, 'quota errors never throw')
  storage.failWrites = false
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.equal(writeJson('k3', circular), false, 'unserialisable values never throw')
})

test('no localStorage at all is fine (SSR / blocked storage)', () => {
  const target = globalThis as unknown as Record<string, unknown>
  const saved = target.localStorage
  delete target.localStorage
  assert.equal(readJson('x', 'dflt'), 'dflt')
  assert.equal(writeJson('x', 1), false)
  target.localStorage = saved
})

test('watch progress: recorded, bounded, sorted by recency, removable and clearable', () => {
  installBrowserEnv()
  const now = Date.now()
  const a = video('a')
  recordProgress(a, 120)
  recordProgress(video('b'), 300)
  recordProgress(video('photo', { isVideo: false }), 50)
  assert.deepEqual(Object.keys(loadProgress()).sort(), ['a', 'b'], 'photos never record progress')
  assert.equal(loadProgress().a.duration, 600)

  const cw = continueWatching(10)
  assert.equal(cw.length, 2)
  assert.ok(cw[0].updatedAt >= cw[1].updatedAt)

  const map: Record<string, ProgressEntry> = {
    old: { itemId: 'old', seconds: 100, duration: 600, updatedAt: now - 5000 },
    fresh: { itemId: 'fresh', seconds: 100, duration: 600, updatedAt: now },
    done: { itemId: 'done', seconds: 590, duration: 600, updatedAt: now + 10 },
    tiny: { itemId: 'tiny', seconds: 5, duration: 600, updatedAt: now + 20 },
  }
  assert.deepEqual(unfinishedEntries(map).map((entry) => entry.itemId), ['fresh', 'old'], 'finished and barely-started items are excluded')
  assert.equal(progressRatio(map.old), 100 / 600)
  assert.equal(progressRatio({ seconds: 5, duration: 0 }), null)
  assert.equal(progressRatio(undefined), null)

  removeProgress('a')
  assert.ok(!('a' in loadProgress()))
  clearProgress()
  assert.deepEqual(loadProgress(), {})

  for (let i = 0; i < MAX_PROGRESS_ENTRIES + 20; i += 1) recordProgress(video(`v${i}`), 100)
  assert.equal(Object.keys(loadProgress()).length, MAX_PROGRESS_ENTRIES)
})

test('progress is not recorded while the write gate is closed (incognito)', () => {
  installBrowserEnv()
  setWriteGate(() => false)
  recordProgress(video('secret'), 200)
  setWriteGate(null)
  assert.deepEqual(loadProgress(), {})
})

test('clearPrivateMediaData removes every private key even while gated', () => {
  const storage = installBrowserEnv()
  for (const key of PRIVATE_MEDIA_KEYS) storage.data.set(key, '[]')
  storage.data.set(STORAGE_KEYS.player, '{}')
  setWriteGate(() => false)
  clearPrivateMediaData()
  setWriteGate(null)
  for (const key of PRIVATE_MEDIA_KEYS) assert.ok(!storage.data.has(key), key)
  assert.ok(storage.data.has(STORAGE_KEYS.player), 'player prefs are not viewing history')
  assert.ok(PRIVATE_MEDIA_KEYS.includes(STORAGE_KEYS.queue))
  assert.ok(PRIVATE_MEDIA_KEYS.includes(STORAGE_KEYS.moments))
  assert.deepEqual(loadCollections(), [])
})

test('player prefs keep working through the gate and default smartStart on', () => {
  installBrowserEnv()
  assert.equal(loadPlayerPrefs().smartStart, true)
  savePlayerPrefs({ rate: 1.5, smartStart: false })
  assert.equal(loadPlayerPrefs().rate, 1.5)
  assert.equal(loadPlayerPrefs().smartStart, false)
  savePlayerPrefs({ rate: 99 })
  assert.equal(loadPlayerPrefs().rate, 1, 'out-of-range stored values fall back')
})

test('per-item playback speed memory is bounded and sanitised', () => {
  installBrowserEnv()
  saveItemRate('vid-a', 1.5)
  saveItemRate('vid-b', 0.75)
  assert.equal(rateFor(loadItemRates(), 'vid-a'), 1.5)
  assert.equal(rateFor(loadItemRates(), 'vid-b'), 0.75)
  assert.equal(rateFor(loadItemRates(), 'vid-c'), undefined)

  let map = {}
  for (let i = 0; i < MAX_RATE_ENTRIES + 30; i += 1) map = withRate(map, `v${i}`, 1.25, i + 1)
  assert.equal(Object.keys(map).length, MAX_RATE_ENTRIES)
  assert.equal(rateFor(map, `v${MAX_RATE_ENTRIES + 29}`), 1.25)
  assert.equal(rateFor(map, 'v0'), undefined, 'least recent entries are evicted')

  // Out-of-range speeds are clamped into 0.25–4×; non-numeric entries are dropped.
  assert.deepEqual(sanitizeRates({ a: [9, 1], b: ['x', 1], c: [2, 5], d: 'no', e: [0.1, 1] }), { a: [4, 1], c: [2, 5], e: [0.25, 1] })
  assert.deepEqual(withRate({}, 'x', Number.NaN), {})
})

test('smart start: needs repeated, consistent skips; forgettable; bounded', () => {
  let state = emptySmartStart()
  assert.equal(suggestStart(state, 'Studio'), null)
  state = recordSkip(state, 'Studio', 22, 1)
  state = recordSkip(state, 'studio', 24, 2) // creator keys are case-insensitive
  assert.equal(suggestStart(state, 'Studio'), null, 'two skips is not yet a habit')
  state = recordSkip(state, 'Studio', 23, 3)
  const suggestion = suggestStart(state, 'STUDIO')
  assert.deepEqual(suggestion, { seconds: 23, samples: 3 })

  // Inconsistent skips never produce a suggestion.
  let scattered = emptySmartStart()
  for (const [i, seconds] of [8, 60, 140, 30].entries()) scattered = recordSkip(scattered, 'Chaos', seconds, i + 1)
  assert.equal(suggestStart(scattered, 'Chaos'), null)

  // Targets outside the intro window are ignored.
  assert.deepEqual(recordSkip(emptySmartStart(), 'x', 2).creators, {})
  assert.deepEqual(recordSkip(emptySmartStart(), 'x', 5000).creators, {})
  assert.deepEqual(recordSkip(emptySmartStart(), '', 30).creators, {})

  const forgotten = forgetCreatorStart(state, 'studio')
  assert.equal(suggestStart(forgotten, 'Studio'), null)
  assert.equal(forgetCreatorStart(forgotten, 'studio'), forgotten)

  let many = emptySmartStart()
  for (let i = 0; i < MAX_CREATORS + 15; i += 1) many = recordSkip(many, `creator-${i}`, 20, i + 1)
  assert.equal(Object.keys(many.creators).length, MAX_CREATORS)

  installBrowserEnv()
  saveSmartStart(state)
  assert.deepEqual(suggestStart(loadSmartStart(), 'studio'), { seconds: 23, samples: 3 })
  assert.deepEqual(sanitizeSmartStart({ v: 2 }), emptySmartStart())
  assert.deepEqual(sanitizeSmartStart({ v: 1, creators: { a: { samples: ['x', 1, 40], updatedAt: 3 } } }).creators.a.samples, [40])
})

test('start intents expire, are item-specific, and can be cleared', () => {
  resetStartIntent()
  setStartIntent({ id: 'a', at: 42, play: true }, 1000)
  assert.equal(peekStartIntent('b', 1001), null)
  const intent = peekStartIntent('a', 1001)
  assert.equal(intent?.at, 42)
  assert.equal(peekStartIntent('a', 1001), intent, 'peeking is pure (safe under StrictMode)')
  assert.equal(peekStartIntent('a', 1000 + START_INTENT_TTL_MS + 1), null, 'stale intents never hijack a later open')
  discardOtherIntents('a')
  assert.ok(peekStartIntent('a', 1001))
  discardOtherIntents('z')
  assert.equal(peekStartIntent('a', 1001), null)
  setStartIntent({ id: 'c', loop: { a: 3, b: 9 } }, 5000)
  clearStartIntent(peekStartIntent('c', 5001))
  assert.equal(peekStartIntent('c', 5001), null)
})

test('live playback hand-off: the dock reads the sheet\'s freshest position without the player\'s help', () => {
  resetStartIntent()
  recordPlayback('a', 2.5, true, 1000)
  recordPlayback('a', 3.1, true, 1250)
  assert.deepEqual(peekHandoff('a', 1300), { id: 'a', at: 3.1, play: true, stamp: 1250 })
  assert.equal(peekHandoff('b', 1300), null, 'only for the same item')
  assert.equal(peekHandoff('a', 1250 + START_INTENT_TTL_MS + 1), null, 'stale snapshots are ignored')
  recordPlayback('a', 3.4, false, 2000)
  assert.equal(peekHandoff('a', 2100)?.play, false, 'a paused sheet hands over paused')
  recordPlayback('a', 0.4, true, 3000)
  assert.equal(peekHandoff('a', 3001), null, 'nothing worth handing over in the first second')
  recordPlayback('a', 5, true, 4000)
  clearHandoff('zzz')
  assert.ok(peekHandoff('a', 4001))
  clearHandoff('a')
  assert.equal(peekHandoff('a', 4001), null)
})

test('surface registry: sheets, overlays and dock dismissal', () => {
  assert.equal(surface.get().sheets, 0)
  const release = surface.registerSheet()
  const releaseTwo = surface.registerSheet()
  assert.equal(surface.get().sheets, 2)
  release()
  release() // double release is harmless
  assert.equal(surface.get().sheets, 1)
  releaseTwo()
  assert.equal(surface.get().sheets, 0)

  assert.equal(overlayOpen(), false)
  surface.openPanel()
  assert.equal(overlayOpen(), true)
  surface.openHelp()
  assert.equal(surface.get().panelOpen, false, 'help replaces the drawer')
  assert.equal(overlayOpen(), true)
  surface.closeHelp()
  assert.equal(overlayOpen(), false)
  surface.togglePanel()
  surface.togglePanel()
  assert.equal(surface.get().panelOpen, false)

  surface.dismissDock()
  assert.equal(surface.get().dockDismissed, true)
  surface.reviveDock()
  assert.equal(surface.get().dockDismissed, false)
})

test('queue store: persists, restores paused, announces navigation, saves a collection', async () => {
  const storage = installBrowserEnv()
  const { queueActions, getQueue, flushQueue, resetQueueCache, QUEUE_NAV_EVENT } = await import('../src/features/queue/queueStore.ts')
  const events: Array<{ id: string; outcome: string }> = []
  ;(globalThis as unknown as { window: EventTarget }).window.addEventListener(QUEUE_NAV_EVENT, (event) => {
    const detail = (event as CustomEvent<{ item: MediaItem; outcome: string }>).detail
    events.push({ id: detail.item.id, outcome: detail.outcome })
  })

  const a = video('a')
  const b = video('b')
  const c = video('c')
  assert.equal(queueActions.enqueue(a, 'last', a), 'playing')
  assert.equal(queueActions.enqueue(b, 'last', a), 'added')
  assert.equal(queueActions.enqueue(c, 'next', a), 'added')
  assert.deepEqual(getQueue().upcoming.map((item) => item.id), ['c', 'b'])

  flushQueue()
  const raw = storage.data.get(STORAGE_KEYS.queue)!
  assert.ok(raw.includes('"nowPlaying"'))

  // "Reload": drop the in-memory copy; the queue comes back with a restored current item.
  resetQueueCache()
  assert.equal(getQueue().nowPlaying?.id, 'a')
  assert.deepEqual(getQueue().upcoming.map((item) => item.id), ['c', 'b'])

  assert.equal(queueActions.next('manual'), 'moved')
  assert.deepEqual(events.at(-1), { id: 'c', outcome: 'moved' })
  queueActions.reorder(['b'])
  assert.equal(queueActions.previous(), 'moved')
  assert.equal(events.at(-1)?.id, 'a')
  assert.equal(queueActions.jumpTo('b'), 'moved')
  assert.equal(events.at(-1)?.id, 'b')
  const eventCount = events.length
  queueActions.setRepeat('one')
  assert.equal(queueActions.next('auto'), 'replay')
  assert.equal(events.length, eventCount, 'replay does not navigate')

  queueActions.toggleAutoplay('b')
  assert.equal(getQueue().autoplay, 'off', 'queue mode defaults on, so the first toggle turns it off')
  queueActions.toggleAutoplay('b')
  assert.equal(getQueue().autoplay, 'on')

  const collection = queueActions.saveAsCollection('Weekend queue')
  assert.ok(collection)
  assert.equal(collection!.name, 'Weekend queue')
  assert.equal(collection!.itemIds[0], 'b', 'now playing leads')
  assert.equal(loadCollections()[0].id, collection!.id)

  // Incognito: queue still works in memory, nothing more is written.
  flushQueue()
  const before = storage.data.get(STORAGE_KEYS.queue)
  setWriteGate(() => false)
  queueActions.enqueue(video('secret'), 'last')
  flushQueue()
  setWriteGate(null)
  assert.equal(storage.data.get(STORAGE_KEYS.queue), before)
  assert.ok(getQueue().upcoming.some((item) => item.id === 'secret'))

  queueActions.clear('all')
  assert.equal(getQueue().nowPlaying, null)
  assert.equal(queueActions.saveAsCollection('x'), null)
})
