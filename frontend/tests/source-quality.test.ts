import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isScopedAdultPeerTubeMetadata,
  selectQualityDiverse,
} from '../api/_lib/source-quality.ts'

test('PeerTube scope accepts explicit publisher metadata', () => {
  assert.equal(isScopedAdultPeerTubeMetadata({
    name: 'Gay amateur scene',
    tags: ['gay', 'male', 'bareback', 'anal'],
  }), true)
})

test('PeerTube scope rejects identity-only podcasts and ASMR', () => {
  assert.equal(isScopedAdultPeerTubeMetadata({
    name: 'Weekly gay culture podcast',
    tags: ['gay', 'podcast', 'interview'],
  }), false)
  assert.equal(isScopedAdultPeerTubeMetadata({
    name: 'Whispered roleplay',
    tags: ['asmr', 'gay', 'pov'],
  }), false)
})

test('PeerTube scope rejects unsafe off-topic descriptions', () => {
  assert.equal(isScopedAdultPeerTubeMetadata({
    name: 'Casting application',
    description: 'I will end my life today',
    tags: ['gay', 'nsfw'],
  }), false)
})

test('source diversity never promotes weak alternatives over ranked items', () => {
  const items = [
    ...Array.from({ length: 12 }, (_, index) => ({ id: `primary-${index}`, source: 'Primary', curationScore: 90 - index })),
    ...Array.from({ length: 6 }, (_, index) => ({ id: `weak-${index}`, source: 'Weak', curationScore: 8 - index })),
  ].sort((a, b) => b.curationScore - a.curationScore)

  const selected = selectQualityDiverse(items, 10)
  assert.equal(selected.length, 10)
  assert.equal(selected.some((item) => item.source === 'Weak'), false)
})

test('source diversity includes competitive alternatives', () => {
  const items = [
    { id: 'a1', source: 'A', curationScore: 80 },
    { id: 'b1', source: 'B', curationScore: 72 },
    { id: 'a2', source: 'A', curationScore: 70 },
  ]
  assert.deepEqual(selectQualityDiverse(items, 3).map((item) => item.id), ['a1', 'b1', 'a2'])
})
