import assert from 'node:assert/strict'
import test from 'node:test'

import { rewriteHlsManifest, looksLikeHlsManifest } from '../api/_lib/hls.ts'
import { unsatisfiedRangeHeader } from '../api/_lib/range.ts'
import {
  allowedProxyHost,
  cacheHeadersFor,
  classifyProxyResponse,
  conditionalHeaders,
  relayHeaders,
  resolveContentType,
  safeProxyTarget,
  totalFromContentRange,
} from '../api/_lib/proxy-utils.ts'

test('allowlist accepts only RedGifs media CDNs', () => {
  assert.equal(allowedProxyHost('media.redgifs.com'), true)
  assert.equal(allowedProxyHost('thumbs2.redgifs.com'), true)
  assert.equal(allowedProxyHost('MEDIA.REDGIFS.COM'), true)
  assert.equal(allowedProxyHost('redgifs.com.evil.test'), false)
  assert.equal(allowedProxyHost('evilredgifs.com'), false)
  assert.equal(allowedProxyHost('api.redgifs.com'), false)
  assert.equal(allowedProxyHost('localhost'), false)
})

test('safe target enforces https, no credentials, no odd ports, allowlisted host', () => {
  assert.ok(safeProxyTarget('https://media.redgifs.com/a.mp4'))
  assert.equal(safeProxyTarget('http://media.redgifs.com/a.mp4'), null)
  assert.equal(safeProxyTarget('https://user:pw@media.redgifs.com/a.mp4'), null)
  assert.equal(safeProxyTarget('https://media.redgifs.com:8443/a.mp4'), null)
  assert.equal(safeProxyTarget('https://media.redgifs.com/a.mp4#x'), null)
  assert.equal(safeProxyTarget('https://169.254.169.254/latest'), null)
  assert.equal(safeProxyTarget('https://media.redgifs.com@evil.test/'), null)
  assert.equal(safeProxyTarget('not a url'), null)
})

test('octet-stream responses regain a media type from the extension', () => {
  assert.equal(resolveContentType('application/octet-stream', '/x/clip.mp4'), 'video/mp4')
  assert.equal(resolveContentType('binary/octet-stream', '/x/clip.WEBM'), 'video/webm')
  assert.equal(resolveContentType('', '/x/clip.mov'), 'video/quicktime')
  assert.equal(resolveContentType('application/octet-stream', '/x/p.jpg'), 'image/jpeg')
  assert.equal(resolveContentType('application/octet-stream', '/x/p.avif'), 'image/avif')
  assert.equal(resolveContentType('application/octet-stream', '/x/index.m3u8'), 'application/vnd.apple.mpegurl')
  assert.equal(resolveContentType('application/octet-stream', '/x/blob.bin'), 'application/octet-stream')
})

test('specific upstream content types are never overridden', () => {
  assert.equal(resolveContentType('video/webm; codecs=vp9', '/x/clip.mp4'), 'video/webm')
  assert.equal(resolveContentType('text/html; charset=utf-8', '/x/clip.mp4'), 'text/html')
})

test('response classification gates what the proxy relays', () => {
  assert.equal(classifyProxyResponse('video/mp4', '/a.mp4'), 'video')
  assert.equal(classifyProxyResponse('image/webp', '/a.webp'), 'image')
  assert.equal(classifyProxyResponse('audio/aac', '/a.aac'), 'audio')
  assert.equal(classifyProxyResponse('application/vnd.apple.mpegurl', '/a.m3u8'), 'manifest')
  assert.equal(classifyProxyResponse('application/octet-stream', '/k.key'), 'key')
  assert.equal(classifyProxyResponse('text/html', '/a.mp4'), 'unsupported')
  assert.equal(classifyProxyResponse('application/json', '/a'), 'unsupported')
})

test('conditional headers are forwarded; If-Range only with Range', () => {
  const headers = new Headers({ 'if-range': '"abc"', 'if-none-match': '"abc"', 'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT' })
  assert.deepEqual(conditionalHeaders(headers, true), {
    'if-range': '"abc"',
    'if-none-match': '"abc"',
    'if-modified-since': 'Wed, 21 Oct 2015 07:28:00 GMT',
  })
  assert.equal('if-range' in conditionalHeaders(headers, false), false)
  assert.deepEqual(conditionalHeaders(new Headers({ 'if-none-match': 'x'.repeat(300) }), false), {})
})

test('relay headers keep validators and drop provider-specific noise', () => {
  const upstream = new Headers({
    'content-type': 'video/mp4',
    etag: '"v1"',
    'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
    'set-cookie': 'a=b',
    'content-disposition': 'attachment',
    'access-control-allow-origin': 'https://x.test',
    server: 'cloudflare',
  })
  const out = relayHeaders(upstream)
  assert.equal(out.get('etag'), '"v1"')
  assert.equal(out.get('last-modified'), 'Wed, 21 Oct 2015 07:28:00 GMT')
  assert.equal(out.get('content-type'), 'video/mp4')
  for (const name of ['set-cookie', 'content-disposition', 'access-control-allow-origin', 'server']) {
    assert.equal(out.has(name), false, name)
  }
})

test('cache policy: images share-cache, video and ranged/failed responses never', () => {
  const image = cacheHeadersFor({ kind: 'image', ok: true, hasRange: false, upstreamCacheControl: 'public, max-age=60' })
  assert.match(image['Cache-Control'], /s-maxage=86400/)
  assert.match(cacheHeadersFor({ kind: 'video', ok: true, hasRange: false, upstreamCacheControl: null })['Cache-Control'], /no-store/)
  assert.match(cacheHeadersFor({ kind: 'image', ok: true, hasRange: true, upstreamCacheControl: null })['Cache-Control'], /no-store/)
  assert.match(cacheHeadersFor({ kind: 'image', ok: false, hasRange: false, upstreamCacheControl: null })['Cache-Control'], /no-store/)
  assert.match(cacheHeadersFor({ kind: 'image', ok: true, hasRange: false, upstreamCacheControl: 'private' })['Cache-Control'], /no-store/)
  assert.match(cacheHeadersFor({ kind: 'manifest', ok: true, hasRange: false, upstreamCacheControl: null })['Cache-Control'], /no-store/)
})

test('416 helpers', () => {
  assert.equal(unsatisfiedRangeHeader(), 'bytes */*')
  assert.equal(unsatisfiedRangeHeader(1000), 'bytes */1000')
  assert.equal(totalFromContentRange('bytes 0-1/1234'), 1234)
  assert.equal(totalFromContentRange('bytes 0-1/*'), null)
  assert.equal(totalFromContentRange(null), null)
})

const options = {
  proxyPath: '/api/archiver-proxy',
  isAllowed: (url: URL) => safeProxyTarget(url.href) !== null,
}

test('HLS master playlist variants are proxied and absolutized', () => {
  const input = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    '360/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
    '/abs/720/index.m3u8',
    '',
  ].join('\n')
  const out = rewriteHlsManifest(input, 'https://media.redgifs.com/v/master.m3u8', options)
  const lines = out.split('\n')
  assert.equal(lines[2], `/api/archiver-proxy?url=${encodeURIComponent('https://media.redgifs.com/v/360/index.m3u8')}`)
  assert.equal(lines[4], `/api/archiver-proxy?url=${encodeURIComponent('https://media.redgifs.com/abs/720/index.m3u8')}`)
  assert.equal(lines[1], '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360')
  assert.equal(lines[5], '')
})

test('HLS media playlist rewrites segments, maps and keys; keeps CRLF', () => {
  const input = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/a.key",IV=0x1',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4.0,',
    'seg-1.ts',
    '#EXT-X-ENDLIST',
  ].join('\r\n')
  const out = rewriteHlsManifest(input, new URL('https://thumbs2.redgifs.com/a/b/index.m3u8'), options)
  assert.ok(out.includes('\r\n'))
  assert.ok(out.includes(`URI="/api/archiver-proxy?url=${encodeURIComponent('https://thumbs2.redgifs.com/a/b/keys/a.key')}",IV=0x1`))
  assert.ok(out.includes(`URI="/api/archiver-proxy?url=${encodeURIComponent('https://thumbs2.redgifs.com/a/b/init.mp4')}"`))
  assert.ok(out.includes(`/api/archiver-proxy?url=${encodeURIComponent('https://thumbs2.redgifs.com/a/b/seg-1.ts')}`))
})

test('HLS references to disallowed hosts are absolutized but never proxied', () => {
  const input = '#EXTM3U\n#EXTINF:4,\nhttps://evil.test/seg.ts\n#EXTINF:4,\nhttp://media.redgifs.com/plain.ts\n'
  const out = rewriteHlsManifest(input, 'https://media.redgifs.com/x/index.m3u8', options)
  assert.ok(out.includes('\nhttps://evil.test/seg.ts\n'))
  assert.ok(out.includes('\nhttp://media.redgifs.com/plain.ts\n'))
  assert.equal(out.includes('/api/archiver-proxy'), false)
})

test('manifest sniffing rejects HTML error pages', () => {
  assert.equal(looksLikeHlsManifest('\n#EXTM3U\n'), true)
  assert.equal(looksLikeHlsManifest('<html>denied</html>'), false)
})
