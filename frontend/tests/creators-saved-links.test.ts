import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMPORT_MAX_CHARS,
  SAVED_LINKS_CAP,
  SAVED_LINKS_KEY,
  SAVED_NOTE_MAX,
  addSavedLinks,
  filterSavedLinks,
  loadSavedLinks,
  mergeSavedLinks,
  normalizeSavedEntry,
  parseSavedLinksImport,
  persistSavedLinks,
  removeSavedLink,
  sanitizeNote,
  sanitizeSavedList,
  savedCatalogHandle,
  savedToCreator,
  serializeSavedLinks,
  setSavedNote,
  type SavedLink,
} from '../src/features/creators/savedLinks.ts'
import { parseProfileList, type ParsedProfile } from '../src/features/creators/platforms.ts'

const NOW = Date.parse('2026-10-05T12:00:00Z')

function profiles(raw: string, hint?: Parameters<typeof parseProfileList>[1]): ParsedProfile[] {
  return parseProfileList(raw, hint, 1000).profiles
}

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

test('storage key is versioned and the cap is 300', () => {
  assert.equal(SAVED_LINKS_KEY, 'media-codex-saved-links-v1')
  assert.equal(SAVED_LINKS_CAP, 300)
})

test('addSavedLinks saves newest-first and dedupes by platform+handle', () => {
  const first = addSavedLinks([], profiles('https://onlyfans.com/aaa https://fansly.com/bbb'), { now: NOW })
  assert.deepEqual(first.next.map((link) => link.id), ['onlyfans:aaa', 'fansly:bbb'])
  assert.equal(first.added.length, 2)
  assert.equal(first.next[0].addedAt, NOW)
  assert.equal(first.next[0].url, 'https://onlyfans.com/aaa')

  // Same handle on a different platform is a different entry; the same platform+handle (any case/URL shape) is a duplicate.
  const second = addSavedLinks(first.next, profiles('https://onlyfans.com/AAA/media @aaa https://x.com/aaa https://justfor.fans/aaa', 'fansly'), { now: NOW + 1 })
  assert.deepEqual(second.next.map((link) => link.id), ['fansly:aaa', 'x:aaa', 'justforfans:aaa', 'onlyfans:aaa', 'fansly:bbb'])
  assert.equal(second.duplicates, 1)
  assert.deepEqual(second.added.map((link) => link.id), ['fansly:aaa', 'x:aaa', 'justforfans:aaa'])
})

test('addSavedLinks enforces the cap and reports what did not fit', () => {
  const full = addSavedLinks([], profiles(Array.from({ length: 300 }, (_, i) => `https://x.com/u${i}`).join(' ')), { now: NOW })
  assert.equal(full.next.length, SAVED_LINKS_CAP)
  assert.equal(full.skippedFull, 0)
  const over = addSavedLinks(full.next, profiles('https://x.com/extra1 https://x.com/extra2 https://x.com/u1'), { now: NOW })
  assert.equal(over.next.length, SAVED_LINKS_CAP)
  assert.equal(over.skippedFull, 2)
  assert.equal(over.duplicates, 1)
  assert.equal(over.added.length, 0)
  const small = addSavedLinks([], profiles('https://x.com/a https://x.com/b https://x.com/c'), { now: NOW, cap: 2 })
  assert.deepEqual(small.next.map((link) => link.id), ['x:a', 'x:b'])
  assert.equal(small.skippedFull, 1)
})

test('remove and note edits are immutable and sanitised', () => {
  const { next } = addSavedLinks([], profiles('https://x.com/a https://x.com/b'), { now: NOW })
  assert.deepEqual(removeSavedLink(next, 'x:a').map((link) => link.id), ['x:b'])
  assert.equal(next.length, 2)
  const noted = setSavedNote(next, 'x:b', '  met at\u0000 the\n\nfestival  ')
  assert.equal(noted.find((link) => link.id === 'x:b')!.note, 'met at the festival')
  assert.equal(next.find((link) => link.id === 'x:b')!.note, '')
  assert.equal(sanitizeNote('x'.repeat(500)).length, SAVED_NOTE_MAX)
  assert.equal(sanitizeNote(42), '')
  assert.deepEqual(setSavedNote(next, 'missing', 'hello'), next)
})

test('normalizeSavedEntry re-parses and ignores stored url/handle claims it cannot verify', () => {
  const good = normalizeSavedEntry({ platform: 'onlyfans', handle: 'WRONG', url: 'https://onlyfans.com/Real', note: 'hi', addedAt: NOW - 1000 }, NOW)!
  assert.deepEqual([good.id, good.handle, good.url, good.note, good.addedAt], ['onlyfans:real', 'real', 'https://onlyfans.com/real', 'hi', NOW - 1000])
  assert.equal(normalizeSavedEntry({ url: 'javascript:alert(1)' }, NOW), null)
  assert.equal(normalizeSavedEntry({ url: 'http://127.0.0.1/admin' }, NOW), null)
  assert.equal(normalizeSavedEntry({ url: 'https://user:pw@onlyfans.com/x' }, NOW), null)
  assert.equal(normalizeSavedEntry('nope', NOW), null)
  assert.equal(normalizeSavedEntry(null, NOW), null)
  assert.equal(normalizeSavedEntry({}, NOW), null)
  // handle+platform fallback (no url)
  assert.equal(normalizeSavedEntry({ platform: 'fansly', handle: 'someone' }, NOW)!.url, 'https://fansly.com/someone')
  assert.equal(normalizeSavedEntry({ platform: 'mastodon', handle: 'a@mastodon.social' }, NOW)!.url, 'https://mastodon.social/@a')
  assert.equal(normalizeSavedEntry({ platform: 'nonsense', handle: 'someone' }, NOW), null)
  assert.equal(normalizeSavedEntry({ platform: 'generic', handle: 'example.com' }, NOW), null)
  // implausible timestamps fall back to now
  assert.equal(normalizeSavedEntry({ url: 'https://x.com/a', addedAt: NOW + 10 * 86_400_000 }, NOW)!.addedAt, NOW)
  assert.equal(normalizeSavedEntry({ url: 'https://x.com/a', addedAt: 'yesterday' }, NOW)!.addedAt, NOW)
  // generic links survive a round trip
  assert.equal(normalizeSavedEntry({ url: 'https://example.com/me' }, NOW)!.platform, 'generic')
})

test('sanitizeSavedList drops junk, dedupes (first wins) and caps', () => {
  const list = sanitizeSavedList(
    [{ url: 'https://x.com/a' }, { url: 'https://x.com/A', note: 'dup' }, 5, { url: 'ftp://nope.example/x' }, { url: 'https://fansly.com/bbb' }],
    NOW,
  )
  assert.deepEqual(list.map((link) => link.id), ['x:a', 'fansly:bbb'])
  assert.deepEqual(sanitizeSavedList('nope', NOW), [])
  assert.deepEqual(sanitizeSavedList(undefined, NOW), [])
  const many = sanitizeSavedList(Array.from({ length: 400 }, (_, i) => ({ url: `https://x.com/u${i}` })), NOW)
  assert.equal(many.length, SAVED_LINKS_CAP)
  assert.equal(sanitizeSavedList(many, NOW, 5).length, 5)
})

test('export -> import round-trips and never needs the network', () => {
  const { next } = addSavedLinks([], profiles('https://onlyfans.com/aaa https://fansly.com/bbb https://example.com/me'), { now: NOW, note: 'fav' })
  const text = serializeSavedLinks(next, NOW)
  const file = JSON.parse(text)
  assert.deepEqual([file.app, file.kind, file.version, file.exportedAt], ['media-codex', 'saved-profile-links', 1, '2026-10-05T12:00:00.000Z'])
  assert.equal(file.links.length, 3)
  assert.equal(file.links[0].note, 'fav')
  const parsed = parseSavedLinksImport(text, NOW)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(parsed.links.map((link) => link.id), next.map((link) => link.id))
    assert.equal(parsed.rejected, 0)
    assert.equal(parsed.truncated, false)
  }
  assert.equal(serializeSavedLinks([], NOW).includes('"links": []'), true)
})

test('import validation: malformed JSON, wrong shape, hostile entries, version, size', () => {
  const error = (text: string) => {
    const result = parseSavedLinksImport(text, NOW)
    assert.equal(result.ok, false)
    return result.ok ? '' : result.error
  }
  assert.match(error(''), /empty/)
  assert.match(error('   '), /empty/)
  assert.match(error('{nope'), /not valid JSON/)
  assert.match(error('"just a string"'), /No links/)
  assert.match(error('{"links": "x"}'), /No links/)
  assert.match(error('{"version": 2, "links": []}'), /newer version/)
  assert.match(error('{"kind": "something-else", "links": []}'), /not a saved-profile-links/)
  assert.match(error('[{"url":"javascript:alert(1)"},{"url":"http://localhost/x"}]'), /None of the links/)
  assert.match(error('[]'), /No links/)
  assert.match(error('x'.repeat(IMPORT_MAX_CHARS + 1)), /too large/)

  const mixed = parseSavedLinksImport(
    JSON.stringify({ version: 1, links: [{ url: 'https://onlyfans.com/okay' }, { url: 'javascript:alert(1)' }, { url: 'https://onlyfans.com/OKAY' }, 'str', { platform: 'fansly', handle: 'fine' }] }),
    NOW,
  )
  assert.equal(mixed.ok, true)
  if (mixed.ok) {
    assert.deepEqual(mixed.links.map((link) => link.id), ['onlyfans:okay', 'fansly:fine'])
    assert.equal(mixed.rejected, 2)
  }
  // A bare array is accepted too (hand-written files).
  const bare = parseSavedLinksImport('[{"url":"https://x.com/a"}]', NOW)
  assert.equal(bare.ok && bare.links.length, 1)
})

test('import is bounded: huge arrays are truncated at the cap', () => {
  const entries = Array.from({ length: 5000 }, (_, i) => ({ url: `https://x.com/u${i}` }))
  const result = parseSavedLinksImport(JSON.stringify(entries), NOW)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.links.length, SAVED_LINKS_CAP)
    assert.equal(result.truncated, true)
  }
})

test('mergeSavedLinks keeps existing entries, back-fills notes, dedupes and respects the cap', () => {
  const existing = addSavedLinks([], profiles('https://x.com/a https://x.com/b'), { now: NOW }).next
  const imported: SavedLink[] = [
    { id: 'x:a', platform: 'x', handle: 'a', url: 'https://x.com/a', note: 'imported note', addedAt: NOW - 5000 },
    { id: 'fansly:c', platform: 'fansly', handle: 'c', url: 'https://fansly.com/c', note: '', addedAt: NOW - 9000 },
  ]
  const merged = mergeSavedLinks(existing, imported)
  assert.equal(merged.duplicates, 1)
  assert.deepEqual(merged.added.map((link) => link.id), ['fansly:c'])
  assert.deepEqual(merged.next.map((link) => link.id), ['x:a', 'x:b', 'fansly:c'])
  assert.equal(merged.next.find((link) => link.id === 'x:a')!.note, 'imported note')
  assert.equal(merged.next.find((link) => link.id === 'x:a')!.addedAt, NOW)

  const capped = mergeSavedLinks(existing, imported, 2)
  assert.equal(capped.next.length, 2)
  assert.equal(capped.skippedFull, 1)
  assert.deepEqual(mergeSavedLinks(existing, []).next, existing)
})

test('loadSavedLinks / persistSavedLinks tolerate missing, blocked and corrupt storage', () => {
  assert.deepEqual(loadSavedLinks(null, NOW), { links: [], available: false })
  assert.deepEqual(loadSavedLinks(undefined, NOW), { links: [], available: false })
  const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.deepEqual(loadSavedLinks(throwing, NOW), { links: [], available: false })
  assert.equal(persistSavedLinks(throwing, []), false)
  assert.equal(persistSavedLinks(null, []), false)

  const storage = new MemoryStorage()
  assert.deepEqual(loadSavedLinks(storage, NOW), { links: [], available: true })
  storage.setItem(SAVED_LINKS_KEY, '{corrupt')
  assert.deepEqual(loadSavedLinks(storage, NOW), { links: [], available: true })
  storage.setItem(SAVED_LINKS_KEY, JSON.stringify({ v: 99, links: [{ url: 'https://x.com/a' }] }))
  assert.deepEqual(loadSavedLinks(storage, NOW).links, [])

  const { next } = addSavedLinks([], profiles('https://onlyfans.com/aaa https://x.com/bbb'), { now: NOW, note: 'n' })
  assert.equal(persistSavedLinks(storage, next), true)
  const raw = JSON.parse(storage.getItem(SAVED_LINKS_KEY)!)
  assert.equal(raw.v, 1)
  assert.equal(raw.links.length, 2)
  assert.deepEqual(loadSavedLinks(storage, NOW + 1).links, next)

  // Stored entries are re-validated on load: tampered storage cannot smuggle in an unsafe URL.
  storage.setItem(SAVED_LINKS_KEY, JSON.stringify({ v: 1, links: [{ url: 'javascript:alert(1)' }, { url: 'https://x.com/ok' }, { url: 'javascript:alert(1)', platform: 'x', handle: 'a' }] }))
  const reloaded = loadSavedLinks(storage, NOW).links
  assert.deepEqual(reloaded.map((link) => link.id), ['x:ok', 'x:a'])
  // An unsafe stored url is never kept: the canonical url is rebuilt from the registry.
  assert.deepEqual(reloaded.map((link) => link.url), ['https://x.com/ok', 'https://x.com/a'])
})

test('Redgifs saved handles can open the public catalog; no other platform can', () => {
  const [rg, of, x] = addSavedLinks([], profiles('https://www.redgifs.com/users/Someone https://onlyfans.com/someone https://x.com/someone'), { now: NOW }).next
  assert.equal(savedCatalogHandle(rg), 'someone')
  assert.equal(savedCatalogHandle(of), null)
  assert.equal(savedCatalogHandle(x), null)
  const creator = savedToCreator(rg)
  assert.deepEqual([creator.id, creator.username, creator.platform, creator.profileUrl], ['resolved-someone', 'someone', 'Redgifs', 'https://www.redgifs.com/users/someone'])
  assert.deepEqual(creator.media, [])
})

test('filterSavedLinks filters by platform and by handle / note / platform text', () => {
  const base = addSavedLinks([], profiles('https://onlyfans.com/alpha https://fansly.com/beta https://x.com/gamma'), { now: NOW }).next
  const list = setSavedNote(base, 'x:gamma', 'met in Lisbon')
  assert.deepEqual(filterSavedLinks(list, null, '').map((link) => link.id), ['onlyfans:alpha', 'fansly:beta', 'x:gamma'])
  assert.deepEqual(filterSavedLinks(list, 'fansly', '').map((link) => link.id), ['fansly:beta'])
  assert.deepEqual(filterSavedLinks(list, null, 'LISBON').map((link) => link.id), ['x:gamma'])
  assert.deepEqual(filterSavedLinks(list, 'x', 'alpha'), [])
  assert.deepEqual(filterSavedLinks(list, null, 'onlyfans').map((link) => link.id), ['onlyfans:alpha'])
})
