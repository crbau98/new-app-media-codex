import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const client = await import('../api/_lib/index-client.ts')
const { default: directory } = await import('../api/creator-directory.ts')
const { default: gateway } = await import('../api/render-gateway.ts')
const lanes = await import('../api/_lib/discovery-lanes.ts')

const INDEX_PATH = '/api/v1/creators/index'
const proxied = (url: string) => `/api/archiver-proxy?url=${encodeURIComponent(url)}`

const indexMedia = (id: string, over: Record<string, unknown> = {}) => ({
  id: `rg-${id}`, title: `clip ${id}`, thumbnail: `https://thumbs44.redgifs.com/${id}-t.jpg`, source: 'Redgifs', duration: '0:12',
  isVideo: true, category: 'gay', creator: 'x', tags: ['gay'], rating: 0, createdAt: '2026-01-01T00:00:00Z', views: 10,
  mediaUrl: `https://media.redgifs.com/${id}.mp4`, streamCandidates: [`https://media.redgifs.com/${id}.mp4`],
  pageUrl: `https://www.redgifs.com/watch/${id}`, likes: 1, width: 100, height: 200, aspect: 0.5, posterUrl: `https://media.redgifs.com/${id}-p.jpg`,
  ...over,
})

const indexCreator = (username: string, over: Record<string, unknown> = {}) => ({
  id: `creator-${username}`, name: username, username, avatar: `https://thumbs44.redgifs.com/${username}-a.jpg`, followers: null,
  platform: 'Redgifs', platforms: ['Redgifs'], profileUrl: `https://www.redgifs.com/users/${username}`,
  profileLinks: [{ label: 'redgifs.com', url: `https://www.redgifs.com/users/${username}` }],
  mediaCount: 50, evidenceCount: 50, viewCount: 5000, likeCount: 100, curationScore: 70, lastSeenAt: '2026-02-01T00:00:00Z',
  observedAt: '2026-03-01T00:00:00Z', discoveryTags: ['gay'], sourceAttribution: 'Public source metadata: Redgifs (creator index)',
  media: [indexMedia(`${username}1`)], ...over,
})

const gif = (id: string, userName: string, over: Record<string, unknown> = {}) => ({
  id, userName, description: `clip ${id}`, tags: ['Gay'], duration: 10, width: 1080, height: 1920, likes: 5, views: 100, createDate: 1_790_000_000,
  urls: { hd: `https://media.redgifs.com/${id}.mp4`, sd: `https://media.redgifs.com/${id}-m.mp4`, poster: `https://media.redgifs.com/${id}-p.jpg`, thumbnail: `https://media.redgifs.com/${id}-t.jpg` },
  ...over,
})

type Handlers = {
  index?: (url: URL) => Response | Promise<Response> | unknown
  gifs?: (params: URLSearchParams) => unknown[] | Response
}
function mockNetwork(handlers: Handlers, seen: string[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    seen.push(url.toString())
    if (url.pathname === INDEX_PATH || url.pathname === `${INDEX_PATH}/stats`) {
      if (!handlers.index) return new Response('down', { status: 503 })
      const out = await handlers.index(url)
      if (out instanceof Response) return out
      if (out === 'hang') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      return Response.json(out)
    }
    if (url.pathname.endsWith('/auth/temporary')) return Response.json({ token: 't' })
    const out = handlers.gifs ? handlers.gifs(url.searchParams) : []
    return out instanceof Response ? out : Response.json({ gifs: out })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

const page = (creators: unknown[], over: Record<string, unknown> = {}) => ({
  creators, nextCursor: null, total: creators.length, sources: [{ platform: 'Redgifs', count: creators.length }], updatedAt: '2026-03-01T00:00:00Z', ...over,
})

/* ── index-client ── */

test('fetchIndexPage builds the request, validates and proxies provider media', async () => {
  const seen: string[] = []
  const restore = mockNetwork({ index: () => page([indexCreator('alpha')], { nextCursor: 'abc' }) }, seen)
  try {
    const result = await client.fetchIndexPage({ cursor: 'cur', limit: 500, tag: 'Twink', q: 'al', sort: 'popular' })
    assert.ok(result)
    const url = new URL(seen[0])
    assert.equal(url.origin + url.pathname, `https://codex-research-radar.onrender.com${INDEX_PATH}`)
    assert.equal(url.searchParams.get('cursor'), 'cur')
    assert.equal(url.searchParams.get('limit'), '96')
    assert.equal(url.searchParams.get('tag'), 'Twink')
    assert.equal(url.searchParams.get('q'), 'al')
    assert.equal(url.searchParams.get('sort'), 'popular')
    assert.equal(result.nextCursor, 'abc')
    assert.equal(result.total, 1)
    const creator = result.creators[0]
    assert.equal(creator.avatar, proxied('https://thumbs44.redgifs.com/alpha-a.jpg'))
    const media = creator.media[0]
    assert.equal(media.thumbnail, proxied('https://thumbs44.redgifs.com/alpha1-t.jpg'))
    assert.equal(media.mediaUrl, proxied('https://media.redgifs.com/alpha1.mp4'))
    assert.deepEqual(media.streamCandidates, [proxied('https://media.redgifs.com/alpha1.mp4'), 'https://media.redgifs.com/alpha1.mp4'])
    assert.equal(media.posterUrl, proxied('https://media.redgifs.com/alpha1-p.jpg'))
    assert.equal(media.aspect, 0.5)
  } finally { restore() }
})

test('fetchIndexPage returns null on every failure mode', async () => {
  const cases: Array<() => Handlers['index']> = [
    () => undefined,                                     // 503
    () => () => new Response('nope', { status: 404 }),
    () => () => new Response('<html>', { status: 200 }),
    () => () => ({ creators: 'nope' }),
    () => () => ({ nothing: true }),
    () => () => ({ creators: [], nextCursor: 5 }),
    () => () => { throw new Error('boom') },
  ]
  for (const make of cases) {
    const restore = mockNetwork({ index: make() })
    try { assert.equal(await client.fetchIndexPage({}), null) } finally { restore() }
  }
  const restore = mockNetwork({ index: () => 'hang' })
  const started = Date.now()
  try { assert.equal(await client.fetchIndexPage({}, 60), null) } finally { restore() }
  assert.ok(Date.now() - started < 1_000, 'times out')
  const original = globalThis.fetch
  globalThis.fetch = (async () => { throw new TypeError('network') }) as typeof fetch
  try { assert.equal(await client.fetchIndexPage({}), null) } finally { globalThis.fetch = original }
})

test('normalisation drops unusable creators, foreign hosts and unsafe URLs', async () => {
  const hostile = indexCreator('hostile', {
    avatar: 'https://evil.example/a.jpg', profileUrl: 'javascript:alert(1)',
    media: [
      indexMedia('bad', { thumbnail: 'https://evil.example/t.jpg', posterUrl: undefined }),
      indexMedia('ok', { streamCandidates: ['https://evil.example/x.mp4', 'https://media.redgifs.com/ok.mp4'] }),
    ],
  })
  const restore = mockNetwork({ index: () => page([hostile, { id: '', name: '' }, 'junk', null, indexCreator('fine')]) })
  try {
    const result = await client.fetchIndexPage({})
    assert.deepEqual(result!.creators.map((c: { username: string }) => c.username), ['hostile', 'fine'])
    const h = result!.creators[0]
    assert.equal(h.avatar, '')
    assert.equal(h.profileUrl, '')
    assert.equal(h.media.length, 1)
    assert.deepEqual(h.media[0].streamCandidates, [proxied('https://media.redgifs.com/ok.mp4'), 'https://media.redgifs.com/ok.mp4'])
  } finally { restore() }
  assert.equal(client.toEdgeMediaUrl('http://media.redgifs.com/x.mp4'), undefined)
  assert.equal(client.toEdgeMediaUrl(proxied('https://evil.example/x')), undefined)
  assert.equal(client.toEdgeMediaUrl(proxied('https://media.redgifs.com/x')), proxied('https://media.redgifs.com/x'))
})

test('origin override must be https without credentials', () => {
  const previous = process.env.RENDER_BACKEND_ORIGIN
  try {
    process.env.RENDER_BACKEND_ORIGIN = 'https://backend.example/ignored/path'
    assert.equal(client.indexBackendOrigin(), 'https://backend.example')
    process.env.RENDER_BACKEND_ORIGIN = 'http://backend.example'
    assert.equal(client.indexBackendOrigin(), 'https://codex-research-radar.onrender.com')
    process.env.RENDER_BACKEND_ORIGIN = 'https://u:p@backend.example'
    assert.equal(client.indexBackendOrigin(), 'https://codex-research-radar.onrender.com')
  } finally {
    if (previous === undefined) delete process.env.RENDER_BACKEND_ORIGIN
    else process.env.RENDER_BACKEND_ORIGIN = previous
  }
})

test('mergeCreators dedupes by lowercase platform+handle and prefers the richer record', () => {
  const live = { platform: 'Redgifs', username: 'Top_Dry', name: 'Top_Dry', avatar: '', media: [1, 2, 3], mediaCount: 3, viewCount: 10, discoveryTags: ['a'] }
  const idx = { platform: 'redgifs', username: 'top_dry', name: 'top_dry', avatar: 'av', media: [1], mediaCount: 90, viewCount: 99, discoveryTags: ['b'], followers: 7 }
  const other = { platform: 'Bluesky', username: 'top_dry', name: 'top_dry', media: [], mediaCount: 0, viewCount: 0 }
  const merged = client.mergeCreators([[live], [idx, other]])
  assert.equal(merged.length, 2)
  const rg = merged.find((c: { platform: string }) => c.platform.toLowerCase() === 'redgifs')!
  assert.equal(rg.media.length, 3)          // more media wins
  assert.equal(rg.avatar, 'av')              // backfilled
  assert.equal(rg.followers, 7)
  assert.deepEqual(rg.discoveryTags, ['a', 'b'])
  assert.equal(client.creatorDedupeKey({ platform: 'Redgifs', username: 'Top_Dry' }), client.creatorDedupeKey({ platform: 'redgifs', username: 'top.dry' }))
})

/* ── directory merge ── */

const callDirectory = async (query = '') => {
  const res = await directory(new Request(`https://x.test/api/creator-directory${query}`))
  return {
    res,
    body: await res.json() as {
      creators: Array<{ id: string; username: string; platform: string; media: Array<{ thumbnail: string }>; avatar: string; mediaCount: number }>
      nextCursor: string | null; total: number | null; sources?: { index: number; live: number }; error?: string
    },
  }
}

test('directory merges index creators with live lanes, dedupes, sets real total and sources', async () => {
  const restore = mockNetwork({
    index: () => page([indexCreator('alpha'), indexCreator('shared', { mediaCount: 400 }), indexCreator('bsky', { id: 'creator-bluesky-bsky', platform: 'Bluesky', platforms: ['Bluesky'], avatar: '', media: [] })], { total: 1234, nextCursor: 'NEXT' }),
    gifs: () => [gif('s1', 'shared'), gif('l1', 'liveonly')],
  })
  try {
    const { res, body } = await callDirectory('?limit=10&tag=Twink')
    assert.equal(res.status, 200)
    assert.equal(body.total, 1234)
    const names = body.creators.map((c) => c.username).sort()
    assert.deepEqual(names, ['alpha', 'bsky', 'liveonly', 'shared'])
    assert.equal(body.creators.filter((c) => c.username === 'shared').length, 1)
    assert.equal(body.creators.find((c) => c.username === 'shared')!.mediaCount, 400) // richer record kept
    assert.deepEqual(body.sources, { index: 3, live: 2 })
    assert.ok(body.creators.every((c) => c.media.every((m) => m.thumbnail.startsWith('/api/archiver-proxy?url='))))
    assert.ok(body.nextCursor, 'index has more pages')
    const decoded = JSON.parse(atob(body.nextCursor!.replace(/-/g, '+').replace(/_/g, '/')))
    assert.equal(decoded.x, 'NEXT')
    assert.ok(lanes.decodeCursor(body.nextCursor!), 'legacy decoder still accepts the extended cursor')
  } finally { restore() }
})

test('cursor chain: index cursor is forwarded, served creators are not repeated, chain terminates', async () => {
  const seen: string[] = []
  const restore = mockNetwork({
    index: (url) => {
      const cursor = url.searchParams.get('cursor')
      if (!cursor) return page([indexCreator('i1'), indexCreator('i2')], { total: 3, nextCursor: 'C2' })
      if (cursor === 'C2') return page([indexCreator('i3'), indexCreator('i1')], { total: 3, nextCursor: null })
      return new Response('bad', { status: 400 })
    },
    gifs: (params) => (params.get('page') === '1' ? [gif('a', 'i1'), gif('b', 'lv1')] : []),
  }, seen)
  try {
    const collected: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const { res, body } = await callDirectory(`?limit=4&tag=Twink${cursor ? `&cursor=${cursor}` : ''}`)
      assert.equal(res.status, 200)
      collected.push(...body.creators.map((c) => c.id))
      cursor = body.nextCursor
      pages += 1
      assert.ok(pages <= lanes.MAX_DIRECTORY_PAGES, 'terminates')
    } while (cursor)
    assert.equal(new Set(collected).size, collected.length, 'no creator served twice')
    assert.deepEqual(['creator-i1', 'creator-i2', 'creator-i3', 'creator-lv1'].filter((id) => !collected.includes(id)), [])
    const cursors = seen.filter((u) => u.includes(INDEX_PATH)).map((u) => new URL(u).searchParams.get('cursor'))
    assert.deepEqual(cursors, [null, 'C2'], 'index is not queried again after it is exhausted')
  } finally { restore() }
})

test('legacy cursors (no index field) keep working', async () => {
  const restore = mockNetwork({ index: () => page([indexCreator('i1')], { nextCursor: null }), gifs: () => [gif('g1', 'livecreator')] })
  try {
    const legacy = lanes.encodeCursor({ i: 0, n: 1, s: [], t: 'Twink' })
    const { res, body } = await callDirectory(`?tag=Twink&cursor=${legacy}`)
    assert.equal(res.status, 200)
    assert.ok(body.creators.some((c) => c.username === 'livecreator'))
  } finally { restore() }
})

test('degrades silently to live-only when the index is down, slow or invalid', async () => {
  for (const index of [undefined, () => 'hang' as unknown, () => ({ garbage: true }), () => new Response('x', { status: 500 })]) {
    const restore = mockNetwork({ index: index as Handlers['index'], gifs: () => [gif('g1', 'onlylive')] })
    const started = Date.now()
    try {
      const { res, body } = await callDirectory('?tag=Twink')
      assert.equal(res.status, 200)
      assert.deepEqual(body.creators.map((c) => c.username), ['onlylive'])
      assert.equal(body.total, null)
      assert.deepEqual(body.sources, { index: 0, live: 1 })
      assert.ok(Date.now() - started < 6_000)
    } finally { restore() }
  }
})

test('index still serves when the live provider is down; 502 only when both fail', async () => {
  const restoreIndexOnly = mockNetwork({ index: () => page([indexCreator('i1')], { total: 9 }), gifs: () => new Response('down', { status: 503 }) })
  try {
    const { res, body } = await callDirectory('?tag=Twink')
    assert.equal(res.status, 200)
    assert.deepEqual(body.creators.map((c) => c.username), ['i1'])
    assert.equal(body.total, 9)
    assert.ok(body.nextCursor, 'live cursor is held so the lanes are retried')
  } finally { restoreIndexOnly() }
  const restoreBoth = mockNetwork({ gifs: () => new Response('down', { status: 503 }) })
  try {
    const { res, body } = await callDirectory('?tag=Twink')
    assert.equal(res.status, 502)
    assert.equal(body.error, 'directory_unavailable')
  } finally { restoreBoth() }
})

test('malformed index cursor field is a 400', async () => {
  const bad = btoa(JSON.stringify({ v: 1, i: 0, n: 0, s: [], t: '', x: 5 })).replace(/=+$/, '')
  assert.equal((await callDirectory(`?cursor=${bad}`)).res.status, 400)
})

/* ── gateway allow-list ── */

test('gateway exposes only GET/HEAD of the index read paths', async () => {
  const original = globalThis.fetch
  const seen: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(`${init?.method} ${String(input)}`)
    return Response.json({ ok: true })
  }) as typeof fetch
  const call = (method: string, path: string, extra = '') => gateway(new Request(`https://x.test/api/render-gateway?path=${encodeURIComponent(path)}${extra}`, { method, body: method === 'POST' ? '{}' : undefined }))
  try {
    for (const method of ['GET', 'HEAD']) {
      assert.equal((await call(method, INDEX_PATH, '&limit=5')).status, 200)
      assert.equal((await call(method, `${INDEX_PATH}/stats`)).status, 200)
    }
    assert.ok(seen[0].includes(`${INDEX_PATH}?limit=5`))
    const before = seen.length
    for (const path of [`${INDEX_PATH}/crawl`, `${INDEX_PATH}/observe`, INDEX_PATH, `${INDEX_PATH}/stats`]) {
      for (const method of ['POST']) assert.equal((await call(method, path)).status, 405, `${method} ${path}`)
    }
    for (const path of [`${INDEX_PATH}/crawl`, `${INDEX_PATH}/observe`, `${INDEX_PATH}/`, `${INDEX_PATH}/stats/x`]) {
      assert.equal((await call('GET', path)).status, 405, `GET ${path}`)
    }
    assert.equal((await call('DELETE', INDEX_PATH)).status, 405)
    assert.equal(seen.length, before, 'blocked requests never reach the backend')
    // existing protections are intact
    assert.equal((await call('GET', '/api/screenshots/proxy-media')).status, 405)
    assert.equal((await call('GET', '/not-api')).status, 400)
    assert.equal((await call('GET', '/api/../secret')).status, 400)
    assert.equal((await call('POST', '/api/v1/ingest/jobs')).status, 200)
  } finally { globalThis.fetch = original }
})
