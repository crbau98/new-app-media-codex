import { createGateway, generateText, Output } from 'ai'
import { z } from 'zod'

export type AiCreatorInput = {
  id: string
  name: string
  platform: string
  tags: string[]
  watched: boolean
  mediaCount: number
  publicViews: number
  deterministicScore: number
}

export type AiSimilarityResult = {
  model: string
  state: 'model' | 'fallback' | 'not-requested'
  suggestions: Map<string, { score: number; reasons: string[] }>
  detail: string
  cacheState?: 'hit' | 'miss'
}

const schema = z.object({
  suggestions: z.array(z.object({
    creatorId: z.string(),
    score: z.number().min(0).max(100),
    reasons: z.array(z.string().max(140)).min(1).max(3),
  })).max(12),
})

// Current low-latency Vercel AI Gateway default. Override with AI_DISCOVERY_MODEL.
const DEFAULT_MODEL = 'openai/gpt-5.6-luna'
const AI_TIMEOUT_MS = 8_000
const RESULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000
const MAX_RETRIES = 1

const resultCache = new Map<string, { at: number; result: AiSimilarityResult }>()

function canonicalCreator(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]+/g, '')
}

/**
 * Preserve exact source matches as rich seeds, but also retain unmatched radar
 * names. The latter lets AI discovery run while public providers are still
 * locating an exact profile instead of reporting "not requested" forever.
 */
export function buildAiDiscoverySeeds(
  creators: AiCreatorInput[],
  requestedSeedNames: string[] = [],
): AiCreatorInput[] {
  const seeds = creators.filter((creator) => creator.watched)
  const existing = new Set(seeds.flatMap((creator) => [
    canonicalCreator(creator.id),
    canonicalCreator(creator.name),
  ]).filter(Boolean))
  for (const rawName of requestedSeedNames) {
    const name = rawName.trim().replace(/^@/, '').slice(0, 80)
    const key = canonicalCreator(name)
    if (!key || existing.has(key)) continue
    existing.add(key)
    seeds.push({
      id: `radar-request-${key}`,
      name,
      platform: 'Radar request',
      tags: [],
      watched: true,
      mediaCount: 0,
      publicViews: 0,
      deterministicScore: 0,
    })
  }
  return seeds.slice(0, 12)
}

function cacheKey(seeds: AiCreatorInput[], candidates: AiCreatorInput[]): string {
  const compact = (creator: AiCreatorInput) => ({
    id: creator.id,
    name: creator.name,
    platform: creator.platform,
    tags: [...creator.tags].sort(),
    watched: creator.watched,
    mediaCount: creator.mediaCount,
    publicViews: Math.round(creator.publicViews),
    deterministicScore: Math.round(creator.deterministicScore),
  })
  return JSON.stringify({
    seeds: seeds.map(compact).sort((a, b) => a.id.localeCompare(b.id)),
    candidates: candidates.map(compact).sort((a, b) => a.id.localeCompare(b.id)),
  })
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /429|too many|rate.?limit|5\d\d|internal|timeout|abort|overloaded|unavailable/i.test(message)
}

function truncate(value: string, max = 180): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

export async function rankSimilarCreatorsWithAI(
  creators: AiCreatorInput[],
  requested: boolean,
  requestedSeedNames: string[] = [],
  gatewayAuthToken = '',
): Promise<AiSimilarityResult> {
  const seeds = buildAiDiscoverySeeds(creators, requestedSeedNames)
  const candidates = creators.filter((creator) => !creator.watched).slice(0, 40)
  if (!requested || !seeds.length || !candidates.length) {
    return {
      model: 'metadata-tfidf-v1', state: 'not-requested', suggestions: new Map(),
      detail: !seeds.length ? 'AI reranking waits for at least one exact radar match.' : 'AI reranking runs during Scan now and the daily scan.',
    }
  }

  const key = cacheKey(seeds, candidates)
  const cached = resultCache.get(key)
  if (cached && Date.now() - cached.at < RESULT_CACHE_TTL_MS) {
    return { ...cached.result, cacheState: 'hit' }
  }

  const model = (process.env.AI_DISCOVERY_MODEL || DEFAULT_MODEL).trim()
  const modelProvider = gatewayAuthToken
    ? createGateway({ apiKey: gatewayAuthToken })(model)
    : model
  let lastError: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const { output } = await generateText({
        model: modelProvider,
        output: Output.object({ schema }),
        maxOutputTokens: 900,
        temperature: 0,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
        providerOptions: { gateway: { tags: ['feature:creator-discovery', 'data:public-metadata'], user: 'creator-radar-public' } },
        prompt: [
          'Rank public creator accounts by metadata similarity to the watched accounts.',
          'Use only supplied public account names, text tags, platform, and engagement. Do not infer appearance, body, gender, sexuality, ethnicity, age, identity, or private traits.',
          'Return only candidate creatorId values. Prefer cross-source corroboration and specific shared tags. Scores are confidence in metadata similarity, not attractiveness.',
          `WATCHED=${JSON.stringify(seeds)}`,
          `CANDIDATES=${JSON.stringify(candidates)}`,
        ].join('\n'),
      })
      const allowed = new Set(candidates.map((candidate) => candidate.id))
      const suggestions = new Map<string, { score: number; reasons: string[] }>()
      for (const item of output.suggestions) {
        if (!allowed.has(item.creatorId) || item.score < 60) continue
        suggestions.set(item.creatorId, {
          score: Math.round(item.score),
          reasons: item.reasons.map((reason) => reason.trim()).filter(Boolean).slice(0, 3),
        })
      }
      const result: AiSimilarityResult = {
        model, state: 'model', suggestions, cacheState: 'miss',
        detail: `AI Gateway metadata reranking completed with ${model}.`,
      }
      resultCache.set(key, { at: Date.now(), result })
      if (resultCache.size > 128) resultCache.clear()
      return result
    } catch (error) {
      lastError = error
      if (attempt < MAX_RETRIES && isRetryable(error)) {
        await new Promise((resolve) => setTimeout(resolve, 600))
        continue
      }
      break
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'request failed'
  console.warn('[ai-discovery] gateway reranking unavailable', {
    model,
    authentication: gatewayAuthToken ? 'vercel-oidc-or-api-key' : 'missing',
    error: truncate(message),
  })
  return {
    model: 'metadata-tfidf-v1', state: 'fallback', suggestions: new Map(),
    detail: 'AI reranking was temporarily unavailable; source discovery and metadata similarity completed normally.',
  }
}
