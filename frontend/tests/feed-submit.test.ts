import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const lib = await import('../api/_lib/creator-feeds-client.ts')
const { default: handler } = await import('../api/feed-submit.ts')

const ORIGIN = 'https://codex-research-radar.onrender.com'
let ipCounter = 0
const freshIp = () => `203.0.113.${(ipCounter += 1)}`

type Call = { url: string; method?: string; headers: Record<string, string>; body?: string }

function mockBackend(respond: (call: Call) => Response | Promise<Response> | 'hang' = () => Response.json({ id: 1, status: 'pending' }, { status: 201 })) {
  const original = globalThis.fetch
  const calls: Call[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    const call: Call = { url: String(input), method: init?.method, headers, body: typeof init?.body === 'string' ? init.body : undefined }
    calls.push(call)
    const out = await respond(call)
    if (out === 'hang') {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    }
    return out
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = original } }
}

const post = (body: unknown, headers: Record<string, string> = {}) => handler(new Request('https://x.test/api/feed-submit', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-real-ip': freshIp(), ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}))

/* ── validation helpers ── */

test('validateFeedSubmission accepts feeds and handles and rejects everything malformed', () => {
  const ok = lib.validateFeedSubmission({ url: ' https://bearstudio.example/feed.xml ', name: 'Bear Studio', email: 'owner@example.com' })
  assert.deepEqual(ok, { ok: true, value: { url: 'https://bearstudio.example/feed.xml', name: 'Bear Studio', email: 'owner@example.com' } })
  assert.deepEqual(lib.validateFeedSubmission({ handle: 'bear.bsky.social', kind: 'bluesky' }), { ok: true, value: { handle: 'bear.bsky.social', kind: 'bluesky' } })
  assert.equal(lib.validateFeedSubmission({ handle: 'fur@masto.example', kind: 'mastodon' }).ok, true)

  const bad: Array<[unknown, string]> = [
    [null, ''], [[], ''], ['x', ''],
    [{}, 'url'],
    [{ url: 'http://bearstudio.example/feed.xml' }, 'url'],
    [{ url: 'ftp://bearstudio.example/feed.xml' }, 'url'],
    [{ url: 'https://user:pw@bearstudio.example/feed.xml' }, 'url'],
    [{ url: 'https://127.0.0.1/feed.xml' }, 'url'],
    [{ url: 'https://[::1]/feed.xml' }, 'url'],
    [{ url: 'https://8.8.8.8/feed.xml' }, 'url'],
    [{ url: 'https://localhost/feed.xml' }, 'url'],
    [{ url: 'https://bearstudio.example:8443/feed.xml' }, 'url'],
    [{ url: 'https://bearstudio.example/a b' }, 'url'],
    [{ url: `https://bearstudio.example/${'a'.repeat(600)}` }, 'url'],
    [{ url: 'not a url' }, 'url'],
    [{ handle: 'someone.bsky.social' }, 'kind'],
    [{ handle: 'someone.bsky.social', kind: 'rss' }, 'kind'],
    [{ url: 'https://a.example/f', kind: 'carrier-pigeon' }, 'kind'],
    [{ url: 'https://a.example/f', email: 'nope' }, 'email'],
    [{ url: 'https://a.example/f', name: 'n'.repeat(81) }, 'name'],
    [{ url: 'https://a.example/f', extra: 1 }, 'extra'],
    [{ url: 5 }, 'url'],
  ]
  for (const [input, field] of bad) {
    const result = lib.validateFeedSubmission(input)
    assert.equal(result.ok, false, JSON.stringify(input))
    if (!result.ok) assert.ok(result.issues.some((issue: { field: string }) => issue.field === field), `${JSON.stringify(input)} -> ${field}`)
  }
})

test('validateTakedown requires a target, a reason and a contact e-mail', () => {
  const ok = lib.validateTakedown({ platform: 'redgifs', handle: 'alpha', reason: 'my content', email: 'me@example.com' })
  assert.deepEqual(ok, { ok: true, value: { reason: 'my content', email: 'me@example.com', platform: 'redgifs', handle: 'alpha' } })
  assert.equal(lib.validateTakedown({ url: 'https://www.redgifs.com/users/alpha', reason: 'mine', email: 'me@example.com' }).ok, true)
  for (const input of [
    { reason: 'mine', email: 'me@example.com' },
    { platform: 'redgifs', reason: 'mine', email: 'me@example.com' },
    { platform: 'redgifs', handle: 'alpha', email: 'me@example.com' },
    { platform: 'redgifs', handle: 'alpha', reason: 'x', email: 'me@example.com' },
    { platform: 'redgifs', handle: 'alpha', reason: 'mine' },
    { platform: 'redgifs', handle: 'alpha', reason: 'mine', email: 'bad' },
    { url: 'http://www.redgifs.com/users/alpha', reason: 'mine', email: 'me@example.com' },
    { url: 'https://www.redgifs.com/users/alpha', reason: 'mine', email: 'me@example.com', admin: true },
    { url: 'https://www.redgifs.com/users/alpha', reason: 'r'.repeat(501), email: 'me@example.com' },
  ]) assert.equal(lib.validateTakedown(input).ok, false, JSON.stringify(input))
})

/* ── client calls ── */

test('submitFeed posts validated JSON to the backend with the visitor address and parses the answer', async () => {
  const { calls, restore } = mockBackend(() => Response.json({ id: 7, status: 'pending', kind: 'rss', displayName: 'Bear Studio', itemCount: 3 }, { status: 201 }))
  try {
    const result = await lib.submitFeed({ url: 'https://bearstudio.example/feed.xml', email: 'owner@example.com' }, { clientIp: '198.51.100.7' })
    assert.equal(result.ok, true)
    assert.equal(result.status, 201)
    assert.equal(result.data!.id, 7)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${ORIGIN}/api/v1/creators/feeds/submit`)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].headers['content-type'], 'application/json')
    assert.equal(calls[0].headers['x-client-ip'], '198.51.100.7')
    assert.equal(calls[0].headers['x-admin-token'], undefined)
    assert.deepEqual(JSON.parse(calls[0].body!), { url: 'https://bearstudio.example/feed.xml', email: 'owner@example.com' })
  } finally { restore() }
})

test('submitTakedown hits the takedown path; invalid input never reaches the network', async () => {
  const { calls, restore } = mockBackend(() => Response.json({ id: 2, status: 'hidden', matchedCreators: 1 }, { status: 201 }))
  try {
    const bad = await lib.submitTakedown({ reason: 'mine' })
    assert.equal(bad.ok, false)
    assert.equal(bad.status, 422)
    assert.equal(bad.error!.code, 'validation_error')
    assert.ok(bad.error!.errors!.length >= 2)
    assert.equal(calls.length, 0)
    const good = await lib.submitTakedown({ platform: 'redgifs', handle: 'alpha', reason: 'my account', email: 'me@example.com' })
    assert.equal(good.ok, true)
    assert.equal(calls[0].url, `${ORIGIN}/api/v1/creators/takedown`)
  } finally { restore() }
})

test('client maps backend errors, rate limits, junk and outages without throwing', async () => {
  const valid = { url: 'https://bearstudio.example/feed.xml' }
  const cases: Array<[() => Response, (r: Awaited<ReturnType<typeof lib.submitFeed>>) => void]> = [
    [() => Response.json({ detail: { code: 'login_required', message: 'behind a login' } }, { status: 422 }),
      (r) => { assert.equal(r.status, 422); assert.equal(r.error!.code, 'login_required'); assert.equal(r.error!.message, 'behind a login') }],
    [() => Response.json({ detail: { code: 'rate_limited', message: 'slow down' } }, { status: 429, headers: { 'Retry-After': '120' } }),
      (r) => { assert.equal(r.status, 429); assert.equal(r.retryAfter, 120); assert.equal(r.error!.code, 'rate_limited') }],
    [() => Response.json({ detail: { code: 'validation_error', message: 'Invalid payload.', errors: [{ field: 'url', message: 'bad' }] } }, { status: 422 }),
      (r) => { assert.deepEqual(r.error!.errors, [{ field: 'url', message: 'bad' }]) }],
    [() => new Response('<html>boom</html>', { status: 500 }), (r) => { assert.equal(r.status, 500); assert.equal(r.error!.code, 'http_500') }],
    [() => new Response('not json', { status: 200 }), (r) => { assert.equal(r.ok, false); assert.equal(r.error!.code, 'bad_backend_response') }],
    [() => Response.json(['array'], { status: 200 }), (r) => { assert.equal(r.ok, false) }],
  ]
  for (const [respond, check] of cases) {
    const { restore } = mockBackend(respond)
    try { check(await lib.submitFeed(valid)) } finally { restore() }
  }
  const original = globalThis.fetch
  globalThis.fetch = (async () => { throw new TypeError('network down') }) as typeof fetch
  try {
    const down = await lib.submitFeed(valid)
    assert.equal(down.ok, false)
    assert.equal(down.status, 502)
    assert.equal(down.error!.code, 'backend_unavailable')
  } finally { globalThis.fetch = original }
  const { restore } = mockBackend(() => 'hang')
  const started = Date.now()
  try {
    const slow = await lib.submitFeed(valid, { timeoutMs: 40 })
    assert.equal(slow.status, 502)
    assert.ok(Date.now() - started < 1_000, 'times out')
  } finally { restore() }
})

test('client only talks to an https backend origin', async () => {
  const previous = process.env.RENDER_BACKEND_ORIGIN
  const { calls, restore } = mockBackend()
  try {
    process.env.RENDER_BACKEND_ORIGIN = 'http://insecure.example'
    await lib.submitFeed({ url: 'https://bearstudio.example/feed.xml' })
    assert.ok(calls[0].url.startsWith(ORIGIN))
    process.env.RENDER_BACKEND_ORIGIN = 'https://backend.example/ignored'
    await lib.submitFeed({ url: 'https://bearstudio.example/feed.xml' })
    assert.ok(calls[1].url.startsWith('https://backend.example/api/v1/creators/feeds/submit'))
  } finally {
    restore()
    if (previous === undefined) delete process.env.RENDER_BACKEND_ORIGIN
    else process.env.RENDER_BACKEND_ORIGIN = previous
  }
})

/* ── /api/feed-submit edge function ── */

test('feed-submit forwards a valid submission with the visitor address and returns the backend answer', async () => {
  const { calls, restore } = mockBackend(() => Response.json({ id: 3, status: 'pending', duplicate: false }, { status: 201 }))
  try {
    const res = await post({ url: 'https://bearstudio.example/feed.xml', email: 'owner@example.com' }, { 'x-real-ip': '198.51.100.20', 'x-admin-token': 'should-not-travel' })
    assert.equal(res.status, 201)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), { id: 3, status: 'pending', duplicate: false })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${ORIGIN}/api/v1/creators/feeds/submit`)
    assert.equal(calls[0].headers['x-client-ip'], '198.51.100.20')
    assert.equal(calls[0].headers['x-admin-token'], undefined)
  } finally { restore() }
})

test('feed-submit routes action=takedown to the takedown endpoint and falls back to the last X-Forwarded-For hop', async () => {
  const { calls, restore } = mockBackend(() => Response.json({ id: 4, status: 'hidden', matchedCreators: 1, matchedItems: 0 }, { status: 201 }))
  try {
    const res = await handler(new Request('https://x.test/api/feed-submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-forwarded-for': '10.0.0.1, 198.51.100.21' },
      body: JSON.stringify({ action: 'takedown', platform: 'redgifs', handle: 'alpha', reason: 'my account', email: 'me@example.com' }),
    }))
    assert.equal(res.status, 201)
    assert.equal(((await res.json()) as { status: string }).status, 'hidden')
    assert.equal(calls[0].url, `${ORIGIN}/api/v1/creators/takedown`)
    assert.equal(calls[0].headers['x-client-ip'], '198.51.100.21')
    assert.deepEqual(JSON.parse(calls[0].body!), { reason: 'my account', email: 'me@example.com', platform: 'redgifs', handle: 'alpha' })
  } finally { restore() }
})

test('feed-submit validates before calling the backend and returns field errors', async () => {
  const { calls, restore } = mockBackend()
  try {
    for (const body of [{}, { url: 'http://x.example/f' }, { url: 'https://127.0.0.1/f' }, { url: 'https://a.example/f', kind: 'nope' }, { action: 'takedown', reason: 'mine' }]) {
      const res = await post(body)
      assert.equal(res.status, 422, JSON.stringify(body))
      const json = await res.json() as { error: { code: string; errors: Array<{ field: string }> } }
      assert.equal(json.error.code, 'validation_error')
      assert.ok(json.error.errors.length > 0)
    }
    assert.equal((await post({ action: 'admin', url: 'https://a.example/f' })).status, 422)
    assert.equal((await post([])).status, 422)
    assert.equal((await post('{nope')).status, 400)
    assert.equal(calls.length, 0, 'nothing invalid reaches the backend')
  } finally { restore() }
})

test('feed-submit enforces method, content type and the 8 KB body cap', async () => {
  const { calls, restore } = mockBackend()
  try {
    const get = await handler(new Request('https://x.test/api/feed-submit'))
    assert.equal(get.status, 405)
    assert.equal(get.headers.get('allow'), 'POST, OPTIONS')
    assert.equal((await handler(new Request('https://x.test/api/feed-submit', { method: 'OPTIONS' }))).status, 204)
    const wrongType = await handler(new Request('https://x.test/api/feed-submit', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }))
    assert.equal(wrongType.status, 415)
    const big = await post(JSON.stringify({ url: `https://a.example/${'a'.repeat(9000)}` }))
    assert.equal(big.status, 413)
    const chunked = await handler(new Request('https://x.test/api/feed-submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new ReadableStream({ start(controller) { for (let i = 0; i < 10; i += 1) controller.enqueue(new Uint8Array(1024).fill(32)); controller.close() } }),
      duplex: 'half',  // streamed request bodies need `duplex` in Node
    } as RequestInit & { duplex: 'half' }))
    assert.equal(chunked.status, 413)
    assert.equal(calls.length, 0)
  } finally { restore() }
})

test('feed-submit answers a filled honeypot with a silent 202 and sends nothing', async () => {
  const { calls, restore } = mockBackend()
  try {
    const feed = await post({ url: 'https://bearstudio.example/feed.xml', website: 'http://spam.example' })
    assert.equal(feed.status, 202)
    assert.deepEqual(await feed.json(), { accepted: true, status: 'pending' })
    const takedown = await post({ action: 'takedown', platform: 'redgifs', handle: 'a', reason: 'mine', email: 'me@example.com', website: 'x' })
    assert.equal(takedown.status, 202)
    assert.equal(calls.length, 0)
  } finally { restore() }
})

test('feed-submit passes backend rate limits and outages through with Retry-After', async () => {
  let mode: 'limit' | 'down' = 'limit'
  const { restore } = mockBackend(() => mode === 'limit'
    ? Response.json({ detail: { code: 'rate_limited', message: 'slow down' } }, { status: 429, headers: { 'Retry-After': '90' } })
    : new Response('', { status: 503 }))
  try {
    const limited = await post({ url: 'https://bearstudio.example/feed.xml' })
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '90')
    assert.equal(((await limited.json()) as { error: { code: string } }).error.code, 'rate_limited')
    mode = 'down'
    const down = await post({ url: 'https://bearstudio.example/feed.xml' })
    assert.equal(down.status, 503)
  } finally { restore() }
})

test('feed-submit has its own per-visitor bucket in front of the backend', async () => {
  const { calls, restore } = mockBackend()
  try {
    const ip = '198.51.100.99'
    const statuses: number[] = []
    for (let i = 0; i < 12; i += 1) statuses.push((await post({ url: `https://bearstudio.example/feed-${i}.xml` }, { 'x-real-ip': ip })).status)
    assert.equal(statuses.filter((s) => s === 201).length, 10)
    assert.deepEqual(statuses.slice(10), [429, 429])
    assert.equal(calls.length, 10)
    assert.equal((await post({ url: 'https://bearstudio.example/other.xml' }, { 'x-real-ip': '198.51.100.100' })).status, 201)
  } finally { restore() }
})

test('feed-submit sends the shared secret with the visitor address when configured', async () => {
  const previous = process.env.GATEWAY_CLIENT_IP_SECRET
  const { calls, restore } = mockBackend()
  try {
    process.env.GATEWAY_CLIENT_IP_SECRET = 's3cret'
    await post({ url: 'https://bearstudio.example/feed.xml' }, { 'x-real-ip': '198.51.100.55' })
    assert.equal(calls[0].headers['x-gateway-secret'], 's3cret')
    assert.equal(calls[0].headers['x-client-ip'], '198.51.100.55')
    delete process.env.GATEWAY_CLIENT_IP_SECRET
    await post({ url: 'https://bearstudio.example/feed2.xml' }, { 'x-real-ip': '198.51.100.56' })
    assert.equal(calls[1].headers['x-gateway-secret'], undefined)
  } finally {
    restore()
    if (previous === undefined) delete process.env.GATEWAY_CLIENT_IP_SECRET
    else process.env.GATEWAY_CLIENT_IP_SECRET = previous
  }
})
