import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const { default: handler } = await import('../api/creator-media.ts')
const { providerHandle, canonicalCreator, isEligibleScopedItem, mapRedgifsItem } = await import('../api/_lib/redgifs.ts')

const gif = (id: string, over: Record<string, unknown> = {}) => ({
  id, userName: 'top_dry', description: `clip ${id}`, tags: ['Gay', 'Solo'], duration: 12, width: 1080, height: 1920,
  likes: 5, views: 100, createDate: 1_790_000_000,
  urls: { hd: `https://media.redgifs.com/${id}.mp4`, sd: `https://media.redgifs.com/${id}-mobile.mp4`, poster: `https://media.redgifs.com/${id}-poster.jpg`, thumbnail: `https://media.redgifs.com/${id}-thumb.jpg` },
  ...over,
})

function mockProvider(pages: Record<number, unknown[]>, total: number, seen: string[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    if (url.includes('/auth/temporary')) return Response.json({ token: 't' })
    const page = Number(new URL(url).searchParams.get('page'))
    return Response.json({ gifs: pages[page] || [], page, pages: Object.keys(pages).length, total })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

test('providerHandle keeps separators; canonicalCreator strips them for matching', () => {
  assert.equal(providerHandle('@Top_Dry '), 'top_dry')
  assert.equal(providerHandle('a@b.com'), '')
  assert.equal(canonicalCreator('top_dry'), 'topdry')
})

test('creator catalog returns a full, paged, normalized page', async () => {
  const seen: string[] = []
  const restore = mockProvider({ 1: [gif('a'), gif('b')], 2: [gif('c')] }, 3, seen)
  try {
    const res = await handler(new Request('https://x.test/api/creator-media?creator=top_dry&page=1&count=2'))
    assert.equal(res.status, 200)
    const body = await res.json() as { items: Array<{ id: string; streamCandidates: string[]; aspect?: number }>; hasMore: boolean; total: number; pages: number }
    assert.deepEqual(body.items.map((i) => i.id), ['rg-a', 'rg-b'])
    assert.equal(body.hasMore, true)
    assert.equal(body.total, 3)
    assert.ok(body.items[0].streamCandidates[0].startsWith('/api/archiver-proxy?url='))
    assert.ok(body.items[0].aspect && body.items[0].aspect < 1)
    // Underscore must survive in the provider path (it was previously stripped).
    assert.ok(seen.some((u) => u.includes('/users/top_dry/search')))
    const last = await handler(new Request('https://x.test/api/creator-media?creator=top_dry&page=2&count=2'))
    const lastBody = await last.json() as { items: unknown[]; hasMore: boolean }
    assert.equal(lastBody.items.length, 1)
    assert.equal(lastBody.hasMore, false)
  } finally { restore() }
})

test('creator catalog drops other creators, ineligible and unplayable items', async () => {
  const restore = mockProvider({ 1: [
    gif('ok'),
    gif('other', { userName: 'someone_else' }),
    gif('fem', { tags: ['Gay', 'girl'] }),
    gif('nostream', { urls: { poster: 'https://media.redgifs.com/x.jpg' } }),
    gif('badhost', { urls: { hd: 'https://evil.example/a.mp4', poster: 'https://evil.example/p.jpg' } }),
  ] }, 5)
  try {
    const res = await handler(new Request('https://x.test/api/creator-media?creator=top_dry'))
    const body = await res.json() as { items: Array<{ id: string }>; skipped: number }
    assert.deepEqual(body.items.map((i) => i.id), ['rg-ok'])
    assert.equal(body.skipped, 4)
  } finally { restore() }
})

test('creator catalog validates input and reports provider failures', async () => {
  assert.equal((await handler(new Request('https://x.test/api/creator-media?creator='))).status, 400)
  assert.equal((await handler(new Request('https://x.test/api/creator-media?creator=a'))).status, 400)
  assert.equal((await handler(new Request('https://x.test/api/creator-media?creator=ok', { method: 'POST' }))).status, 405)
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
  try {
    const res = await handler(new Request('https://x.test/api/creator-media?creator=someone'))
    assert.equal(res.status, 502)
  } finally { globalThis.fetch = original }
})

test('cards get the small thumbnail; the full-size poster is kept separately', () => {
  const item = mapRedgifsItem(gif('t') as never) as { thumbnail: string; posterUrl?: string }
  assert.ok(decodeURIComponent(item.thumbnail).endsWith('t-thumb.jpg'))
  assert.ok(item.posterUrl && decodeURIComponent(item.posterUrl).endsWith('t-poster.jpg'))
  // No thumbnail from the provider: fall back to the poster rather than an empty card.
  const noThumb = mapRedgifsItem(gif('u', { urls: { hd: 'https://media.redgifs.com/u.mp4', poster: 'https://media.redgifs.com/u-poster.jpg' } }) as never)
  assert.ok(decodeURIComponent(noThumb.thumbnail).endsWith('u-poster.jpg'))
})

test('shared mapper marks watched creators and keeps eligibility rules', () => {
  const item = mapRedgifsItem(gif('z') as never, true)
  assert.equal(item.isWatchedCreator, true)
  assert.equal(item.source, 'Redgifs')
  assert.equal(isEligibleScopedItem(gif('q', { description: 'straight scene' }) as never), false)
})
