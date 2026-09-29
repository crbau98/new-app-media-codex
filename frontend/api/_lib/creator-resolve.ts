/**
 * Pure creator-resolution logic: query sanitising, handle variants, name
 * similarity and candidate ranking. No I/O. Resolves names to PUBLIC platform
 * creator handles only.
 */
import { normalizeKey } from './creator-registry.js'

export const MAX_VARIANTS = 24
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const HANDLE_CHARS = /^[a-z0-9_.-]{2,50}$/

export type SanitizedQuery =
  | { ok: true; text: string; /** true when the input was a URL or @handle */ handleLike: boolean }
  | { ok: false; reason: 'too_short' | 'too_long' | 'email' | 'pii' | 'empty' }

/** Validate and normalise a user query. Strips URLs / @ to a bare handle; rejects emails and PII-looking input. */
export function sanitizeQuery(raw: string): SanitizedQuery {
  let text = String(raw || '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  if (EMAIL.test(text)) return { ok: false, reason: 'email' }
  // Phone / long-number / SSN-like strings.
  if (/(?:\+?\d[\s().-]?){9,}/.test(text) && text.replace(/\D/g, '').length >= 9) return { ok: false, reason: 'pii' }
  let handleLike = false
  const urlMatch = text.match(/^(?:https?:\/\/)?(?:www\.|m\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/(.+)$/i)
  if (urlMatch) {
    const segments = urlMatch[2].split(/[?#]/)[0].split('/').filter(Boolean)
    const marker = new Set(['users', 'user', 'creators', 'creator', 'u', 'c', 'channel', 'channels', 'a', 'accounts'])
    let seg = segments[0] || ''
    if (marker.has(seg.toLowerCase()) && segments[1]) seg = segments[1]
    text = seg.replace(/^@/, '')
    handleLike = true
  } else if (text.startsWith('@')) {
    text = text.slice(1)
    handleLike = true
  }
  try { text = decodeURIComponent(text) } catch { /* keep raw */ }
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length < 2) return { ok: false, reason: 'too_short' }
  if (text.length > 80) return { ok: false, reason: 'too_long' }
  return { ok: true, text, handleLike }
}

function tokensOf(text: string): string[] {
  return text
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function clean(handle: string): string {
  return handle.toLowerCase().replace(/[^a-z0-9_.-]+/g, '').replace(/^[_.-]+|[_.-]+$/g, '')
}

const SUFFIXES = ['official', 'xxx', 'real', '1', '69', 'nsfw']
const PREFIXES = ['real', 'official', 'its', 'the']

/**
 * Ordered candidate provider usernames for a free-text name, most likely first.
 * Deduped, only [a-z0-9_.-], capped at MAX_VARIANTS.
 */
export function handleVariants(query: string, cap = MAX_VARIANTS): string[] {
  const s = sanitizeQuery(query)
  if (!s.ok) return []
  const tokens = tokensOf(s.text)
  if (!tokens.length) return []
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    const v = clean(value)
    if (!HANDLE_CHARS.test(v) || seen.has(v) || out.length >= cap) return
    seen.add(v)
    out.push(v)
  }
  // A typed handle (with its own separators) is the single most likely candidate.
  const typed = s.text.toLowerCase().replace(/\s+/g, '')
  if (tokens.length === 1 || /[_.-]/.test(typed)) push(typed)

  if (tokens.length === 1) {
    const base = tokens[0]
    push(base)
    for (const suffix of SUFFIXES) push(base + suffix)
    push(`${base}_official`)
    for (const prefix of PREFIXES) push(prefix + base)
    push(`${base}_`)
    push(`${base}_xxx`)
    return out
  }

  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  const all = tokens.join('')
  push(all)
  push(tokens.join('_'))
  push(tokens.join('.'))
  push(tokens.join('-'))
  push(`${last}${first}`)
  push(`${last}_${first}`)
  push(`${last}.${first}`)
  if (tokens.length > 2) { push(first + last); push(`${first}_${last}`) }
  push(`${first}${last[0]}`)
  push(`${first}_${last[0]}`)
  for (const suffix of ['1', 'official', 'xxx', 'real']) push(all + suffix)
  push(`${all}_official`)
  push(`real${all}`)
  push(`official${all}`)
  push(`${tokens.join('_')}_official`)
  push(`${first}${last}69`)
  push(`its${all}`)
  push(`${all}nsfw`)
  return out
}

/** Merge several variant lists round-robin (keeps each list's own order), deduped and capped. */
export function mergeVariants(lists: string[][], cap = MAX_VARIANTS): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = 0; out.length < cap; i++) {
    let any = false
    for (const list of lists) {
      if (i >= list.length) continue
      any = true
      if (!seen.has(list[i]) && out.length < cap) { seen.add(list[i]); out.push(list[i]) }
    }
    if (!any) break
  }
  return out
}

/** Damerau-Levenshtein (optimal string alignment) distance. */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[a.length][b.length]
}

/** 0..1 similarity between a typed name and a candidate handle / display name. */
export function nameSimilarity(query: string, candidate: string): number {
  const q = normalizeKey(query)
  const c = normalizeKey(candidate)
  if (!q || !c) return 0
  if (q === c) return 1
  const maxLen = Math.max(q.length, c.length)
  let score = 1 - damerauLevenshtein(q, c) / maxLen
  const tokens = tokensOf(query).filter((t) => t.length >= 2)
  if (tokens.length) {
    const hit = tokens.filter((t) => c.includes(t)).length
    const overlap = hit / tokens.length
    if (tokens.length >= 2) score = Math.max(score, overlap === 1 ? 0.9 : overlap * 0.6)
    else if (overlap === 1) score = Math.max(score, 0.7 + 0.2 * (tokens[0].length / c.length))
  }
  const shorter = q.length <= c.length ? q : c
  const longer = q.length <= c.length ? c : q
  if (shorter.length >= 4 && (longer.startsWith(shorter) || longer.endsWith(shorter))) {
    score = Math.max(score, 0.72 + 0.2 * (shorter.length / longer.length))
  }
  return Math.min(0.99, Math.max(0, score))
}

/** True when a distinctive (>=4 char) word of the query appears inside the handle. */
export function sharesToken(query: string, candidate: string): boolean {
  const c = normalizeKey(candidate)
  return tokensOf(query).some((t) => t.length >= 4 && c.includes(t))
}

export type RawCandidate = {
  handle: string
  origin: 'registry' | 'variant' | 'text' | 'endpoint'
  /** Position in the ordered variant list (variant origin). */
  variantIndex?: number
  /** Provider catalog size when probed. */
  total?: number | null
  /** How many text-search hits carried this username. */
  mentions?: number
  displayName?: string
}

export type RankedCandidate = RawCandidate & {
  confidence: number
  matchedBy: 'exact' | 'variant' | 'alias' | 'search'
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Assign confidence + matchedBy, dedupe by handle (best wins), sort best-first. */
export function rankCandidates(query: string, candidates: RawCandidate[]): RankedCandidate[] {
  const queryKey = normalizeKey(query)
  const best = new Map<string, RankedCandidate>()
  for (const cand of candidates) {
    const key = normalizeKey(cand.handle)
    if (!key) continue
    const sameAsQuery = key === queryKey
    let confidence: number
    let matchedBy: RankedCandidate['matchedBy']
    if (cand.origin === 'registry') {
      confidence = sameAsQuery ? 0.99 : 0.98
      matchedBy = sameAsQuery ? 'exact' : 'alias'
    } else if (cand.origin === 'variant') {
      const idx = Math.min(cand.variantIndex ?? 0, 12)
      confidence = (sameAsQuery ? 0.95 : 0.88) - idx * 0.02
      if ((cand.total ?? 0) >= 10) confidence += 0.02
      matchedBy = sameAsQuery ? 'exact' : 'variant'
    } else {
      const sim = nameSimilarity(query, cand.handle)
      const mentions = cand.mentions ?? 1
      confidence = 0.2 + 0.45 * sim + Math.min(mentions, 10) * 0.02
      if (sameAsQuery) { confidence = 0.9; matchedBy = 'exact' } else matchedBy = 'search'
      confidence = Math.min(confidence, sameAsQuery ? 0.9 : 0.8)
    }
    const ranked: RankedCandidate = { ...cand, confidence: round2(Math.max(0.05, Math.min(0.99, confidence))), matchedBy }
    const current = best.get(key)
    if (!current || ranked.confidence > current.confidence) {
      best.set(key, { ...ranked, total: ranked.total ?? current?.total, displayName: ranked.displayName ?? current?.displayName })
    } else if (current) {
      current.total = current.total ?? cand.total
      current.displayName = current.displayName ?? cand.displayName
    }
  }
  return [...best.values()].sort((a, b) =>
    b.confidence - a.confidence || (b.total ?? 0) - (a.total ?? 0) || a.handle.localeCompare(b.handle))
}

/** Bounded-concurrency map preserving order. Never rejects: failures become `undefined`. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      try { results[i] = await fn(items[i], i) } catch { results[i] = undefined }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
