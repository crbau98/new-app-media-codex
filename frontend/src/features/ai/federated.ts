/** Pure helpers behind the AI-assisted federated (PeerTube / Mastodon) search. */

import { detectUnsafeIntent, parseNaturalQuery, redactPII, searchText, type MediaLite } from './core/library.ts'

export type FederatedSource = 'peertube' | 'mastodon'

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/**
 * Understand a plain-language request ("chill solo videos") and reduce it to the
 * best provider term. Mastodon hashtags are a single word, so the strongest one
 * is picked; PeerTube gets the tag words plus any leftover text. PII is
 * redacted first and unsafe requests are refused before anything is sent.
 */
export function interpretFederatedTerm(input: string, source: FederatedSource): { term: string; refused?: string; understood?: string } {
  const raw = redactPII(input.trim().replace(/^#/, ''))
  const verdict = detectUnsafeIntent(raw)
  if (verdict.blocked) return { term: '', refused: verdict.message }
  if (!/\s/.test(raw)) return { term: raw }
  const parsed = parseNaturalQuery(raw)
  const words = [...parsed.tags, ...parsed.text.split(' ')].filter(Boolean)
  if (!words.length) return { term: raw }
  const term = source === 'mastodon' ? words[0].replace(/[^a-z0-9_]/gi, '') : words.join(' ')
  return { term: term || raw, understood: term && term !== raw ? term : undefined }
}

/** Order provider results by relevance to the term (BM25 + synonyms) without dropping any. */
export function rankFederatedItems(items: Array<Record<string, unknown>>, term: string): Array<Record<string, unknown>> {
  if (items.length < 3 || !term) return items
  const lites: MediaLite[] = items.map((raw, index) => ({
    id: String(index),
    title: asString(raw.title) ?? asString(raw.description) ?? '',
    creator: asString(raw.creator) ?? asString(raw.channel) ?? asString(raw.account) ?? '',
    source: '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    duration: typeof raw.duration === 'number' ? raw.duration : 0,
    isVideo: true, views: 0, likes: 0, createdAt: asString(raw.publishedAt) ?? '',
  }))
  const order = new Map(searchText(lites, term, items.length).map((entry, rank) => [entry.item.id, rank]))
  return items
    .map((raw, index) => ({ raw, rank: order.get(String(index)) ?? items.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.raw)
}
