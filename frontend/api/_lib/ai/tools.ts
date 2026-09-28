/**
 * Concierge tools. They run server-side against the *catalog the client sent*
 * (public metadata only, already sanitised) using the same deterministic
 * library code the browser uses. Model-supplied arguments are zod-validated
 * by the SDK; results are re-validated here and every id is checked against
 * the catalog before it can reach the client.
 */

import { tool } from 'ai'
import { z } from 'zod'
import {
  buildIndex,
  parseNaturalQuery,
  planSession,
  runQuery,
  similarItems,
  suggestCollections,
  type MediaLite,
  type MoodId,
  type RankedItem,
} from '../../../src/features/ai/core/library.js'
import { toolResultSchema, MOOD_VALUES, type ToolResult } from './schemas.js'

export interface ToolContext {
  catalog: MediaLite[]
  currentId?: string | null
  tasteTags: string[]
}

const byIdMap = (items: MediaLite[]) => new Map(items.map((item) => [item.id, item]))

function pack(ctx: ToolContext, ranked: RankedItem[], note: string, extra: Partial<ToolResult> = {}): ToolResult {
  const known = byIdMap(ctx.catalog)
  const ids: string[] = []
  const reasons: Record<string, string> = {}
  for (const entry of ranked) {
    if (!known.has(entry.item.id) || ids.includes(entry.item.id)) continue
    ids.push(entry.item.id)
    reasons[entry.item.id] = entry.reasons[0] ?? ''
    if (ids.length >= 12) break
  }
  return toolResultSchema.parse({ ids, note, reasons, ...extra })
}

export function buildTools(ctx: ToolContext) {
  const index = buildIndex(ctx.catalog)
  return {
    searchLibrary: tool({
      description: 'Search the user\'s library with natural language filters (tags, creator, source, duration, recency, mood). Returns matching item ids.',
      inputSchema: z.object({
        query: z.string().min(1).max(200).describe('Natural-language request, e.g. "chill solo videos under 5 minutes"'),
        limit: z.number().int().min(1).max(12).default(6),
      }),
      execute: async ({ query, limit }): Promise<ToolResult> => {
        const q = parseNaturalQuery(query)
        if (q.refused) return pack(ctx, [], q.refused.message)
        const out = runQuery(ctx.catalog, q, { limit, index })
        const note = out.results.length
          ? `${out.total} match${out.total === 1 ? '' : 'es'}${out.relaxed.length ? ` (${out.relaxed[0].toLowerCase()})` : ''}.`
          : 'Nothing in the library matches that.'
        return pack(ctx, out.results, note)
      },
    }),
    findSimilar: tool({
      description: 'Find library items similar to a given item id, using shared tags, creator and title words.',
      inputSchema: z.object({ id: z.string().min(1).max(120), limit: z.number().int().min(1).max(12).default(6) }),
      execute: async ({ id, limit }): Promise<ToolResult> => {
        const target = id === 'current' ? ctx.currentId ?? '' : id
        const results = similarItems(ctx.catalog, target, limit)
        return pack(ctx, results, results.length ? 'Ranked by shared public tags and creator.' : 'That item is not in the current library.')
      },
    }),
    planWatchlist: tool({
      description: 'Plan "tonight\'s watchlist": a varied set of videos that fits a time budget and mood, ordered to build up to the best pick.',
      inputSchema: z.object({
        minutes: z.number().int().min(5).max(360).default(45),
        moods: z.array(z.enum(MOOD_VALUES)).max(3).default([]),
      }),
      execute: async ({ minutes, moods }): Promise<ToolResult> => {
        const plan = planSession(ctx.catalog, { minutes, moods: moods as MoodId[] })
        return pack(ctx, plan.items, plan.note, { totalSeconds: plan.totalSeconds })
      },
    }),
    explainRecommendation: tool({
      description: 'Explain, using public metadata only, why an item may suit the user. Never speculates about people.',
      inputSchema: z.object({ id: z.string().min(1).max(120) }),
      execute: async ({ id }): Promise<ToolResult> => {
        const item = ctx.catalog.find((entry) => entry.id === id)
        if (!item) return pack(ctx, [], 'That item is not in the current library.')
        const shared = item.tags.filter((tag) => ctx.tasteTags.some((t) => t.toLowerCase() === tag.toLowerCase()))
        const parts = [
          shared.length ? `Shares your liked tags: ${shared.slice(0, 3).map((t) => `#${t}`).join(', ')}` : '',
          item.likes > 0 ? `${item.likes.toLocaleString('en-US')} public likes` : '',
        ].filter(Boolean)
        return pack(ctx, [{ item, score: 1, reasons: [parts[0] ?? 'Popular in the public feed'] }], parts.length ? parts.join(' · ') : 'Ranked on public engagement and freshness.')
      },
    }),
    buildCollection: tool({
      description: 'Build a smart collection: pick a short name and the items that belong to it, from a natural-language description or from the library\'s natural groupings.',
      inputSchema: z.object({
        name: z.string().min(1).max(60),
        query: z.string().max(200).default(''),
      }),
      execute: async ({ name, query }): Promise<ToolResult> => {
        if (query.trim()) {
          const q = parseNaturalQuery(query)
          if (q.refused) return pack(ctx, [], q.refused.message)
          const out = runQuery(ctx.catalog, q, { limit: 12, index })
          return pack(ctx, out.results, `${out.results.length} items collected.`, { name })
        }
        const suggestion = suggestCollections(ctx.catalog, 1)[0]
        const known = byIdMap(ctx.catalog)
        const ranked: RankedItem[] = (suggestion?.ids ?? []).flatMap((id) => {
          const item = known.get(id)
          return item ? [{ item, score: 1, reasons: [suggestion?.description ?? ''] }] : []
        })
        return pack(ctx, ranked, suggestion ? suggestion.description : 'Not enough related items yet.', { name: suggestion?.name ?? name })
      },
    }),
  }
}
