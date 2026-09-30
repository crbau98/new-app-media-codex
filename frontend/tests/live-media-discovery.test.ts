import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const { default: handler } = await import('../api/live-media.ts')
const lanes = await import('../api/_lib/discovery-lanes.ts')

const gif = (id: string, userName: string, over: Record<string, unknown> = {}) => ({
  id, userName, description: `clip ${id}`, tags: ['Gay'], duration: 10, width: 1080, height: 1920,
  likes: 5, views: 100, createDate: 1_790_000_000,
  urls: { hd: `https://media.redgifs.com/${id}.mp4`, sd: `https://media.redgifs.com/${id}-m.mp4`, poster: `https://media.redgifs.com/${id}-p.jpg`, thumbnail: `https://media.redgifs.com/${id}-t.jpg` },
  ...over,
})

function mockProvider(seen: string[]) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.includes('redgifs.com')) return new Response('offline', { status: 503 })
    seen.push(url)
    if (url.includes('/auth/temporary')) return Response.json({ token: 't' })
    const parsed = new URL(url)
    if (parsed.pathname.includes('/users/')) {
      const handle = decodeURIComponent(parsed.pathname.split('/')[3])
      if (handle === 'gone_user') return new Response('missing', { status: 404 })
      return Response.json({ gifs: [gif(`u-${handle}`, handle), gif(`x-${handle}`, 'someone_else')] })
    }
    const tag = parsed.searchParams.get('tags') || ''
    if (tag === 'Broken Lane') return new Response('boom', { status: 500 })
    return Response.json({ gifs: [gif(`${tag}-${parsed.searchParams.get('order')}-${parsed.searchParams.get('page')}`, `c_${tag.replace(/\W/g, '')}`)] })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

const feed = async (query: string) => {
  const res = await handler(new Request(`https://x.test/api/live-media?${query}`))
  return { res, body: await res.json() as { performers: Array<{ username: string; isWatched: boolean; mediaCount: number }>; items: Array<{ creator: string }>; counts: Record<string, number>; watchlist: { requested: string[] } } }
}

test('feed keeps the Gay lane and adds rotating extra lanes that differ by seed', async () => {
  const seenA: string[] = []
  let restore = mockProvider(seenA)
  try {
    const { res, body } = await feed('count=100&pages=3&lane=0')
    assert.equal(res.status, 200)
    const tags = new Set(seenA.filter((u) => u.includes('/gifs/search')).map((u) => new URL(u).searchParams.get('tags')))
    assert.ok(tags.has('Gay'))
    assert.ok(tags.size >= 4, `expected several lanes, got ${[...tags]}`)
    assert.ok(body.performers.length >= 4)
    assert.ok(body.counts.providerRequestsAttempted >= 9)
  } finally { restore() }
  const seenB: string[] = []
  restore = mockProvider(seenB)
  try {
    await feed('count=100&pages=3&lane=5')
    const tagsOf = (seen: string[]) => new Set(seen.filter((u) => u.includes('/gifs/search')).map((u) => new URL(u).searchParams.get('tags')))
    assert.notDeepEqual([...tagsOf(seenA)].sort(), [...tagsOf(seenB)].sort())
  } finally { restore() }
})

test('a pinned unknown or broken lane fails soft', async () => {
  const seen: string[] = []
  const restore = mockProvider(seen)
  try {
    const { res, body } = await feed('lane=Broken%20Lane')
    assert.equal(res.status, 200)
    assert.ok(body.items.length > 0)
    assert.ok(seen.some((u) => u.includes('tags=Broken+Lane')))
  } finally { restore() }
})

test('watchlist: cap raised to 40, raw handles (underscore/dot/hyphen) used for lookups, matching stays canonical', async () => {
  const seen: string[] = []
  const restore = mockProvider(seen)
  try {
    const names = ['Top_Dry', 'dot.guy', 'dash-guy', 'gone_user', ...Array.from({ length: 40 }, (_, index) => `extra_${index}`)]
    const { res, body } = await feed(`watchlist=${names.join(',')}`)
    assert.equal(res.status, 200)
    assert.equal(body.watchlist.requested.length, 40)
    const userPaths = seen.filter((u) => u.includes('/users/')).map((u) => new URL(u).pathname)
    assert.ok(userPaths.includes('/v2/users/top_dry/search'))
    assert.ok(userPaths.includes('/v2/users/dot.guy/search'))
    assert.ok(userPaths.includes('/v2/users/dash-guy/search'))
    assert.equal(userPaths.length, 40)
    const watched = body.performers.filter((p) => p.isWatched).map((p) => p.username)
    assert.ok(watched.includes('top_dry'))
    assert.ok(watched.includes('dot.guy'))
    assert.ok(!watched.includes('someone_else'))
  } finally { restore() }
})

test('feed no longer hides creators because a description mentions a marker word', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.includes('redgifs.com')) return new Response('offline', { status: 503 })
    if (url.includes('/auth/temporary')) return Response.json({ token: 't' })
    return Response.json({ gifs: [
      gif('d1', 'described_guy', { description: 'straight guy with his girlfriend’s roommate' }),
      gif('d2', 'tagged_out', { tags: ['Gay', 'lesbian'] }),
    ] })
  }) as typeof fetch
  try {
    const { body } = await feed('lane=0')
    const names = body.performers.map((p) => p.username)
    assert.ok(names.includes('described_guy'))
    assert.ok(!names.includes('tagged_out'))
  } finally { globalThis.fetch = original }
})

test('rotateLanes is deterministic, excludes the primary lane and varies by seed', () => {
  const a = lanes.rotateLanes(0, 4)
  assert.deepEqual(a, lanes.rotateLanes(0, 4))
  assert.equal(a.length, 4)
  assert.ok(a.every((lane: { tag: string }) => lane.tag !== 'Gay'))
  assert.notDeepEqual(a, lanes.rotateLanes(1, 4))
})

test('runBounded respects concurrency and deadline', async () => {
  let active = 0
  let peak = 0
  const tasks = Array.from({ length: 20 }, () => async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    return 1
  })
  const ok = await lanes.runBounded(tasks, 8, Date.now() + 5_000)
  assert.equal(ok.filter((r: PromiseSettledResult<number>) => r.status === 'fulfilled').length, 20)
  assert.ok(peak <= 8)
  const late = await lanes.runBounded(tasks, 8, Date.now() - 1)
  assert.ok(late.every((r: PromiseSettledResult<number>) => r.status === 'rejected'))
})
