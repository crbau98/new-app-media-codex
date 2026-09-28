import type { MediaItem } from './types.ts'
import { canonicalTag, creatorKey, parseNaturalQuery, stem, synonymsOf, tokenize, type AiQuery, type Vocab } from '../features/ai/core/library.ts'

export type StructuredQuery = {
  text: string
  source?: string
  creator?: string
  tag?: string
  minDuration?: number
  maxDuration?: number
  minViews?: number
  quality?: 'hd' | 'sd'
  /** Extended fields populated by `parseSearchInput` (natural language). */
  tags?: string[]
  excludeTags?: string[]
  since?: number
  mediaType?: 'video' | 'image'
  /** Set when the guardrails refuse the query (identify/locate/minors/non-consent). */
  refused?: string
}

function parseDuration(value: string): number | undefined {
  const match = value.match(/^(\d+)(s|m)?$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  return match[2]?.toLowerCase() === 'm' ? amount * 60 : amount
}

function mediaDurationSeconds(duration: string): number {
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/**
 * Backward-compatible entry point used by the Search page. Classic operators
 * (`tag:`, `creator:`, `duration:1m-5m` ...) behave exactly as before. When a
 * query has no operators but is clearly natural language ("solo under 5
 * minutes", "by @creator") it is understood too. Plain keyword queries are left
 * untouched so they still go to the server search unchanged.
 */
export function parseProQuery(input: string): StructuredQuery {
  const legacy = parseOperators(input)
  const hasLegacyOperator = Boolean(
    legacy.source || legacy.creator || legacy.tag || legacy.minDuration !== undefined ||
      legacy.maxDuration !== undefined || legacy.minViews !== undefined || legacy.quality,
  )
  if (hasLegacyOperator || !input.trim()) return legacy
  const ai = parseNaturalQuery(input)
  // An impossible view floor makes pages that only inspect operators treat this as a
  // structured query with zero matches, so a refused query is never forwarded to providers.
  if (ai.refused) return { text: '', refused: ai.refused.message, minViews: Number.POSITIVE_INFINITY }
  const structural = ai.minDuration !== undefined || ai.maxDuration !== undefined || ai.creators.length > 0 ||
    ai.sources.length > 0 || ai.minViews !== undefined
  if (!structural) return legacy
  return parseSearchInput(input).structured
}

function parseOperators(input: string): StructuredQuery {
  const query: StructuredQuery = { text: '' }
  const freeText: string[] = []
  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const [rawKey, ...rest] = token.split(':')
    const key = rawKey.toLowerCase()
    const value = rest.join(':')
    if (!value) {
      freeText.push(token)
      continue
    }
    if (key === 'source') query.source = value.toLowerCase()
    else if (key === 'creator') query.creator = value.replace(/^@/, '').toLowerCase()
    else if (key === 'tag') query.tag = value.toLowerCase()
    else if (key === 'quality' && /^(hd|sd)$/i.test(value)) query.quality = value.toLowerCase() as 'hd' | 'sd'
    else if (key === 'views' && /^>\d+$/.test(value)) query.minViews = Number(value.slice(1))
    else if (key === 'duration') {
      const range = value.match(/^(\d+[sm]?)-(\d+[sm]?)$/i)
      if (range) {
        query.minDuration = parseDuration(range[1])
        query.maxDuration = parseDuration(range[2])
      } else if (value.startsWith('>')) query.minDuration = parseDuration(value.slice(1))
      else if (value.startsWith('<')) query.maxDuration = parseDuration(value.slice(1))
    } else freeText.push(token)
  }
  query.text = freeText.join(' ').toLowerCase()
  return query
}

function editDistance(a: string, b: string): number {
  if (!a) return b.length
  if (!b) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}

function wordMatches(words: string[], haystack: string, token: string): boolean {
  if (haystack.includes(token)) return true
  const stemmed = stem(token)
  if (stemmed.length >= 3 && haystack.includes(stemmed)) return true
  if (synonymsOf(token).some((alias) => alias !== token && haystack.includes(alias))) return true
  if (token.length < 4) return false
  return words.some((word) => editDistance(word.slice(0, token.length + 1), token) <= 1 || editDistance(word, token) <= 1)
}

/** Every query word must match (substring, plural/stem, synonym, or one typo). */
function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true
  if (haystack.includes(needle)) return true
  const words = haystack.split(/\s+/)
  const tokens = tokenize(needle)
  if (!tokens.length) return false
  return tokens.every((token) => wordMatches(words, haystack, token))
}

/**
 * Natural-language aware parse used by the Search page and command bar. Pro
 * syntax (`creator:x tag:y duration:1m-5m`) still works exactly as before; plain
 * language ("chill solo under 5 minutes from last week") is layered on top.
 */
export function parseSearchInput(input: string, opts: { vocab?: Vocab; now?: number } = {}): { structured: StructuredQuery; ai: AiQuery } {
  const ai = parseNaturalQuery(input, opts)
  const structured: StructuredQuery = {
    text: ai.text,
    source: ai.sources[0],
    creator: ai.creators[0],
    tag: ai.tags[0],
    tags: ai.tags,
    excludeTags: ai.excludeTags,
    minDuration: ai.minDuration,
    maxDuration: ai.maxDuration,
    minViews: ai.minViews,
    since: ai.since,
    mediaType: ai.mediaType,
  }
  return { structured, ai }
}

export function filterMedia(items: MediaItem[], structured: StructuredQuery): MediaItem[] {
  return items.filter((item) => {
    const haystack = [item.title, item.creator, item.source, item.description ?? '', ...item.tags].join(' ').toLowerCase()
    if (structured.text && !fuzzyIncludes(haystack, structured.text)) return false
    if (structured.source && item.source.toLowerCase() !== structured.source && !item.source.toLowerCase().includes(structured.source)) return false
    if (structured.creator && creatorKey(item.creator) !== creatorKey(structured.creator)) return false
    const canon = new Set(item.tags.map(canonicalTag))
    if (structured.tags?.length) {
      // Natural-language tags are soft: a tag word in the title/description counts too.
      const words = haystack.split(/\s+/)
      for (const tag of structured.tags) {
        const key = canonicalTag(tag)
        if (!canon.has(key) && !wordMatches(words, haystack, key)) return false
      }
    } else if (structured.tag && !canon.has(canonicalTag(structured.tag))) return false
    if (structured.excludeTags?.some((tag) => canon.has(canonicalTag(tag)))) return false
    if (structured.mediaType === 'image' && item.isVideo) return false
    if (structured.mediaType === 'video' && !item.isVideo) return false
    if (structured.since !== undefined) {
      const created = Date.parse(item.createdAt)
      if (!Number.isFinite(created) || created < structured.since) return false
    }
    const seconds = item.isVideo ? mediaDurationSeconds(item.duration) : 0
    if (structured.minDuration !== undefined && (!item.isVideo || seconds < structured.minDuration)) return false
    if (structured.maxDuration !== undefined && (!item.isVideo || seconds > structured.maxDuration)) return false
    if (structured.minViews !== undefined && item.views < structured.minViews) return false
    if (structured.quality === 'hd' && item.isVideo && seconds > 0 && item.views < 1000) return false
    return true
  })
}
