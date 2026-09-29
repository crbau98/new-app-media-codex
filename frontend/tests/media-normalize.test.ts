import assert from 'node:assert/strict'
import test from 'node:test'

import { aspectOf, dedupeItems, isPlayable, orderStreamCandidates, peerTubeStreams, pruneUnplayable, streamRank, withContract } from '../api/_lib/media-normalize.ts'
import type { UnifiedMediaItem } from '../api/_lib/discovery-types.ts'

const item = (over: Partial<UnifiedMediaItem> = {}): UnifiedMediaItem => ({
  id: 'a', title: 'T', source: 'X', duration: '0:10', isVideo: true, category: 'c', creator: 'me', tags: [], rating: 0, createdAt: '', views: 0,
  streamCandidates: [], pageUrl: 'https://x.test/a', likes: 0, comments: 0, isLiked: false, isNew: false, isTrending: false, curationScore: 0, curationReasons: [], isWatchedCreator: false, ...over,
})

test('orders progressive mp4 before webm before hls, proxied first within rank', () => {
  const p = (u: string) => `/api/archiver-proxy?url=${encodeURIComponent(u)}`
  const out = orderStreamCandidates(['https://c/x.m3u8', 'https://c/x.webm', 'https://c/x.mp4', p('https://c/x.mp4'), 'https://c/x.mp4'])
  assert.deepEqual(out, [p('https://c/x.mp4'), 'https://c/x.mp4', 'https://c/x.webm', 'https://c/x.m3u8'])
  assert.equal(streamRank(p('https://c/x.m3u8')), 2)
})

test('withContract fills aspect, duration, hls and mime only when known', () => {
  const out = withContract(item({ streamCandidates: ['https://c/a.m3u8', 'https://c/a.mp4'] }), { width: 1080, height: 1920, durationSeconds: 12.3456, hasAudio: false })
  assert.equal(out.aspect, 0.5625)
  assert.equal(out.durationSeconds, 12.346)
  assert.equal(out.hasAudio, false)
  assert.equal(out.hlsUrl, 'https://c/a.m3u8')
  assert.equal(out.mediaUrl, 'https://c/a.mp4')
  assert.equal(out.mimeType, 'video/mp4')
  const bare = withContract(item({ streamCandidates: [] }))
  assert.equal(bare.aspect, undefined)
  assert.equal('mimeType' in bare, false)
  assert.equal(aspectOf(0, 5), undefined)
})

test('unplayable items are dropped and cross-provider duplicates collapse', () => {
  const a = item({ id: 'rg-1', streamCandidates: ['https://c/a.mp4'], pageUrl: 'https://www.site.test/v/1?utm_source=x' })
  const b = item({ id: 'pt-9', streamCandidates: ['https://c/a.mp4?token=2'], width: 1280, height: 720, pageUrl: 'https://site.test/v/1' })
  const c = item({ id: 'pt-3', streamCandidates: [] })
  assert.equal(isPlayable(c), false)
  const { items, dropped } = pruneUnplayable(dedupeItems([a, b, c]))
  assert.equal(dropped, 1)
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'pt-9')
})

test('peerTubeStreams prefers <=1080p mp4 then hls', () => {
  const r = peerTubeStreams({
    files: [{ fileUrl: 'https://p/4k.mp4', resolution: { id: 2160 } }, { fileUrl: 'https://p/720.mp4', resolution: { id: 720 } }, { fileUrl: 'http://p/insecure.mp4', resolution: { id: 480 } }],
    streamingPlaylists: [{ playlistUrl: 'https://p/master.m3u8' }],
  })
  assert.deepEqual(r.streams, ['https://p/720.mp4', 'https://p/master.m3u8'])
  assert.equal(r.height, 720)
})
