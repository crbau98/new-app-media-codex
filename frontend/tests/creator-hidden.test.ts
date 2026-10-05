import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const { default: mediaHandler } = await import('../api/creator-media.ts')
const { fetchHiddenKeys, isHiddenCreator, resetHiddenCache } = await import('../api/_lib/index-client.ts')

const gif = (id: string, userName: string) => ({
  id, userName, description: `clip ${id}`, tags: ['Gay'], duration: 10, width: 1080, height: 1920, likes: 1, views: 1, createDate: 1_790_000_000,
  urls: { hd: `https://media.redgifs.com/${id}.mp4`, poster: `https://media.redgifs.com/${id}-poster.jpg`, thumbnail: `https://media.redgifs.com/${id}-thumb.jpg` },
})

function mockFetch(hidden: string[] | 'fail') {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/creators/index/hidden')) {
      if (hidden === 'fail') return new Response('nope', { status: 500 })
      return Response.json({ keys: hidden })
    }
    if (url.includes('/auth/temporary')) return Response.json({ token: 't' })
    return Response.json({ gifs: [gif('a', 'top_dry')], page: 1, pages: 1, total: 1 })
  }) as typeof fetch
  return () => { globalThis.fetch = original }
}

test('fetchHiddenKeys reads the list, caches it, and soft-fails to the last known set', async () => {
  resetHiddenCache()
  let restore = mockFetch(['redgifs:topdry'])
  try {
    const keys = await fetchHiddenKeys()
    assert.ok(keys.has('redgifs:topdry'))
    assert.equal(isHiddenCreator(keys, { platform: 'Redgifs', username: 'Top_Dry' }), true)
    assert.equal(isHiddenCreator(keys, { platform: 'Redgifs', username: 'someone' }), false)
  } finally { restore() }
  // Cached: a failing backend does not change the answer within the TTL.
  restore = mockFetch('fail')
  try {
    assert.ok((await fetchHiddenKeys()).has('redgifs:topdry'))
  } finally { restore() }
  resetHiddenCache()
  restore = mockFetch('fail')
  try {
    assert.equal((await fetchHiddenKeys()).size, 0)
  } finally { restore(); resetHiddenCache() }
})

test('a creator removed by takedown gets an empty catalog even though the provider has posts', async () => {
  resetHiddenCache()
  let restore = mockFetch(['redgifs:topdry'])
  try {
    const res = await mediaHandler(new Request('https://x.test/api/creator-media?creator=top_dry'))
    const body = await res.json() as { items: unknown[] }
    assert.equal(res.status, 200)
    assert.equal(body.items.length, 0)
  } finally { restore() }
  resetHiddenCache()
  restore = mockFetch([])
  try {
    const res = await mediaHandler(new Request('https://x.test/api/creator-media?creator=top_dry'))
    const body = await res.json() as { items: unknown[] }
    assert.equal(body.items.length, 1)
  } finally { restore(); resetHiddenCache() }
})
