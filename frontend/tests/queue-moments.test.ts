import assert from 'node:assert/strict'
import test from 'node:test'

import { installBrowserEnv } from './queue-env.ts'
import {
  DEDUPE_WINDOW,
  MAX_LABEL,
  MAX_MOMENTS,
  MAX_PER_ITEM,
  addMoment,
  defaultLabel,
  exportMoments,
  isClip,
  mergeMoments,
  momentPercent,
  momentsForItem,
  parseMomentsImport,
  removeMoment,
  removeMomentsForItem,
  renameMoment,
  sanitizeMoments,
  type Moment,
  type MomentInput,
} from '../src/features/queue/momentsModel.ts'

const base: MomentInput = { itemId: 'vid-1', t: 83.2, title: 'Studio signal', creator: 'Signal Studio', thumbnail: 'https://img.example/p.jpg', duration: 240, source: 'Test' }

test('addMoment stores minimal metadata and defaults the label', () => {
  const result = addMoment([], base, 1000, () => 0.5)
  assert.equal(result.outcome, 'added')
  const moment = result.moment!
  assert.equal(moment.itemId, 'vid-1')
  assert.equal(moment.t, 83.2)
  assert.equal(moment.label, '')
  assert.equal(moment.createdAt, 1000)
  assert.deepEqual(Object.keys(moment).sort(), ['createdAt', 'creator', 'duration', 'id', 'itemId', 'label', 't', 'source', 'thumbnail', 'title'].sort())
  assert.equal(defaultLabel(moment), 'Moment at 1:23')
  assert.equal(isClip(moment), false)
})

test('a clip carries an end, loops from t, and has a range label', () => {
  const { moment } = addMoment([], { ...base, t: 10, end: 25.5, label: '  the good part  ' }, 1)
  assert.equal(moment!.end, 25.5)
  assert.equal(moment!.label, 'the good part')
  assert.equal(isClip(moment!), true)
  assert.equal(defaultLabel({ ...moment!, label: '' }), 'Clip 0:10–0:25')
  // A range shorter than the minimum degrades to a plain moment.
  assert.equal(addMoment([], { ...base, t: 10, end: 10.2 }, 1).moment!.end, undefined)
  // End before start is not a clip either.
  assert.equal(addMoment([], { ...base, t: 10, end: 5 }, 1).moment!.end, undefined)
})

test('saving again at the same spot updates instead of duplicating', () => {
  const first = addMoment([], base, 1, () => 0.1)
  const again = addMoment(first.list, { ...base, t: base.t + DEDUPE_WINDOW - 0.1, label: 'nice' }, 2)
  assert.equal(again.outcome, 'updated')
  assert.equal(again.list.length, 1)
  assert.equal(again.moment!.label, 'nice')
  assert.equal(again.moment!.t, base.t, 'the original position is kept')
  // A moment and a clip at the same time are distinct bookmarks.
  const clip = addMoment(first.list, { ...base, end: base.t + 10 }, 3)
  assert.equal(clip.outcome, 'added')
  assert.equal(clip.list.length, 2)
  // Far apart is a new moment.
  assert.equal(addMoment(first.list, { ...base, t: base.t + 30 }, 4).list.length, 2)
})

test('limits: per item and overall, oldest dropped first', () => {
  let list: Moment[] = []
  for (let i = 0; i < MAX_PER_ITEM; i += 1) list = addMoment(list, { ...base, t: i * 10 }, i + 1, () => i / 100).list
  assert.equal(list.length, MAX_PER_ITEM)
  const over = addMoment(list, { ...base, t: 9999 }, 1000)
  assert.equal(over.outcome, 'limit')
  assert.equal(over.list.length, MAX_PER_ITEM)

  let big: Moment[] = []
  for (let i = 0; i < MAX_MOMENTS + 25; i += 1) big = addMoment(big, { ...base, itemId: `item-${i}`, t: 5 }, i + 1, () => (i % 97) / 97).list
  assert.equal(big.length, MAX_MOMENTS)
  assert.equal(big[0].itemId, `item-${MAX_MOMENTS + 24}`, 'newest first')
  assert.ok(!big.some((moment) => moment.itemId === 'item-0'), 'the oldest were dropped')
})

test('invalid input is rejected without changing the list', () => {
  const list = addMoment([], base, 1).list
  assert.equal(addMoment(list, { ...base, itemId: '' }, 2).outcome, 'invalid')
  assert.equal(addMoment(list, { ...base, t: Number.NaN }, 2).outcome, 'invalid')
  assert.equal(addMoment(list, { ...base, t: Infinity }, 2).outcome, 'invalid')
})

test('momentsForItem sorts by time; remove / rename / removeForItem', () => {
  let list: Moment[] = []
  for (const t of [50, 5, 20]) list = addMoment(list, { ...base, t }, t, () => t / 100).list
  list = addMoment(list, { ...base, itemId: 'other', t: 1 }, 99, () => 0.9).list
  assert.deepEqual(momentsForItem(list, 'vid-1').map((moment) => moment.t), [5, 20, 50])
  const target = list.find((moment) => moment.t === 20)!
  assert.equal(renameMoment(list, target.id, 'x'.repeat(500)).find((moment) => moment.id === target.id)!.label.length, MAX_LABEL)
  assert.equal(removeMoment(list, target.id).length, 3)
  assert.equal(removeMomentsForItem(list, 'vid-1').length, 1)
})

test('sanitizeMoments rejects junk, unsafe URLs and duplicate ids', () => {
  const cleaned = sanitizeMoments([
    { id: 'm1', itemId: 'a', t: 4, title: 'ok', creator: 'c', thumbnail: 'javascript:alert(1)', createdAt: 5 },
    { id: 'm1', itemId: 'a', t: 9, createdAt: 6 },
    { id: 'm2', itemId: '', t: 3 },
    { id: 'm3', itemId: 'a', t: 'soon' },
    { id: 'm4', itemId: 'a', t: -5, end: 3, createdAt: 8 },
    null,
    'string',
    { id: 'm5', itemId: 'b', t: 12, thumbnail: '/api/thumb?id=1', label: 'a\u0000b\u0007c', createdAt: 7 },
  ])
  assert.deepEqual(cleaned.map((moment) => moment.id), ['m4', 'm5', 'm1'], 'newest first, junk and the duplicate id dropped')
  assert.equal(cleaned.find((moment) => moment.id === 'm1')!.thumbnail, '')
  assert.equal(cleaned.find((moment) => moment.id === 'm5')!.thumbnail, '/api/thumb?id=1')
  assert.equal(cleaned.find((moment) => moment.id === 'm5')!.label, 'a b c')
  assert.equal(cleaned.find((moment) => moment.id === 'm4')!.t, 0, 'clamped into range')
  assert.deepEqual(sanitizeMoments('nope'), [])
})

test('export → import round-trips through JSON', () => {
  let list: Moment[] = []
  list = addMoment(list, { ...base, label: 'first' }, 10, () => 0.2).list
  list = addMoment(list, { ...base, t: 120, end: 150 }, 20, () => 0.4).list
  const text = exportMoments(list, new Date('2026-10-05T12:00:00Z'))
  const file = JSON.parse(text)
  assert.equal(file.app, 'media-codex')
  assert.equal(file.kind, 'moments')
  assert.equal(file.exportedAt, '2026-10-05T12:00:00.000Z')
  const parsed = parseMomentsImport(text)
  assert.ok(parsed.ok)
  if (parsed.ok) {
    assert.equal(parsed.skipped, 0)
    assert.deepEqual(parsed.moments, list)
  }
})

test('import accepts a bare array and rejects wrong shapes', () => {
  const list = addMoment([], base, 1).list
  const bare = parseMomentsImport(JSON.stringify(list))
  assert.ok(bare.ok && bare.moments.length === 1)
  for (const text of ['', 'not json', '{"hello":1}', JSON.stringify({ kind: 'other', moments: [] }), JSON.stringify({ kind: 'moments', version: 2, moments: [] }), 'x'.repeat(2_100_000)]) {
    assert.equal(parseMomentsImport(text).ok, false, text.slice(0, 20))
  }
  const mixed = parseMomentsImport(JSON.stringify({ kind: 'moments', version: 1, moments: [...list, { nope: 1 }, 7] }))
  assert.ok(mixed.ok && mixed.moments.length === 1 && mixed.skipped === 2)
})

test('mergeMoments skips duplicates by id or by item/time/kind', () => {
  const a = addMoment([], base, 1, () => 0.1).list
  const incoming = [
    ...a, // same id
    { ...a[0], id: 'other-id', t: a[0].t + 0.5 }, // same spot
    { ...a[0], id: 'fresh', t: a[0].t + 60, createdAt: 50 },
  ]
  const merged = mergeMoments(a, incoming)
  assert.equal(merged.added, 1)
  assert.equal(merged.duplicates, 2)
  assert.equal(merged.list.length, 2)
  assert.deepEqual(mergeMoments(a, []).list, a)
})

test('momentPercent positions ticks on the timeline', () => {
  assert.equal(momentPercent({ t: 60, duration: 240 }), 25)
  assert.equal(momentPercent({ t: 999, duration: 240 }), 100)
  assert.equal(momentPercent({ t: 60 }), 0)
  assert.equal(momentPercent({ t: 60 }, 120), 50)
})

test('moments store persists through the gate and restores', async () => {
  const storage = installBrowserEnv()
  const { momentsActions, flushMoments, resetMomentsCache, getMoments } = await import('../src/features/queue/momentsStore.ts')
  const { setWriteGate } = await import('../src/features/queue/persist.ts')

  const item = { id: 'vid-9', title: 'T', creator: 'c', thumbnail: 'https://img.example/t.jpg', duration: '2:00', source: 'Src' }
  const saved = momentsActions.save(item, 42.5, { label: 'hello' })
  assert.equal(saved.outcome, 'added')
  assert.equal(getMoments().length, 1)
  assert.equal(getMoments()[0].duration, 120, 'duration comes from the "2:00" string')
  flushMoments()
  assert.ok(storage.data.get('media-codex-moments-v1')?.includes('"vid-9"'))

  resetMomentsCache()
  assert.equal(getMoments()[0].label, 'hello', 'restored from storage')

  // Incognito: the in-memory list still works, nothing new is written.
  setWriteGate(() => false)
  momentsActions.save(item, 90)
  flushMoments()
  assert.equal(getMoments().length, 2)
  resetMomentsCache()
  assert.equal(getMoments().length, 1, 'the gated save never reached storage')
  setWriteGate(null)

  const exported = momentsActions.exportJson()
  const outcome = momentsActions.importJson(exported)
  assert.ok(outcome.ok && outcome.added === 0 && outcome.duplicates === 1)
  assert.equal(momentsActions.importJson('garbage').ok, false)
})
