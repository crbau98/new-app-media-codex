import assert from 'node:assert/strict'
import test from 'node:test'

import type { MediaLite } from '../src/features/ai/core/library.ts'
import {
  HALF_LIFE_DAYS,
  applySignal,
  betaDraw,
  decayed,
  emptyTasteProfile,
  hasTasteSignal,
  recommendForYou,
  scoreItem,
  summarizeTaste,
  daypartOf,
  type SignalItem,
} from '../src/features/ai/taste/engine.ts'
import { ingestSnapshot, type AppSignalSnapshot } from '../src/features/ai/taste/ingest.ts'
import {
  _resetTasteMemory,
  exportTasteProfile,
  getCachedTasteProfile,
  importTasteProfile,
  isTasteLearningEnabled,
  loadTasteProfile,
  recordTasteSignal,
  resetTasteProfile,
  saveTasteProfile,
  setTasteLearningEnabled,
  validateProfile,
} from '../src/features/ai/taste/storage.ts'
import { mulberry32 } from '../src/features/ai/core/library.ts'
import { rankForYou } from '../src/lib/discovery.ts'
import { buildProfile, scoreMedia } from '../src/lib/recommend.ts'
import type { MediaItem } from '../src/lib/types.ts'

const NOW = Date.parse('2026-09-28T20:00:00'), DAY = 86_400_000
const lite = (over: Partial<MediaLite> & { id: string }): MediaLite => ({
  title: 'T', creator: 'anon', source: 'Redgifs', tags: [], duration: 200, isVideo: true, views: 2000, likes: 100,
  createdAt: new Date(NOW - DAY).toISOString(), ...over,
})
const sig = (m: MediaLite): SignalItem => ({ id: m.id, creator: m.creator, source: m.source, tags: m.tags, duration: m.duration })

test('affinities decay by exactly one half per half-life', () => {
  let p = applySignal(emptyTasteProfile(NOW), 'like', sig(lite({ id: '1', tags: ['solo'] })), { now: NOW })
  const fresh = decayed(p.tags.solo, NOW, HALF_LIFE_DAYS.tags)
  const later = decayed(p.tags.solo, NOW + HALF_LIFE_DAYS.tags * DAY, HALF_LIFE_DAYS.tags)
  assert.ok(fresh > 0)
  assert.ok(Math.abs(later - fresh / 2) < 1e-9)
  // Re-applying after time folds the decayed value, not the stale one.
  p = applySignal(p, 'like', sig(lite({ id: '2', tags: ['solo'] })), { now: NOW + HALF_LIFE_DAYS.tags * DAY })
  assert.ok(p.tags.solo.w < fresh * 2 && p.tags.solo.w > fresh)
})

test('negative signals push scores down and track evidence separately', () => {
  const disliked = lite({ id: 'n', tags: ['kink'], creator: 'grump' })
  let p = emptyTasteProfile(NOW)
  p = applySignal(p, 'less', sig(disliked), { now: NOW })
  p = applySignal(p, 'hide', sig(disliked), { now: NOW })
  assert.ok(p.tags.kink.w < 0)
  assert.equal(p.tags.kink.q, 2)
  assert.equal(p.tags.kink.p, 0)
  const bad = scoreItem(lite({ id: 'x', tags: ['kink'], creator: 'grump' }), p, { now: NOW })
  const neutral = scoreItem(lite({ id: 'y', tags: ['studio'], creator: 'other' }), p, { now: NOW })
  assert.ok(bad.score < neutral.score)
})

test('tag aliases merge into one affinity ("Muscular" and "gym" are the same taste)', () => {
  let p = emptyTasteProfile(NOW)
  p = applySignal(p, 'like', sig(lite({ id: '1', tags: ['Muscular'] })), { now: NOW })
  const b = scoreItem(lite({ id: '2', tags: ['gym'], creator: 'z' }), p, { now: NOW })
  assert.ok(b.tags > 0.2)
})

test('recommendForYou ranks liked-tag items first, excludes engaged/hidden, explains why', () => {
  let p = emptyTasteProfile(NOW)
  for (let i = 0; i < 3; i += 1) p = applySignal(p, 'like', sig(lite({ id: `l${i}`, tags: ['romantic', 'duo'], creator: 'lovebirds' })), { now: NOW })
  const catalog = [
    lite({ id: 'r1', tags: ['romantic'], creator: 'other1' }),
    lite({ id: 'g1', tags: ['group'], creator: 'other2' }),
    lite({ id: 'r2', tags: ['duo', 'romantic'], creator: 'lovebirds' }),
    lite({ id: 'h1', tags: ['romantic'], creator: 'hid' }),
    lite({ id: 'e1', tags: ['romantic'], creator: 'engaged' }),
  ]
  const recs = recommendForYou(catalog, p, { now: NOW, seed: 1, hidden: new Set(['h1']), exclude: new Set(['e1']), limit: 5 })
  const ids = recs.map((r) => r.item.id)
  assert.ok(!ids.includes('h1') && !ids.includes('e1'))
  assert.equal(ids[0], 'r2')
  assert.ok(ids.indexOf('r1') < ids.indexOf('g1'))
  assert.match(recs[0].reasons.join(' '), /@lovebirds|#romantic|#duo/)
})

test('MMR keeps one creator from flooding the rail', () => {
  let p = emptyTasteProfile(NOW)
  p = applySignal(p, 'follow', sig(lite({ id: 'f', creator: 'star', tags: ['solo'] })), { now: NOW })
  const spam = Array.from({ length: 8 }, (_, i) => lite({ id: `s${i}`, creator: 'star', tags: ['solo'] }))
  const mix = [lite({ id: 'm1', creator: 'a', tags: ['duo'] }), lite({ id: 'm2', creator: 'b', tags: ['group'] })]
  const recs = recommendForYou([...spam, ...mix], p, { now: NOW, seed: 3, limit: 4, followed: new Set(['star']) })
  const stars = recs.filter((r) => r.item.creator === 'star').length
  assert.ok(stars <= 3, `expected diversity, got ${stars} from one creator`)
})

test('exploration is deterministic per seed and only surfaces novel, decent items', () => {
  let p = emptyTasteProfile(NOW)
  for (let i = 0; i < 4; i += 1) p = applySignal(p, 'like', sig(lite({ id: `k${i}`, tags: ['solo'], creator: 'fav' })), { now: NOW })
  const catalog = [
    ...Array.from({ length: 6 }, (_, i) => lite({ id: `f${i}`, tags: ['solo'], creator: `fav${i}` })),
    ...Array.from({ length: 6 }, (_, i) => lite({ id: `n${i}`, tags: ['travel'], creator: `new${i}`, views: 90000, likes: 4000 })),
  ]
  const a = recommendForYou(catalog, p, { now: NOW, seed: 42, limit: 8, mode: 'adventurous' })
  const b = recommendForYou(catalog, p, { now: NOW, seed: 42, limit: 8, mode: 'adventurous' })
  assert.deepEqual(a.map((r) => r.item.id), b.map((r) => r.item.id))
  assert.ok(a.some((r) => r.kind === 'explore'), 'adventurous mode explores')
  const familiar = recommendForYou(catalog, p, { now: NOW, seed: 42, limit: 8, mode: 'familiar' })
  assert.ok(familiar.filter((r) => r.kind === 'explore').length <= a.filter((r) => r.kind === 'explore').length)
  for (const r of a.filter((x) => x.kind === 'explore')) assert.match(r.reasons.join(' '), /new|different/i)
})

test('betaDraw concentrates with evidence and stays within 0..1', () => {
  const rand = mulberry32(7)
  const wide = Array.from({ length: 200 }, () => betaDraw(1, 1, rand))
  const tight = Array.from({ length: 200 }, () => betaDraw(60, 20, rand))
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs)
  assert.ok(spread(wide) > spread(tight))
  assert.ok([...wide, ...tight].every((x) => x >= 0 && x <= 1))
})

test('ingestSnapshot is idempotent and handles unlike, follow, dwell and completion', () => {
  const a = lite({ id: 'a', creator: 'Cool Guy', tags: ['solo'], duration: 600 })
  const items = [sig(a)]
  const snap: AppSignalSnapshot = { likes: { a: true }, follows: { 'creator-coolguy': true }, recentlyViewed: ['a'], hidden: [], progress: { a: { seconds: 560, duration: 600, updatedAt: NOW } } }
  const once = ingestSnapshot(emptyTasteProfile(NOW), snap, items, NOW)
  const twice = ingestSnapshot(once, snap, items, NOW)
  assert.equal(twice, once, 'second pass changes nothing')
  assert.ok(once.tags.solo.w > 3)
  assert.ok(once.creators.coolguy.w > 5)
  assert.ok(once.applied['done:a'])
  const unliked = ingestSnapshot(once, { ...snap, likes: { a: false } }, items, NOW)
  assert.ok(unliked.tags.solo.w < once.tags.solo.w)
  assert.equal(unliked.applied['like:a'], undefined)
})

test('ingestSnapshot registers early abandonment as a skip only after the session ended', () => {
  const a = lite({ id: 'a', tags: ['group'], duration: 600 })
  const snap: AppSignalSnapshot = { likes: {}, follows: {}, recentlyViewed: [], hidden: [], progress: { a: { seconds: 3, duration: 600, updatedAt: NOW - 3_600_000 } } }
  const fresh = ingestSnapshot(emptyTasteProfile(NOW), { ...snap, progress: { a: { seconds: 3, duration: 600, updatedAt: NOW } } }, [sig(a)], NOW)
  assert.equal(fresh.tags.group, undefined)
  const later = ingestSnapshot(emptyTasteProfile(NOW), snap, [sig(a)], NOW)
  assert.ok(later.tags.group.w < 0)
})

test('daypart habits: evening likes boost the same tag in the evening more than at night', () => {
  const evening = new Date(NOW).setHours(19)
  const night = new Date(NOW).setHours(2)
  assert.equal(daypartOf(19), 'evening')
  let p = emptyTasteProfile(evening)
  p = applySignal(p, 'like', sig(lite({ id: '1', tags: ['chill'] })), { now: evening })
  const item = lite({ id: '2', tags: ['chill'], creator: 'q' })
  const a = scoreItem(item, p, { now: evening }).daypart
  const b = scoreItem(item, p, { now: night }).daypart
  assert.ok(a > b)
})

test('summarizeTaste surfaces top and disliked signals', () => {
  let p = emptyTasteProfile(NOW)
  p = applySignal(p, 'like', sig(lite({ id: '1', tags: ['solo'], creator: 'fan' })), { now: NOW })
  p = applySignal(p, 'less', sig(lite({ id: '2', tags: ['group'], creator: 'meh' })), { now: NOW })
  const s = summarizeTaste(p, NOW)
  assert.equal(s.topTags[0].tag, 'solo')
  assert.equal(s.dislikedTags[0].tag, 'group')
  assert.equal(s.topCreators[0].creator, 'fan')
})

/* storage */

function fakeWindow() {
  const store = new Map<string, string>()
  const g = globalThis as unknown as { window?: unknown }
  g.window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } },
    dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {},
  }
  return store
}

test('storage: persists, exports, imports, pauses and resets — all on-device', () => {
  const store = fakeWindow()
  _resetTasteMemory()
  recordTasteSignal('like', sig(lite({ id: '1', tags: ['solo'], creator: 'fan' })))
  assert.ok(store.get('media-codex-taste-v1'), 'persisted to localStorage')
  const exported = exportTasteProfile()
  assert.match(exported, /taste-profile/)
  assert.equal(getCachedTasteProfile()?.events, 1)

  setTasteLearningEnabled(false)
  assert.equal(isTasteLearningEnabled(), false)
  recordTasteSignal('like', sig(lite({ id: '2', tags: ['group'] })))
  assert.equal(loadTasteProfile().events, 1, 'paused learning ignores new signals')
  assert.equal(getCachedTasteProfile(), null, 'paused learning stops personalising')
  setTasteLearningEnabled(true)

  store.set('media-codex-ai-recent-v1', '["x"]')
  resetTasteProfile()
  assert.equal(loadTasteProfile().events, 0)
  assert.equal(store.get('media-codex-taste-v1'), undefined)
  assert.equal(store.get('media-codex-ai-recent-v1'), undefined, 'reset also clears recent AI queries')

  assert.equal(importTasteProfile(exported), true)
  assert.equal(loadTasteProfile().events, 1)
  assert.equal(importTasteProfile('{"nope":1}'), false)
  assert.equal(importTasteProfile('not json'), false)
  assert.equal(validateProfile({ v: 1, tags: { x: { w: 'bad' } } })?.tags.x, undefined)
  saveTasteProfile(emptyTasteProfile())
  delete (globalThis as { window?: unknown }).window
  _resetTasteMemory()
})

test('storage survives blocked localStorage', () => {
  const g = globalThis as unknown as { window?: unknown }
  g.window = { localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {} }
  _resetTasteMemory()
  assert.doesNotThrow(() => recordTasteSignal('like', sig(lite({ id: '1', tags: ['solo'] }))))
  assert.equal(loadTasteProfile().events, 1)
  delete g.window
  _resetTasteMemory()
})

/* backward-compatible rankers */

const media = (over: Partial<MediaItem> & { id: string }): MediaItem => ({
  title: 'Item', thumbnail: '', source: 'Redgifs', duration: '3:20', isVideo: true, category: 'c', creator: 'anon',
  tags: [], rating: 4, createdAt: new Date(NOW - DAY).toISOString(), views: 2000, likes: 100, ...over,
})

test('scoreMedia stays backward compatible and now merges alias tags', () => {
  const liked = media({ id: 'a', creator: 'fan', tags: ['Muscular'] })
  const profile = buildProfile([liked], { a: { saved: true, reaction: 'like' } })
  const scored = scoreMedia([media({ id: 'b', tags: ['gym'] }), media({ id: 'c', tags: ['studio'] })], profile)
  assert.equal(scored[0].item.id, 'b')
  assert.ok(scored[0].reasons.length > 0)
})

test('rankForYou keeps its signature; explicit taste re-ranks and null disables it', () => {
  const items = [media({ id: 'x', tags: ['solo'], creator: 'p' }), media({ id: 'y', tags: ['group'], creator: 'q' })]
  const base = { tagPreferences: {}, creatorPreferences: {}, followCache: {}, likeCache: {}, recentlyViewed: [], hiddenMedia: [], mode: 'balanced' as const }
  const plain = rankForYou(items, base, { taste: null })
  assert.equal(plain.length, 2)
  let p = emptyTasteProfile(NOW)
  for (let i = 0; i < 3; i += 1) p = applySignal(p, 'like', { id: `z${i}`, creator: 'zz', source: 'Redgifs', tags: ['group'], duration: 200 }, { now: NOW })
  assert.ok(hasTasteSignal(p))
  const withTaste = rankForYou(items, base, { taste: p })
  assert.equal(withTaste[0].id, 'y')
  assert.ok((withTaste[0].recommendationReasons ?? []).length > 0)
})
