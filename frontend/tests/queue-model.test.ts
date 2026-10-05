import assert from 'node:assert/strict'
import test from 'node:test'

import type { MediaItem } from '../src/lib/types.ts'
import {
  MAX_UPCOMING,
  clear,
  cycleRepeat,
  effectiveAutoplay,
  emptyQueue,
  enqueue,
  findInQueue,
  inQueueMode,
  isInQueue,
  jumpTo,
  moveUpcoming,
  moveUpcomingBy,
  next,
  parseQueue,
  peekNext,
  previous,
  queueIds,
  queuePosition,
  removeUpcoming,
  serializeQueue,
  setAutoplay,
  setRepeat,
  setShuffle,
  setUpcomingOrder,
  shuffled,
  startFrom,
  trimItem,
  type QueueState,
} from '../src/features/queue/queueModel.ts'

function item(id: string, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    title: `Title ${id}`,
    thumbnail: `https://img.example/${id}.jpg`,
    source: 'Test',
    duration: '1:00',
    isVideo: true,
    category: 'Featured',
    creator: 'creator',
    tags: ['a'],
    rating: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    views: 10,
    mediaUrl: `/api/archiver-proxy?url=https%3A%2F%2Fmedia.example%2F${id}.mp4`,
    ...over,
  }
}

/** Deterministic rng: a simple LCG so shuffles are reproducible. */
function lcg(seed = 7) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

const ids = (list: MediaItem[]) => list.map((entry) => entry.id)
const A = item('a')
const B = item('b')
const C = item('c')
const D = item('d')

function build(...items: MediaItem[]): QueueState {
  return startFrom(emptyQueue(), items)
}

test('enqueue on an empty queue starts it from the viewed item', () => {
  const started = enqueue(emptyQueue(), A, 'last', A)
  assert.equal(started.outcome, 'playing')
  assert.equal(started.state.nowPlaying?.id, 'a')
  assert.deepEqual(started.state.upcoming, [])

  // Adding a *different* item while watching A anchors the queue at A.
  const anchored = enqueue(emptyQueue(), B, 'last', A)
  assert.equal(anchored.outcome, 'added')
  assert.equal(anchored.state.nowPlaying?.id, 'a')
  assert.deepEqual(ids(anchored.state.upcoming), ['b'])

  // No anchor: the item itself becomes current.
  assert.equal(enqueue(emptyQueue(), C, 'last').state.nowPlaying?.id, 'c')
})

test('enqueue last / next ordering, duplicates and the size cap', () => {
  let state = build(A)
  state = enqueue(state, B, 'last').state
  state = enqueue(state, C, 'last').state
  state = enqueue(state, D, 'next').state
  assert.deepEqual(ids(state.upcoming), ['d', 'b', 'c'])

  const again = enqueue(state, B, 'last')
  assert.equal(again.outcome, 'already')
  assert.deepEqual(ids(again.state.upcoming), ['d', 'b', 'c'])

  // "Play next" on something already queued moves it to the front.
  const moved = enqueue(state, C, 'next')
  assert.equal(moved.outcome, 'moved')
  assert.deepEqual(ids(moved.state.upcoming), ['c', 'd', 'b'])

  // The current item is never queued twice.
  assert.equal(enqueue(state, A, 'last').outcome, 'already')

  let full = build(A)
  for (let i = 0; i < MAX_UPCOMING; i += 1) full = enqueue(full, item(`x${i}`), 'last').state
  assert.equal(full.upcoming.length, MAX_UPCOMING)
  assert.equal(enqueue(full, item('overflow'), 'last').outcome, 'full')
})

test('next walks the queue, keeps history, and ends at the end when repeat is off', () => {
  let state = build(A, B, C)
  const step = next(state, 'manual')
  assert.equal(step.outcome, 'moved')
  assert.equal(step.item?.id, 'b')
  state = step.state
  assert.deepEqual(ids(state.history), ['a'])
  assert.deepEqual(ids(state.upcoming), ['c'])

  state = next(state, 'auto').state
  assert.equal(state.nowPlaying?.id, 'c')
  const end = next(state, 'auto')
  assert.equal(end.outcome, 'end')
  assert.equal(end.item, null)
  assert.equal(end.state, state, 'state is untouched at the end')
  assert.equal(next(emptyQueue(), 'manual').outcome, 'empty')
})

test('previous steps back and returns the current item to the front of upcoming', () => {
  let state = build(A, B, C)
  state = next(state, 'manual').state // b
  state = next(state, 'manual').state // c
  const back = previous(state)
  assert.equal(back.item?.id, 'b')
  assert.deepEqual(ids(back.state.upcoming), ['c'])
  assert.deepEqual(ids(back.state.history), ['a'])
  assert.equal(previous(build(A)).outcome, 'start')
})

test('repeat one replays on auto-advance but a manual next still moves on', () => {
  const state = setRepeat(build(A, B), 'one')
  const auto = next(state, 'auto')
  assert.equal(auto.outcome, 'replay')
  assert.equal(auto.item?.id, 'a')
  assert.equal(auto.state, state)
  assert.equal(next(state, 'manual').item?.id, 'b')
})

test('repeat all wraps with the whole cycle and a lone item replays', () => {
  let state = setRepeat(build(A, B, C), 'all')
  state = next(state, 'auto').state
  state = next(state, 'auto').state
  assert.equal(state.nowPlaying?.id, 'c')
  const wrapped = next(state, 'auto')
  assert.equal(wrapped.outcome, 'wrapped')
  assert.equal(wrapped.item?.id, 'a')
  assert.deepEqual(ids(wrapped.state.upcoming), ['b', 'c'])
  assert.deepEqual(wrapped.state.history, [])

  const lone = next(setRepeat(build(A), 'all'), 'auto')
  assert.equal(lone.outcome, 'replay')
})

test('cycleRepeat goes off → all → one → off', () => {
  let state = emptyQueue()
  const seen: string[] = []
  for (let i = 0; i < 4; i += 1) {
    state = cycleRepeat(state)
    seen.push(state.repeat)
  }
  assert.deepEqual(seen, ['all', 'one', 'off', 'all'])
})

test('shuffle reorders upcoming, keeps the same items, and turning it off restores the original order', () => {
  const state = build(A, B, C, D, item('e'), item('f'))
  const rng = lcg(3)
  const on = setShuffle(state, true, rng)
  assert.equal(on.shuffle, true)
  assert.equal(on.nowPlaying?.id, 'a')
  assert.deepEqual(ids(on.upcoming).slice().sort(), ['b', 'c', 'd', 'e', 'f'])
  assert.notDeepEqual(ids(on.upcoming), ['b', 'c', 'd', 'e', 'f'], 'a seeded shuffle of five moves something')
  const off = setShuffle(on, false)
  assert.equal(off.shuffle, false)
  assert.deepEqual(ids(off.upcoming), ['b', 'c', 'd', 'e', 'f'])
  assert.equal(off.order, null)
})

test('items added while shuffled are restored after turning shuffle off', () => {
  let state = setShuffle(build(A, B, C), true, lcg(11))
  state = enqueue(state, D, 'last').state
  const off = setShuffle(state, false)
  assert.deepEqual(ids(off.upcoming), ['b', 'c', 'd'])
})

test('shuffled is a permutation and handles tiny lists', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8]
  const out = shuffled(list, lcg(5))
  assert.deepEqual(out.slice().sort((x, y) => x - y), list)
  assert.deepEqual(shuffled([], lcg()), [])
  assert.deepEqual(shuffled([9], lcg()), [9])
})

test('repeat-all wrap while shuffled never starts with the item that just played', () => {
  for (let seed = 1; seed < 30; seed += 1) {
    let state = setRepeat(setShuffle(build(A, B, C), true, lcg(seed)), 'all')
    state = next(state, 'auto').state
    state = next(state, 'auto').state
    const justPlayed = state.nowPlaying!.id
    const wrapped = next(state, 'auto', lcg(seed + 100))
    assert.equal(wrapped.outcome, 'wrapped')
    assert.notEqual(wrapped.item?.id, justPlayed)
    assert.equal(wrapped.state.upcoming.length, 2)
  }
})

test('reorder: move, moveBy, setUpcomingOrder', () => {
  const state = build(A, B, C, D)
  assert.deepEqual(ids(moveUpcoming(state, 'd', 0).upcoming), ['d', 'b', 'c'])
  assert.deepEqual(ids(moveUpcoming(state, 'b', 99).upcoming), ['c', 'd', 'b'])
  assert.deepEqual(ids(moveUpcomingBy(state, 'c', -1).upcoming), ['c', 'b', 'd'])
  assert.equal(moveUpcomingBy(state, 'b', -1), state, 'already first: no change')
  assert.equal(moveUpcoming(state, 'zzz', 0), state)
  assert.deepEqual(ids(setUpcomingOrder(state, ['d', 'c', 'b']).upcoming), ['d', 'c', 'b'])
  // Unknown ids are ignored and missing ones keep their place at the end.
  assert.deepEqual(ids(setUpcomingOrder(state, ['c', 'nope']).upcoming), ['c', 'b', 'd'])
  assert.equal(setUpcomingOrder(state, ['b', 'c', 'd']), state)
})

test('remove drops only upcoming items and the shuffle snapshot', () => {
  let state = setShuffle(build(A, B, C), true, lcg(2))
  state = removeUpcoming(state, 'b')
  assert.deepEqual(ids(state.upcoming).slice().sort(), ['c'])
  assert.ok(!state.order?.includes('b'))
  assert.equal(removeUpcoming(state, 'a'), state, 'the current item is not removable here')
})

test('clear: upcoming keeps the current item, all keeps only preferences', () => {
  let state = setAutoplay(setRepeat(build(A, B, C), 'all'), 'on')
  const upcomingOnly = clear(state, 'upcoming')
  assert.equal(upcomingOnly.nowPlaying?.id, 'a')
  assert.deepEqual(upcomingOnly.upcoming, [])
  const all = clear(state, 'all')
  assert.equal(all.nowPlaying, null)
  assert.equal(all.repeat, 'all')
  assert.equal(all.autoplay, 'on')
  assert.equal(clear(emptyQueue(), 'upcoming').upcoming.length, 0)
  state = emptyQueue()
  assert.equal(clear(state, 'upcoming'), state)
})

test('jumpTo moves forward past skipped items (into history) and back into history', () => {
  const state = build(A, B, C, D)
  const forward = jumpTo(state, 'c')
  assert.equal(forward.item?.id, 'c')
  assert.deepEqual(ids(forward.state.history), ['a', 'b'])
  assert.deepEqual(ids(forward.state.upcoming), ['d'])

  const back = jumpTo(forward.state, 'a')
  assert.equal(back.item?.id, 'a')
  assert.deepEqual(ids(back.state.history), [])
  assert.deepEqual(ids(back.state.upcoming), ['b', 'c', 'd'])

  assert.equal(jumpTo(state, 'a').outcome, 'replay')
  assert.equal(jumpTo(state, 'zzz').outcome, 'empty')
})

test('selectors: position, ids, membership, queue mode and effective autoplay', () => {
  let state = build(A, B, C)
  state = next(state, 'manual').state
  assert.deepEqual(queuePosition(state), { index: 2, total: 3 })
  assert.deepEqual(queueIds(state), ['b', 'c'])
  assert.equal(isInQueue(state, 'b'), true)
  assert.equal(isInQueue(state, 'a'), false, 'history is not "in the queue"')
  assert.equal(findInQueue(state, 'a')?.id, 'a')
  assert.equal(inQueueMode(state, 'b'), true)
  assert.equal(inQueueMode(state, 'c'), false)
  assert.equal(peekNext(state)?.item.id, 'c')

  // Autoplay: default on in queue mode, off otherwise; explicit prefs win.
  assert.equal(effectiveAutoplay(state, 'b'), true)
  assert.equal(effectiveAutoplay(state, 'zzz'), false)
  assert.equal(effectiveAutoplay(setAutoplay(state, 'off'), 'b'), false)
  assert.equal(effectiveAutoplay(setAutoplay(state, 'on'), 'zzz'), true)
  assert.equal(effectiveAutoplay(emptyQueue(), null), false)
})

test('peekNext: wrap target under repeat-all, nothing at the end under repeat-off', () => {
  let state = build(A, B)
  state = next(state, 'manual').state
  assert.equal(peekNext(state), null)
  assert.deepEqual(peekNext(setRepeat(state, 'all')), { item: A, via: 'wrap' })
})

test('startFrom replaces the queue, dedupes, and keeps preferences', () => {
  const prefs = setAutoplay(setRepeat(emptyQueue(), 'one'), 'off')
  const state = startFrom(prefs, [A, B, A, C])
  assert.equal(state.nowPlaying?.id, 'a')
  assert.deepEqual(ids(state.upcoming), ['b', 'c'])
  assert.equal(state.repeat, 'one')
  assert.equal(state.autoplay, 'off')
  assert.equal(startFrom(state, []).nowPlaying, null)
})

test('persist → restore round-trips, restores paused state, and sanitises corrupt data', () => {
  let state = build(A, B, C, D)
  state = next(state, 'manual').state
  state = setRepeat(setAutoplay(state, 'on'), 'all')
  state = setShuffle(state, true, lcg(9))

  const restored = parseQueue(serializeQueue(state))
  assert.deepEqual(restored, state)
  assert.equal(restored.nowPlaying?.id, 'b')

  assert.deepEqual(parseQueue('not json'), emptyQueue())
  assert.deepEqual(parseQueue(null), emptyQueue())
  assert.deepEqual(parseQueue(JSON.stringify({ v: 99 })), emptyQueue())

  const hostile = parseQueue({
    v: 1,
    nowPlaying: { id: 'ok', title: 'x', isVideo: true, thumbnail: 'javascript:alert(1)', mediaUrl: 'data:text/html,hi', streamCandidates: ['https://a/b.mp4', 'file:///etc/passwd'] },
    upcoming: [{ id: 'ok' }, { id: 'u1', title: 5 }, { nope: true }, null, 'str', { id: 'u1' }],
    history: [{ id: 'h1' }, { id: 'h1' }],
    repeat: 'banana',
    autoplay: 'maybe',
    shuffle: 'yes',
  })
  assert.equal(hostile.nowPlaying?.thumbnail, '')
  assert.equal(hostile.nowPlaying?.mediaUrl, undefined)
  assert.deepEqual(hostile.nowPlaying?.streamCandidates, ['https://a/b.mp4'])
  assert.deepEqual(ids(hostile.upcoming), ['u1'], 'duplicates of the current item and junk entries are dropped')
  assert.deepEqual(ids(hostile.history), ['h1'])
  assert.equal(hostile.repeat, 'off')
  assert.equal(hostile.autoplay, 'auto')
  assert.equal(hostile.shuffle, false)

  // Upcoming/history without a current item are orphans.
  assert.deepEqual(parseQueue({ v: 1, upcoming: [{ id: 'x' }] }).upcoming, [])
})

test('trimItem keeps playable fields and bounds the rest', () => {
  const big = item('big', {
    description: 'x'.repeat(5000),
    tags: Array.from({ length: 40 }, (_, i) => `tag${i}`),
    gallery: Array.from({ length: 40 }, (_, i) => ({ url: `https://img.example/${i}.jpg` })),
    streamCandidates: Array.from({ length: 20 }, (_, i) => `https://v.example/${i}.mp4`),
    hlsUrl: 'https://v.example/master.m3u8',
    dominantColor: '#aabbcc',
    spriteGrid: { cols: 5, rows: 5, tileWidth: 160, tileHeight: 90, intervalSeconds: 2 },
  })
  const trimmed = trimItem(big)!
  assert.equal('description' in trimmed, false)
  assert.equal(trimmed.tags.length, 10)
  assert.equal(trimmed.gallery?.length, 12)
  assert.equal(trimmed.streamCandidates?.length, 6)
  assert.equal(trimmed.hlsUrl, 'https://v.example/master.m3u8')
  assert.equal(trimmed.dominantColor, '#aabbcc')
  assert.deepEqual(trimmed.spriteGrid, { cols: 5, rows: 5, tileWidth: 160, tileHeight: 90, intervalSeconds: 2 })
  assert.equal(trimItem({ title: 'no id' }), null)
  assert.equal(trimItem('nope'), null)
  assert.ok(JSON.stringify(trimmed).length < 6000, 'snapshots stay small')
})
