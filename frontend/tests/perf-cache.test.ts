import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CACHE_VERSION,
  HINT_KEY,
  MAX_AGE_MS,
  MAX_ENTRIES,
  MAX_ENTRY_CHARS,
  PERSISTED_CREATOR_MEDIA,
  STORAGE_PREFIX,
  hashKey,
  heroThumbnail,
  isPersistableKey,
  makeHint,
  parseEntry,
  parseHint,
  planEviction,
  serializeEntry,
  storageKeyFor,
  trimDiscoveryForPersist,
} from '../src/lib/perf/cache.ts'

const NOW = 1_800_000_000_000
const KEY = ['live-discovery', ['alpha', 'beta']] as const

function payload(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      { id: 'a', title: 'A', thumbnail: '/api/archiver-proxy?url=https%3A%2F%2Fthumbs44.redgifs.com%2Fa.jpg', curationScore: 50 },
      { id: 'b', title: 'B', thumbnail: '/api/archiver-proxy?url=https%3A%2F%2Fthumbs44.redgifs.com%2Fb.jpg', curationScore: 90 },
      { id: 'c', title: 'C', thumbnail: '/api/archiver-proxy?url=https%3A%2F%2Fthumbs44.redgifs.com%2Fc.jpg', curationScore: 90 },
    ],
    performers: Array.from({ length: 30 }, (_, index) => ({
      id: `creator-${index}`,
      name: `Creator ${index}`,
      media: [{ id: `m${index}-1` }, { id: `m${index}-2` }, { id: `m${index}-3` }],
    })),
    updatedAt: '2026-10-05T00:00:00.000Z',
    counts: { received: 3, eligible: 3, playable: 3, pagesScanned: 1 },
    watchlist: { requested: ['alpha', 'beta'], matched: ['alpha'] },
    ...overrides,
  }
}

test('only the live feed key family is persistable', () => {
  assert.equal(isPersistableKey(['live-discovery', []]), true)
  assert.equal(isPersistableKey(['live-discovery', 'creators', ['x']]), true)
  assert.equal(isPersistableKey(['search-media', 'jock', []]), false)
  assert.equal(isPersistableKey(['creator-directory', '', 'smart']), false)
  assert.equal(isPersistableKey(['live-discovery', 'search', 'private text']), false)
  assert.equal(isPersistableKey([]), false)
})

test('hashKey is stable, order-insensitive for objects, and sensitive to content', () => {
  assert.equal(hashKey(KEY), hashKey(['live-discovery', ['alpha', 'beta']]))
  assert.notEqual(hashKey(KEY), hashKey(['live-discovery', ['beta', 'alpha']]))
  assert.equal(hashKey(['k', { a: 1, b: 2 }]), hashKey(['k', { b: 2, a: 1 }]))
  assert.match(hashKey(KEY), /^[0-9a-f]{8}$/)
  assert.ok(storageKeyFor(KEY).startsWith(STORAGE_PREFIX))
})

test('the stored key never contains the watchlist in plain text', () => {
  assert.equal(storageKeyFor(KEY).includes('alpha'), false)
  const text = serializeEntry(KEY, payload(), NOW) as string
  assert.equal(text.includes('alpha'), false)
  assert.equal(text.includes('beta'), false)
})

test('serialize + parse round-trips within the TTL', () => {
  const text = serializeEntry(KEY, payload(), NOW) as string
  assert.ok(text)
  const hit = parseEntry<ReturnType<typeof payload>>(text, KEY, NOW + 60_000)
  assert.ok(hit)
  assert.equal(hit.savedAt, NOW)
  assert.equal(hit.data.items.length, 3)
})

test('entries expire after 6 hours (and a clock that went backwards is a miss)', () => {
  assert.equal(MAX_AGE_MS, 6 * 60 * 60 * 1000)
  const text = serializeEntry(KEY, payload(), NOW) as string
  assert.ok(parseEntry(text, KEY, NOW + MAX_AGE_MS))
  assert.equal(parseEntry(text, KEY, NOW + MAX_AGE_MS + 1), null)
  assert.equal(parseEntry(text, KEY, NOW - 1), null)
})

test('a version bump invalidates stored entries', () => {
  const text = serializeEntry(KEY, payload(), NOW) as string
  const bumped = text.replace(`"v":${CACHE_VERSION}`, `"v":${CACHE_VERSION + 1}`)
  assert.notEqual(bumped, text)
  assert.equal(parseEntry(bumped, KEY, NOW), null)
})

test('a different query key never reads another key\'s entry', () => {
  const text = serializeEntry(KEY, payload(), NOW) as string
  assert.equal(parseEntry(text, ['live-discovery', ['other']], NOW), null)
})

test('corrupt, truncated or wrongly shaped storage is a miss, never a throw', () => {
  assert.equal(parseEntry(null, KEY, NOW), null)
  assert.equal(parseEntry('', KEY, NOW), null)
  assert.equal(parseEntry('{not json', KEY, NOW), null)
  assert.equal(parseEntry('[]', KEY, NOW), null)
  assert.equal(parseEntry(JSON.stringify({ v: CACHE_VERSION, savedAt: NOW, k: hashKey(KEY), data: 'oops' }), KEY, NOW), null)
  assert.equal(parseEntry(JSON.stringify({ v: CACHE_VERSION, savedAt: NOW, k: hashKey(KEY), data: { items: 'nope' } }), KEY, NOW), null)
  assert.equal(parseEntry(JSON.stringify({ v: CACHE_VERSION, savedAt: 'x', k: hashKey(KEY), data: { items: [] } }), KEY, NOW), null)
})

test('non-persistable keys and empty data are not serialized', () => {
  assert.equal(serializeEntry(['search-media', 'x', []], payload(), NOW), null)
  assert.equal(serializeEntry(KEY, undefined, NOW), null)
  assert.equal(serializeEntry(KEY, null, NOW), null)
})

test('oversized payloads are not persisted', () => {
  const big = payload({ items: Array.from({ length: 4000 }, (_, index) => ({ id: `i${index}`, title: 'x'.repeat(200), thumbnail: '/api/archiver-proxy?url=x' })) })
  assert.equal(serializeEntry(KEY, big, NOW), null)
  assert.ok(MAX_ENTRY_CHARS > 100_000)
})

test('trim keeps items but shrinks creator media and blanks the radar copy', () => {
  const trimmed = trimDiscoveryForPersist(payload()) as ReturnType<typeof payload>
  assert.equal(trimmed.items.length, 3)
  assert.deepEqual(trimmed.watchlist, { requested: [], matched: [] })
  const performers = trimmed.performers as Array<{ media: unknown[] }>
  assert.equal(performers[0].media.length, 1)
  assert.equal(performers[PERSISTED_CREATOR_MEDIA - 1].media.length, 1)
  assert.equal(performers[PERSISTED_CREATOR_MEDIA].media.length, 0)
})

test('payloads without performers pass through untouched', () => {
  const plain = { items: [], updatedAt: 'x' }
  assert.equal(trimDiscoveryForPersist(plain), plain)
})

test('eviction drops stale versions, expired entries and anything past the cap (oldest first)', () => {
  const key = (name: string) => `${STORAGE_PREFIX}${name}`
  const entries = [
    { key: key('a'), savedAt: NOW - 1000 },
    { key: key('b'), savedAt: NOW - 2000 },
    { key: key('c'), savedAt: NOW - 3000 },
    { key: key('expired'), savedAt: NOW - MAX_AGE_MS - 1 },
    { key: key('unreadable'), savedAt: null },
    { key: 'mc.qc.v0:legacy', savedAt: NOW },
  ]
  const drop = planEviction(entries, NOW)
  assert.equal(MAX_ENTRIES, 2)
  assert.deepEqual(new Set(drop), new Set([key('c'), key('expired'), key('unreadable'), 'mc.qc.v0:legacy']))
})

test('hero choice matches Home (highest curation score, first wins ties) and only returns preloadable URLs', () => {
  const data = payload()
  assert.equal(heroThumbnail(data), (data.items[1] as { thumbnail: string }).thumbnail)
  assert.equal(heroThumbnail({ items: [] }), null)
  assert.equal(heroThumbnail({ items: [{ id: 'x', thumbnail: 'http://insecure.example/x.jpg', curationScore: 5 }] }), null)
  assert.equal(heroThumbnail({ items: [{ id: 'x', thumbnail: '/media/relative.jpg', curationScore: 5 }] }), null)
  assert.equal(heroThumbnail({ items: [{ id: 'x', thumbnail: 'https://cdn.example/x.jpg' }] }), 'https://cdn.example/x.jpg')
})

test('hint round-trips and expires with the same TTL', () => {
  const hint = makeHint(payload(), NOW)
  assert.ok(hint)
  const raw = JSON.stringify(hint)
  assert.ok(parseHint(raw, NOW + 1000))
  assert.equal(parseHint(raw, NOW + MAX_AGE_MS + 1), null)
  assert.equal(parseHint('{"v":99}', NOW), null)
  assert.equal(parseHint('garbage', NOW), null)
  assert.equal(HINT_KEY, 'mc.qc.hint')
})
