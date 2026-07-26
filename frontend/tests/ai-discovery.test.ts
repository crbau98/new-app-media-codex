import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAiDiscoverySeeds,
  rankCreatorMetadataFallback,
  type AiCreatorInput,
} from '../api/_lib/ai-similarity.ts'

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

test('metadata fallback returns useful, explainable suggestions without an AI provider', () => {
  const strong = creator({
    id: 'strong',
    deterministicScore: 80,
    mediaCount: 6,
    publicViews: 50_000,
    tags: ['studio', 'interview'],
  })
  const fresh = creator({
    id: 'fresh',
    deterministicScore: 0,
    mediaCount: 1,
    publicViews: 50,
    tags: [],
  })

  const suggestions = rankCreatorMetadataFallback([fresh, strong])

  assert.equal(suggestions.size, 2)
  assert.ok((suggestions.get('strong')?.score || 0) > (suggestions.get('fresh')?.score || 0))
  assert.match(suggestions.get('strong')?.reasons.join(' ') || '', /public metadata similarity/i)
  assert.ok((suggestions.get('fresh')?.reasons.length || 0) > 0)
})
