import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ERASE_PHRASE, appKeys, isAppKey, phraseMatches, wipeEverything, type CachesLike, type IdbLike, type StorageLike, type SwRegistrationLike,
} from '../src/features/privacy/wipe.ts'
import {
  INCOGNITO_DROP_KEYS, STORE_KEY, filterIncognitoWrite, installStorageGuard, blockAllWrites, isIncognito, setIncognito, subscribeIncognito, snapshotStoreHistory,
} from '../src/features/privacy/incognito.ts'

class FakeStorage implements StorageLike {
  data = new Map<string, string>()
  get length() { return this.data.size }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null }
  setItem(key: string, value: string) { this.data.set(key, String(value)) }
  removeItem(key: string) { this.data.delete(key) }
}

test('key enumeration: only media-codex* keys, snapshot is safe to delete from', () => {
  const s = new FakeStorage()
  for (const k of ['media-codex-store', 'media-codex-adult-verified', 'media-codex:legacy', 'other-app', 'theme', 'MEDIA-CODEX-upper']) s.setItem(k, '1')
  assert.deepEqual(appKeys(s).sort(), ['media-codex-adult-verified', 'media-codex-store', 'media-codex:legacy'])
  assert.equal(isAppKey('media-codex-lite'), true)
  assert.equal(isAppKey('x-media-codex'), false)
  for (const k of appKeys(s)) s.removeItem(k)
  assert.deepEqual([...s.data.keys()].sort(), ['MEDIA-CODEX-upper', 'other-app', 'theme'])
})

test('erase phrase is forgiving about case and spacing but exact otherwise', () => {
  assert.equal(phraseMatches(ERASE_PHRASE), true)
  assert.equal(phraseMatches('  erase   everything '), true)
  assert.equal(phraseMatches('erase'), false)
  assert.equal(phraseMatches('erase everything now'), false)
  assert.equal(phraseMatches(''), false)
})

function fakeEnv(opts: { databases?: boolean } = {}) {
  const local = new FakeStorage()
  const session = new FakeStorage()
  for (const k of ['media-codex-store', 'media-codex-privacy-v1', 'media-codex-lockout-v1', 'media-codex-adult-verified', 'unrelated']) local.setItem(k, 'x')
  session.setItem('media-codex-incognito-v1', '1')
  session.setItem('keep-me', '1')
  const deleted: string[] = []
  const dbs = ['codex-cache', 'other-db']
  const idb: IdbLike = {
    ...(opts.databases === false ? {} : { databases: async () => dbs.map((name) => ({ name })) }),
    deleteDatabase(name: string) {
      const request = { onsuccess: null as unknown, onerror: null as unknown, onblocked: null as unknown }
      queueMicrotask(() => { deleted.push(name); (request.onsuccess as () => void)?.() })
      return request
    },
  }
  const cacheStore = new Map<string, boolean>([['media-codex-shell-v5', true], ['media-codex-images-v5', true], ['workbox-precache', true]])
  const caches: CachesLike = { keys: async () => [...cacheStore.keys()], delete: async (name) => cacheStore.delete(name) }
  const messages: unknown[] = []
  let unregistered = 0
  const registrations: SwRegistrationLike[] = [{ active: { postMessage: (m) => messages.push(m) }, unregister: async () => { unregistered += 1; return true } }]
  const order: string[] = []
  return { local, session, idb, caches, cacheStore, deleted, messages, registrations, order, get unregistered() { return unregistered }, dbs }
}

test('wipeEverything clears app keys, IndexedDB, Cache Storage and service workers', async () => {
  const f = fakeEnv()
  let cookiesCleared = false
  const report = await wipeEverything({
    local: f.local, session: f.session, indexedDB: f.idb, caches: f.caches, getRegistrations: async () => f.registrations,
    beforeWipe: () => f.order.push('before'), clearCookies: () => { cookiesCleared = true },
  })
  assert.deepEqual(f.order, ['before'])
  assert.deepEqual(report.errors, [])
  assert.deepEqual([...f.local.data.keys()], ['unrelated'], 'adult gate, store, privacy, lockout all gone; foreign keys untouched')
  assert.deepEqual([...f.session.data.keys()], ['keep-me'])
  assert.deepEqual(report.localKeys.sort(), ['media-codex-adult-verified', 'media-codex-lockout-v1', 'media-codex-privacy-v1', 'media-codex-store'])
  assert.deepEqual(report.sessionKeys, ['media-codex-incognito-v1'])
  assert.deepEqual(f.deleted.sort(), ['codex-cache', 'other-db'])
  assert.deepEqual([...f.cacheStore.keys()], [], 'every cache is deleted, including service-worker caches')
  assert.deepEqual(f.messages, [{ type: 'CLEAR_CACHES' }])
  assert.equal(f.unregistered, 1)
  assert.equal(report.registrations, 1)
  assert.equal(cookiesCleared, true)
})

test('wipeEverything falls back to known database names and survives failing subsystems', async () => {
  const f = fakeEnv({ databases: false })
  const report = await wipeEverything({
    local: f.local, indexedDB: f.idb, knownDatabases: ['media-codex-db'],
    caches: { keys: async () => { throw new Error('caches blocked') }, delete: async () => false },
    getRegistrations: async () => { throw new Error('sw blocked') },
  })
  assert.deepEqual(f.deleted, ['media-codex-db'])
  assert.deepEqual([...f.local.data.keys()], ['unrelated'], 'storage still cleared')
  assert.equal(report.errors.length, 2)
  assert.match(report.errors.join('|'), /caches blocked/)
  assert.match(report.errors.join('|'), /sw blocked/)
})

/* ---- incognito ---- */

const storeJson = (state: Record<string, unknown>) => JSON.stringify({ state, version: 4 })

test('incognito filter: history keys are dropped, history fields in the store keep their pre-session value', () => {
  for (const key of INCOGNITO_DROP_KEYS) assert.equal(filterIncognitoWrite(key, '{"x":1}', {}), null, key)
  assert.equal(filterIncognitoWrite('media-codex-collections-v1', '[1]', {}), '[1]', 'explicit user data still saves')
  assert.equal(filterIncognitoWrite('media-codex-privacy-v1', '{}', {}), '{}')
  assert.equal(filterIncognitoWrite('media-codex-theatre-v1', '1', {}), '1')

  const before = storeJson({ recentlyViewed: ['a'], tagPreferences: { x: 1 }, creatorPreferences: { y: 2 }, likeCache: {} })
  const baseline = snapshotStoreHistory(before)
  assert.deepEqual(baseline, { recentlyViewed: ['a'], tagPreferences: { x: 1 }, creatorPreferences: { y: 2 } })

  const during = storeJson({ recentlyViewed: ['z', 'a'], tagPreferences: { x: 9, new: 4 }, creatorPreferences: { y: 5 }, likeCache: { z: true }, theme: 'light' })
  const written = JSON.parse(filterIncognitoWrite(STORE_KEY, during, baseline)!)
  assert.deepEqual(written.state.recentlyViewed, ['a'])
  assert.deepEqual(written.state.tagPreferences, { x: 1 })
  assert.deepEqual(written.state.creatorPreferences, { y: 2 })
  assert.deepEqual(written.state.likeCache, { z: true }, 'likes are explicit actions and persist')
  assert.equal(written.state.theme, 'light')
  assert.equal(written.version, 4)

  // No prior store: history fields fall back to empty, never to the session's values.
  const fresh = JSON.parse(filterIncognitoWrite(STORE_KEY, during, {})!)
  assert.deepEqual(fresh.state.recentlyViewed, [])
  assert.deepEqual(fresh.state.tagPreferences, {})
  // Unparseable or foreign shapes pass through untouched instead of throwing.
  assert.equal(filterIncognitoWrite(STORE_KEY, 'not json', baseline), 'not json')
  assert.equal(filterIncognitoWrite(STORE_KEY, '{"a":1}', baseline), '{"a":1}')
})

test('storage guard: while incognito no history reaches localStorage; clear-everything blocks all writes', () => {
  class GuardStorage extends FakeStorage {}
  const local = new GuardStorage()
  const session = new GuardStorage()
  const g = globalThis as unknown as Record<string, unknown>
  g.Storage = GuardStorage
  g.window = { localStorage: local, sessionStorage: session }

  local.setItem(STORE_KEY, storeJson({ recentlyViewed: ['old'], tagPreferences: {}, creatorPreferences: {} }))
  installStorageGuard()
  assert.equal(isIncognito(), false)

  // Normal mode: everything persists.
  local.setItem('media-codex-progress-v1', '{"a":1}')
  assert.equal(local.getItem('media-codex-progress-v1'), '{"a":1}')
  local.removeItem('media-codex-progress-v1')

  let notified = 0
  const off = subscribeIncognito(() => { notified += 1 })
  setIncognito(true)
  assert.equal(isIncognito(), true)
  assert.equal(notified, 1)
  assert.equal(session.getItem('media-codex-incognito-v1'), '1', 'flag survives a reload within the tab')

  local.setItem('media-codex-progress-v1', '{"a":2}')
  local.setItem('media-codex-taste-v1', '{"profile":1}')
  local.setItem('media-codex-ai-recent-v1', '["secret search"]')
  local.setItem('media-codex-concierge-v1', '[{"role":"user"}]')
  local.setItem(STORE_KEY, storeJson({ recentlyViewed: ['watched-in-incognito', 'old'], tagPreferences: { k: 3 }, creatorPreferences: {}, likeCache: { liked: true } }))
  local.setItem('media-codex-collections-v1', '[{"id":"c"}]')

  for (const key of INCOGNITO_DROP_KEYS) assert.equal(local.getItem(key), null, `${key} must not be written`)
  const store = JSON.parse(local.getItem(STORE_KEY)!)
  assert.deepEqual(store.state.recentlyViewed, ['old'])
  assert.deepEqual(store.state.tagPreferences, {})
  assert.deepEqual(store.state.likeCache, { liked: true })
  assert.equal(local.getItem('media-codex-collections-v1'), '[{"id":"c"}]')

  setIncognito(false)
  assert.equal(isIncognito(), false)
  assert.equal(session.getItem('media-codex-incognito-v1'), null)
  local.setItem('media-codex-progress-v1', '{"a":3}')
  assert.equal(local.getItem('media-codex-progress-v1'), '{"a":3}', 'recording resumes after incognito')

  const storeBefore = local.getItem(STORE_KEY)
  blockAllWrites()
  local.setItem('media-codex-privacy-v1', '{"pin":1}')
  local.setItem(STORE_KEY, 'overwritten')
  local.setItem('unrelated-key', 'still allowed')
  assert.equal(local.getItem('media-codex-privacy-v1'), null, 'nothing re-persists between the wipe and the reload')
  assert.equal(local.getItem(STORE_KEY), storeBefore)
  assert.equal(local.getItem('unrelated-key'), 'still allowed', 'only app keys are blocked')
  off()
})
