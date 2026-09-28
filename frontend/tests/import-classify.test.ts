import assert from 'node:assert/strict'
import test from 'node:test'

import { register } from 'node:module'

register('./ts-resolve-hook.mjs', import.meta.url)
const { canonicalizeUrl, classifyUrl, ClassifyError, extractHtml, parseDash, parseHls, parseIsoDuration, sniffBytes } = await import('../api/_lib/import-classify.ts')
const { assertPublicHttpUrl, isPrivateHost } = await import('../api/_lib/net-safe.ts')
type Fetcher = import('../api/_lib/import-classify.ts').Fetcher

const enc = (s: string) => new TextEncoder().encode(s)
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

function fake(routes: Record<string, [number, Uint8Array | string]>): Fetcher {
  return async (url) => {
    const hit = routes[url]
    if (!hit) throw new Error('connect_failed')
    const body = typeof hit[1] === 'string' ? enc(hit[1]) : hit[1]
    return { url, status: hit[0], headers: new Headers(), body, truncated: false }
  }
}

test('private hosts and numeric IP tricks are blocked', () => {
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '169.254.169.254', '2130706433', '0x7f.1', '[::1]', '[::ffff:127.0.0.1]', 'a.internal', '192.168.1.1', '100.64.0.1']) {
    assert.equal(isPrivateHost(h), true, h)
  }
  assert.equal(isPrivateHost('example.com'), false)
  assert.throws(() => assertPublicHttpUrl('http://user:pw@example.com/'), /credentials/)
  assert.throws(() => assertPublicHttpUrl('ftp://example.com/'), /unsupported_protocol/)
  assert.throws(() => assertPublicHttpUrl('https://example.com:22/'), /port_not_allowed/)
})

test('sniffBytes uses magic bytes, not extensions', () => {
  assert.equal(sniffBytes(PNG).mime, 'image/png')
  assert.equal(sniffBytes(MP4).mime, 'video/mp4')
  assert.equal(sniffBytes(enc('#EXTM3U\n')).kind, 'hls')
  assert.equal(sniffBytes(enc('<!doctype html><html>')).kind, 'html')
  assert.equal(sniffBytes(enc('random text here')).kind, 'unknown')
})

test('canonicalizeUrl strips tracking and unifies hosts', () => {
  assert.equal(canonicalizeUrl('https://www.Example.com/a/?utm_source=x&fbclid=1&q=2#f'), 'https://example.com/a?q=2')
  assert.equal(canonicalizeUrl('https://twitter.com/u/status/1?s=20'), 'https://x.com/u/status/1')
  assert.equal(canonicalizeUrl('https://youtu.be/abc?si=z'), 'https://youtube.com/watch?v=abc')
  assert.equal(canonicalizeUrl('https://www.redgifs.com/ifr/Name?x=1'), 'https://redgifs.com/watch/name')
})

test('manifest parsing: DRM, ladder, duration', () => {
  assert.equal(parseHls('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x",KEYFORMAT="com.apple.streamingkeydelivery"\n#EXTINF:4,\na.ts\n', 'https://x/y.m3u8').protected, true)
  const info = parseHls('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\na\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160\nb\n', 'https://x/y.m3u8')
  assert.equal(info.bestHeight, 720)
  assert.equal(parseHls('#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:2.5,\nb.ts\n#EXT-X-ENDLIST\n', 'x').durationSeconds, 6.5)
  assert.equal(parseDash('<MPD mediaPresentationDuration="PT1M30S"><ContentProtection schemeIdUri="urn:uuid:edef8ba9"/></MPD>').protected, true)
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723)
})

const HTML = `<!doctype html><html><head><title>T</title>
<meta property="og:title" content="Nice &amp; clip"><meta property="og:video:secure_url" content="/m/clip.mp4"><meta property="og:video:type" content="video/mp4">
<meta property="og:video" content="https://example.com/embed/9"><meta property="og:image" content="/m/p.png"><meta property="video:duration" content="95">
<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://example.com/m/alt.webm","duration":"PT1M35S"}</script>
</head><body><video><source src="/m/dead.mp4" type="video/mp4"></video></body></html>`

test('extractHtml finds og/json-ld/video candidates and embeds', () => {
  const m = extractHtml(HTML, 'https://example.com/watch/9')
  assert.equal(m.title, 'Nice & clip')
  assert.ok(m.candidates.some((c) => c.url === 'https://example.com/m/clip.mp4' && c.kind === 'video'))
  assert.deepEqual(m.embedUrls, ['https://example.com/embed/9'])
  assert.equal(m.durationSeconds, 95)
})

test('classifyUrl on html ranks mp4 first, prunes dead candidates', async () => {
  const f = fake({
    'https://example.com/watch/9': [200, HTML],
    'https://example.com/m/clip.mp4': [206, MP4],
    'https://example.com/m/alt.webm': [200, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 0, 0, 0])],
    'https://example.com/m/p.png': [200, PNG],
    'https://example.com/m/dead.mp4': [404, 'x'],
  })
  const out = await classifyUrl('https://example.com/watch/9', f)
  assert.equal(out.kind, 'video')
  assert.equal(out.streamCandidates[0], 'https://example.com/m/clip.mp4')
  assert.ok(!out.streamCandidates.includes('https://example.com/m/dead.mp4'))
  assert.equal(out.thumbnailUrl, 'https://example.com/m/p.png')
  assert.equal(out.playable, true)
})

test('classifyUrl direct image with wrong content type, feeds, errors', async () => {
  const img = await classifyUrl('https://cdn.example.com/a.jpg', fake({ 'https://cdn.example.com/a.jpg': [200, PNG] }))
  assert.equal(img.kind, 'image')
  const feed = await classifyUrl('https://example.com/f.xml', fake({ 'https://example.com/f.xml': [200, '<?xml version="1.0"?><rss><channel><title>F</title><item><title>One</title><link>https://example.com/1</link><enclosure url="https://example.com/1.mp4" type="video/mp4"/></item></channel></rss>'] }))
  assert.equal(feed.kind, 'feed')
  assert.equal(feed.feedItems[0].kind, 'video')
  await assert.rejects(classifyUrl('http://127.0.0.1/x', fake({})), (e: unknown) => e instanceof ClassifyError && e.code === 'private_host_blocked')
  await assert.rejects(classifyUrl('https://example.com/g', fake({ 'https://example.com/g': [404, 'x'] })), (e: unknown) => e instanceof ClassifyError && e.code === 'not_found')
})
