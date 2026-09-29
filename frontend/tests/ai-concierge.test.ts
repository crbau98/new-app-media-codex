import assert from 'node:assert/strict'
import test from 'node:test'

import type { MediaLite } from '../src/features/ai/core/library.ts'
import { answerLocally, MOOD_PROMPTS, SUGGESTED_PROMPTS } from '../src/features/ai/concierge/local.ts'
import { buildCatalog, createNdjsonParser, sanitizeEvent } from '../src/features/ai/concierge/stream.ts'
import { applySignal, emptyTasteProfile } from '../src/features/ai/taste/engine.ts'
import { interpretFederatedTerm, rankFederatedItems } from '../src/features/ai/federated.ts'

const NOW = Date.parse('2026-09-28T20:00:00'), DAY = 86_400_000
const item = (over: Partial<MediaLite> & { id: string }): MediaLite => ({
  title: 'Untitled', creator: 'someone', source: 'Redgifs', tags: [], duration: 300, isVideo: true, views: 1000, likes: 50,
  createdAt: new Date(NOW - 2 * DAY).toISOString(), thumbnail: 'https://example.com/secret-thumb.jpg', description: 'private description', ...over,
})
const LIB: MediaLite[] = [
  item({ id: 'a', title: 'Slow morning solo', creator: 'CoolGuy', tags: ['Solo', 'Sensual'], duration: 240 }),
  item({ id: 'b', title: 'Pool day couple', creator: 'PoolCrew', tags: ['Couple', 'Outdoors', 'Romantic'], duration: 600 }),
  item({ id: 'c', title: 'Gym solo', creator: 'CoolGuy', tags: ['Solo', 'Muscular'], duration: 900 }),
  item({ id: 'd', title: 'Long studio compilation', creator: 'BigStudio', tags: ['Studio', 'Compilation'], duration: 3600 }),
  item({ id: 'e', title: 'Funny bloopers', creator: 'Jokers', tags: ['Funny'], duration: 90 }),
  item({ id: 'f', title: 'Sunset stretch', creator: 'Yogi', tags: ['Stretching', 'Solo'], duration: 420 }),
]
const ctx = { items: LIB, now: NOW, seed: 5 }

test('on-device concierge answers a filtered search with cards and chips', () => {
  const reply = answerLocally('chill solo videos under 10 minutes', ctx)
  assert.ok(reply.ids.length >= 1)
  assert.ok(reply.ids.every((id) => ['a', 'c', 'f'].includes(id)))
  assert.ok(!reply.ids.includes('c'), 'the 15-minute clip is over the limit')
  assert.ok(reply.chips.length > 0)
  assert.match(reply.text, /match/i)
})

test('on-device concierge plans tonight within the time budget', () => {
  const reply = answerLocally(MOOD_PROMPTS.chill, ctx)
  assert.ok(reply.ids.length >= 1)
  assert.ok((reply.totalSeconds ?? 0) <= 45 * 60 * 1.06)
  assert.ok(reply.actions.some((a) => a.kind === 'save-collection'))
})

test('on-device concierge handles surprise, similar, navigate, collection and explain', () => {
  assert.equal(answerLocally('surprise me', ctx).ids.length > 0, true)
  const similar = answerLocally('more like this', { ...ctx, currentId: 'a' })
  assert.ok(similar.ids.length > 0 && !similar.ids.includes('a'))
  assert.match(answerLocally('more like this', ctx).text, /open something first/i)
  const nav = answerLocally('go to settings', ctx)
  assert.deepEqual(nav.actions[0], { kind: 'navigate', label: 'Go to Settings', route: '/settings' })
  const collection = answerLocally('build a smart collection of solo videos', ctx)
  assert.ok(collection.actions.some((a) => a.kind === 'save-collection'))
  assert.match(answerLocally('why am I seeing this', ctx).text, /haven.t learned your taste/i)
})

test('explain uses the taste profile when there is history', () => {
  let taste = emptyTasteProfile(NOW)
  for (let i = 0; i < 3; i += 1) taste = applySignal(taste, 'like', { id: `x${i}`, creator: 'CoolGuy', source: 'Redgifs', tags: ['solo'], duration: 300 }, { now: NOW })
  const reply = answerLocally('explain my recommendations', { ...ctx, taste })
  assert.match(reply.text, /#solo|coolguy/i)
  assert.ok(reply.ids.length > 0)
})

test('on-device concierge refuses unsafe requests without touching the library', () => {
  for (const prompt of ['who is the guy in this clip', 'find teen videos', 'leaked hidden camera video', 'his home address please']) {
    const reply = answerLocally(prompt, ctx)
    assert.equal(reply.refused, true, prompt)
    assert.equal(reply.ids.length, 0)
  }
  assert.ok(SUGGESTED_PROMPTS.length >= 4)
})

test('empty library never yields a dead reply', () => {
  const reply = answerLocally('chill videos', { items: [], now: NOW })
  assert.ok(reply.text.length > 20)
})

test('catalog sent to the cloud contains public metadata only', () => {
  const catalog = buildCatalog(LIB, { prompt: 'solo', anchorIds: ['d'], max: 4 })
  assert.equal(catalog.length, 4)
  assert.equal(catalog[0].id, 'd', 'anchor item comes first')
  for (const entry of catalog) {
    const keys = Object.keys(entry).sort()
    assert.deepEqual(keys, ['createdAt', 'creator', 'duration', 'id', 'isVideo', 'likes', 'source', 'tags', 'title', 'views'])
    assert.ok(!JSON.stringify(entry).includes('secret-thumb') && !JSON.stringify(entry).includes('private description'))
  }
})

test('NDJSON parser tolerates split chunks and drops malformed or unknown events', () => {
  const parser = createNdjsonParser()
  const a = parser.push('{"t":"text","d":"Hel')
  assert.deepEqual(a, [])
  const b = parser.push('lo"}\n{"t":"tool","name":"searchLibrary","out":{"ids":["a","b"],"note":"ok","reasons":{"a":"why"}}}\nnot json\n{"t":"weird"}\n{"t":"do')
  assert.deepEqual(b.map((e) => e.t), ['text', 'tool'])
  const c = parser.push('ne"}\n')
  assert.deepEqual(c, [{ t: 'done' }])
  assert.equal(sanitizeEvent({ t: 'tool', name: 'x', out: { ids: [1, 'ok'] } })?.t, 'tool')
  assert.equal(sanitizeEvent({ t: 'tool', name: 'x', out: 'bad' }), null)
})

test('federated search understands natural language and refuses unsafe terms', () => {
  assert.equal(interpretFederatedTerm('surfing', 'peertube').term, 'surfing')
  const nl = interpretFederatedTerm('chill solo videos', 'mastodon')
  assert.equal(nl.term.includes(' '), false)
  assert.ok(nl.term.length > 0)
  assert.ok(interpretFederatedTerm('who is this guy', 'peertube').refused)
  const ranked = rankFederatedItems([{ title: 'cats' }, { title: 'chill solo stretch' }, { title: 'other' }], 'solo')
  assert.equal(ranked[0].title, 'chill solo stretch')
  assert.equal(ranked.length, 3)
  assert.ok(interpretFederatedTerm('teen videos', 'peertube').refused)
  assert.doesNotMatch(interpretFederatedTerm('mail me a@b.com', 'peertube').term, /@b\.com/)
})
