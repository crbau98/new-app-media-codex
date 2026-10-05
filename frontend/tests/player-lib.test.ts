import assert from 'node:assert/strict'
import test from 'node:test'

import {
  averageRgb,
  bufferedSegments,
  formatTime,
  isDoubleTap,
  parseHexColor,
  resolveKeyAction,
  spriteTile,
  stepRate,
  tapZone,
} from '../src/lib/player/controls.ts'
import { parseGallery, parseSpriteGrid, readMediaIntel, safeColor, safeImageSrc } from '../src/lib/player/intel.ts'
import { backoffDelay, classifyMediaError, preloadFor, readNetworkProfile, resumePosition } from '../src/lib/player/resilience.ts'
import { buildSources, fileQualityOptions, heightFromUrl, isHlsUrl, mimeFromUrl, preferSource } from '../src/lib/player/sources.ts'
import { clampView, inertiaStep, swipeDirection, toggleZoom, zoomAt } from '../src/lib/player/zoom.ts'

test('formatTime renders m:ss and h:mm:ss', () => {
  assert.equal(formatTime(0), '0:00')
  assert.equal(formatTime(65.9), '1:05')
  assert.equal(formatTime(3725), '1:02:05')
  assert.equal(formatTime(Number.NaN), '0:00')
})

test('keyboard map covers the documented shortcuts and gates frame-step on pause', () => {
  assert.deepEqual(resolveKeyAction({ key: ' ' }, false), { type: 'toggle' })
  assert.deepEqual(resolveKeyAction({ key: 'j' }, false), { type: 'seek', delta: -10 })
  assert.deepEqual(resolveKeyAction({ key: 'ArrowRight' }, false), { type: 'seek', delta: 5 })
  assert.deepEqual(resolveKeyAction({ key: '5' }, false), { type: 'seekPercent', percent: 50 })
  assert.equal(resolveKeyAction({ key: '.' }, false), null)
  assert.deepEqual(resolveKeyAction({ key: '.' }, true), { type: 'frame', direction: 1 })
  assert.equal(resolveKeyAction({ key: 'k', metaKey: true }, false), null)
  assert.equal(resolveKeyAction({ key: 's' }, false), null)
  // Round 4: queue/moment keys; PiP moved to I and the A-B loop to A so B can bookmark a moment.
  assert.deepEqual(resolveKeyAction({ key: 'n' }, false), { type: 'nextItem' })
  assert.deepEqual(resolveKeyAction({ key: 'p' }, false), { type: 'prevItem' })
  assert.deepEqual(resolveKeyAction({ key: 'b' }, false), { type: 'moment' })
  assert.deepEqual(resolveKeyAction({ key: 'a' }, false), { type: 'abLoop' })
  assert.deepEqual(resolveKeyAction({ key: 'i' }, false), { type: 'pip' })
})

test('stepRate saturates at both ends', () => {
  assert.equal(stepRate(1, 1), 1.25)
  assert.equal(stepRate(2, 1), 2)
  assert.equal(stepRate(0.5, -1), 0.5)
})

test('spriteTile maps time onto a row-major storyboard', () => {
  assert.deepEqual(spriteTile(0, 100, 10, 10), { index: 0, x: 0, y: 0 })
  const last = spriteTile(100, 100, 10, 10)
  assert.equal(last?.index, 99)
  assert.equal(last?.x, 100)
  assert.equal(last?.y, 100)
  assert.equal(spriteTile(5, 0, 10, 10), null)
})

test('bufferedSegments produces fractional spans', () => {
  assert.deepEqual(bufferedSegments([{ start: 0, end: 25 }, { start: 50, end: 50 }], 100), [{ left: 0, width: 0.25 }])
})

test('averageRgb ignores transparent pixels and lifts vibrance', () => {
  const [r, g, b] = averageRgb([200, 0, 0, 255, 200, 0, 0, 255, 0, 255, 0, 0])
  assert.ok(r > 200 && g < 10 && b < 10)
  assert.deepEqual(averageRgb([]).length, 3)
})

test('parseHexColor handles short and long hex', () => {
  assert.deepEqual(parseHexColor('#fff'), [255, 255, 255])
  assert.deepEqual(parseHexColor('#102030'), [16, 32, 48])
  assert.equal(parseHexColor('red'), null)
})

test('double tap and tap zones', () => {
  assert.equal(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 200, x: 20, y: 15 }), true)
  assert.equal(isDoubleTap({ t: 0, x: 10, y: 10 }, { t: 600, x: 20, y: 15 }), false)
  assert.equal(isDoubleTap(null, { t: 1, x: 0, y: 0 }), false)
  assert.equal(tapZone(10, 300), 'left')
  assert.equal(tapZone(150, 300), 'center')
  assert.equal(tapZone(290, 300), 'right')
})

test('media intelligence parser is defensive', () => {
  const intel = readMediaIntel({
    width: 1920,
    height: 1080,
    spriteGrid: { cols: 10, rows: 5, tileWidth: 160 },
    gallery: ['https://a/1.jpg', { url: 'https://a/2.jpg', width: 10 }, { nope: true }, 5],
    hasAudio: false,
    dominantColor: '#123',
  })
  assert.equal(intel.aspect, 1920 / 1080)
  assert.deepEqual(intel.spriteGrid, { cols: 10, rows: 5, tileWidth: 160, tileHeight: undefined })
  assert.equal(intel.gallery.length, 2)
  assert.equal(intel.hasAudio, false)
  assert.deepEqual(readMediaIntel(null).gallery, [])
  assert.deepEqual(parseSpriteGrid('10x5'), { cols: 10, rows: 5 })
  assert.equal(parseSpriteGrid('nope'), undefined)
  assert.deepEqual(parseGallery('x'), [])
})

test('inline colour / lqip values are sanitised', () => {
  assert.equal(safeColor('#abc'), '#abc')
  assert.equal(safeColor('rgb(1 2 3)'), 'rgb(1 2 3)')
  assert.equal(safeColor('red; background:url(x)'), undefined)
  assert.equal(safeImageSrc('data:image/webp;base64,AAAA'), 'data:image/webp;base64,AAAA')
  assert.equal(safeImageSrc('javascript:alert(1)'), undefined)
  assert.equal(safeImageSrc('data:text/html;base64,AAAA'), undefined)
})

test('error classification drives recovery', () => {
  assert.equal(classifyMediaError(2).retrySame, true)
  assert.equal(classifyMediaError(3).nextSource, true)
  assert.equal(classifyMediaError(4).nextSource, true)
  assert.equal(classifyMediaError(1).kind, 'aborted')
  assert.equal(classifyMediaError(null).kind, 'unknown')
})

test('backoff grows exponentially and is capped', () => {
  assert.equal(backoffDelay(0, 500, 8000, 0), 500)
  assert.equal(backoffDelay(2, 500, 8000, 0), 2000)
  assert.equal(backoffDelay(10, 500, 8000, 0), 8000)
  assert.equal(backoffDelay(1, 500, 8000, 1), 1250)
})

test('preload policy respects data saver and slow links', () => {
  assert.equal(preloadFor(readNetworkProfile({ saveData: true }), false), 'none')
  assert.equal(preloadFor(readNetworkProfile({ saveData: true }), true), 'metadata')
  assert.equal(preloadFor(readNetworkProfile({ effectiveType: '3g' }), true), 'metadata')
  assert.equal(preloadFor(readNetworkProfile({ effectiveType: '4g' }), true), 'auto')
  assert.equal(preloadFor(readNetworkProfile(null), false), 'metadata')
})

test('resume position ignores tiny and finished positions', () => {
  assert.equal(resumePosition({ seconds: 5, duration: 100 }, 100), null)
  assert.equal(resumePosition({ seconds: 95, duration: 100 }, 100), null)
  assert.equal(resumePosition({ seconds: 40, duration: 100 }, 100), 40)
  assert.equal(resumePosition(undefined, 100), null)
})

const resolve = (url: string) => url
const proxied = (name: string) => `/api/archiver-proxy?url=${encodeURIComponent(`https://media.redgifs.com/${name}`)}`

test('source chain: HLS leads, files keep proxy-first order, labels are inferred', () => {
  const sources = buildSources({
    hlsUrl: proxied('clip.m3u8'),
    streamCandidates: ['https://cdn.example/clip-mobile.mp4', proxied('clip-hd.mp4'), proxied('clip-mobile.mp4')],
    quality: 'auto',
    preferMobile: false,
    resolve,
  })
  assert.equal(sources[0].kind, 'hls')
  assert.equal(sources[1].url, proxied('clip-hd.mp4'))
  assert.equal(sources[sources.length - 1].url, 'https://cdn.example/clip-mobile.mp4')
  const labels = fileQualityOptions(sources).map((option) => option.label)
  assert.deepEqual(labels, ['HD', 'SD'])
})

test('undecodable candidates are skipped but never leave the chain empty', () => {
  const probe = { canPlayType: (type: string) => (type.startsWith('video/webm') ? '' : 'maybe') }
  const mixed = buildSources({
    streamCandidates: ['https://cdn.example/a.webm', 'https://cdn.example/b.mp4'],
    quality: 'auto', preferMobile: false, resolve, probe,
  })
  assert.deepEqual(mixed.map((s) => s.url), ['https://cdn.example/b.mp4'])
  const onlyWebm = buildSources({ streamCandidates: ['https://cdn.example/a.webm'], quality: 'auto', preferMobile: false, resolve, probe })
  assert.equal(onlyWebm.length, 1)
})

test('legacy screenshot ids resolve; modern ids do not', async () => {
  const { legacyScreenshotId } = await import('../src/lib/player/sources.ts')
  assert.equal(legacyScreenshotId('123'), '123')
  assert.equal(legacyScreenshotId('shot-45'), '45')
  assert.equal(legacyScreenshotId('screenshot-7'), '7')
  assert.equal(legacyScreenshotId('rg-abc'), null)
})

test('source helpers', () => {
  assert.equal(isHlsUrl('https://x/y/index.m3u8?token=1'), true)
  assert.equal(isHlsUrl(proxied('a.m3u8')), true)
  assert.equal(isHlsUrl(proxied('a.mp4')), false)
  assert.equal(mimeFromUrl(proxied('a.webm')), 'video/webm')
  assert.equal(heightFromUrl('https://x/video-720p.mp4'), 720)
  assert.equal(heightFromUrl('https://x/plain.mp4'), undefined)
  const list = buildSources({ streamCandidates: ['https://x/a-1080.mp4', 'https://x/a-720.mp4'], quality: 'auto', preferMobile: false, resolve })
  assert.equal(preferSource(list, 'https://x/a-720.mp4')[0].url, 'https://x/a-720.mp4')
})

const viewport = { width: 400, height: 600 }

test('zoom clamps pan to the overflow and keeps focal point stable', () => {
  const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 0 }, viewport)
  assert.equal(zoomed.scale, 2)
  assert.equal(zoomed.x, -100)
  const clamped = clampView({ scale: 2, x: 999, y: -999 }, viewport)
  assert.equal(clamped.x, 200)
  assert.equal(clamped.y, -300)
  assert.deepEqual(clampView({ scale: 1, x: 50, y: 50 }, viewport), { scale: 1, x: 0, y: 0 })
})

test('double-tap toggles zoom and inertia settles', () => {
  const on = toggleZoom({ scale: 1, x: 0, y: 0 }, { x: 0, y: 0 }, viewport)
  assert.ok(on.scale > 2)
  assert.deepEqual(toggleZoom(on, { x: 0, y: 0 }, viewport), { scale: 1, x: 0, y: 0 })
  let view = { scale: 3, x: 0, y: 0 }
  let velocity = { x: 1.2, y: 0 }
  let frames = 0
  for (;;) {
    const step = inertiaStep(view, velocity, viewport, 16)
    if (!step || frames++ > 400) break
    view = step.view
    velocity = step.velocity
  }
  assert.ok(frames < 400)
  assert.ok(view.x > 0 && view.x <= 400)
})

test('swipe direction requires a mostly-horizontal, deliberate gesture', () => {
  assert.equal(swipeDirection(-150, 10, 200, 400), 1)
  assert.equal(swipeDirection(150, 10, 200, 400), -1)
  assert.equal(swipeDirection(-40, 5, 50, 400), 1)
  assert.equal(swipeDirection(-20, 2, 500, 400), 0)
  assert.equal(swipeDirection(-100, 120, 200, 400), 0)
})
