import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const search = await import('../api/_lib/sources/creator-search.ts')
const { mapPeerTubeActor, searchPeerTubeCreators } = await import('../api/_lib/sources/peertube-creators.ts')
const { searchActivityPubCreators, parseFederatedHandle, mapMastodonAccount } = await import('../api/_lib/sources/activitypub-creators.ts')
const { parseCreatorProfileUrl, searchCreatorWebLeads } = await import('../api/_lib/creator-web-leads.ts')
const { getSource } = await import('../api/_lib/sources/registry.ts')

type Route = (url: URL) => Response | Promise<Response> | undefined
function mockFetch(route: Route, seen: string[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    seen.push(url.toString())
    const res = await route(url)
    if (res) return res
    // hang until aborted for unmatched hosts
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}
const notFound = () => new Response('nope', { status: 404 })

const channel = (name: string, host: string, extra: Record<string, unknown> = {}) => ({
  name, host, displayName: `${name} display`, followersCount: 42, videosCount: 7,
  url: `https://${host}/video-channels/${name}`, avatars: [{ path: '/lazy-static/avatars/a-small.png' }, { path: '/lazy-static/avatars/a.png' }], ...extra,
})

test('PeerTube channel search maps handle, counts, avatar and asks nsfw=both', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => {
    if (url.pathname === '/api/v1/search/video-channels') return Response.json({ data: [channel('jakipz', 'peertube.example')] })
    return notFound()
  }, seen)
  try {
    const hits = await searchPeerTubeCreators('jakipz', { instances: ['sepiasearch.org'] })
    assert.equal(hits.length, 1)
    assert.deepEqual([hits[0].handle, hits[0].platform, hits[0].followers, hits[0].mediaCount],
      ['jakipz@peertube.example', 'PeerTube', 42, 7])
    assert.equal(hits[0].profileUrl, 'https://peertube.example/video-channels/jakipz')
    assert.equal(hits[0].avatar, 'https://peertube.example/lazy-static/avatars/a.png')
    assert.match(seen[0], /nsfw=both/)
    assert.match(seen[0], /search=jakipz/)
  } finally { restore() }
})

test('PeerTube instance list rejects private hosts and soft-fails on errors', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => (url.hostname === 'ok.example' ? Response.json({ data: [channel('a', 'ok.example')] }) : notFound()), seen)
  try {
    const hits = await searchPeerTubeCreators('a', { instances: ['127.0.0.1', 'localhost', 'bad.example', 'ok.example'] })
    assert.equal(hits.length, 1)
    assert.ok(!seen.some((u) => u.includes('127.0.0.1') || u.includes('localhost')))
  } finally { restore() }
  assert.equal(mapPeerTubeActor({ name: 'bad name!' }, 'x.example', 'channel'), null)
})

test('PeerTube exact account lookup for name@host queries', async () => {
  const restore = mockFetch((url) => {
    if (url.pathname === '/api/v1/accounts/mike%40tube.example') return Response.json(channel('mike', 'tube.example'))
    return Response.json({ data: [] })
  })
  try {
    const hits = await searchPeerTubeCreators('mike@tube.example', { instances: ['tube.example'] })
    assert.equal(hits[0]?.handle, 'mike@tube.example')
  } finally { restore() }
})

test('ActivityPub: WebFinger for @user@host and account search; locked accounts dropped', async () => {
  const restore = mockFetch((url) => {
    if (url.pathname === '/.well-known/webfinger') {
      assert.equal(url.searchParams.get('resource'), 'acct:yerger@social.example')
      return Response.json({ links: [{ rel: 'http://webfinger.net/rel/profile-page', href: 'https://social.example/@yerger' }] })
    }
    if (url.pathname === '/api/v1/accounts/lookup') {
      return Response.json({ acct: 'yerger', username: 'yerger', display_name: 'Michael Yerger', url: 'https://social.example/@yerger', followers_count: 900, statuses_count: 12, locked: false, avatar: 'https://social.example/a.png' })
    }
    if (url.pathname === '/api/v2/search') {
      return Response.json({ accounts: [
        { acct: 'yerger2', username: 'yerger2', display_name: 'Y2', url: 'https://open.example/@yerger2', followers_count: 1 },
        { acct: 'priv', username: 'priv', display_name: 'Private', url: 'https://open.example/@priv', locked: true },
      ] })
    }
    return notFound()
  })
  try {
    const hits = await searchActivityPubCreators('@yerger@social.example', { instances: ['open.example'] })
    const handles = hits.map((h) => h.handle)
    assert.ok(handles.includes('yerger@social.example'))
    assert.ok(handles.includes('yerger2@open.example'))
    assert.ok(!handles.includes('priv@open.example'))
    assert.equal(hits.find((h) => h.handle === 'yerger@social.example')?.followers, 900)
    assert.equal(hits[0].matchedBy, 'exact')
  } finally { restore() }
})

test('ActivityPub: auth-required instances fail soft', async () => {
  const restore = mockFetch(() => new Response('auth', { status: 401 }))
  try {
    assert.deepEqual(await searchActivityPubCreators('someone', { instances: ['open.example'] }), [])
  } finally { restore() }
  assert.equal(parseFederatedHandle('a@b.co')?.user, 'a')
  assert.equal(parseFederatedHandle('nothandle'), null)
  assert.equal(mapMastodonAccount({ url: 'https://x.example/@a', username: 'a', discoverable: false }, 'x.example'), null)
})

test('URL parsers: platform + handle', () => {
  const p = (u: string) => parseCreatorProfileUrl(u)
  assert.deepEqual(p('https://www.redgifs.com/users/HoguesDirtyLaundry'), { platform: 'Redgifs', handle: 'hoguesdirtylaundry', profileUrl: 'https://www.redgifs.com/users/hoguesdirtylaundry', linkOnly: false })
  assert.equal(p('https://redgifs.com/watch/abc'), null)
  assert.deepEqual([p('https://x.com/jakipz')?.platform, p('https://x.com/jakipz')?.handle], ['X', 'jakipz'])
  assert.equal(p('https://twitter.com/jakipz/status/123')?.handle, 'jakipz')
  assert.equal(p('https://x.com/home'), null)
  assert.equal(p('https://x.com/search?q=a'), null)
  assert.deepEqual([p('https://cool-blog.tumblr.com/post/1')?.platform, p('https://cool-blog.tumblr.com/post/1')?.handle], ['Tumblr', 'cool-blog'])
  assert.equal(p('https://www.tumblr.com/blog/someone')?.handle, 'someone')
  assert.equal(p('https://www.tumblr.com/'), null)
  assert.deepEqual([p('https://www.reddit.com/user/some_guy')?.platform, p('https://old.reddit.com/u/some_guy/')?.handle], ['Reddit', 'some_guy'])
  assert.equal(p('https://reddit.com/r/gay'), null)
  const of = p('https://onlyfans.com/someone')
  assert.deepEqual([of?.platform, of?.handle, of?.linkOnly], ['OnlyFans', 'someone', true])
  assert.equal(p('https://fansly.com/abc/posts')?.linkOnly, true)
  assert.equal(p('https://onlyfans.com/my'), null)
  assert.equal(p('https://example.com/x'), null)
  assert.equal(p('javascript:alert(1)'), null)
})

test('web leads: DuckDuckGo results become link-only/attributed hits', async () => {
  const html = `<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://onlyfans.com/somebody')}&amp;rut=1">Somebody OF</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://x.com/somebody')}">Somebody on X</a>
    <a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://news.example/article')}">News</a>`
  const restore = mockFetch((url) => (url.hostname === 'html.duckduckgo.com' ? new Response(html) : undefined))
  try {
    const hits = await searchCreatorWebLeads('somebody')
    assert.deepEqual(hits.map((h) => h.platform), ['OnlyFans', 'X'])
    assert.equal(hits[0].sourceAttribution, 'DuckDuckGo lead (link only)')
    assert.equal(hits[1].sourceAttribution, 'DuckDuckGo lead')
    assert.ok(hits.every((h) => h.matchedBy === 'search'))
  } finally { restore() }
})

test('sanitize: rejects emails and phone-like strings, keeps @handles', () => {
  const s = search.sanitizeCreatorQuery
  assert.equal(s('person@example.com'), null)
  assert.equal(s('+1 (555) 123-4567'), null)
  assert.equal(s('555-123-4567'), null)
  assert.equal(s('a'), null)
  assert.equal(s('@user@mastodon.social'), '@user@mastodon.social')
  assert.equal(s('Christian Hogue'), 'Christian Hogue')
})

test('email query makes no network calls and returns []', async () => {
  const seen: string[] = []
  const restore = mockFetch(() => notFound(), seen)
  try {
    assert.deepEqual(await search.searchSourceCreators('someone@gmail.com'), [])
    assert.equal(seen.length, 0)
  } finally { restore() }
})

test('confidence ordering: exact handle > name contains > fuzzy; dedupe; limit', async () => {
  search.clearCreatorSearchCache()
  const restore = mockFetch((url) => {
    if (url.pathname === '/api/v1/search/video-channels') {
      return Response.json({ data: [
        channel('jakipz', 'a.example', { displayName: 'Jakipz' }),
        channel('jakipz', 'a.example', { displayName: 'Jakipz' }), // duplicate
        channel('the_jakipz_fan_club', 'b.example', { displayName: 'Fan club' }),
        channel('jakiprz', 'c.example', { displayName: 'Jakiprz' }),
        channel('unrelated', 'd.example', { displayName: 'Nothing' }),
      ] })
    }
    if (url.hostname === 'html.duckduckgo.com') {
      return new Response(`<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent('https://onlyfans.com/jakipz')}">x</a>`)
    }
    return notFound()
  })
  try {
    const hits = await search.searchSourceCreators('Jakipz', { limit: 10 })
    assert.equal(hits[0].handle, 'jakipz@a.example')
    assert.equal(hits[0].matchedBy, 'exact')
    assert.equal(hits.filter((h) => h.handle === 'jakipz@a.example').length, 1)
    const order = hits.map((h) => h.handle)
    assert.ok(order.indexOf('the_jakipz_fan_club@b.example') < order.indexOf('jakiprz@c.example'))
    assert.ok(!order.includes('unrelated@d.example'))
    const link = hits.find((h) => h.platform === 'OnlyFans')
    assert.ok(link && link.confidence < hits[0].confidence)
    for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i - 1].confidence >= hits[i].confidence)
    search.clearCreatorSearchCache()
    assert.equal((await search.searchSourceCreators('Jakipz', { limit: 2 })).length, 2)
  } finally { restore() }
})

test('soft-fail: every source down returns []; caller abort returns quickly', async () => {
  search.clearCreatorSearchCache()
  let restore = mockFetch(() => { throw new Error('network down') })
  try {
    assert.deepEqual(await search.searchSourceCreators('anyone here'), [])
  } finally { restore() }
  restore = mockFetch(() => undefined) // hangs until aborted
  try {
    const ac = new AbortController()
    const started = Date.now()
    const pending = search.searchSourceCreators('slow one', { signal: ac.signal })
    setTimeout(() => ac.abort(), 30)
    assert.deepEqual(await pending, [])
    assert.ok(Date.now() - started < 1500)
  } finally { restore() }
})

test('overall budget cuts slow sources but keeps fast results', async () => {
  search.clearCreatorSearchCache()
  const restore = mockFetch((url) => {
    if (url.hostname === 'sepiasearch.org') return Response.json({ data: [channel('fastguy', 'f.example', { displayName: 'Fast Guy' })] })
    return undefined // everything else hangs
  })
  try {
    const started = Date.now()
    const hits = await search.runCreatorSearch('fastguy', {}, 150)
    assert.ok(Date.now() - started < 1500)
    assert.equal(hits[0]?.handle, 'fastguy@f.example')
  } finally { restore() }
})

test('LRU: cached (no refetch), TTL expiry, max 200 entries', async () => {
  search.clearCreatorSearchCache()
  const seen: string[] = []
  const restore = mockFetch((url) => (url.pathname === '/api/v1/search/video-channels'
    ? Response.json({ data: [channel('cachedguy', 'c.example')] }) : notFound()), seen)
  const realNow = Date.now
  try {
    await search.searchSourceCreators('cachedguy')
    const first = seen.length
    assert.ok(first > 0)
    await search.searchSourceCreators('  CachedGuy ')
    assert.equal(seen.length, first)
    Date.now = () => realNow() + 11 * 60 * 1000
    await search.searchSourceCreators('cachedguy')
    assert.ok(seen.length > first)
    Date.now = realNow
    search.clearCreatorSearchCache()
    for (let i = 0; i < 210; i += 1) {
      const name = `cachedguy${i}x`
      // each query hits a distinct name so the mock returns a matching channel
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const u = new URL(String(input))
        return u.pathname === '/api/v1/search/video-channels' ? Response.json({ data: [channel(name, 'c.example')] }) : notFound()
      }) as typeof fetch
      await search.runCreatorSearch(name, {}, 500)
    }
    assert.ok(search.creatorSearchCacheSize() <= 200)
  } finally { Date.now = realNow; restore() }
})

test('registry documents the new sources', () => {
  for (const id of ['peertube-creators', 'activitypub', 'creator-web-leads']) assert.ok(getSource(id), id)
  assert.ok(getSource('creator-web-leads')?.capabilities.includes('linkOnly'))
})
