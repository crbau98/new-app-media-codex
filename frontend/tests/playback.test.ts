import assert from 'node:assert/strict'
import test from 'node:test'

import { orderPlaybackCandidates } from '../src/lib/playback.ts'

const candidates = [
  '/proxy/video-hd.mp4',
  '/proxy/video-mobile.mp4',
  'https://cdn.example/video-hd.mp4',
  'https://cdn.example/video-mobile.mp4',
]

test('auto quality preserves provider order on desktop', () => {
  assert.deepEqual(orderPlaybackCandidates(candidates, 'auto'), candidates)
})

test('auto quality prioritizes compatible mobile streams on compact devices', () => {
  assert.deepEqual(orderPlaybackCandidates(candidates, 'auto', true), [
    '/proxy/video-mobile.mp4',
    'https://cdn.example/video-mobile.mp4',
    '/proxy/video-hd.mp4',
    'https://cdn.example/video-hd.mp4',
  ])
})

test('explicit quality preference overrides automatic device selection', () => {
  assert.deepEqual(orderPlaybackCandidates(candidates, '1080p', true), [
    '/proxy/video-hd.mp4',
    'https://cdn.example/video-hd.mp4',
    '/proxy/video-mobile.mp4',
    'https://cdn.example/video-mobile.mp4',
  ])
})
