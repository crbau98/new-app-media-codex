import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const { default: resolveHandler } = await import('../api/creator-resolve.ts')
const { default: mediaHandler } = await import('../api/creator-media.ts')
const lib = await import('../api/_lib/creator-resolve.ts')
const registry = await import('../api/_lib/creator-registry.ts')

const gif = (id: string, userName: string, over: Record<string, unknown> = {}) => ({
  id, userName, description: `clip ${id}`, tags: ['Gay'], duration: 10, width: 720, height: 1280,
  likes: 1, views: 10, createDate: 1_790_000_000,
  urls: { hd: `https://media.redgifs.com/${id}.mp4`, poster: `https://media.redgifs.com/${id}-p.jpg`, thumbnail: `https://media.redgifs.com/${id}-t.jpg` },
  ...over,
})

type Mock = { users?: Record<string, unknown[]>; text?: Record<string, unknown[]>; status?: number }

function mockProvider(mock: Mock, seen: string[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    if (mock.status) return new Response('down', { status: mock.status })
    if (url.includes('/auth/temporary')) return Response.json({ token: 't' })
    const u = new URL(url)
    const user = u.pathname.match(/\/users\/([^/]+)\/search/)
    if (user) {
      const gifs = mock.users?.[decodeURIComponent(user[1])] || []
      return Response.json({ gifs, page: 1, pages: 1, total: gifs.length })
    }
    if (u.pathname.endsWith('/gifs/search')) {
      const text = u.searchParams.get('search_text') || ''
      return Response.json({ gifs: mock.text?.[text] || [] })
    }
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

let ipCounter = 0
const call = (q: string, extra = '') =>
  resolveHandler(new Request(`https://x.test/api/creator-resolve?q=${encodeURIComponent(q)}${extra}`, {
    headers: { 'x-forwarded-for': `10.0.0.${++ipCounter}` },
  }))

type Body = { query: string; candidates: Array<{ handle: string; displayName: string; confidence: number; matchedBy: string; mediaCount: number | null; avatar?: string; profileUrl: string; platform: string }>; tried: string[] }

test('handleVariants: name -> ordered, deduped, capped, provider-safe', () => {
  const v = lib.handleVariants('Michael Yerger')
  assert.deepEqual(v.slice(0, 5), ['michaelyerger', 'michael_yerger', 'michael.yerger', 'michael-yerger', 'yergermichael'])
  assert.ok(v.length <= 24 && new Set(v).size === v.length)
  assert.ok(v.every((h) => /^[a-z0-9_.-]{2,50}$/.test(h)))
  assert.ok(v.includes('michaelyergerofficial'))
  const j = lib.handleVariants('jakipz')
  assert.equal(j[0], 'jakipz')
  assert.ok(j.includes('jakipz_official'))
})

test('sanitizeQuery strips urls and @, rejects emails / phone numbers', () => {
  assert.deepEqual(lib.sanitizeQuery('@Some_Handle'), { ok: true, text: 'Some_Handle', handleLike: true })
  assert.equal((lib.sanitizeQuery('https://www.redgifs.com/users/hoguesdirtylaundry') as { text: string }).text, 'hoguesdirtylaundry')
  assert.equal((lib.sanitizeQuery('x.com/jakipz?ref=1') as { text: string }).text, 'jakipz')
  assert.deepEqual(lib.sanitizeQuery('a@b.com'), { ok: false, reason: 'email' })
  assert.equal(lib.sanitizeQuery('call 555 123 4567').ok, false)
  assert.equal(lib.sanitizeQuery('a').ok, false)
  assert.equal(lib.sanitizeQuery('x'.repeat(81)).ok, false)
  assert.deepEqual(lib.handleVariants('me@example.com'), [])
})

test('similarity: transposition, prefix/suffix and token overlap', () => {
  assert.equal(lib.damerauLevenshtein('yerger', 'yergre'), 1)
  assert.ok(lib.nameSimilarity('Michael Yerger', 'michael_yerger') === 1)
  assert.ok(lib.nameSimilarity('Michael Yerger', 'realmichaelyerger99') >= 0.85)
  assert.ok(lib.nameSimilarity('Michael Yerger', 'zzzxxq') < 0.3)
})

test('registry: alias lookup is normalised; Yerger/Jakipz have no invented handles', () => {
  assert.equal(registry.findRegistryEntries('Christian  HOGUE!')[0].canonicalName, 'Christian Hogue')
  assert.equal(registry.findRegistryEntries("Hogue's Dirty Laundry")[0].handles.redgifs?.[0], 'hoguesdirtylaundry')
  assert.deepEqual(registry.findRegistryEntries('michael yerger')[0].handles, {})
  assert.deepEqual(registry.findRegistryEntries('jakipz')[0].handles, {})
  assert.deepEqual(registry.findRegistryEntries('nobody at all'), [])
})

test('Christian Hogue alias resolves to hoguesdirtylaundry first', async () => {
  const restore = mockProvider({ users: { hoguesdirtylaundry: [gif('h1', 'hoguesdirtylaundry'), gif('h2', 'hoguesdirtylaundry')] } })
  try {
    const res = await call('christian hogue')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('cache-control') || '', /s-maxage=600/)
    const body = await res.json() as Body
    assert.equal(body.candidates[0].handle, 'hoguesdirtylaundry')
    assert.equal(body.candidates[0].matchedBy, 'alias')
    assert.equal(body.candidates[0].displayName, 'Christian Hogue')
    assert.equal(body.candidates[0].mediaCount, 2)
    assert.equal(body.candidates[0].profileUrl, 'https://www.redgifs.com/users/hoguesdirtylaundry')
    assert.ok(body.candidates[0].avatar?.startsWith('/api/archiver-proxy?url='))
    assert.equal(body.tried[0], 'hoguesdirtylaundry')
  } finally { restore() }
})

test('Michael Yerger resolves through a variant with confidence ordering', async () => {
  const restore = mockProvider({ users: {
    michael_yerger: [gif('m1', 'michael_yerger')],
    michaelyerger1: [gif('m2', 'michaelyerger1')],
  } })
  try {
    const body = await (await call('Michael Yerger')).json() as Body
    assert.deepEqual(body.candidates.map((c) => c.handle), ['michael_yerger', 'michaelyerger1'])
    assert.equal(body.candidates[0].matchedBy, 'exact')
    assert.equal(body.candidates[1].matchedBy, 'variant')
    assert.ok(body.candidates[0].confidence > body.candidates[1].confidence)
    assert.ok(body.tried.includes('michaelyerger') && body.tried.includes('michael_yerger'))
  } finally { restore() }
})

test('exact single-token handle is matchedBy exact; url input is stripped', async () => {
  const restore = mockProvider({ users: { jakipz: [gif('j1', 'jakipz')] } })
  try {
    const body = await (await call('https://www.redgifs.com/users/Jakipz')).json() as Body
    assert.equal(body.query, 'Jakipz')
    assert.equal(body.candidates[0].handle, 'jakipz')
    assert.equal(body.candidates[0].matchedBy, 'exact')
  } finally { restore() }
})

test('text-search fallback surfaces a userName absent from every variant', async () => {
  const restore = mockProvider({ text: { 'Michael Yerger': [
    gif('t1', 'mikey_yerger_official'), gif('t2', 'mikey_yerger_official'), gif('t3', 'unrelated_person'),
  ] }, users: { mikey_yerger_official: [gif('t1', 'mikey_yerger_official')] } })
  try {
    const body = await (await call('Michael Yerger')).json() as Body
    assert.equal(body.candidates[0].handle, 'mikey_yerger_official')
    assert.equal(body.candidates[0].matchedBy, 'search')
    assert.ok(!body.candidates.some((c) => c.handle === 'unrelated_person'))
  } finally { restore() }
})

test('rejects emails and bad methods; OPTIONS ok', async () => {
  assert.equal((await call('someone@example.com')).status, 400)
  assert.equal((await call('a')).status, 400)
  assert.equal((await resolveHandler(new Request('https://x.test/api/creator-resolve?q=abc', { method: 'POST' }))).status, 405)
  assert.equal((await resolveHandler(new Request('https://x.test/api/creator-resolve', { method: 'OPTIONS' }))).status, 204)
})

test('soft-fails: provider 5xx gives 502 JSON; registry hit survives outage', async () => {
  let restore = mockProvider({ status: 503 })
  try {
    const res = await call('nobody special')
    assert.equal(res.status, 502)
    assert.equal(((await res.json()) as { error: string }).error, 'providers_unavailable')
    const reg = await call('christian hogue')
    assert.equal(reg.status, 200)
    assert.equal(((await reg.json()) as Body).candidates[0].handle, 'hoguesdirtylaundry')
  } finally { restore() }
  restore = mockProvider({})
  try {
    const empty = await call('nobody special')
    assert.equal(empty.status, 200)
    assert.deepEqual(((await empty.json()) as Body).candidates, [])
  } finally { restore() }
})

test('creator-media: strict=0 keeps items strict mode hides', async () => {
  const users = { top_dry: [gif('ok', 'top_dry'), gif('fem', 'top_dry', { tags: ['Gay', 'girl'] })] }
  const restore = mockProvider({ users })
  try {
    const strict = await (await mediaHandler(new Request('https://x.test/api/creator-media?creator=top_dry'))).json() as { items: Array<{ id: string }> }
    assert.deepEqual(strict.items.map((i) => i.id), ['rg-ok'])
    const loose = await (await mediaHandler(new Request('https://x.test/api/creator-media?creator=top_dry&strict=0'))).json() as { items: Array<{ id: string }> }
    assert.deepEqual(loose.items.map((i) => i.id).sort(), ['rg-fem', 'rg-ok'])
  } finally { restore() }
})

test('creator-media: display name resolves to a handle and reports resolvedHandle', async () => {
  const restore = mockProvider({ users: { michael_yerger: [gif('a', 'michael_yerger')], hoguesdirtylaundry: [gif('b', 'hoguesdirtylaundry')] } })
  try {
    const a = await (await mediaHandler(new Request('https://x.test/api/creator-media?creator=Michael%20Yerger&strict=0'))).json() as { resolvedHandle: string; items: Array<{ id: string }> }
    assert.equal(a.resolvedHandle, 'michael_yerger')
    assert.deepEqual(a.items.map((i) => i.id), ['rg-a'])
    const b = await (await mediaHandler(new Request('https://x.test/api/creator-media?creator=christian%20hogue'))).json() as { resolvedHandle: string }
    assert.equal(b.resolvedHandle, 'hoguesdirtylaundry')
  } finally { restore() }
})
