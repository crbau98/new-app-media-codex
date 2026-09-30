import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RADAR_CAP,
  addToRadar,
  candidateToCreator,
  followName,
  isCatalogPlatform,
  matchedByLabel,
  mergeCreators,
  normalizeCandidates,
  parseBulkList,
  parseCreatorInput,
  parseProfileUrl,
  sanitizeRadarList,
} from '../src/features/creators/creatorLogic.ts'

const creator = (name: string, over: Record<string, unknown> = {}) => ({ id: `c-${name}`, name, avatar: '', ...over })

test('parseProfileUrl extracts handles from supported profile links', () => {
  assert.deepEqual(parseProfileUrl('https://www.redgifs.com/users/hoguesdirtylaundry'), { handle: 'hoguesdirtylaundry', platform: 'redgifs' })
  assert.deepEqual(parseProfileUrl('redgifs.com/users/Jakipz?tab=gifs'), { handle: 'Jakipz', platform: 'redgifs' })
  assert.deepEqual(parseProfileUrl('https://x.com/michaelyerger'), { handle: 'michaelyerger', platform: 'x' })
  assert.deepEqual(parseProfileUrl('https://twitter.com/michaelyerger/status/123'), { handle: 'michaelyerger', platform: 'x' })
  assert.deepEqual(parseProfileUrl('https://www.reddit.com/u/some_user'), { handle: 'some_user', platform: 'reddit' })
})

test('parseProfileUrl rejects non-profile or unknown links', () => {
  assert.equal(parseProfileUrl('https://example.com/foo'), null)
  assert.equal(parseProfileUrl('https://x.com/home'), null)
  assert.equal(parseProfileUrl('https://www.redgifs.com/browse'), null)
  assert.equal(parseProfileUrl('Christian Hogue'), null)
})

test('parseCreatorInput classifies names, handles and urls', () => {
  assert.deepEqual(parseCreatorInput('  '), { kind: 'empty', query: '' })
  assert.deepEqual(parseCreatorInput('Christian Hogue'), { kind: 'name', query: 'Christian Hogue' })
  assert.deepEqual(parseCreatorInput('@jakipz'), { kind: 'handle', query: 'jakipz', handle: 'jakipz' })
  assert.equal(parseCreatorInput('hoguesdirtylaundry').kind, 'name') // bare plain word: let the resolver decide
  assert.equal(parseCreatorInput('michael_yerger').kind, 'handle')
  const url = parseCreatorInput('https://www.redgifs.com/users/hoguesdirtylaundry')
  assert.equal(url.kind, 'url')
  assert.equal(url.query, 'hoguesdirtylaundry')
  assert.equal(url.platform, 'redgifs')
})

test('parseBulkList splits on commas/newlines, dedupes and skips junk', () => {
  const list = parseBulkList('Christian Hogue, Michael Yerger\n@jakipz\n\n  christian hogue ;x, https://x.com/foo_bar')
  assert.deepEqual(list.map((entry) => entry.query), ['Christian Hogue', 'Michael Yerger', 'jakipz', 'foo_bar'])
  assert.equal(parseBulkList('').length, 0)
  assert.equal(parseBulkList(Array.from({ length: 300 }, (_, i) => `creator${i}`).join(','), 50).length, 50)
})

test('addToRadar caps at 40, dedupes by key and reports overflow', () => {
  assert.equal(RADAR_CAP, 40)
  const start = Array.from({ length: 38 }, (_, i) => `handle${i}`)
  const result = addToRadar(start, ['@Handle1', 'newone', 'another', 'third', 'a'])
  assert.deepEqual(result.added, ['newone', 'another'])
  assert.deepEqual(result.skippedFull, ['third'])
  assert.equal(result.next.length, 40)
  assert.equal(start.length, 38, 'input is not mutated')
  assert.equal(addToRadar(result.next, ['more']).next.length, 40)
})

test('mergeCreators dedupes by lowercase handle and back-fills gaps', () => {
  const feed = [creator('Jakipz', { username: 'Jakipz', mediaCount: 3 })]
  const directory = [
    creator('jakipz', { username: 'jakipz', mediaCount: 120, avatar: 'a.jpg', followers: 900 }),
    creator('Michael Yerger', { username: 'michaelyerger' }),
  ]
  const merged = mergeCreators(feed as never, directory as never)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].name, 'Jakipz', 'feed entry wins')
  assert.equal(merged[0].mediaCount, 120)
  assert.equal(merged[0].avatar, 'a.jpg')
  assert.equal(merged[0].followers, 900)
})

test('candidateToCreator builds a drawer-ready creator with an empty media list', () => {
  const c = candidateToCreator({
    handle: 'hoguesdirtylaundry', displayName: 'Christian Hogue', platform: 'Redgifs',
    profileUrl: 'https://www.redgifs.com/users/hoguesdirtylaundry', confidence: 0.98, matchedBy: 'alias', mediaCount: 87,
  })
  assert.equal(c.username, 'hoguesdirtylaundry')
  assert.equal(c.name, 'Christian Hogue')
  assert.equal(c.mediaCount, 87)
  assert.deepEqual(c.media, [])
  assert.deepEqual(c.matchReasons, ['Known alias'])
  assert.equal(followName(c), 'hoguesdirtylaundry')
  assert.equal(followName(creator('Someone') as never), 'Someone')
})

test('normalizeCandidates tolerates malformed payloads', () => {
  assert.deepEqual(normalizeCandidates(null), [])
  assert.deepEqual(normalizeCandidates({ candidates: 'x' }), [])
  const out = normalizeCandidates({ candidates: [{ handle: '@A_b', confidence: 0.4 }, { handle: 'a_b' }, { nope: 1 }, { handle: 'z', followers: 'many', mediaCount: 5 }] })
  assert.equal(out.length, 2)
  assert.equal(out[0].handle, 'A_b')
  assert.equal(out[0].displayName, 'A_b')
  assert.equal(out[1].followers, null)
  assert.equal(out[1].mediaCount, 5)
})

test('sanitizeRadarList rehydrates old (≤8) and new (≤40) persisted lists', () => {
  assert.deepEqual(sanitizeRadarList(['@a_b', 'A_B', 'me@example.com', 42, ' Jake  Z ', 'x']), ['a_b', 'Jake Z'])
  assert.deepEqual(sanitizeRadarList('nope'), [])
  const many = Array.from({ length: 60 }, (_, i) => `creator${i}`)
  assert.equal(sanitizeRadarList(many).length, 40)
  assert.equal(sanitizeRadarList(many.slice(0, 8)).length, 8, 'a legacy 8-item list is preserved')
})

test('platform helpers', () => {
  assert.equal(isCatalogPlatform('Redgifs'), true)
  assert.equal(isCatalogPlatform('X'), false)
  assert.equal(isCatalogPlatform(undefined, 'https://www.redgifs.com/users/x'), true)
  assert.equal(matchedByLabel('variant'), 'Handle variant')
  assert.equal(matchedByLabel('search'), 'Search hit')
  assert.equal(matchedByLabel('weird'), 'Possible match')
})
