/**
 * Optional cloud helpers for the command bar: LLM query refinement and
 * embedding-based semantic re-ranking. Both are strictly best-effort — every
 * failure resolves to `null` so the deterministic local result stands.
 */

import { cosine, mergeRefinement, type AiQuery, type MediaLite, type RankedItem, blendEmbeddingScores } from '../core/library.ts'

export interface RefineResult {
  state: 'model' | 'refused' | 'fallback' | 'unavailable'
  query?: AiQuery
  summary?: string
  detail?: string
}

const refineCache = new Map<string, RefineResult>()
let queryAvailable: boolean | null = null

export async function refineQueryRemote(base: AiQuery, vocab: { tags: string[]; creators: string[]; sources: string[] }, signal: AbortSignal): Promise<RefineResult | null> {
  if (queryAvailable === false) return null
  const key = base.raw.toLowerCase()
  const hit = refineCache.get(key)
  if (hit) return hit
  try {
    const response = await fetch('/api/ai-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: base.raw, vocab: { tags: vocab.tags.slice(0, 80), creators: vocab.creators.slice(0, 40), sources: vocab.sources.slice(0, 12) } }),
      signal,
      credentials: 'omit',
    })
    if (!response.ok) { if (response.status === 404 || response.status === 405) queryAvailable = false; return null }
    const data = (await response.json()) as { state?: string; refinement?: unknown; detail?: string }
    if (data.state === 'unavailable') { queryAvailable = false; return null }
    if (data.state === 'refused') return { state: 'refused', detail: data.detail }
    if (data.state !== 'model') return { state: 'fallback', detail: data.detail }
    const merged = mergeRefinement(base, data.refinement)
    const summary = data.refinement && typeof (data.refinement as { summary?: unknown }).summary === 'string' ? (data.refinement as { summary: string }).summary : undefined
    const result: RefineResult = { state: 'model', query: merged, summary }
    refineCache.set(key, result)
    if (refineCache.size > 60) refineCache.clear()
    return result
  } catch {
    return null
  }
}

/* ── embeddings ── */

const vectorCache = new Map<string, number[]>()
let embedAvailable: boolean | null = null

function itemText(item: MediaLite): string {
  return `${item.title}. ${item.tags.slice(0, 8).join(', ')}. ${item.creator}`.slice(0, 300)
}

async function embedAvailability(signal: AbortSignal): Promise<boolean> {
  if (embedAvailable !== null) return embedAvailable
  try {
    const response = await fetch('/api/ai-embed', { signal, credentials: 'omit' })
    const data = response.ok ? ((await response.json()) as { available?: boolean }) : null
    embedAvailable = data?.available === true
  } catch {
    embedAvailable = false
  }
  return embedAvailable
}

/**
 * Re-rank the head of a result list by embedding similarity to the query.
 * Returns the input untouched when no embedding model is configured.
 */
export async function semanticRerank(query: string, results: RankedItem[], signal: AbortSignal): Promise<RankedItem[] | null> {
  if (query.trim().length < 3 || results.length < 3) return null
  if (!(await embedAvailability(signal))) return null
  const head = results.slice(0, 24)
  const need = head.filter((entry) => !vectorCache.has(entry.item.id))
  const texts = [query.trim().slice(0, 200), ...need.map((entry) => itemText(entry.item))]
  try {
    const response = await fetch('/api/ai-embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts }), signal, credentials: 'omit' })
    if (!response.ok) return null
    const data = (await response.json()) as { state?: string; vectors?: number[][] }
    if (data.state !== 'ok' || !Array.isArray(data.vectors) || data.vectors.length !== texts.length) return null
    const [queryVector, ...itemVectors] = data.vectors
    need.forEach((entry, i) => vectorCache.set(entry.item.id, itemVectors[i]))
    if (vectorCache.size > 600) vectorCache.clear()
    const sims = new Map<string, number>()
    for (const entry of head) {
      const vector = vectorCache.get(entry.item.id) ?? itemVectors[need.indexOf(entry)]
      if (vector) sims.set(entry.item.id, Math.max(0, cosine(queryVector, vector)))
    }
    return [...blendEmbeddingScores(head, sims, 0.4), ...results.slice(24)]
  } catch {
    return null
  }
}
