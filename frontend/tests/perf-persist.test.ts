import assert from 'node:assert/strict'
import test from 'node:test'

import { HINT_KEY, LAST_SAVE_KEY, STORAGE_PREFIX, serializeEntry, storageKeyFor } from '../src/lib/perf/cache.ts'
import { clearQueryCache, restoreDiscoveryCache, startQueryPersistence } from '../src/lib/perf/persist.ts'

type Listener = (event: unknown) => void

class FakeStorage {
  data = new Map<string, string>()
  failWrites = false
  get length() { return this.data.size }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  getItem(key: string) { return this.data.has(key) ? (this.data.get(key) as string) : null }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('QuotaExceededError')
    this.data.set(key, value)
  }
  removeItem(key: string) { this.data.delete(key) }
}

function fakeClient() {
  const cache = new Map<string, { data: unknown; updatedAt?: number }>()
  const listeners: Listener[] = []
  const client = {
    getQueryData: (key: readonly unknown[]) => cache.get(JSON.stringify(key))?.data,
    setQueryData: (key: readonly unknown[], data: unknown, options?: { updatedAt?: number }) => { cache.set(JSON.stringify(key), { data, updatedAt: options?.updatedAt }) },
    getQueryCache: () => ({ subscribe: (listener: Listener) => { listeners.push(listener); return () => { listeners.splice(listeners.indexOf(listener), 1) } } }),
    clear: () => cache.clear(),
  }
  return { client, cache, listeners }
}

function install(storage: FakeStorage) {
  const timers: Array<() => void> = []
  ;(globalThis as Record<string, unknown>).window = {
    localStorage: storage,
    // Run scheduled work synchronously so the test can assert right after the event.
    setTimeout: (fn: () => void) => { timers.push(fn); fn(); return timers.length },
    clearTimeout: () => undefined,
  }
  delete (globalThis as Record<string, unknown>).requestIdleCallback
  return () => { delete (globalThis as Record<string, unknown>).window }
}

const payload = () => ({
  items: [{ id: 'a', title: 'A', thumbnail: '/api/archiver-proxy?url=a', curationScore: 80 }],
  performers: [{ id: 'creator-1', name: 'Someone Else', media: [{ id: 'm1' }, { id: 'm2' }] }],
  updatedAt: '2026-10-05T00:00:00.000Z',
  watchlist: { requested: ['x'], matched: ['x'] },
})

test('restore hydrates the feed with the save time as updatedAt', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    const key = ['live-discovery', ['x']] as const
    const savedAt = Date.now() - 60_000
    storage.setItem(storageKeyFor(key), serializeEntry(key, payload(), savedAt) as string)
    const { client, cache } = fakeClient()
    assert.equal(restoreDiscoveryCache(client as never, ['x']), true)
    const entry = cache.get(JSON.stringify(key))
    assert.ok(entry)
    assert.equal(entry.updatedAt, savedAt)
    assert.equal((entry.data as ReturnType<typeof payload>).items.length, 1)
  } finally {
    restoreWindow()
  }
})

test('restore ignores expired entries, other radars and corrupt storage', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    const key = ['live-discovery', ['x']] as const
    storage.setItem(storageKeyFor(key), serializeEntry(key, payload(), Date.now() - 7 * 3600_000) as string)
    const { client } = fakeClient()
    assert.equal(restoreDiscoveryCache(client as never, ['x']), false)
    assert.equal(restoreDiscoveryCache(client as never, ['someone-else']), false)
    storage.setItem(storageKeyFor(key), '{corrupt')
    assert.equal(restoreDiscoveryCache(client as never, ['x']), false)
  } finally {
    restoreWindow()
  }
})

test('restore never overwrites data that is already in memory', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    const key = ['live-discovery', []] as const
    storage.setItem(storageKeyFor(key), serializeEntry(key, payload(), Date.now()) as string)
    const { client, cache } = fakeClient()
    client.setQueryData(key, { items: ['fresh'] })
    restoreDiscoveryCache(client as never, [])
    assert.deepEqual(cache.get(JSON.stringify(key))?.data, { items: ['fresh'] })
  } finally {
    restoreWindow()
  }
})

test('restore survives storage that throws', () => {
  const restoreWindow = install({ getItem() { throw new Error('blocked') } } as unknown as FakeStorage)
  try {
    assert.equal(restoreDiscoveryCache(fakeClient().client as never, []), false)
  } finally {
    restoreWindow()
  }
})

test('persistence writes feed updates (metadata only, radar blanked) and a hero hint', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    const { client, listeners } = fakeClient()
    const stop = startQueryPersistence(client as never)
    const key = ['live-discovery', ['x']] as const
    client.setQueryData(key, payload())
    listeners[0]({ type: 'updated', action: { type: 'success' }, query: { queryKey: key } })
    const stored = storage.getItem(storageKeyFor(key))
    assert.ok(stored)
    assert.ok(storage.getItem(LAST_SAVE_KEY))
    const hint = JSON.parse(storage.getItem(HINT_KEY) as string)
    assert.equal(hint.hero, '/api/archiver-proxy?url=a')
    const parsed = JSON.parse(stored)
    assert.deepEqual(parsed.data.watchlist, { requested: [], matched: [] })
    assert.equal(parsed.data.performers[0].media.length, 1)
    // the user's radar is not written anywhere in the persisted copy
    assert.equal(stored.includes('"x"'), false)
    stop()
  } finally {
    restoreWindow()
  }
})

test('persistence ignores queries outside the feed family and non-success events', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    const { client, listeners } = fakeClient()
    startQueryPersistence(client as never)
    const search = ['search-media', 'private words', []] as const
    client.setQueryData(search, payload())
    listeners[0]({ type: 'updated', action: { type: 'success' }, query: { queryKey: search } })
    listeners[0]({ type: 'updated', action: { type: 'fetch' }, query: { queryKey: ['live-discovery', []] } })
    listeners[0]({ type: 'added', query: { queryKey: ['live-discovery', []] } })
    assert.equal(storage.length, 0)
  } finally {
    restoreWindow()
  }
})

test('a full or blocked storage drops our own entries and never throws', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    storage.setItem('media-codex-store', '{"state":{}}')
    storage.setItem(`${STORAGE_PREFIX}stale`, 'x')
    storage.failWrites = true
    const { client, listeners } = fakeClient()
    startQueryPersistence(client as never)
    const key = ['live-discovery', []] as const
    client.setQueryData(key, payload())
    listeners[0]({ type: 'updated', action: { type: 'success' }, query: { queryKey: key } })
    assert.equal(storage.getItem(`${STORAGE_PREFIX}stale`), null)
    assert.equal(storage.getItem('media-codex-store'), '{"state":{}}')
  } finally {
    restoreWindow()
  }
})

test('clearQueryCache removes every persisted copy and nothing else', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    storage.setItem('media-codex-store', '{"state":{"likeCache":{"a":true}}}')
    storage.setItem('media-codex-adult-verified', '1')
    storage.setItem(`${STORAGE_PREFIX}abc12345`, '{}')
    storage.setItem(LAST_SAVE_KEY, '1')
    storage.setItem(HINT_KEY, '{}')
    storage.setItem('mc.qc.v0:legacy', '{}')
    clearQueryCache()
    assert.deepEqual([...storage.data.keys()].sort(), ['media-codex-adult-verified', 'media-codex-store'])
  } finally {
    restoreWindow()
  }
})

test('clearQueryCache can also drop the in-memory queries', () => {
  const storage = new FakeStorage()
  const restoreWindow = install(storage)
  try {
    const { client, cache } = fakeClient()
    startQueryPersistence(client as never)
    client.setQueryData(['live-discovery', []], payload())
    clearQueryCache({ memory: true })
    assert.equal(cache.size, 0)
  } finally {
    restoreWindow()
  }
})
