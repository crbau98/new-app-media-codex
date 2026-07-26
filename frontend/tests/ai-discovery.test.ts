import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAiDiscoverySeeds, type AiCreatorInput } from '../api/_lib/ai-similarity.ts'

const creator = (overrides: Partial<AiCreatorInput> = {}): AiCreatorInput => ({
  id: 'creator-observed',
  name: 'Observed Creator',
  platform: 'Redgifs',
  tags: ['studio'],
  watched: false,
  mediaCount: 2,
  publicViews: 100,
  deterministicScore: 72,
  ...overrides,
})

test('AI discovery keeps exact watched creators as rich seeds', () => {
  const watched = creator({ watched: true })
  assert.deepEqual(buildAiDiscoverySeeds([watched], ['Observed Creator']), [watched])
})

test('AI discovery creates bounded seeds for unmatched radar names', () => {
  const seeds = buildAiDiscoverySeeds([creator()], ['@New Creator', 'new-creator', ''])
  assert.deepEqual(seeds, [{
    id: 'radar-request-newcreator',
    name: 'New Creator',
    platform: 'Radar request',
    tags: [],
    watched: true,
    mediaCount: 0,
    publicViews: 0,
    deterministicScore: 0,
  }])
})
