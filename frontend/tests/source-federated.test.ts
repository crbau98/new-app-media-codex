import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const bsky = await import('../api/_lib/sources/bluesky.ts')
const masto = await import('../api/_lib/sources/mastodon-tags.ts')
const lemmy = await import('../api/_lib/sources/lemmy.ts')
const common = await import('../api/_lib/sources/federated-common.ts')
const search = await import('../api/_lib/sources/creator-search.ts')
const { collectAdditionalSources } = await import('../api/_lib/multi-source.ts')
const { getSource } = await import('../api/_lib/sources/registry.ts')

type Route = (url: URL) => Response | Promise<Response> | undefined
function mockFetch(route: Route, seen: string[] = []) {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    seen.push(url.toString())
    const res = await route(url)
    if (res) return res
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}
const notFound = () => new Response('nope', { status: 404 })

/* ------------------------------- Bluesky -------------------------------- */

const author = (extra: Record<string, unknown> = {}) => ({ did: 'did:plc:abcdefgh12345678', handle: 'jake.bsky.social', displayName: 'Jake', avatar: 'https://cdn.bsky.app/a.jpg', ...extra })
const post = (embed: unknown, extra: Record<string, unknown> = {}) => ({
  uri: 'at://did:plc:abcdefgh12345678/app.bsky.feed.post/3kabc', author: author(),
  record: { text: 'hello mail me a@b.com', createdAt: '2026-01-02T03:04:05Z' }, embed, likeCount: 3, replyCount: 1, ...extra,
})
const imagesEmbed = { $type: 'app.bsky.embed.images#view', images: [
  { thumb: 'https://cdn.bsky.app/t1.jpg', fullsize: 'https://cdn.bsky.app/f1.jpg', alt: 'one', aspectRatio: { width: 400, height: 300 } },
  { thumb: 'https://cdn.bsky.app/t2.jpg', fullsize: 'https://cdn.bsky.app/f2.jpg', alt: 'two' },
] }
const videoEmbed = { $type: 'app.bsky.embed.video#view', playlist: 'https://video.bsky.app/watch/did/cid/playlist.m3u8', thumbnail: 'https://video.bsky.app/watch/did/cid/thumbnail.jpg', alt: 'v', aspectRatio: { width: 1080, height: 1920 } }

test('Bluesky maps image and video embeds with post/profile links, redacting emails', () => {
  const imgs = bsky.mapBlueskyPost(post(imagesEmbed))
  assert.equal(imgs.length, 2)
  assert.equal(imgs[0].isVideo, false)
  assert.equal(imgs[0].mediaUrl, 'https://cdn.bsky.app/f1.jpg')
  assert.equal(imgs[0].pageUrl, 'https://bsky.app/profile/jake.bsky.social/post/3kabc')
  assert.equal(imgs[0].profileUrl, 'https://bsky.app/profile/jake.bsky.social')
  assert.equal(imgs[0].source, 'Bluesky')
  assert.ok(!/a@b\.com/.test(imgs[0].title + (imgs[0].description || '')))
  assert.notEqual(imgs[0].id, imgs[1].id)
  const [vid] = bsky.mapBlueskyPost(post(videoEmbed))
  assert.equal(vid.isVideo, true)
  assert.deepEqual(vid.streamCandidates, ['https://video.bsky.app/watch/did/cid/playlist.m3u8'])
  assert.equal(vid.hlsUrl, vid.streamCandidates[0])
  assert.equal(vid.thumbnail, 'https://video.bsky.app/watch/did/cid/thumbnail.jpg')
  assert.equal(vid.aspect, 0.5625)
  const both = bsky.mapBlueskyPost(post({ $type: 'app.bsky.embed.recordWithMedia#view', media: videoEmbed }))
  assert.equal(both.length, 1)
})

test('Bluesky video without a real HLS URL is not playable and is dropped', () => {
  assert.equal(bsky.mapBlueskyPost(post({ ...videoEmbed, playlist: 'http://video.bsky.app/x.m3u8' })).length, 0)
  assert.equal(bsky.mapBlueskyPost(post({ ...videoEmbed, playlist: 'https://video.bsky.app/x.html' })).length, 0)
  assert.equal(bsky.mapBlueskyPost(post({ $type: 'app.bsky.embed.external#view' })).length, 0)
})

test('Bluesky keeps adult labels but skips unsafe labels and !no-unauthenticated', () => {
  const porn = bsky.mapBlueskyPost(post(imagesEmbed, { labels: [{ val: 'porn' }] }))
  assert.equal(porn.length, 2)
  assert.match(porn[0].curationReasons[0], /adult-labelled/)
  for (const val of ['csam', 'underage', 'non-consensual', 'ncii', '!takedown']) {
    assert.equal(bsky.mapBlueskyPost(post(imagesEmbed, { labels: [{ val }] })).length, 0, val)
  }
  assert.equal(bsky.mapBlueskyPost(post(imagesEmbed, { author: author({ labels: [{ val: '!no-unauthenticated' }] }) })).length, 0)
  const selfLabelled = post(imagesEmbed)
  ;(selfLabelled.record as Record<string, unknown>).labels = { values: [{ val: 'sexual' }] }
  assert.equal(bsky.mapBlueskyPost(selfLabelled).length, 2)
  ;(selfLabelled.record as Record<string, unknown>).labels = { values: [{ val: 'minor' }] }
  assert.equal(bsky.mapBlueskyPost(selfLabelled).length, 0)
  assert.equal(bsky.mapBlueskyActor({ did: 'd', handle: 'x.bsky.social', labels: [{ val: '!no-unauthenticated' }] }), null)
})

test('Bluesky actor search maps counts and uses the public AppView', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => url.pathname.endsWith('app.bsky.actor.searchActors')
    ? Response.json({ actors: [{ did: 'did:plc:1', handle: 'jake.bsky.social', displayName: 'Jake', avatar: 'https://cdn.bsky.app/a.jpg', followersCount: 12, postsCount: 34 }, { handle: 'bad', did: '' }] })
    : notFound(), seen)
  try {
    const hits = await search.runCreatorSearch('jake', { limit: 5 }, 2000)
    const hit = hits.find((h: { platform: string }) => h.platform === 'Bluesky')
    assert.ok(hit)
    assert.deepEqual([hit.handle, hit.profileUrl, hit.followers, hit.mediaCount], ['jake.bsky.social', 'https://bsky.app/profile/jake.bsky.social', 12, 34])
    assert.ok(seen.some((u) => u.startsWith('https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?')))
  } finally { restore(); search.clearCreatorSearchCache() }
})

test('collectBluesky: search 403 soft-fails, watchlist actor feed still maps', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => {
    if (url.pathname.endsWith('searchPosts')) return new Response('auth', { status: 403 })
    if (url.pathname.endsWith('searchActors')) return Response.json({ actors: [{ did: 'did:plc:abcdefgh12345678', handle: 'jake.bsky.social', displayName: 'Jake', followersCount: 5, postsCount: 9 }, { did: 'did:plc:zzzzzzzz', handle: 'other.bsky.social', displayName: 'Other' }] })
    if (url.pathname.endsWith('getAuthorFeed')) return Response.json({ feed: [{ post: post(imagesEmbed) }, { post: post(videoEmbed, { uri: 'at://did:plc:abcdefgh12345678/app.bsky.feed.post/3kvid' }), reason: { $type: 'reasonRepost' } }] })
    return notFound()
  }, seen)
  try {
    const result = await bsky.collectBluesky({ watchlist: ['jake', 'a@b.com'] })
    assert.equal(result.media.length, 2)
    assert.ok(result.media.every((m: { isWatchedCreator: boolean }) => m.isWatchedCreator))
    assert.equal(result.leads.length, 1)
    assert.equal(result.leads[0].exactWatchMatch, true)
    assert.equal(result.status.id, 'bluesky')
    assert.equal(result.status.state, 'limited')
    assert.equal(result.status.mediaFound, 2)
    assert.ok(seen.some((u) => u.includes('filter=posts_with_media')))
    assert.ok(!seen.some((u) => u.includes('a%40b.com')))
  } finally { restore() }
})

test('collectBluesky: all-401 is limited (auth), all-500 is error, never throws', async () => {
  let restore = mockFetch(() => new Response('', { status: 401 }))
  try {
    const r = await bsky.collectBluesky({})
    assert.equal(r.media.length, 0)
    assert.equal(r.status.state, 'limited')
  } finally { restore() }
  restore = mockFetch(() => new Response('', { status: 503 }))
  try {
    const r = await bsky.collectBluesky({})
    assert.equal(r.status.state, 'error')
  } finally { restore() }
})

test('collectBluesky honours the request cap and an abort signal', async () => {
  const seen: string[] = []
  let restore = mockFetch(() => Response.json({ posts: [], actors: [] }), seen)
  try {
    await bsky.collectBluesky({ query: 'gay', watchlist: ['aaa', 'bbb', 'ccc', 'ddd', 'eee'], maxRequests: 2 })
    assert.ok(seen.length <= 2)
  } finally { restore() }
  restore = mockFetch(() => Response.json({}))
  try {
    const controller = new AbortController()
    controller.abort()
    const r = await bsky.collectBluesky({ signal: controller.signal })
    assert.equal(r.attempted, 0)
  } finally { restore() }
})

/* ------------------------------- Mastodon ------------------------------- */

const account = (extra: Record<string, unknown> = {}) => ({ id: '42', username: 'bear', acct: 'bear', display_name: 'Bear <b>Guy</b>', url: 'https://mastodon.social/@bear', avatar: 'https://files.mastodon.social/a.png', followers_count: 10, locked: false, discoverable: true, ...extra })
const status = (extra: Record<string, unknown> = {}) => ({
  id: '100', url: 'https://mastodon.social/@bear/100', visibility: 'public', sensitive: true, created_at: '2026-01-01T00:00:00Z',
  content: '<p>hi call +1 (555) 123-4567</p>', account: account(), tags: [{ name: 'gay' }], favourites_count: 4, replies_count: 1,
  media_attachments: [
    { id: 'a1', type: 'video', url: 'https://files.mastodon.social/v.mp4', preview_url: 'https://files.mastodon.social/v.png', meta: { original: { width: 720, height: 1280, duration: 12.5 } } },
    { id: 'a2', type: 'gifv', url: 'https://files.mastodon.social/g.mp4', preview_url: 'https://files.mastodon.social/g.png' },
    { id: 'a3', type: 'image', url: 'https://files.mastodon.social/i.jpg', preview_url: 'https://files.mastodon.social/i-small.jpg' },
    { id: 'a4', type: 'audio', url: 'https://files.mastodon.social/x.mp3' },
  ], ...extra,
})

test('Mastodon maps video/gifv/image attachments and keeps sensitive posts', () => {
  const { items, account: acc } = masto.mapMastodonStatus(status(), 'mastodon.social')
  assert.equal(items.length, 3)
  assert.deepEqual(items.map((i: { isVideo: boolean }) => i.isVideo), [true, true, false])
  assert.equal(items[0].streamCandidates[0], 'https://files.mastodon.social/v.mp4')
  assert.equal(items[0].durationSeconds, 12)
  assert.equal(items[2].mediaUrl, 'https://files.mastodon.social/i.jpg')
  assert.equal(items[0].pageUrl, 'https://mastodon.social/@bear/100')
  assert.equal(items[0].profileUrl, 'https://mastodon.social/@bear')
  assert.ok(!/555/.test(items[0].title))
  assert.match(items[0].curationReasons[0], /sensitive/)
  assert.equal(acc?.handle, 'bear@mastodon.social')
  assert.equal(acc?.displayName, 'Bear Guy')
})

test('Mastodon skips locked/suspended/non-discoverable accounts, boosts and non-public statuses', () => {
  for (const extra of [{ locked: true }, { suspended: true }, { discoverable: false }]) {
    assert.equal(masto.mapMastodonStatus(status({ account: account(extra) }), 'mastodon.social').items.length, 0)
  }
  assert.equal(masto.mapMastodonStatus(status({ reblog: { id: '9' } }), 'mastodon.social').items.length, 0)
  assert.equal(masto.mapMastodonStatus(status({ visibility: 'private' }), 'mastodon.social').items.length, 0)
  assert.equal(masto.mapMastodonStatus(status({ visibility: 'unlisted' }), 'mastodon.social').items.length, 0)
})

test('Mastodon env parsing: instances are SSRF-filtered and capped, tags validated', () => {
  assert.deepEqual(masto.mastodonInstances({ MASTODON_TAG_INSTANCES: 'https://Foo.example/, 127.0.0.1, localhost, 10.0.0.5, a.example, foo.example, b.example, c.example' }), ['foo.example', 'a.example', 'b.example'])
  assert.deepEqual(masto.mastodonInstances({}), ['mastodon.social', 'mstdn.social'])
  assert.deepEqual(masto.mastodonInstances({ MASTODON_TAG_INSTANCES: '127.0.0.1' }), [])
  assert.deepEqual(masto.mastodonTags({ MASTODON_TAGS: '#Gay, bad-tag!, x, gaymen, gay' }), ['gay', 'gaymen'])
})

test('collectMastodonTags never calls private hosts, caps requests and dedupes', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => url.pathname.startsWith('/api/v1/timelines/tag/') ? Response.json([status(), status()]) : notFound(), seen)
  try {
    const r = await masto.collectMastodonTags({ env: { MASTODON_TAG_INSTANCES: 'localhost,192.168.1.2,ok.example,ok2.example' } })
    assert.ok(seen.length <= 8)
    assert.ok(seen.every((u) => u.startsWith('https://ok.example/') || u.startsWith('https://ok2.example/')))
    assert.ok(seen.every((u) => u.includes('only_media=true') && u.includes('limit=40')))
    assert.equal(r.attempted, seen.length)
    assert.equal(r.media.length, new Set(r.media.map((m: { id: string }) => m.id)).size)
    assert.equal(r.leads.length, 1)
    assert.equal(r.status.id, 'mastodon')
    assert.equal(r.status.state, 'connected')
  } finally { restore() }
})

test('collectMastodonTags soft-fails on 401/5xx/timeouts and reports the state', async () => {
  let restore = mockFetch(() => new Response('', { status: 401 }))
  try {
    const r = await masto.collectMastodonTags({})
    assert.equal(r.media.length, 0)
    assert.equal(r.status.state, 'limited')
  } finally { restore() }
  restore = mockFetch(() => new Response('', { status: 500 }))
  try {
    assert.equal((await masto.collectMastodonTags({})).status.state, 'error')
  } finally { restore() }
  restore = mockFetch(() => undefined) // hangs until aborted
  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 30)
    const r = await masto.collectMastodonTags({ signal: controller.signal })
    assert.equal(r.media.length, 0)
    assert.equal(r.status.state, 'error')
  } finally { restore() }
})

test('collectMastodonTags watchlist: exact acct match yields a watched lead and account statuses', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => {
    if (url.pathname === '/api/v2/search') return Response.json({ accounts: [account({ username: 'other', url: 'https://mastodon.social/@other' }), account()] })
    if (url.pathname === '/api/v1/accounts/42/statuses') return Response.json([status({ id: '200', url: 'https://mastodon.social/@bear/200' })])
    if (url.pathname.startsWith('/api/v1/timelines/tag/')) return Response.json([])
    return notFound()
  }, seen)
  try {
    const r = await masto.collectMastodonTags({ watchlist: ['bear'], env: { MASTODON_TAG_INSTANCES: 'mastodon.social' } })
    const lead = r.leads.find((l: { exactWatchMatch: boolean }) => l.exactWatchMatch)
    assert.equal(lead?.username, 'bear@mastodon.social')
    assert.ok(r.media.length >= 1 && r.media.every((m: { isWatchedCreator: boolean }) => m.isWatchedCreator))
    assert.ok(seen.length <= 8)
  } finally { restore() }
})

/* --------------------------------- Lemmy -------------------------------- */

const lview = (post: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  post: { id: 7, name: 'A post', ap_id: 'https://lemmy.test/post/7', published: '2026-02-03T04:05:06Z', nsfw: true, ...post },
  creator: { id: 1, name: 'gus', display_name: 'Gus', actor_id: 'https://lemmy.test/u/gus', avatar: 'https://lemmy.test/pictrs/a.png' },
  community: { name: 'gaynsfw' }, counts: { score: 9, comments: 2 }, ...extra,
})

test('Lemmy classifies direct media, gifv and known embeds only', () => {
  assert.equal(lemmy.classifyLemmyUrl('https://x.test/a.JPG')?.kind, 'image')
  assert.equal(lemmy.classifyLemmyUrl('https://x.test/a.webm?x=1')?.kind, 'video')
  assert.equal(lemmy.classifyLemmyUrl('https://i.imgur.com/abc.gifv')?.url, 'https://i.imgur.com/abc.mp4')
  assert.equal(lemmy.classifyLemmyUrl('https://www.redgifs.com/watch/foo')?.kind, 'embed')
  assert.equal(lemmy.classifyLemmyUrl('https://blog.example/article'), null)
  assert.equal(lemmy.classifyLemmyUrl('http://x.test/a.mp4'), null)
  assert.equal(lemmy.classifyLemmyUrl('https://127.0.0.1/a.mp4'), null)
})

test('Lemmy maps posts and skips removed/deleted/banned, embeds need a thumbnail', () => {
  const img = lemmy.mapLemmyPost(lview({ url: 'https://lemmy.test/pictrs/image/a.png', body: 'mail me x@y.org' }), 'lemmy.test')
  assert.equal(img.item?.isVideo, false)
  assert.equal(img.item?.mediaUrl, 'https://lemmy.test/pictrs/image/a.png')
  assert.equal(img.item?.pageUrl, 'https://lemmy.test/post/7')
  assert.equal(img.item?.profileUrl, 'https://lemmy.test/u/gus')
  assert.ok(!/x@y\.org/.test(img.item?.description || ''))
  const vid = lemmy.mapLemmyPost(lview({ url: 'https://cdn.test/v.mp4', thumbnail_url: 'https://lemmy.test/pictrs/image/t.jpg' }), 'lemmy.test')
  assert.equal(vid.item?.isVideo, true)
  assert.deepEqual(vid.item?.streamCandidates, ['https://cdn.test/v.mp4'])
  assert.equal(vid.item?.thumbnail, 'https://lemmy.test/pictrs/image/t.jpg')
  assert.equal(lemmy.mapLemmyPost(lview({ url: 'https://www.redgifs.com/watch/foo' }), 'lemmy.test').item, null)
  assert.ok(lemmy.mapLemmyPost(lview({ url: 'https://www.redgifs.com/watch/foo', thumbnail_url: 'https://lemmy.test/t.jpg' }), 'lemmy.test').item)
  assert.equal(lemmy.mapLemmyPost(lview({ url: 'https://x.test/a.png', removed: true }), 'lemmy.test').item, null)
  assert.equal(lemmy.mapLemmyPost(lview({ url: 'https://x.test/a.png', deleted: true }), 'lemmy.test').item, null)
  assert.equal(lemmy.mapLemmyPost(lview({ url: 'https://x.test/a.png' }, { creator: { name: 'gus', banned: true } }), 'lemmy.test').item, null)
})

test('Lemmy env parsing is SSRF-filtered and communities validated', () => {
  assert.deepEqual(lemmy.lemmyInstances({ LEMMY_INSTANCES: '10.1.1.1, lemmy.test, [::1], localhost' }), ['lemmy.test'])
  assert.deepEqual(lemmy.lemmyInstances({}), ['lemmynsfw.com', 'lemmy.world'])
  assert.deepEqual(lemmy.lemmyCommunities({ LEMMY_COMMUNITIES: 'GayBros, bad-name, x@127.0.0.1, ok@lemmy.test' }), ['gaybros', 'ok@lemmy.test'])
})

test('collectLemmy: maps posts, dedupes, caps requests, never hits private hosts', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => url.pathname === '/api/v3/post/list' ? Response.json({ posts: [lview({ url: 'https://x.test/a.png' }), lview({ url: 'https://x.test/a.png' })] }) : notFound(), seen)
  try {
    const r = await lemmy.collectLemmy({ env: { LEMMY_INSTANCES: 'lemmy.test,127.0.0.1', LEMMY_COMMUNITIES: 'a1,b2,c3,d4,e5,f6,g7,h8,i9' } })
    assert.ok(seen.length <= 8)
    assert.ok(seen.every((u) => u.startsWith('https://lemmy.test/api/v3/post/list?') && u.includes('sort=New')))
    assert.equal(r.media.length, 1)
    assert.equal(r.leads.length, 1)
    assert.equal(r.status.id, 'lemmy')
    assert.equal(r.status.state, 'connected')
  } finally { restore() }
})

test('collectLemmy soft-fails on 403/5xx and finds watchlist users', async () => {
  let restore = mockFetch(() => new Response('', { status: 403 }))
  try {
    const r = await lemmy.collectLemmy({})
    assert.equal(r.status.state, 'limited')
    assert.equal(r.media.length, 0)
  } finally { restore() }
  restore = mockFetch(() => new Response('', { status: 502 }))
  try {
    assert.equal((await lemmy.collectLemmy({})).status.state, 'error')
  } finally { restore() }
  const seen: string[] = []
  restore = mockFetch((url) => {
    if (url.pathname === '/api/v3/search') return Response.json({ users: [{ person: { name: 'gus', display_name: 'Gus', actor_id: 'https://lemmy.test/u/gus' } }] })
    if (url.pathname === '/api/v3/user') return Response.json({ posts: [lview({ url: 'https://x.test/v.mp4', thumbnail_url: 'https://x.test/t.jpg' })] })
    return Response.json({ posts: [] })
  }, seen)
  try {
    const r = await lemmy.collectLemmy({ watchlist: ['gus'], env: { LEMMY_INSTANCES: 'lemmy.test', LEMMY_COMMUNITIES: 'one' } })
    assert.equal(r.leads.find((l: { exactWatchMatch: boolean }) => l.exactWatchMatch)?.username, 'gus@lemmy.test')
    assert.equal(r.media.length, 1)
    assert.equal(r.media[0].isWatchedCreator, true)
    assert.ok(seen.some((u) => u.includes('type_=Users')))
  } finally { restore() }
})

/* ------------------------------ common + wiring ------------------------- */

test('redact strips e-mails and phone-like numbers; cleanTerm rejects them', () => {
  assert.equal(common.redact('hi a.b@c.io or +1 555 123 4567 ok'), 'hi or ok')
  assert.equal(common.cleanTerm('me@x.io'), null)
  assert.equal(common.cleanTerm('https://x.test'), null)
  assert.equal(common.cleanTerm('@jake'), 'jake')
})

test('registry documents the three federated sources', () => {
  for (const id of ['bluesky', 'mastodon', 'lemmy']) {
    const entry = getSource(id)
    assert.ok(entry && entry.termsUrl.startsWith('https://') && entry.complianceNote && entry.rateLimit, id)
  }
})

test('collectAdditionalSources merges federated results and keeps existing fields', async () => {
  const seen: string[] = []
  const restore = mockFetch((url) => {
    if (url.hostname === 'public.api.bsky.app' && url.pathname.endsWith('searchPosts')) return Response.json({ posts: [post(imagesEmbed)] })
    if (url.hostname === 'mastodon.social' && url.pathname.startsWith('/api/v1/timelines/tag/')) return Response.json([status()])
    if (url.hostname === 'lemmynsfw.com' && url.pathname === '/api/v3/post/list') return Response.json({ posts: [lview({ url: 'https://x.test/a.png' })] })
    if (url.hostname === 'sepiasearch.org') return Response.json({ data: [] })
    return new Response('', { status: 404 })
  }, seen)
  const saved = { ...process.env }
  delete process.env.MASTODON_TAG_INSTANCES
  delete process.env.LEMMY_INSTANCES
  try {
    const result = await collectAdditionalSources([], { query: '' })
    const ids = result.statuses.map((s: { id: string }) => s.id)
    for (const id of ['peertube', 'bluesky', 'mastodon', 'lemmy']) assert.ok(ids.includes(id), id)
    assert.ok(result.media.some((m: { source: string }) => m.source === 'Bluesky'))
    assert.ok(result.media.some((m: { source: string }) => m.source === 'Mastodon'))
    assert.ok(result.media.some((m: { source: string }) => m.source === 'Lemmy'))
    assert.ok(result.leads.some((l: { platform: string }) => l.platform === 'Bluesky'))
    assert.ok(result.requestsAttempted >= 3 && result.requestsSucceeded >= 3)
    assert.ok('duckduckgo' in result)
    const fed = result.statuses.filter((s: { id: string }) => ['bluesky', 'mastodon', 'lemmy'].includes(s.id))
    assert.ok(fed.every((s: { mediaFound: number }) => s.mediaFound >= 1))
  } finally {
    process.env = saved
    restore()
  }
})

test('collectAdditionalSources survives every federated host failing', async () => {
  const restore = mockFetch(() => new Response('', { status: 500 }))
  try {
    const result = await collectAdditionalSources([], {})
    assert.ok(Array.isArray(result.media))
    const bluesky = result.statuses.find((s: { id: string }) => s.id === 'bluesky')
    assert.ok(bluesky && bluesky.state !== 'connected')
  } finally { restore() }
})
