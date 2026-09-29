/**
 * On-device concierge brain. Used whenever the AI Gateway is not configured or
 * a cloud request fails, so the concierge is never a dead UI. It combines the
 * deterministic query parser, BM25 search, similarity, session planner and the
 * on-device taste engine — nothing leaves the browser.
 */

import {
  formatMinutes,
  moodById,
  parseNaturalQuery,
  planSession,
  runQuery,
  similarItems,
  suggestCollections,
  type AiQuery,
  type MediaLite,
  type MoodId,
  type RankedItem,
} from '../core/library.ts'
import { explainBreakdown, recommendForYou, scoreItem, summarizeTaste, hasTasteSignal, type TasteProfile, type TasteMode } from '../taste/engine.ts'

export type ReplyAction =
  | { kind: 'navigate'; label: string; route: string }
  | { kind: 'save-collection'; label: string; name: string; ids: string[] }
  | { kind: 'open-media'; label: string; id: string }
  | { kind: 'prompt'; label: string; prompt: string }

export interface ConciergeContext {
  items: MediaLite[]
  currentId?: string | null
  /** Ids shown in the previous assistant reply (for "more like the first one"). */
  lastIds?: string[]
  taste?: TasteProfile | null
  affinity?: (item: MediaLite) => number
  followed?: Set<string>
  mode?: TasteMode
  now?: number
  seed?: number
}

export interface ConciergeReply {
  text: string
  ids: string[]
  reasons: Record<string, string>
  actions: ReplyAction[]
  refused?: boolean
  /** Interpretation chips (what the parser understood). */
  chips: string[]
  totalSeconds?: number
  collectionName?: string
}

export const SUGGESTED_PROMPTS: Array<{ label: string; prompt: string }> = [
  { label: 'Chill picks under 10 min', prompt: 'chill videos under 10 minutes' },
  { label: 'Plan tonight (45 min)', prompt: "plan tonight's watchlist for 45 minutes" },
  { label: 'Newest from my creators', prompt: 'newest videos from the last week' },
  { label: 'Surprise me', prompt: 'surprise me' },
  { label: 'Why am I seeing these?', prompt: 'explain my recommendations' },
  { label: 'Build a smart collection', prompt: 'build a smart collection of my favourite tags' },
]

export const MOOD_PROMPTS: Record<MoodId, string> = {
  chill: "Plan tonight's watchlist, chill mood, about 45 minutes",
  energetic: "Plan tonight's watchlist, high-energy mood, about 30 minutes",
  romantic: "Plan tonight's watchlist, romantic mood, about 45 minutes",
  playful: "Plan tonight's watchlist, playful mood, about 30 minutes",
  marathon: "Plan tonight's watchlist, marathon mood, about 2 hours",
}

const ids = (ranked: RankedItem[]) => ranked.map((r) => r.item.id)
const reasonMap = (ranked: RankedItem[]) => Object.fromEntries(ranked.map((r) => [r.item.id, r.reasons[0] ?? '']))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function emptyReply(text: string, chips: string[] = [], extra: Partial<ConciergeReply> = {}): ConciergeReply {
  return { text, ids: [], reasons: {}, actions: [], chips, ...extra }
}

export function answerLocally(prompt: string, ctx: ConciergeContext, query?: AiQuery): ConciergeReply {
  const now = ctx.now ?? Date.now()
  const items = ctx.items
  const q = query ?? parseNaturalQuery(prompt, { now })
  const chips = q.notes.slice(0, 6)

  if (q.refused) return emptyReply(q.refused.message, [], { refused: true })
  if (!items.length) {
    return emptyReply('Your library is still loading or empty. Once items appear I can search, plan and explain them for you.', chips)
  }
  const affinity = ctx.affinity

  switch (q.intent) {
    case 'navigate': {
      const label = q.notes[0] ?? 'that page'
      return emptyReply(`Opening ${label}.`, chips, { actions: [{ kind: 'navigate', label: `Go to ${label}`, route: q.navigate ?? '/media' }] })
    }

    case 'surprise': {
      const out = runQuery(items, { ...q, sort: 'random' }, { now, seed: ctx.seed ?? now, limit: 3, affinity })
      if (!out.results.length) return emptyReply('I could not find anything to surprise you with under those filters.', chips)
      const [first] = out.results
      return {
        text: `Here is a wildcard: “${first.item.title}” by @${first.item.creator}. Two more in case it isn’t quite right.`,
        ids: ids(out.results), reasons: reasonMap(out.results), chips,
        actions: [{ kind: 'prompt', label: 'Another surprise', prompt: 'surprise me' }],
      }
    }

    case 'similar': {
      const target = q.similarTo && q.similarTo !== 'current' ? q.similarTo : ctx.currentId ?? ctx.lastIds?.[0]
      const anchor = items.find((item) => item.id === target)
      if (!anchor) return emptyReply('Open something first (or pick one of my earlier results) and I will find more like it.', chips)
      const related = similarItems(items, anchor.id, 6)
      if (!related.length) return emptyReply(`I couldn’t find anything close to “${anchor.title}” yet.`, chips)
      return {
        text: `More like “${anchor.title}” — matched on shared public tags, creator and title words.`,
        ids: ids(related), reasons: reasonMap(related), chips: ['More like this', ...chips.filter((c) => c !== 'More like this')],
        actions: [],
      }
    }

    case 'plan': {
      const minutes = q.budgetMinutes ?? 45
      const plan = planSession(items, { moods: q.moods, minutes, now, affinity, q: { ...q, sort: 'relevance' } })
      if (!plan.items.length) return emptyReply(`I couldn’t fit a ${minutes}-minute session from what’s loaded. Try a longer budget or a different mood.`, chips)
      const moodText = q.moods.length ? `${q.moods.map((m) => moodById(m)?.label.toLowerCase()).join(' + ')} ` : ''
      return {
        text: `Tonight’s ${moodText}watchlist: ${plural(plan.items.length, 'pick')}, about ${formatMinutes(plan.totalSeconds)} of your ${minutes}-minute window. It builds up so the strongest fit lands last.`,
        ids: ids(plan.items), reasons: reasonMap(plan.items), chips, totalSeconds: plan.totalSeconds,
        actions: [{ kind: 'save-collection', label: 'Save as collection', name: `Tonight · ${moodText.trim() || 'mixed'}`.trim(), ids: ids(plan.items) }],
      }
    }

    case 'collection': {
      const hasFilter = Boolean(q.tags.length || q.text || q.moods.length || q.creators.length || q.mediaType)
      if (hasFilter) {
        const out = runQuery(items, { ...q, intent: 'search' }, { now, limit: 12, affinity })
        if (!out.results.length) return emptyReply('Nothing matches that description yet, so there is nothing to collect.', chips)
        const name = collectionTitle(q)
        return {
          text: `Collected ${plural(out.results.length, 'item')} for “${name}”. Save it to keep it in your collections.`,
          ids: ids(out.results), reasons: reasonMap(out.results), chips, collectionName: name,
          actions: [{ kind: 'save-collection', label: 'Save as collection', name, ids: ids(out.results) }],
        }
      }
      const suggestions = suggestCollections(items, 3)
      if (!suggestions.length) return emptyReply('I need a few more related items before I can suggest a smart collection.', chips)
      const first = suggestions[0]
      const byId = new Map(items.map((item) => [item.id, item]))
      const ranked: RankedItem[] = first.ids.slice(0, 12).flatMap((id) => { const item = byId.get(id); return item ? [{ item, score: 1, reasons: [first.description] }] : [] })
      return {
        text: `Smart collection idea: “${first.name}” — ${first.description}.${suggestions.length > 1 ? ` I also see ${suggestions.slice(1).map((s) => `“${s.name}”`).join(' and ')}.` : ''}`,
        ids: ids(ranked), reasons: reasonMap(ranked), chips, collectionName: first.name,
        actions: [
          { kind: 'save-collection', label: `Save “${first.name}”`, name: first.name, ids: first.ids },
          ...suggestions.slice(1).map((s): ReplyAction => ({ kind: 'save-collection', label: `Save “${s.name}”`, name: s.name, ids: s.ids })),
        ],
      }
    }

    case 'explain': {
      const profile = ctx.taste
      if (!profile || !hasTasteSignal(profile, { followed: ctx.followed })) {
        return emptyReply('I haven’t learned your taste yet. Like, follow or watch a few things (or use “more/less like this”) and I’ll explain what drives your For You picks. Everything I learn stays on this device.', chips)
      }
      const recs = recommendForYou(items, profile, { now, limit: 5, mode: ctx.mode, followed: ctx.followed, seed: ctx.seed })
      const summary = summarizeTaste(profile, now)
      const bits = [
        summary.topTags.length ? `you lean towards ${summary.topTags.slice(0, 3).map((t) => `#${t.tag}`).join(', ')}` : '',
        summary.topCreators.length ? `you return to ${summary.topCreators.slice(0, 2).map((c) => `@${c.creator}`).join(' and ')}` : '',
        summary.favoriteLength ? `you usually watch ${summary.favoriteLength} videos` : '',
        summary.peakDaypart ? `you watch most in the ${summary.peakDaypart}` : '',
      ].filter(Boolean)
      return {
        text: `Here is why your picks look the way they do: ${bits.length ? bits.join('; ') : 'signals are still light'}. A little exploration is mixed in so you keep finding new things.`,
        ids: recs.map((r) => r.item.id), reasons: Object.fromEntries(recs.map((r) => [r.item.id, r.reasons[0] ?? ''])), chips,
        actions: [{ kind: 'navigate', label: 'Manage taste in Settings', route: '/settings' }],
      }
    }

    default: {
      if (!q.tags.length && !q.text && !q.moods.length && !q.creators.length && q.sort === 'relevance' && q.minDuration === undefined && q.maxDuration === undefined && q.since === undefined && !q.mediaType && !q.sources.length) {
        // Nothing understood: fall back to a taste-aware nudge instead of a shrug.
        if (ctx.taste && hasTasteSignal(ctx.taste, { followed: ctx.followed })) {
          const recs = recommendForYou(items, ctx.taste, { now, limit: 5, mode: ctx.mode, followed: ctx.followed, seed: ctx.seed })
          return { text: 'I wasn’t sure what to filter on, so here are some picks tuned to your taste. Try “chill solo under 10 minutes” or “plan tonight”.', ids: recs.map((r) => r.item.id), reasons: Object.fromEntries(recs.map((r) => [r.item.id, r.reasons[0] ?? ''])), chips, actions: [] }
        }
        return emptyReply('I can search by tag, creator, length and recency, plan a session, or find more like something. Try “chill solo videos under 5 minutes” or “plan tonight’s watchlist”.', chips, {
          actions: SUGGESTED_PROMPTS.slice(0, 3).map((s) => ({ kind: 'prompt', label: s.label, prompt: s.prompt })),
        })
      }
      const out = runQuery(items, q, { now, limit: 8, affinity })
      if (!out.results.length) {
        return emptyReply(`Nothing matches “${prompt.trim().slice(0, 60)}”. Try fewer filters or a broader tag.`, chips, {
          actions: [{ kind: 'prompt', label: 'Surprise me instead', prompt: 'surprise me' }],
        })
      }
      const relaxed = out.relaxed.length ? ` (${out.relaxed[0].charAt(0).toLowerCase()}${out.relaxed[0].slice(1)})` : ''
      return {
        text: `Found ${plural(out.total, 'match')}${relaxed}. ${out.results.length < out.total ? `Showing the best ${out.results.length}.` : ''}`.trim(),
        ids: ids(out.results), reasons: reasonMap(out.results), chips,
        actions: out.total > out.results.length ? [{ kind: 'navigate', label: `See all ${out.total} in Search`, route: `/search?q=${encodeURIComponent(prompt.trim())}` }] : [],
      }
    }
  }
}

function collectionTitle(q: AiQuery): string {
  const parts = [...q.moods.map((m) => moodById(m)?.label ?? m), ...q.tags.map((t) => t.replace(/-/g, ' ')), ...(q.creators.length ? [`@${q.creators[0]}`] : [])]
  const name = parts.length ? parts.join(' · ') : q.text || 'Smart picks'
  return name.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60)
}

/** "Why this?" for a single item, using the taste breakdown. */
export function explainItem(item: MediaLite, taste: TasteProfile | null | undefined, ctx: { followed?: Set<string>; now?: number } = {}): string[] {
  if (!taste) return ['Ranked on public engagement and freshness — no personal history yet.']
  const now = ctx.now ?? Date.now()
  const b = scoreItem(item, taste, { now, followed: ctx.followed })
  return explainBreakdown(item, b, { now, profile: taste })
}
