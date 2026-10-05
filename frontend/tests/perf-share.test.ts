import assert from 'node:assert/strict'
import test from 'node:test'

import { shareDiscovery } from '../src/lib/perf/share.ts'
import { buildDiscoveryRequest } from '../src/lib/perf/discovery-request.ts'
import { discoveryKey, DISCOVERY_STALE_MS } from '../src/lib/perf/discovery-keys.ts'

function item(id: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Title ${id}`, thumbnail: `/api/archiver-proxy?url=${id}`, creator: 'c', views: 10, likes: 1, curationScore: 50, tags: ['a', 'b'], ...extra }
}
function creator(id: string, extra: Record<string, unknown> = {}) {
  return { id, name: id, avatar: '', mediaCount: 2, viewCount: 20, similarityScore: 0, media: [item(`${id}-m`)], ...extra }
}
function payload(items: unknown[], performers: unknown[], updatedAt: string) {
  return { items, performers, updatedAt }
}

test('first load (no previous data) is returned as-is', () => {
  const next = payload([item('a')], [creator('x')], 't1')
  assert.equal(shareDiscovery(undefined, next), next)
})

test('unchanged items and creators keep their previous identity; the top level takes the new timestamp', () => {
  const previous = payload([item('a'), item('b')], [creator('x')], 't1')
  const next = payload([item('a'), item('b')], [creator('x')], 't2')
  const shared = shareDiscovery(previous, next) as typeof previous
  assert.equal(shared.updatedAt, 't2')
  assert.equal(shared.items, previous.items)
  assert.equal(shared.performers, previous.performers)
  assert.equal(shared.items[0], previous.items[0])
})

test('a changed item replaces only itself; siblings keep identity', () => {
  const previous = payload([item('a'), item('b')], [], 't1')
  const next = payload([item('a'), item('b', { views: 999 })], [], 't2')
  const shared = shareDiscovery(previous, next) as typeof previous
  assert.notEqual(shared.items, previous.items)
  assert.equal(shared.items[0], previous.items[0])
  assert.equal(shared.items[1], next.items[1])
  assert.equal((shared.items[1] as { views: number }).views, 999)
})

test('reordered, added and removed items are honoured while matching items are reused', () => {
  const previous = payload([item('a'), item('b'), item('c')], [], 't1')
  const next = payload([item('c'), item('d'), item('a')], [], 't2')
  const shared = shareDiscovery(previous, next) as typeof previous
  assert.deepEqual(shared.items.map((entry) => (entry as { id: string }).id), ['c', 'd', 'a'])
  assert.equal(shared.items[0], previous.items[2])
  assert.equal(shared.items[2], previous.items[0])
  assert.equal(shared.items[1], next.items[1])
})

test('creators are shared by id and signature', () => {
  const previous = payload([], [creator('x'), creator('y')], 't1')
  const next = payload([], [creator('x'), creator('y', { mediaCount: 9 })], 't2')
  const shared = shareDiscovery(previous, next) as typeof previous
  assert.equal(shared.performers[0], previous.performers[0])
  assert.equal(shared.performers[1], next.performers[1])
})

test('non-object results (errors, empty) pass through', () => {
  assert.equal(shareDiscovery({ items: [] }, null), null)
  assert.equal(shareDiscovery({ items: [] }, 'x'), 'x')
})

test('a payload without arrays does not throw', () => {
  const next = { updatedAt: 't2' }
  assert.equal(shareDiscovery({ updatedAt: 't1' }, next), next)
})

test('anonymous default feed is a cacheable GET with the documented URL', () => {
  const request = buildDiscoveryRequest([])
  assert.equal(request.method, 'GET')
  assert.equal(request.url, '/api/live-media?count=96&pages=3&sort=smart')
  assert.equal(request.cacheable, true)
  assert.equal(request.sig, 'GET /api/live-media?count=96&pages=3&sort=smart')
  assert.equal(request.body, undefined)
})

test('personalised, query, sorted and forced requests are POSTs with no-store and a capped watchlist', () => {
  const personalised = buildDiscoveryRequest(['a', 'b'])
  assert.equal(personalised.method, 'POST')
  assert.equal(personalised.cache, 'no-store')
  assert.equal(personalised.cacheable, false)
  assert.deepEqual(JSON.parse(personalised.body as string), { count: 96, pages: 3, sort: 'smart', query: '', watchlist: ['a', 'b'], forceFresh: false, useAI: false })

  const many = Array.from({ length: 55 }, (_, index) => `h${index}`)
  assert.equal(JSON.parse(buildDiscoveryRequest(many).body as string).watchlist.length, 40)

  assert.equal(buildDiscoveryRequest([], { query: 'jock' }).method, 'POST')
  assert.equal(buildDiscoveryRequest([], { sort: 'newest' }).method, 'POST')
  assert.equal(buildDiscoveryRequest([], { query: '   ' }).method, 'GET')

  const forced = buildDiscoveryRequest([], { forceFresh: true })
  assert.equal(forced.method, 'POST')
  assert.equal(forced.timeoutMs, 45000)
  assert.equal(forced.headers?.['Cache-Control'], 'no-cache')
  assert.equal(JSON.parse(forced.body as string).useAI, true)
})

test('feed key and freshness window', () => {
  assert.deepEqual(discoveryKey(['a']), ['live-discovery', ['a']])
  assert.equal(DISCOVERY_STALE_MS, 300_000)
})
