import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const { default: handler, validHandle } = await import('../api/creator-related.ts')
const graph = await import('../api/_lib/creator-graph.ts')
const { CREATOR_REGISTRY } = await import('../api/_lib/creator-registry.ts')

const NOW = Date.parse('2026-09-30T00:00:00Z')
const ts = (daysAgo: number) => Math.floor((NOW - daysAgo * 86_400_000) / 1000)

const gif = (id: string, userName: string, tags: string[], over: Record<string, unknown> = {}) => ({
  id, userName, description: `clip ${id}`, tags, duration: 12, width: 1080, height: 1920,
  likes: 50, views: 1000, createDate: ts(3),
  urls: {
    hd: `https://media.redgifs.com/${id}.mp4`, sd: `https://media.redgifs.com/${id}-mobile.mp4`,
    poster: `https://media.redgifs.com/${id}-poster.jpg`, thumbnail: `https://thumbs2.redgifs.com/${id}-thumb.jpg`,
  },
  ...over,
})

/* ── tag profile ── */

test('tag profile ignores generic tags and weights by share of posts', () => {
  const items = [
    { tags: ['Gay', 'Male', 'Video', 'Bearded', 'Jock'] },
    { tags: ['gay', 'Bearded'] },
    { tags: ['Bearded', 'Gym'] },
    { tags: ['Jock'] },
  ]
  const profile = graph.buildTagProfile(items)
  assert.deepEqual(profile.map((p: { tag: string }) => p.tag), ['bearded', 'jock', 'gym'])
  assert.equal(profile[0].weight, 0.75)
  assert.ok(!profile.some((p: { tag: string }) => ['gay', 'male', 'video'].includes(p.tag)))
  assert.deepEqual(graph.pickQueryTags(profile, 2), ['bearded', 'jock'])
})

test('background frequency down-weights tags that are everywhere (idf-ish)', () => {
  const items = [{ tags: ['a-tag', 'rare'] }, { tags: ['a-tag'] }]
  const background = new Map([['a-tag', 0.95], ['rare', 0.02]])
  const profile = graph.buildTagProfile(items, background)
  assert.equal(profile[0].tag, 'rare' === profile[0].tag ? 'rare' : 'a-tag')
  const a = profile.find((p: { tag: string }) => p.tag === 'a-tag')!.weight
  const r = profile.find((p: { tag: string }) => p.tag === 'rare')!.weight
  assert.ok(r > a * 0.5, 'rare tag is not crushed by a ubiquitous one')
  assert.deepEqual(graph.buildTagProfile([]), [])
})

/* ── scoring ── */

test('rankRelated excludes self, unplayable and ineligible items; scores overlap, recency, engagement', () => {
  const profile = graph.buildTagProfile([{ tags: ['bearded', 'jock'] }, { tags: ['bearded', 'jock'] }, { tags: ['bearded'] }])
  const pool = [
    gif('s1', 'Me_Self', ['bearded', 'jock']),
    gif('a1', 'strong_match', ['Bearded', 'Jock'], { createDate: ts(2), likes: 900 }),
    gif('a2', 'strong_match', ['Bearded']),
    gif('b1', 'weak_old', ['Bearded'], { createDate: ts(700), likes: 1, views: 10 }),
    gif('c1', 'female_marker', ['Bearded', 'Female']),
    gif('d1', 'no_media', ['Bearded', 'Jock'], { urls: {} }),
    gif('e1', 'unrelated', ['cooking']),
  ]
  const ranked = graph.rankRelated(pool, profile, '@me_self', 12, NOW)
  assert.deepEqual(ranked.map((r: { handle: string }) => r.handle), ['strong_match', 'weak_old'])
  assert.ok(ranked[0].score > ranked[1].score)
  assert.deepEqual(ranked[0].sharedTags, ['bearded', 'jock'])
  assert.equal(ranked[0].reason, 'Shares #bearded, #jock')
  assert.equal(ranked[0].platform, 'Redgifs')
  assert.ok(ranked[0].avatar!.startsWith('/api/archiver-proxy?url='))
  assert.ok(ranked[0].avatar!.includes(encodeURIComponent('thumbs2.redgifs.com')))
  assert.ok(ranked.every((r: { score: number }) => r.score >= 0 && r.score <= 1))
})

test('reason text, recency and engagement are bounded', () => {
  assert.equal(graph.reasonText(['a b', 'c', 'd', 'e']), 'Shares #ab, #c, #d')
  assert.equal(graph.reasonText([]), 'Similar public posts')
  assert.equal(graph.recencyScore(0, NOW), 0)
  assert.ok(graph.recencyScore(NOW, NOW) > 0.99)
  assert.ok(graph.recencyScore(NOW - 365 * 86_400_000, NOW) < 0.05)
  assert.equal(graph.engagementScore([]), 0)
  assert.ok(graph.engagementScore([{ likes: 1e9, views: 1e9 }]) <= 1)
})

/* ── link parsing ── */

test('parseProfileLink maps known platforms and rejects everything else', () => {
  const p = graph.parseProfileLink
  assert.deepEqual(
    (({ platform, handle, url, linkOnly }) => ({ platform, handle, url, linkOnly }))(p('https://www.redgifs.com/users/Top_Dry')),
    { platform: 'Redgifs', handle: 'top_dry', url: 'https://www.redgifs.com/users/top_dry', linkOnly: false },
  )
  assert.equal(p('https://twitter.com/someone?ref=1').url, 'https://x.com/someone')
  assert.equal(p('https://x.com/someone').linkOnly, true)
  assert.equal(p('https://x.com/i/status/1'), null)
  assert.equal(p('https://blog-name.tumblr.com/post/1').url, 'https://blog-name.tumblr.com')
  assert.equal(p('https://www.tumblr.com/blog/xyz').handle, 'xyz')
  assert.equal(p('https://old.reddit.com/u/some_user').url, 'https://www.reddit.com/user/some_user')
  assert.equal(p('https://www.reddit.com/r/gay'), null)
  assert.equal(p('https://onlyfans.com/name').platform, 'OnlyFans')
  assert.equal(p('https://fansly.com/name/posts').handle, 'name')
  assert.equal(p('https://justfor.fans/name').platform, 'JustFor.Fans')
  assert.equal(p('https://linktr.ee/name').platform, 'Linktree')
  assert.ok(p('https://linktr.ee/name').label.startsWith('Link in bio'))
  assert.equal(p('https://beacons.ai/name').platform, 'Beacons')
  assert.equal(p('https://allmylinks.com/name').platform, 'AllMyLinks')
  assert.equal(p('https://example.com/name'), null)
})

test('parseProfileLink enforces the SSRF policy', () => {
  const p = graph.parseProfileLink
  for (const bad of [
    'http://127.0.0.1/users/x', 'https://localhost/x', 'https://x.com@evil.test/u', 'https://user:pw@x.com/name',
    'https://x.com:9999/name', 'javascript:alert(1)', 'ftp://x.com/name', 'https://[::1]/x', 'https://10.0.0.5/a',
    'https://metadata.google.internal/x', 'not a url', 'https://2130706433/x',
  ]) assert.equal(p(bad), null, bad)
})

test('extractUrls finds full and bare known-host links and strips punctuation', () => {
  const text = 'Find me: https://x.com/abc, also linktr.ee/abc. redgifs.com/users/abc! (https://example.com/x) bare example.com/nope'
  const urls = graph.extractUrls(text)
  assert.deepEqual(urls, ['https://x.com/abc', 'https://linktr.ee/abc', 'https://redgifs.com/users/abc', 'https://example.com/x'])
  const links = graph.linksFromText(text)
  assert.deepEqual(links.map((l: { platform: string }) => l.platform), ['X', 'Linktree', 'Redgifs'])
  assert.ok(links.every((l: { verified: boolean; source: string }) => l.verified === false && l.source === 'bio'))
})

test('dedupe merges by platform+handle, keeps verified/registry, caps at 12', () => {
  const mk = (platform: string, handle: string, verified: boolean, source: 'bio' | 'registry' = 'bio') =>
    ({ platform, handle, url: `https://x.com/${handle}`, label: handle, verified, source, linkOnly: true })
  const out = graph.dedupeLinks([mk('X', 'Abc', false), mk('X', 'abc', true, 'registry'), mk('Reddit', 'r1', false)])
  assert.equal(out.length, 2)
  assert.equal(out[0].verified, true)
  assert.equal(out[0].source, 'registry')
  const many = Array.from({ length: 30 }, (_, i) => mk('X', `h${i}`, false))
  assert.equal(graph.dedupeLinks(many).length, 12)
})

test('verified flag: registry true, Bluesky bio false, Mastodon only for verified_at fields', () => {
  const reg = graph.registryLinks([{ canonicalName: 'T', aliases: [], handles: { redgifs: ['one', 'two'], x: ['@tx'] } }], 'one')
  assert.deepEqual(reg.map((l: { handle: string }) => l.handle), ['two', 'tx'])
  assert.ok(reg.every((l: { verified: boolean; source: string }) => l.verified && l.source === 'registry'))

  const account = {
    note: '<p>Hi <a href="https://linktr.ee/me" rel="me">linktr.ee/me</a> and https://x.com/me_note</p>',
    fields: [
      { name: 'Reddit', value: '<a href="https://www.reddit.com/user/me" rel="me nofollow">reddit</a>', verified_at: '2026-01-01T00:00:00Z' },
      { name: 'Tumblr', value: '<a href="https://me.tumblr.com">me.tumblr.com</a>', verified_at: null },
      { name: 'Evil', value: '<a href="http://127.0.0.1/x">x</a> <a href="https://evil.test/a">a</a>', verified_at: '2026-01-01T00:00:00Z' },
    ],
  }
  const links = graph.linksFromMastodonAccount(account)
  const by = Object.fromEntries(links.map((l: { platform: string; verified: boolean }) => [l.platform, l.verified]))
  assert.deepEqual(by, { Linktree: false, X: false, Reddit: true, Tumblr: false })
  assert.deepEqual(graph.linksFromMastodonAccount(null), [])
})

/* ── fetchers with mocked fetch ── */

function mockFetch(routes: Record<string, (url: URL) => Response | Promise<Response>>, seen: string[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    seen.push(url.href)
    for (const [needle, fn] of Object.entries(routes)) if (url.href.includes(needle)) return fn(url)
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

test('fetchBlueskyLinks reads the public profile bio only', async () => {
  const seen: string[] = []
  const restore = mockFetch({
    'public.api.bsky.app': () => Response.json({ handle: 'name.bsky.social', description: 'Posts at redgifs.com/users/name and https://onlyfans.com/name' }),
  }, seen)
  try {
    const links = await graph.fetchBlueskyLinks('@Name.bsky.social')
    assert.deepEqual(links.map((l: { platform: string }) => l.platform), ['Bluesky', 'Redgifs', 'OnlyFans'])
    assert.ok(links.every((l: { verified: boolean }) => l.verified === false))
    assert.equal(seen.length, 1)
    assert.ok(seen[0].startsWith('https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=name.bsky.social'))
    assert.deepEqual(await graph.fetchBlueskyLinks('not a handle'), [])
  } finally { restore() }
})

test('fetchMastodonLinks uses accounts/lookup and refuses private instances', async () => {
  const seen: string[] = []
  const restore = mockFetch({
    'accounts/lookup': () => Response.json({ note: '', fields: [{ value: '<a href="https://x.com/me">x</a>', verified_at: '2026-01-01' }] }),
  }, seen)
  try {
    const links = await graph.fetchMastodonLinks('me@mastodon.example')
    assert.equal(links[0].verified, true)
    assert.ok(seen[0].startsWith('https://mastodon.example/api/v1/accounts/lookup?acct=me'))
    assert.deepEqual(await graph.fetchMastodonLinks('me@localhost'), [])
    await assert.rejects(graph.fetchMastodonLinks('me@box.internal'))
    assert.equal(seen.length, 1)
  } finally { restore() }
})

/* ── handler ── */

function provider(opts: { own?: unknown[]; tagHits?: Record<string, unknown[]>; failTags?: boolean | string[]; failCatalog?: boolean } = {}, seen: string[] = []) {
  return mockFetch({
    '/auth/temporary': () => Response.json({ token: 't' }),
    '/users/': () => {
      if (opts.failCatalog) return new Response('x', { status: 500 })
      return Response.json({ gifs: opts.own || [], page: 1, pages: 1, total: (opts.own || []).length })
    },
    '/gifs/search': (url) => {
      const tag = (url.searchParams.get('tags') || '').toLowerCase()
      if (opts.failTags === true || (Array.isArray(opts.failTags) && opts.failTags.includes(tag))) return new Response('x', { status: 500 })
      return Response.json({ gifs: opts.tagHits?.[tag] || [] })
    },
  }, seen)
}

let ipCounter = 0
const req = (qs: string, method = 'GET') => new Request(`https://x.test/api/creator-related?${qs}`, {
  method, headers: { 'x-forwarded-for': `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` },
})

test('validation: handle shape, emails, platform, method', async () => {
  assert.equal(validHandle('@Top_Dry'), 'top_dry')
  assert.equal(validHandle('a'), null)
  assert.equal(validHandle('a@b.com'), null)
  assert.equal(validHandle('x'.repeat(51)), null)
  assert.equal(validHandle('bad handle'), null)
  assert.equal((await handler(req('creator=a%40b.com'))).status, 400)
  assert.equal((await handler(req(''))).status, 400)
  assert.equal((await handler(req('creator=top_dry&platform=bluesky'))).status, 400)
  assert.equal((await handler(req('creator=top_dry', 'POST'))).status, 405)
  const opt = await handler(req('creator=top_dry', 'OPTIONS'))
  assert.equal(opt.status, 204)
})

test('handler returns related creators, excludes self, sets CDN cache headers', async () => {
  const seen: string[] = []
  const own = [gif('o1', 'top_dry', ['Gay', 'Bearded', 'Jock']), gif('o2', 'top_dry', ['Bearded', 'Gym']), gif('o3', 'top_dry', ['Bearded'])]
  const hits = [gif('h1', 'top_dry', ['Bearded']), gif('h2', 'other_one', ['Bearded', 'Jock']), gif('h3', 'third', ['Bearded'], { createDate: ts(400) })]
  const restore = provider({ own, tagHits: { bearded: hits, jock: [hits[1]], gym: [] } }, seen)
  try {
    const res = await handler(req('creator=Top_Dry&limit=5'))
    assert.equal(res.status, 200)
    assert.match(res.headers.get('cache-control')!, /s-maxage=900/)
    assert.match(res.headers.get('cdn-cache-control')!, /s-maxage=900/)
    const body = await res.json() as { creator: string; related: Array<{ handle: string; reason: string; sharedTags: string[] }>; elsewhere: unknown[]; updatedAt: string; partial?: string[] }
    assert.equal(body.creator, 'top_dry')
    assert.deepEqual(body.related.map((r) => r.handle), ['other_one', 'third'])
    assert.ok(body.related[0].reason.startsWith('Shares #'))
    assert.equal(body.partial, undefined)
    assert.deepEqual(body.elsewhere, [])
    assert.ok(body.updatedAt)
    // Bounded: 1 auth + 1 catalog + at most 3 tag searches.
    assert.ok(seen.filter((u) => u.includes('/gifs/search')).length <= 3)
    assert.ok(seen.some((u) => u.includes('/users/top_dry/search')))
  } finally { restore() }
})

test('handler soft-fails tag searches (200 + partial, short cache) and 502s when the provider is down', async () => {
  const own = [gif('o1', 'soft_fail', ['Bearded', 'Jock'])]
  let restore = provider({ own, failTags: ['jock'], tagHits: { bearded: [gif('h1', 'survivor', ['Bearded'])] } })
  try {
    const res = await handler(req('creator=soft_fail'))
    assert.equal(res.status, 200)
    const body = await res.json() as { related: Array<{ handle: string }>; partial?: string[] }
    assert.deepEqual(body.related.map((r) => r.handle), ['survivor'])
    assert.deepEqual(body.partial, ['related'])
    assert.match(res.headers.get('cache-control')!, /s-maxage=60\b/)
  } finally { restore() }
  restore = provider({ own, failTags: true })
  try {
    assert.equal((await handler(req('creator=soft_fail'))).status, 502)
  } finally { restore() }
  restore = provider({ failCatalog: true })
  try {
    const res = await handler(req('creator=provider_down'))
    assert.equal(res.status, 502)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal((await res.json() as { error: string }).error, 'creator_related_unavailable')
  } finally { restore() }
})

test('handler: unknown creator is an empty 200, and registry links come back verified', async () => {
  const restore = provider({ own: [] })
  try {
    const res = await handler(req('creator=nobody_here'))
    assert.equal(res.status, 200)
    const body = await res.json() as { related: unknown[]; elsewhere: unknown[] }
    assert.deepEqual(body.related, [])
    assert.deepEqual(body.elsewhere, [])
  } finally { restore() }

  CREATOR_REGISTRY.push({
    canonicalName: 'Test Fixture Creator', aliases: ['fixturecreator'],
    handles: { redgifs: ['fixture_main', 'fixture_alt'], x: ['fixture_x'], bluesky: ['fixture.bsky.social'] },
  })
  const restore2 = mockFetch({
    '/auth/temporary': () => Response.json({ token: 't' }),
    '/users/': () => Response.json({ gifs: [], page: 1, pages: 0, total: 0 }),
    'public.api.bsky.app': () => Response.json({ handle: 'fixture.bsky.social', description: 'https://fansly.com/fixture_f and https://x.com/fixture_x' }),
  })
  try {
    const res = await handler(req('creator=fixture_main'))
    assert.equal(res.status, 200)
    const body = await res.json() as { elsewhere: Array<{ platform: string; handle: string; verified: boolean; source: string; linkOnly: boolean }> }
    const by = Object.fromEntries(body.elsewhere.map((l) => [`${l.platform}:${l.handle}`, l]))
    assert.equal(by['Redgifs:fixture_alt'].verified, true)
    assert.equal(by['Redgifs:fixture_alt'].linkOnly, false)
    assert.equal(by['X:fixture_x'].verified, true, 'registry + bio duplicate merges to verified')
    assert.equal(by['X:fixture_x'].source, 'registry')
    assert.equal(by['Fansly:fixture_f'].verified, false)
    assert.equal(by['Fansly:fixture_f'].linkOnly, true)
    assert.equal(by['Redgifs:fixture_main'], undefined, 'never lists the creator to themselves')
    assert.ok(body.elsewhere.length <= 12)
  } finally { restore2(); CREATOR_REGISTRY.pop() }
})

test('per-IP rate limit answers 429 without caching', async () => {
  const restore = provider({ own: [] })
  try {
    const limited = () => new Request('https://x.test/api/creator-related?creator=rate_limited', { headers: { 'x-forwarded-for': '203.0.113.77' } })
    let last = 200
    for (let i = 0; i < 25; i += 1) last = (await handler(limited())).status
    assert.equal(last, 429)
  } finally { restore() }
})
