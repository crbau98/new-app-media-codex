import { generateText, Output } from 'ai'
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
}

const schema = z.object({
  suggestions: z.array(z.object({
    creatorId: z.string(),
    score: z.number().min(0).max(100),
    reasons: z.array(z.string().max(100)).min(1).max(3),
  })).max(12),
})

export async function rankSimilarCreatorsWithAI(
  creators: AiCreatorInput[],
  requested: boolean,
): Promise<AiSimilarityResult> {
  const seeds = creators.filter((creator) => creator.watched)
  const candidates = creators.filter((creator) => !creator.watched).slice(0, 40)
  if (!requested || !seeds.length || !candidates.length) {
    return {
      model: 'metadata-tfidf-v1', state: 'not-requested', suggestions: new Map(),
      detail: !seeds.length ? 'AI reranking waits for at least one exact radar match.' : 'AI reranking runs during Scan now and the daily scan.',
    }
  }

  const model = (process.env.AI_DISCOVERY_MODEL || 'openai/gpt-5.4').trim()
  try {
    const { output } = await generateText({
      model,
      output: Output.object({ schema }),
      maxOutputTokens: 900,
      temperature: 0,
      providerOptions: { gateway: { tags: ['feature:creator-discovery', 'data:public-metadata'], user: 'creator-radar-public', cacheControl: 's-maxage=21600' } },
      prompt: [
        'Rank public creator accounts by metadata similarity to the watched accounts.',
        'Use only supplied public text tags, platform, and engagement. Do not infer appearance, body, gender, sexuality, ethnicity, age, identity, or private traits.',
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
    return { model, state: 'model', suggestions, detail: 'AI Gateway metadata reranking completed.' }
  } catch (error) {
    return {
      model: 'metadata-tfidf-v1', state: 'fallback', suggestions: new Map(),
      detail: `AI Gateway unavailable; deterministic similarity remained active (${error instanceof Error ? error.name : 'request failed'}).`,
    }
  }
}
