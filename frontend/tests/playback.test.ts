import assert from 'node:assert/strict'
import test from 'node:test'

import { orderPlaybackCandidates } from '../src/lib/playback.ts'

const candidates = [
  '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-hd.mp4',
  '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-mobile.mp4',
  'https://cdn.example/video-hd.mp4',
  'https://cdn.example/video-mobile.mp4',
]

test('auto quality preserves provider order on desktop', () => {
  assert.deepEqual(orderPlaybackCandidates(candidates, 'auto'), candidates)
})

test('auto quality prioritizes compatible mobile streams on compact devices', () => {
  assert.deepEqual(orderPlaybackCandidates(candidates, 'auto', true), [
    '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-mobile.mp4',
    '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-hd.mp4',
    'https://cdn.example/video-mobile.mp4',
    'https://cdn.example/video-hd.mp4',
  ])
})

test('explicit quality preference overrides automatic device selection', () => {
  assert.deepEqual(orderPlaybackCandidates(candidates, '1080p', true), [
    '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-hd.mp4',
    '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-mobile.mp4',
    'https://cdn.example/video-hd.mp4',
    'https://cdn.example/video-mobile.mp4',
  ])
})

test('proxy streams stay ahead of direct provider fallbacks without a quality preference', () => {
  assert.deepEqual(orderPlaybackCandidates([
    'https://cdn.example/video-hd.mp4',
    '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-hd.mp4',
  ], 'auto'), [
    '/api/archiver-proxy?url=https%3A%2F%2Fcdn.example%2Fvideo-hd.mp4',
    'https://cdn.example/video-hd.mp4',
  ])
})
