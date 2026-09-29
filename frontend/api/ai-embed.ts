/**
 * Optional embedding endpoint for semantic re-ranking of search results.
 *
 *   GET  -> { available }  (true only when AI_EMBEDDING_MODEL and gateway credentials exist)
 *   POST { texts: string[] } -> { state:'ok', model, vectors:number[][] } | { state:'unavailable' }
 *
 * Fully optional: when no embedding model is configured the client keeps its
 * local BM25/synonym ranking. Only short public-metadata strings are embedded
 * (title, tags, creator handle), PII-redacted and injection-sanitised.
 */
export const config = { runtime: 'edge', maxDuration: 15 }

import { embedMany } from 'ai'
import { redactPII, sanitizeUntrusted } from '../src/features/ai/core/library.js'
import { clientIp, consumeBudget, embeddingModel, embeddingModelId, errorMessage, gatewayToken, isSameOrigin, json } from './_lib/ai/gateway.js'
import { embedRequestSchema } from './_lib/ai/schemas.js'

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const token = gatewayToken(req)
  const modelId = embeddingModelId()
  const available = Boolean(token && modelId)
  if (req.method === 'GET') return json({ available, model: available ? modelId : null })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!available) return json({ state: 'unavailable', detail: 'No embedding model configured.' })

  const parsed = embedRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ state: 'unavailable', detail: 'Invalid request.' }, 400)
  if (!consumeBudget('ai-embed', clientIp(req), 20, 5 * 60_000)) return json({ state: 'unavailable', detail: 'Rate limited.' }, 429, { 'Retry-After': '30' })

  try {
    const values = parsed.data.texts.map((text) => sanitizeUntrusted(redactPII(text), 300) || '-')
    const { embeddings } = await embedMany({
      model: embeddingModel(modelId, token),
      values,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(8_000),
      providerOptions: { gateway: { tags: ['feature:semantic-search', 'data:public-metadata'] } },
    })
    return json({ state: 'ok', model: modelId, vectors: embeddings })
  } catch (error) {
    console.warn('[ai-embed] embeddings unavailable', { modelId, error: errorMessage(error) })
    return json({ state: 'unavailable', detail: 'Embedding model unavailable; using local ranking.' })
  }
}
