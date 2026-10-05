import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PLATFORMS,
  PAYWALL_NOTE,
  buildProfileUrl,
  displayHandle,
  isPublicHostname,
  isSubscriptionPlatform,
  parseProfileInput,
  parseProfileList,
  platformById,
  platformIdFromName,
  safeHttpUrl,
  safeOutboundUrl,
} from '../src/features/creators/platforms.ts'
import {
  OTHER_PLATFORM,
  creatorPlatformIds,
  creatorPlatformLinks,
  platformFilterOptions,
  splitPlatformLinks,
} from '../src/features/creators/platformLinks.ts'

const ok = (input: string, hint?: Parameters<typeof parseProfileInput>[1]) => {
  const result = parseProfileInput(input, hint)
  assert.equal(result.ok, true, `expected ${input} to parse (${result.ok ? '' : result.reason})`)
  return result.ok ? result.profile : (undefined as never)
}
const reason = (input: string, hint?: Parameters<typeof parseProfileInput>[1]) => {
  const result = parseProfileInput(input, hint)
  assert.equal(result.ok, false, `expected ${input} to be rejected`)
  return result.ok ? '' : result.reason
}

test('registry covers the required platforms with consistent kinds', () => {
  const kinds = Object.fromEntries(PLATFORMS.map((def) => [def.id, def.kind]))
  assert.equal(kinds.redgifs, 'playable')
  for (const id of ['x', 'bluesky', 'mastodon', 'tumblr', 'reddit', 'peertube', 'lemmy', 'instagram']) assert.equal(kinds[id], 'public-link', id)
  for (const id of ['onlyfans', 'fansly', 'justforfans']) assert.equal(kinds[id], 'subscription', id)
  for (const id of ['linktree', 'beacons', 'allmylinks']) assert.equal(kinds[id], 'link-in-bio', id)
  assert.equal(new Set(PLATFORMS.map((def) => def.id)).size, PLATFORMS.length)
  for (const def of PLATFORMS) {
    assert.ok(def.mark.length >= 1 && def.mark.length <= 3, def.id)
    assert.match(def.accent, /^\d{1,3} \d{1,3} \d{1,3}$/, def.id)
  }
  assert.equal(isSubscriptionPlatform('onlyfans'), true)
  assert.equal(isSubscriptionPlatform('x'), false)
  assert.match(PAYWALL_NOTE, /paywall/)
})

test('subscription platform URLs resolve to canonical creator pages', () => {
  const of = ok('https://onlyfans.com/Some.Creator?ref=123#top')
  assert.deepEqual([of.platform, of.handle, of.url, of.kind, of.key], ['onlyfans', 'some.creator', 'https://onlyfans.com/some.creator', 'subscription', 'onlyfans:some.creator'])
  assert.equal(ok('onlyfans.com/u12345678/media').url, 'https://onlyfans.com/u12345678')
  assert.equal(ok('https://www.onlyfans.com/someone').handle, 'someone')
  const fansly = ok('https://fansly.com/someone/posts')
  assert.deepEqual([fansly.platform, fansly.url], ['fansly', 'https://fansly.com/someone'])
  const jff = ok('https://justfor.fans/someone')
  assert.deepEqual([jff.platform, jff.url, jff.kind], ['justforfans', 'https://justfor.fans/someone', 'subscription'])
  assert.equal(ok('https://www.justforfans.com/someone').platform, 'justforfans')
  assert.equal(ok('https://www.patreon.com/c/someone').url, 'https://www.patreon.com/someone')
})

test('subscription site pages that are not profiles are rejected, not saved as creators', () => {
  assert.equal(reason('https://onlyfans.com/'), 'not-a-profile')
  assert.equal(reason('https://onlyfans.com/my/collections'), 'not-a-profile')
  assert.equal(reason('https://onlyfans.com/123456789'), 'not-a-profile')
  assert.equal(reason('https://fansly.com/explore'), 'not-a-profile')
  assert.equal(reason('https://justfor.fans/login'), 'not-a-profile')
})

test('public platforms: handles, hosts and canonical URLs', () => {
  assert.deepEqual(
    [ok('https://twitter.com/Some_User/status/123').platform, ok('https://twitter.com/Some_User/status/123').url],
    ['x', 'https://x.com/some_user'],
  )
  assert.equal(ok('https://mobile.twitter.com/abc').handle, 'abc')
  assert.equal(reason('https://x.com/home'), 'not-a-profile')
  assert.equal(reason('https://x.com/i/flow/login'), 'not-a-profile')

  const bsky = ok('https://bsky.app/profile/Some.Bsky.Social/post/3k')
  assert.deepEqual([bsky.platform, bsky.handle, bsky.url], ['bluesky', 'some.bsky.social', 'https://bsky.app/profile/some.bsky.social'])
  assert.equal(ok('@name.bsky.social').platform, 'bluesky')
  assert.equal(ok('name.bsky.social').platform, 'bluesky')

  assert.equal(ok('https://some-blog.tumblr.com/post/12').url, 'https://some-blog.tumblr.com/')
  assert.equal(ok('https://www.tumblr.com/some-blog').handle, 'some-blog')
  assert.equal(ok('https://www.tumblr.com/blog/some-blog').handle, 'some-blog')
  assert.equal(reason('https://www.tumblr.com/dashboard'), 'not-a-profile')
  assert.equal(reason('https://assets.tumblr.com/foo'), 'not-a-profile')

  assert.deepEqual([ok('https://old.reddit.com/user/Some_User/').platform, ok('https://old.reddit.com/user/Some_User/').url], ['reddit', 'https://www.reddit.com/user/some_user'])
  assert.equal(ok('https://www.reddit.com/u/abc_def').handle, 'abc_def')
  assert.equal(reason('https://www.reddit.com/r/gaybros'), 'subreddit')
  assert.equal(reason('r/gaybros'), 'subreddit')
  assert.equal(ok('u/some_user').platform, 'reddit')

  assert.equal(ok('https://www.instagram.com/some.user/').url, 'https://www.instagram.com/some.user/')
  assert.equal(reason('https://www.instagram.com/p/ABC123/'), 'not-a-profile')
  assert.equal(ok('https://www.tiktok.com/@some.user/video/1').url, 'https://www.tiktok.com/@some.user')
  assert.equal(ok('https://www.youtube.com/@SomeUser').url, 'https://www.youtube.com/@someuser')
  assert.equal(ok('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv').url, 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv')
  assert.equal(reason('https://www.youtube.com/watch?v=abc'), 'not-a-profile')
  assert.equal(ok('https://www.twitch.tv/some_user').platform, 'twitch')
  assert.equal(ok('https://www.threads.net/@some.user').platform, 'threads')
})

test('redgifs profile links are the playable kind', () => {
  const rg = ok('https://www.redgifs.com/users/HoguesDirtyLaundry?tab=gifs')
  assert.deepEqual([rg.platform, rg.handle, rg.kind, rg.url], ['redgifs', 'hoguesdirtylaundry', 'playable', 'https://www.redgifs.com/users/hoguesdirtylaundry'])
  assert.equal(reason('https://www.redgifs.com/browse'), 'not-a-profile')
  assert.equal(reason('https://www.redgifs.com/watch/foo'), 'not-a-profile')
})

test('link-in-bio hosts', () => {
  assert.deepEqual([ok('https://linktr.ee/Someone').platform, ok('https://linktr.ee/Someone').kind, ok('https://linktr.ee/Someone').url], ['linktree', 'link-in-bio', 'https://linktr.ee/someone'])
  assert.equal(ok('beacons.ai/someone').url, 'https://beacons.ai/someone')
  assert.equal(ok('https://allmylinks.com/someone').platform, 'allmylinks')
})

test('fediverse: Mastodon, Lemmy and PeerTube profiles on any instance', () => {
  const mastodon = ok('https://mastodon.social/@Someone')
  assert.deepEqual([mastodon.platform, mastodon.handle, mastodon.url, mastodon.inferred], ['mastodon', 'someone@mastodon.social', 'https://mastodon.social/@someone', true])
  assert.equal(displayHandle(mastodon.platform, mastodon.handle), '@someone@mastodon.social')
  const remote = ok('https://mastodon.social/@someone@other.example')
  assert.deepEqual([remote.handle, remote.url], ['someone@other.example', 'https://other.example/@someone'])
  const bare = ok('@someone@mastodon.social')
  assert.deepEqual([bare.platform, bare.url], ['mastodon', 'https://mastodon.social/@someone'])
  const lemmy = ok('https://lemmy.world/u/Someone')
  assert.deepEqual([lemmy.platform, lemmy.handle, lemmy.url], ['lemmy', 'someone@lemmy.world', 'https://lemmy.world/u/someone'])
  const peertube = ok('https://peertube.example/accounts/someone')
  assert.deepEqual([peertube.platform, peertube.handle], ['peertube', 'someone@peertube.example'])
  // A Lemmy community is not a person.
  assert.equal(ok('https://lemmy.world/c/gaybros').platform, 'generic')
  // Hosts with their own platform entry never fall into the fediverse heuristic.
  assert.equal(ok('https://medium.com/@someone').platform, 'generic')
  assert.equal(ok('https://x.com/@someone').platform, 'x')
})

test('unknown hosts become a generic external link with tracking params stripped', () => {
  const generic = ok('https://www.example.com/me/links?utm_source=x&keep=1#frag')
  assert.equal(generic.platform, 'generic')
  assert.equal(generic.kind, 'external')
  assert.equal(generic.url, 'https://www.example.com/me/links?keep=1')
  assert.equal(generic.key, 'generic:example.com/me/links?keep=1')
  assert.equal(ok('example.org').platform, 'generic')
  assert.equal(ok('example.org').url, 'https://example.org/')
})

test('unsafe URLs are rejected: scheme, credentials, private / IP / internal hosts, ports', () => {
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'ftp://example.com/x',
    'mailto:me@example.com', 'vbscript:msgbox(1)',
  ]) assert.equal(reason(bad), 'unsupported-scheme', bad)
  assert.equal(reason('https://user:pass@onlyfans.com/someone'), 'credentials')
  assert.equal(reason('https://onlyfans.com@evil.example/someone'), 'credentials')
  for (const bad of [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://169.254.169.254/latest', 'http://[::1]/x',
    'http://2130706433/x', 'http://0x7f.1/x', 'http://0177.0.0.1/x', 'https://printer.local/x', 'https://intranet.internal/x', 'https://8.8.8.8/x',
    'https://example/x', 'https://host.home.arpa/x',
  ]) assert.equal(reason(bad), 'private-host', bad)
  assert.equal(reason('https://example.com:8443/x'), 'private-host')
  assert.equal(reason('https://exa mple.com'), 'invalid-url')
  assert.equal(reason('https://example.com/\u0000'), 'invalid-url')
  assert.equal(reason('https://' + 'a'.repeat(3000) + '.com'), 'too-long')
  assert.equal(reason(''), 'empty')
  assert.equal(reason('   '), 'empty')
})

test('homograph and lookalike hosts do not borrow a platform', () => {
  assert.equal(ok('https://onlyfans.com.evil.example/someone').platform, 'generic')
  assert.equal(ok('https://evil-onlyfans.com/someone').platform, 'generic')
  assert.equal(ok('https://notx.com/someone').platform, 'generic')
  const punycode = ok('https://onlуfans.com/someone') // Cyrillic "у"
  assert.equal(punycode.platform, 'generic')
  assert.match(punycode.host, /^xn--/)
})

test('safeHttpUrl / safeOutboundUrl / isPublicHostname', () => {
  assert.equal(safeHttpUrl('https://x.com/a').ok, true)
  assert.equal(safeHttpUrl('//x.com/a').ok, false)
  assert.equal(safeOutboundUrl('https://x.com/a'), 'https://x.com/a')
  assert.equal(safeOutboundUrl('javascript:alert(1)'), null)
  assert.equal(safeOutboundUrl(undefined), null)
  assert.equal(safeOutboundUrl(42), null)
  assert.equal(isPublicHostname('example.com'), true)
  assert.equal(isPublicHostname('xn--e1afmkfd.xn--p1ai'), true)
  for (const host of ['localhost', 'a.local', '127.0.0.1', '1.2.3', '[::1]', 'a..b.com', '-a.com', 'a.c', '']) assert.equal(isPublicHostname(host), false, host)
})

test('bare @handles need a platform unless they are self-describing', () => {
  assert.equal(reason('@someone'), 'needs-platform')
  assert.equal(reason('someone'), 'needs-platform')
  const hinted = ok('@Some_One', 'onlyfans')
  assert.deepEqual([hinted.platform, hinted.url], ['onlyfans', 'https://onlyfans.com/some_one'])
  assert.equal(ok('someone', 'fansly').url, 'https://fansly.com/someone')
  assert.equal(ok('someone', 'justforfans').url, 'https://justfor.fans/someone')
  assert.equal(ok('@some.user', 'instagram').url, 'https://www.instagram.com/some.user/')
  assert.equal(ok('jay.example.com', 'bluesky').url, 'https://bsky.app/profile/jay.example.com')
  // A pasted URL wins over the hint.
  assert.equal(ok('https://fansly.com/someone', 'onlyfans').platform, 'fansly')
  assert.equal(reason('@someone', 'mastodon'), 'invalid-handle')
  assert.equal(reason('@ab', 'onlyfans'), 'invalid-handle') // too short for OnlyFans
  assert.equal(reason('@bad/handle', 'x'), 'invalid-url')
  assert.equal(reason('@waytoolonghandlewayyy', 'x'), 'invalid-handle')
  assert.equal(reason('someone@example.com'), 'email')
})

test('buildProfileUrl rebuilds canonical urls and rejects invalid handles', () => {
  assert.equal(buildProfileUrl('onlyfans', 'someone'), 'https://onlyfans.com/someone')
  assert.equal(buildProfileUrl('mastodon', 'someone@mastodon.social'), 'https://mastodon.social/@someone')
  assert.equal(buildProfileUrl('onlyfans', 'a/b'), null)
  assert.equal(buildProfileUrl('generic', 'x'), null)
})

test('parseProfileList splits pastes, dedupes and reports errors', () => {
  const result = parseProfileList(
    'https://onlyfans.com/aaa, https://onlyfans.com/AAA\n@bbb\njavascript:alert(1);https://fansly.com/ccc  https://x.com/home',
    'x',
  )
  assert.deepEqual(result.profiles.map((profile) => profile.key), ['onlyfans:aaa', 'x:bbb', 'fansly:ccc'])
  assert.equal(result.duplicates, 1)
  assert.deepEqual(result.errors.map((error) => error.reason), ['unsupported-scheme', 'not-a-profile'])
  assert.equal(result.truncated, false)
  const many = parseProfileList(Array.from({ length: 30 }, (_, i) => `https://x.com/user${i}`).join('\n'), null, 10)
  assert.equal(many.profiles.length, 10)
  assert.equal(many.truncated, true)
  assert.deepEqual(parseProfileList('', null), { profiles: [], errors: [], errorCount: 0, duplicates: 0, truncated: false })
  assert.equal(result.errorCount, 2)
  const noisy = parseProfileList(Array.from({ length: 30 }, (_, i) => `nope${i}`).join(' '), null)
  assert.equal(noisy.errorCount, 30)
  assert.equal(noisy.errors.length, 12)
})

test('platformIdFromName maps API platform names, short aliases only match exactly', () => {
  assert.equal(platformIdFromName('Redgifs public profile'), 'redgifs')
  assert.equal(platformIdFromName('OnlyFans'), 'onlyfans')
  assert.equal(platformIdFromName('JustFor.Fans'), 'justforfans')
  assert.equal(platformIdFromName('Link in bio (Linktree)'), 'linktree')
  assert.equal(platformIdFromName('X'), 'x')
  assert.equal(platformIdFromName('Twitter'), 'x')
  assert.equal(platformIdFromName('Public test source'), null)
  assert.equal(platformIdFromName('Fox news'), null)
  assert.equal(platformIdFromName(''), null)
  assert.equal(platformIdFromName(undefined), null)
})

const creator = (over: Record<string, unknown> = {}) => ({ id: 'c', name: 'Someone', avatar: '', ...over })

test('creatorPlatformLinks merges profile url, profile links and elsewhere without guessing', () => {
  const links = creatorPlatformLinks(
    creator({
      platform: 'Redgifs',
      platforms: ['Redgifs', 'OnlyFans'],
      profileUrl: 'https://www.redgifs.com/users/someone',
      profileLinks: [
        { label: 'Redgifs', url: 'https://www.redgifs.com/users/someone' },
        { label: 'Post', url: 'https://www.redgifs.com/watch/abc' },
        { label: 'Site', url: 'https://example.com/some' },
      ],
    }),
    [
      { platform: 'X', handle: 'someone_x', url: 'https://x.com/someone_x', verified: true },
      { platform: 'OnlyFans', handle: 'someone', url: 'https://onlyfans.com/someone', verified: false },
      { platform: 'Evil', url: 'javascript:alert(1)' },
      { platform: 'Home', url: 'https://someone.example/' },
    ],
  )
  assert.deepEqual(links.map((link) => link.key), ['redgifs:someone', 'x:someone_x', 'onlyfans:someone', 'generic:someone.example'])
  assert.deepEqual(links.map((link) => link.kind), ['playable', 'public-link', 'subscription', 'external'])
  const x = links.find((link) => link.platform === 'x')!
  assert.equal(x.verified, true)
  assert.equal(x.display, '@someone_x')
  // The OnlyFans platform name was already satisfied by the elsewhere link: no duplicate name-only entry.
  assert.equal(links.filter((link) => link.platform === 'onlyfans').length, 1)
  assert.equal(links.every((link) => link.url === null || link.url.startsWith('https://')), true)
})

test('a subscription platform known only by name is listed without a URL (never guessed)', () => {
  const links = creatorPlatformLinks(creator({ platform: 'Redgifs', platforms: ['Redgifs', 'Fansly'] }))
  const fansly = links.find((link) => link.platform === 'fansly')!
  assert.equal(fansly.url, null)
  assert.equal(fansly.source, 'platform-name')
  const split = splitPlatformLinks(links)
  assert.deepEqual(split.subscribe, [])
  assert.deepEqual(split.chips.map((link) => link.platform), ['redgifs', 'fansly'])
})

test('splitPlatformLinks sends only linked subscription platforms to the subscribe buttons', () => {
  const links = creatorPlatformLinks(creator(), [
    { url: 'https://onlyfans.com/someone' },
    { url: 'https://fansly.com/someone' },
    { url: 'https://justfor.fans/someone' },
    { url: 'https://linktr.ee/someone' },
    { url: 'https://bsky.app/profile/someone.bsky.social' },
  ])
  const { chips, subscribe } = splitPlatformLinks(links)
  assert.deepEqual(subscribe.map((link) => link.platform), ['onlyfans', 'fansly', 'justforfans'])
  assert.deepEqual(chips.map((link) => link.platform), ['bluesky', 'linktree'])
})

test('creatorPlatformLinks is bounded and tolerates empty input', () => {
  assert.deepEqual(creatorPlatformLinks(null), [])
  assert.deepEqual(creatorPlatformLinks(undefined), [])
  const many = Array.from({ length: 40 }, (_, i) => ({ url: `https://example${i}.com/me` }))
  assert.equal(creatorPlatformLinks(creator(), many).length, 12)
  assert.equal(creatorPlatformLinks(creator(), many, 5).length, 5)
})

test('creatorPlatformIds + platformFilterOptions count registry platforms and bucket the rest', () => {
  const a = creatorPlatformIds(creator({ platform: 'Redgifs', profileUrl: 'https://www.redgifs.com/users/a' }))
  const b = creatorPlatformIds(creator({ platform: 'Redgifs', platforms: ['Redgifs', 'Bluesky'] }))
  const c = creatorPlatformIds(creator({ platform: 'Public test source' }))
  const d = creatorPlatformIds(creator())
  assert.deepEqual([...a], ['redgifs'])
  assert.deepEqual([...b].sort(), ['bluesky', 'redgifs'])
  assert.deepEqual([...c], [OTHER_PLATFORM])
  assert.equal(d.size, 0)
  const options = platformFilterOptions([a, b, c, new Set(['onlyfans']), new Set(['onlyfans'])])
  assert.deepEqual(options.map((option) => [option.id, option.count]), [['onlyfans', 2], ['redgifs', 2], ['bluesky', 1], ['other', 1]])
  assert.equal(options.find((option) => option.id === 'onlyfans')!.kind, 'subscription')
  assert.equal(platformById('onlyfans')!.label, 'OnlyFans')
})
