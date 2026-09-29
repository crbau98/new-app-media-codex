import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const { default: handler } = await import('../api/creator-directory.ts')
const lanes = await import('../api/_lib/discovery-lanes.ts')

const gif = (id: string, userName: string, over: Record<string, unknown> = {}) => ({
  id, userName, description: `clip ${id}`, tags: ['Gay'], duration: 10, width: 1080, height: 1920,
  likes: 5, views: 100, createDate: 1_790_000_000,
  urls: { hd: `https://media.redgifs.com/${id}.mp4`, sd: `https://media.redgifs.com/${id}-m.mp4`, poster: `https://media.redgifs.com/${id}-p.jpg`, thumbnail: `https://media.redgifs.com/${id}-t.jpg` },
  ...over,
})

type Responder = (params: URLSearchParams, url: string) => Response | unknown[]

function mockProvider(responder: Responder, seen: string[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    if (url.includes('/auth/temporary')) return Response.json({ token: 't' })
    const out = responder(new URL(url).searchParams, url)
    return out instanceof Response ? out : Response.json({ gifs: out })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

const call = async (query = '') => {
  const res = await handler(new Request(`https://x.test/api/creator-directory${query}`))
  return { res, body: await res.json() as { creators: Array<{ id: string; name: string; avatar: string; profileUrl: string; mediaCount: number; viewCount: number; likeCount: number; platform: string; discoveryTags: string[]; media: unknown[]; lastSeenAt: string | null }>; nextCursor: string | null; total: number | null; lanes: Array<{ tag: string; pagesScanned: number }>; error?: string } }
}

test('lane plan is deterministic, page-major and bounded', () => {
  const a = lanes.planUnits()
  const b = lanes.planUnits()
  assert.deepEqual(a, b)
  assert.equal(a[0].page, 1)
  // Every lane appears on page 1 before any lane reaches page 2.
  const firstPage2 = a.findIndex((unit: { page: number }) => unit.page === 2)
  const tagsBefore = new Set(a.slice(0, firstPage2).map((unit: { tag: string }) => unit.tag))
  assert.equal(tagsBefore.size, lanes.DISCOVERY_LANES.length)
  assert.ok(lanes.DISCOVERY_LANES.some((lane: { tag: string }) => lane.tag === 'Gay'))
  assert.equal(lanes.planUnits([lanes.laneForTag('twink')!]).every((unit: { tag: string }) => unit.tag === 'Twink'), true)
  assert.equal(lanes.laneForTag('x'), null)
  assert.equal(lanes.laneForTag('Totally Unknown Niche')!.tier, 'best-effort')
})

test('cursor round-trips and rejects malformed input', () => {
  const cursor = { i: 16, n: 2, s: [lanes.creatorHash('abc'), lanes.creatorHash('def')], t: 'Twink' }
  const encoded = lanes.encodeCursor(cursor)
  assert.match(encoded, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(lanes.decodeCursor(encoded), cursor)
  assert.equal(lanes.decodeCursor('not base64!'), null)
  assert.equal(lanes.decodeCursor('e30'), null)
  assert.equal(lanes.decodeCursor(btoa('{"v":1,"i":-1,"n":0,"s":[],"t":""}').replace(/=+$/, '')), null)
})

test('directory aggregates by userName, sums stats, builds Creator shape and dedupes', async () => {
  const restore = mockProvider(() => [
    gif('a1', 'Top_Dry', { views: 1000, likes: 50 }),
    gif('a2', 'top_dry', { views: 200, likes: 5, createDate: 1_790_500_000 }),
    gif('b1', 'other.guy', { views: 10 }),
    gif('bad', 'noposter', { urls: { hd: 'https://evil.example/x.mp4' } }),
    gif('fem', 'femtag', { tags: ['Gay', 'girl'] }),
    gif('nameless', ''),
  ])
  try {
    const { res, body } = await call('?limit=48&tag=Twink')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'public, s-maxage=600, stale-while-revalidate=3600')
    assert.equal(body.total, null)
    const names = body.creators.map((c) => c.name).sort()
    assert.deepEqual(names, ['Top_Dry', 'other.guy'])
    const top = body.creators.find((c) => c.name === 'Top_Dry')!
    assert.equal(top.id, 'creator-topdry')
    assert.equal(top.mediaCount, 2)
    assert.equal(top.viewCount, 1200)
    assert.equal(top.likeCount, 55)
    assert.equal(top.platform, 'Redgifs')
    assert.ok(top.avatar.includes('-t.jpg'))
    assert.ok(top.profileUrl.startsWith('https://www.redgifs.com/users/'))
    assert.ok(top.discoveryTags.includes('Gay') && top.discoveryTags.includes('Twink'))
    assert.ok(top.media.length <= 6)
    assert.ok(top.lastSeenAt)
    assert.equal('key' in top, false)
  } finally { restore() }
})

test('sorting: newest and popular', async () => {
  const data = [
    gif('o', 'old_pop', { views: 9000, createDate: 1_700_000_000 }),
    gif('n', 'new_low', { views: 5, createDate: 1_795_000_000 }),
  ]
  const restore = mockProvider(() => data)
  try {
    assert.deepEqual((await call('?tag=Bear&sort=newest')).body.creators.map((c) => c.name), ['new_low', 'old_pop'])
    assert.deepEqual((await call('?tag=Bear&sort=popular')).body.creators.map((c) => c.name), ['old_pop', 'new_low'])
  } finally { restore() }
})

test('soft-fails per request when some lanes 4xx/5xx and tolerates unknown tags', async () => {
  const restore = mockProvider((params) => {
    if (params.get('order') === 'trending') return new Response('nope', { status: 500 })
    if (params.get('order') === 'top28') return new Response('nope', { status: 404 })
    return [gif(`g-${params.get('order')}`, 'survivor')]
  })
  try {
    const { res, body } = await call('?tag=Completely%20Unknown%20Tag')
    assert.equal(res.status, 200)
    assert.deepEqual(body.creators.map((c) => c.name), ['survivor'])
    assert.ok(body.lanes.every((lane) => lane.tag === 'Completely Unknown Tag' && lane.pagesScanned >= 1))
  } finally { restore() }
  const restoreAll = mockProvider(() => new Response('down', { status: 503 }))
  try {
    const { res, body } = await call('?tag=Twink')
    assert.equal(res.status, 502)
    assert.equal(body.error, 'directory_unavailable')
    assert.equal(res.headers.get('cache-control'), 'no-store')
  } finally { restoreAll() }
})

test('pagination dedupes across pages and terminates', async () => {
  // 30 creators per page-1 unit (same set for every order) + one new creator per page.
  const restore = mockProvider((params) => {
    const page = Number(params.get('page'))
    const base = Array.from({ length: 30 }, (_, index) => gif(`p${page}-${index}`, `creator_${page}_${index}`))
    return [...base, gif('shared', 'shared_creator')]
  })
  try {
    const collected: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const { res, body } = await call(`?tag=Twink&limit=20${cursor ? `&cursor=${cursor}` : ''}`)
      assert.equal(res.status, 200)
      assert.ok(body.creators.length <= 20)
      collected.push(...body.creators.map((c) => c.id))
      cursor = body.nextCursor
      pages += 1
      assert.ok(pages <= lanes.MAX_DIRECTORY_PAGES, 'must terminate')
    } while (cursor)
    assert.equal(new Set(collected).size, collected.length, 'no creator is served twice')
    assert.ok(collected.includes('creator-sharedcreator'))
    assert.equal(collected.filter((id) => id === 'creator-sharedcreator').length, 1)
    assert.ok(collected.length >= 60)
  } finally { restore() }
})

test('validates params, methods and cursor binding; never throws', async () => {
  assert.equal((await call('?sort=bogus')).res.status, 400)
  assert.equal((await call('?limit=abc')).res.status, 400)
  assert.equal((await call('?cursor=%25%25')).res.status, 400)
  assert.equal((await call('?tag=%21')).res.status, 400)
  const bound = lanes.encodeCursor({ i: 0, n: 0, s: [], t: 'Bear' })
  assert.equal((await call(`?tag=Twink&cursor=${bound}`)).res.status, 400)
  assert.equal((await handler(new Request('https://x.test/api/creator-directory', { method: 'POST' }))).status, 405)
  assert.equal((await handler(new Request('https://x.test/api/creator-directory', { method: 'OPTIONS' }))).status, 204)
})

test('eligibility ignores free-text descriptions but honours structured tags', () => {
  const base = { id: 'x', userName: 'guy', tags: ['Gay'] }
  assert.equal(lanes.isEligibleCreatorItem({ ...base, description: 'straight guy gets a massage from his girlfriend’s brother' }), true)
  assert.equal(lanes.isEligibleCreatorItem({ ...base, description: 'my wife took this, girl talk' }), true)
  assert.equal(lanes.isEligibleCreatorItem({ ...base, tags: ['Gay', 'Straight'] }), false)
  assert.equal(lanes.isEligibleCreatorItem({ ...base, niches: [{ name: 'lesbian' }] }), false)
  assert.equal(lanes.isEligibleCreatorItem({ ...base, userName: 'girl' }), false)
  assert.equal(lanes.isEligibleCreatorItem({ ...base, userName: 'girlish_boy' }), true)
})
