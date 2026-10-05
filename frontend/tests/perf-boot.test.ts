import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { buildDiscoveryRequest } from '../src/lib/perf/discovery-request.ts'
import { HINT_KEY, LAST_SAVE_KEY, heroThumbnail } from '../src/lib/perf/cache.ts'

const SOURCE = readFileSync(new URL('../src/lib/perf/boot.js', import.meta.url), 'utf8')

interface FakeLink { rel?: string; as?: string; href?: string; referrerPolicy?: string; attrs: Record<string, string>; setAttribute(name: string, value: string): void }

function run(options: { storage?: Record<string, string>; path?: string; fetchImpl?: (url: string, init: Record<string, unknown>) => Promise<unknown>; light?: boolean } = {}) {
  const storage = { ...(options.storage ?? {}) }
  const links: FakeLink[] = []
  const attributes: Record<string, string> = {}
  const rootStyle: Record<string, string> = {}
  const fetches: Array<{ url: string; init: Record<string, unknown> }> = []
  const fetchImpl = options.fetchImpl ?? (async () => ({ ok: true, json: async () => ({ items: [] }) }))
  const window: Record<string, unknown> = {
    localStorage: { getItem: (key: string) => (key in storage ? storage[key] : null), setItem() {}, removeItem() {} },
    location: { pathname: options.path ?? '/media' },
    matchMedia: () => ({ matches: Boolean(options.light) }),
    fetch: (url: string, init: Record<string, unknown>) => {
      fetches.push({ url, init })
      return fetchImpl(url, init)
    },
    AbortController,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  }
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value }, style: rootStyle },
    head: { appendChild: (link: FakeLink) => { links.push(link) } },
    createElement: (): FakeLink => ({ attrs: {}, setAttribute(name, value) { this.attrs[name] = value } }),
  }
  const context = vm.createContext({ window, document, Date, JSON, Object, Number, Error, Promise })
  vm.runInContext(SOURCE, context)
  return { window, attributes, rootStyle, links, fetches }
}

const verified = { 'media-codex-adult-verified': '1' }
const store = (state: Record<string, unknown>) => JSON.stringify({ state, version: 4 })

test('theme: persisted preference wins, auto follows the OS, default is dark', () => {
  assert.equal(run({ storage: { 'media-codex-store': store({ theme: 'light' }) } }).attributes['data-theme'], 'light')
  assert.equal(run({ storage: { 'media-codex-store': store({ theme: 'light' }) } }).rootStyle.backgroundColor, '#f9f5ee')
  assert.equal(run({ storage: { 'media-codex-store': store({ theme: 'auto' }) }, light: true }).attributes['data-theme'], 'light')
  assert.equal(run({ storage: { 'media-codex-store': store({ theme: 'auto' }) }, light: false }).attributes['data-theme'], 'dark')
  assert.equal(run().attributes['data-theme'], 'dark')
  assert.equal(run({ storage: { 'media-codex-store': '{broken' } }).rootStyle.backgroundColor, '#0c0912')
})

test('unverified visitors (18+ gate not confirmed) trigger no request and no image preload', () => {
  const hint = JSON.stringify({ v: 1, at: Date.now(), hero: '/api/archiver-proxy?url=x' })
  const { fetches, links, window } = run({ storage: { [HINT_KEY]: hint } })
  assert.equal(fetches.length, 0)
  assert.equal(links.length, 0)
  assert.equal(window.__mcBoot, undefined)
})

test('verified visitor on a feed route starts the anonymous GET and its signature matches the app request', () => {
  const { fetches, window } = run({ storage: verified, path: '/media' })
  assert.equal(fetches.length, 1)
  const expected = buildDiscoveryRequest([])
  assert.equal(fetches[0].url, expected.url)
  assert.equal(fetches[0].init.method, 'GET')
  assert.equal((window.__mcBoot as { sig: string }).sig, expected.sig)
})

test('a personalised radar produces the same POST body and signature as the app', () => {
  const watchlist = ['Atlas Fit', 'orion_cam']
  const { fetches, window } = run({ storage: { ...verified, 'media-codex-store': store({ creatorWatchlist: watchlist }) }, path: '/explore' })
  const expected = buildDiscoveryRequest(watchlist)
  assert.equal(fetches.length, 1)
  assert.equal(fetches[0].init.method, 'POST')
  assert.equal(fetches[0].init.body, expected.body)
  assert.equal(fetches[0].init.cache, 'no-store')
  // the script runs in another realm: compare by value, not by prototype
  assert.deepEqual(JSON.parse(JSON.stringify(fetches[0].init.headers)), expected.headers)
  assert.equal((window.__mcBoot as { sig: string }).sig, expected.sig)
})

test('a malformed radar in storage leaves the request to the app', () => {
  const { fetches } = run({ storage: { ...verified, 'media-codex-store': store({ creatorWatchlist: ['ok', 42] }) } })
  assert.equal(fetches.length, 0)
})

test('routes that do not read the feed (settings, 404) start nothing', () => {
  assert.equal(run({ storage: verified, path: '/settings' }).fetches.length, 0)
  assert.equal(run({ storage: verified, path: '/nope' }).fetches.length, 0)
})

test('a fresh persisted copy (< 5 min) skips the redundant early request', () => {
  assert.equal(run({ storage: { ...verified, [LAST_SAVE_KEY]: String(Date.now() - 60_000) } }).fetches.length, 0)
  assert.equal(run({ storage: { ...verified, [LAST_SAVE_KEY]: String(Date.now() - 10 * 60_000) } }).fetches.length, 1)
})

test('the persisted hint preloads the hero poster on Home only, with the same attributes as the <img>', () => {
  const hero = '/api/archiver-proxy?url=https%3A%2F%2Fthumbs44.redgifs.com%2Fa.jpg'
  const hint = JSON.stringify({ v: 1, at: Date.now() - 1000, hero })
  const home = run({ storage: { ...verified, [HINT_KEY]: hint }, path: '/media' })
  assert.equal(home.links.length, 1)
  assert.equal(home.links[0].rel, 'preload')
  assert.equal(home.links[0].as, 'image')
  assert.equal(home.links[0].href, hero)
  assert.equal(home.links[0].attrs.fetchpriority, 'high')
  assert.equal(home.links[0].referrerPolicy, 'no-referrer')
  assert.equal(run({ storage: { ...verified, [HINT_KEY]: hint }, path: '/explore' }).links.length, 0)
  const expired = JSON.stringify({ v: 1, at: Date.now() - 7 * 3600_000, hero })
  assert.equal(run({ storage: { ...verified, [HINT_KEY]: expired }, path: '/media' }).links.length, 0)
  const unsafe = JSON.stringify({ v: 1, at: Date.now(), hero: 'http://insecure.example/x.jpg' })
  assert.equal(run({ storage: { ...verified, [HINT_KEY]: unsafe }, path: '/media' }).links.length, 0)
})

test('when the response arrives the boot script preloads the same hero the app will pick', async () => {
  const items = [
    { id: 'a', thumbnail: '/api/archiver-proxy?url=a', curationScore: 40 },
    { id: 'b', thumbnail: '/api/archiver-proxy?url=b', curationScore: 88 },
    { id: 'c', thumbnail: '/api/archiver-proxy?url=c', curationScore: 88 },
  ]
  const { window, links } = run({ storage: verified, fetchImpl: async () => ({ ok: true, json: async () => ({ items }) }) })
  const payload = await (window.__mcBoot as { p: Promise<unknown> }).p
  assert.deepEqual(payload, { items })
  assert.equal(links.length, 1)
  assert.equal(links[0].href, heroThumbnail({ items }))
  assert.equal(links[0].href, '/api/archiver-proxy?url=b')
})

test('a hint that already matches the response is not preloaded twice', async () => {
  const items = [{ id: 'b', thumbnail: '/api/archiver-proxy?url=b', curationScore: 88 }]
  const hint = JSON.stringify({ v: 1, at: Date.now(), hero: '/api/archiver-proxy?url=b' })
  const { window, links } = run({ storage: { ...verified, [HINT_KEY]: hint }, fetchImpl: async () => ({ ok: true, json: async () => ({ items }) }) })
  await (window.__mcBoot as { p: Promise<unknown> }).p
  assert.equal(links.length, 1)
})

test('network failure is swallowed by the boot script but still observable by the app', async () => {
  const { window } = run({ storage: verified, fetchImpl: async () => { throw new Error('offline') } })
  await assert.rejects((window.__mcBoot as { p: Promise<unknown> }).p, /offline/)
  const failing = run({ storage: verified, fetchImpl: async () => ({ ok: false, status: 502, json: async () => ({}) }) })
  await assert.rejects((failing.window.__mcBoot as { p: Promise<unknown> }).p, /feed 502/)
})

test('the script never throws when storage is unavailable', () => {
  const window: Record<string, unknown> = {
    get localStorage() { throw new Error('blocked') },
    location: { pathname: '/media' },
    matchMedia: () => ({ matches: false }),
  }
  const attributes: Record<string, string> = {}
  const document = { documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value }, style: {} }, head: { appendChild() {} }, createElement: () => ({}) }
  vm.runInContext(SOURCE, vm.createContext({ window, document, Date, JSON, Object, Number, Error, Promise }))
  assert.equal(attributes['data-theme'], 'dark')
})
