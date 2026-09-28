/**
 * On-device Taste Engine — pure functions only.
 *
 * A taste profile is a set of sparse affinity vectors (tags, creators, sources,
 * watch-length buckets, day-part tag habits and recent search terms). Every
 * affinity decays exponentially with its own half-life, positive and negative
 * evidence are tracked separately (for Thompson-style exploration), and ranking
 * combines exploitation (score), exploration (epsilon / Thompson draws) and
 * diversity (MMR). Nothing here touches the network or storage.
 */

import {
  canonicalTag,
  creatorKey,
  itemSimilarity,
  mmrSelect,
  mulberry32,
  stem,
  tokenize,
  type MediaLite,
} from '../core/library.ts'

export type Daypart = 'morning' | 'day' | 'evening' | 'night'
export type LengthBucket = 'xs' | 's' | 'm' | 'l' | 'xl'
export type TasteMode = 'balanced' | 'familiar' | 'adventurous'

export type SignalKind =
  | 'like' | 'unlike' | 'follow' | 'unfollow' | 'view' | 'dwell' | 'complete' | 'skip'
  | 'more' | 'less' | 'hide' | 'search'

export interface Affinity {
  /** Signed weight at time `t` (decays). */
  w: number
  /** Last update, epoch ms. */
  t: number
  /** Positive / negative evidence counts (never decay) — Beta posterior for Thompson draws. */
  p: number
  q: number
}

export interface TasteProfile {
  v: 1
  createdAt: number
  updatedAt: number
  events: number
  tags: Record<string, Affinity>
  creators: Record<string, Affinity>
  sources: Record<string, Affinity>
  lengths: Record<LengthBucket, Affinity>
  dayparts: Record<Daypart, Record<string, Affinity>>
  searches: Record<string, Affinity>
  /** Idempotency ledger for signals derived from app state ("like:<id>", "view:<id>", ...). */
  applied: Record<string, number>
}

export interface SignalItem {
  id: string
  creator: string
  source: string
  tags: string[]
  /** Seconds, 0 when unknown/image. */
  duration: number
}

export const HALF_LIFE_DAYS = { tags: 21, creators: 45, sources: 60, lengths: 45, dayparts: 30, searches: 7 } as const
export const SIGNAL_WEIGHTS: Record<Exclude<SignalKind, 'dwell' | 'search'>, number> = {
  like: 3, unlike: -2, follow: 5, unfollow: -3, view: 0.4, complete: 2.5, skip: -1, more: 3, less: -3, hide: -5,
}
const CLAMP = { min: -20, max: 40 }
const MAX_ENTRIES = 400
const DAY = 86_400_000

export function daypartOf(hour: number): Daypart {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'day'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

export function lengthBucket(seconds: number): LengthBucket {
  if (seconds < 60) return 'xs'
  if (seconds < 300) return 's'
  if (seconds < 900) return 'm'
  if (seconds < 2400) return 'l'
  return 'xl'
}

const LENGTH_LABEL: Record<LengthBucket, string> = { xs: 'under a minute', s: '1–5 min', m: '5–15 min', l: '15–40 min', xl: '40+ min' }
export function lengthLabel(bucket: LengthBucket): string { return LENGTH_LABEL[bucket] }

const zero = (now: number): Affinity => ({ w: 0, t: now, p: 0, q: 0 })

export function emptyTasteProfile(now = Date.now()): TasteProfile {
  return {
    v: 1, createdAt: now, updatedAt: now, events: 0,
    tags: {}, creators: {}, sources: {},
    lengths: { xs: zero(now), s: zero(now), m: zero(now), l: zero(now), xl: zero(now) },
    dayparts: { morning: {}, day: {}, evening: {}, night: {} },
    searches: {}, applied: {},
  }
}

/** Value of an affinity at `now` after exponential half-life decay. */
export function decayed(aff: Affinity | undefined, now: number, halfLifeDays: number): number {
  if (!aff) return 0
  const age = Math.max(0, now - aff.t) / DAY
  return aff.w * Math.pow(0.5, age / halfLifeDays)
}

function bump(bucket: Record<string, Affinity>, key: string, delta: number, now: number, halfLifeDays: number) {
  if (!key) return
  const prev = bucket[key]
  const base = decayed(prev, now, halfLifeDays)
  bucket[key] = {
    w: Math.max(CLAMP.min, Math.min(CLAMP.max, base + delta)),
    t: now,
    p: (prev?.p ?? 0) + (delta > 0 ? 1 : 0),
    q: (prev?.q ?? 0) + (delta < 0 ? 1 : 0),
  }
}

function prune(bucket: Record<string, Affinity>, now: number, halfLifeDays: number) {
  const keys = Object.keys(bucket)
  if (keys.length <= MAX_ENTRIES) return
  const ranked = keys.map((k) => [k, Math.abs(decayed(bucket[k], now, halfLifeDays))] as const).sort((a, b) => b[1] - a[1])
  for (const [k] of ranked.slice(MAX_ENTRIES)) delete bucket[k]
}

function cloneProfile(p: TasteProfile): TasteProfile {
  return {
    ...p,
    tags: { ...p.tags }, creators: { ...p.creators }, sources: { ...p.sources },
    lengths: { ...p.lengths },
    dayparts: { morning: { ...p.dayparts.morning }, day: { ...p.dayparts.day }, evening: { ...p.dayparts.evening }, night: { ...p.dayparts.night } },
    searches: { ...p.searches }, applied: { ...p.applied },
  }
}

export function canonicalTagsOf(item: { tags: string[] }, max = 8): string[] {
  const out: string[] = []
  for (const tag of item.tags) {
    const canon = canonicalTag(tag)
    if (canon && !out.includes(canon)) out.push(canon)
    if (out.length >= max) break
  }
  return out
}

/**
 * Fold one signal into the profile. `amount` scales the weight (e.g. minutes
 * of dwell). Pure: returns a new profile.
 */
export function applySignal(
  profile: TasteProfile,
  kind: SignalKind,
  item: SignalItem | null,
  opts: { now?: number; amount?: number; term?: string } = {},
): TasteProfile {
  const now = opts.now ?? Date.now()
  const next = cloneProfile(profile)
  next.updatedAt = now
  next.events += 1

  if (kind === 'search') {
    for (const token of tokenize(opts.term ?? '')) {
      const term = stem(token)
      if (term.length < 3) continue
      bump(next.searches, term, 1, now, HALF_LIFE_DAYS.searches)
    }
    prune(next.searches, now, HALF_LIFE_DAYS.searches)
    return next
  }
  if (!item) return next

  const base = kind === 'dwell' ? Math.min(3, Math.max(0, opts.amount ?? 0.5)) : SIGNAL_WEIGHTS[kind]
  const weight = base * (kind === 'dwell' ? 1 : (opts.amount ?? 1))
  const tags = canonicalTagsOf(item)
  const perTag = tags.length ? weight / Math.sqrt(tags.length) : 0
  const creator = creatorKey(item.creator)
  const isPositive = weight > 0

  if (kind === 'follow' || kind === 'unfollow') {
    if (creator) bump(next.creators, creator, weight, now, HALF_LIFE_DAYS.creators)
    for (const tag of tags) bump(next.tags, tag, perTag * 0.3, now, HALF_LIFE_DAYS.tags)
    return next
  }

  for (const tag of tags) bump(next.tags, tag, perTag, now, HALF_LIFE_DAYS.tags)
  if (creator) {
    const creatorWeight = kind === 'hide' || kind === 'less' ? weight * 0.5 : kind === 'view' ? weight * 0.5 : weight * 0.8
    bump(next.creators, creator, creatorWeight, now, HALF_LIFE_DAYS.creators)
  }
  const source = creatorKey(item.source)
  if (source) bump(next.sources, source, weight * 0.25, now, HALF_LIFE_DAYS.sources)
  if (item.duration > 0 && kind !== 'view') {
    const bucket = lengthBucket(item.duration)
    next.lengths[bucket] = bumpAffinity(next.lengths[bucket], weight * 0.5, now, HALF_LIFE_DAYS.lengths)
  }
  if (isPositive && kind !== 'view') {
    const dp = daypartOf(new Date(now).getHours())
    for (const tag of tags) bump(next.dayparts[dp], tag, perTag * 0.6, now, HALF_LIFE_DAYS.dayparts)
    prune(next.dayparts[dp], now, HALF_LIFE_DAYS.dayparts)
  }
  prune(next.tags, now, HALF_LIFE_DAYS.tags)
  prune(next.creators, now, HALF_LIFE_DAYS.creators)
  return next
}

function bumpAffinity(prev: Affinity, delta: number, now: number, halfLifeDays: number): Affinity {
  return {
    w: Math.max(CLAMP.min, Math.min(CLAMP.max, decayed(prev, now, halfLifeDays) + delta)),
    t: now,
    p: prev.p + (delta > 0 ? 1 : 0),
    q: prev.q + (delta < 0 ? 1 : 0),
  }
}

/* ─────────────────────────────── scoring ─────────────────────────────── */

export interface ScoreContext {
  now: number
  /** creatorKey()s the user follows. */
  followed?: Set<string>
  /** Aggregated legacy "more/less like this" preferences from the app store (already on-device). */
  priorTags?: Record<string, number>
  priorCreators?: Record<string, number>
  hidden?: Set<string>
  /** id -> last seen ms, to damp repeats. */
  seen?: Map<string, number>
  mode?: TasteMode
  /** Tag document frequencies (for rarity weighting). */
  tagDf?: Map<string, number>
  totalItems?: number
}

export interface ScoreBreakdown {
  creator: number
  tags: number
  source: number
  length: number
  daypart: number
  search: number
  quality: number
  repeat: number
  raw: number
  score: number
  /** 0 = deeply familiar, 1 = entirely new territory. */
  novelty: number
  topTags: string[]
  negTags: string[]
  followedCreator: boolean
}

const tanh = Math.tanh

function itemQuality(item: MediaLite, now: number): number {
  const curation = item.curation ?? Math.min(100, Math.log10(item.views + 10) * 14 + Math.log10(item.likes + 10) * 10)
  const t = Date.parse(item.createdAt)
  const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : 90
  return Math.min(1, curation / 100) * 0.7 + Math.max(0, 1 - ageDays / 90) * 0.3
}

export function scoreItem(item: MediaLite, profile: TasteProfile, ctx: ScoreContext): ScoreBreakdown {
  const now = ctx.now
  const ck = creatorKey(item.creator)
  const followedCreator = Boolean(ctx.followed?.has(ck))
  const tags = canonicalTagsOf(item)

  let creator = tanh(decayed(profile.creators[ck], now, HALF_LIFE_DAYS.creators) / 6)
  if (followedCreator) creator += 0.6
  creator += tanh((ctx.priorCreators?.[ck] ?? 0) / 5) * 0.5
  creator = Math.max(-1.2, Math.min(1.6, creator))

  const dp = daypartOf(new Date(now).getHours())
  const tagVals: Array<{ tag: string; v: number }> = []
  let daypart = 0
  for (const tag of tags) {
    const rarity = ctx.tagDf && ctx.totalItems ? 0.75 + 0.5 * Math.min(1, Math.log(1 + ctx.totalItems / (1 + (ctx.tagDf.get(tag) ?? 0))) / Math.log(1 + ctx.totalItems)) : 1
    const v = (tanh(decayed(profile.tags[tag], now, HALF_LIFE_DAYS.tags) / 6) + tanh((ctx.priorTags?.[tag] ?? 0) / 5) * 0.4) * rarity
    tagVals.push({ tag, v })
    daypart += tanh(decayed(profile.dayparts[dp][tag], now, HALF_LIFE_DAYS.dayparts) / 4)
  }
  tagVals.sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
  const top = tagVals.slice(0, 4)
  const tagsScore = Math.max(-1.4, Math.min(1.6, top.reduce((s, x) => s + x.v, 0) / 2))
  daypart = tags.length ? (daypart / tags.length) * 0.5 : 0

  const source = tanh(decayed(profile.sources[creatorKey(item.source)], now, HALF_LIFE_DAYS.sources) / 8) * 0.3
  const length = item.isVideo && item.duration > 0 ? tanh(decayed(profile.lengths[lengthBucket(item.duration)], now, HALF_LIFE_DAYS.lengths) / 5) * 0.4 : 0

  let search = 0
  const titleTerms = new Set(tokenize(`${item.title} ${item.tags.join(' ')}`).map(stem))
  for (const term of titleTerms) search += tanh(decayed(profile.searches[term], now, HALF_LIFE_DAYS.searches) / 3)
  search = Math.min(1, search) * 0.5

  const quality = itemQuality(item, now)
  const seenAt = ctx.seen?.get(item.id)
  const repeat = seenAt ? -0.5 * Math.pow(0.5, Math.max(0, now - seenAt) / (2 * DAY)) : 0

  const raw = 2.2 * creator + 2.0 * tagsScore + 0.6 * source + 0.7 * length + 0.8 * daypart + 0.9 * search + 1.4 * quality + repeat
  const score = 100 / (1 + Math.exp(-(raw - 1.5) / 1.6))
  const familiarity = Math.min(1, Math.abs(creator) + Math.abs(tagsScore) * 1.4)
  return {
    creator, tags: tagsScore, source, length, daypart, search, quality, repeat, raw, score,
    novelty: 1 - familiarity,
    topTags: top.filter((x) => x.v > 0.2).map((x) => x.tag),
    negTags: top.filter((x) => x.v < -0.2).map((x) => x.tag),
    followedCreator,
  }
}

/** Ordered, human-readable reasons — the "why you're seeing this" explanation. */
export function explainBreakdown(item: MediaLite, b: ScoreBreakdown, opts: { explore?: boolean; profile?: TasteProfile; now?: number } = {}): string[] {
  const reasons: string[] = []
  if (b.followedCreator) reasons.push(`Because you follow @${item.creator}`)
  else if (b.creator > 0.35) reasons.push(`You keep coming back to @${item.creator}`)
  if (b.topTags.length) reasons.push(`You like ${b.topTags.slice(0, 2).map((t) => `#${t}`).join(' and ')}`)
  if (b.daypart > 0.15) reasons.push(`Fits your ${daypartOf(new Date(opts.now ?? Date.now()).getHours())} viewing`)
  if (b.length > 0.15 && opts.profile) reasons.push('Fits your usual watch length')
  if (b.search > 0.2) reasons.push('Related to what you searched for')
  if (opts.explore) reasons.push(b.topTags.length ? 'Exploring something a little different' : `Something new${item.tags[0] ? `: #${canonicalTag(item.tags[0])}` : ''}`)
  if (b.quality > 0.65) reasons.push('Popular with viewers right now')
  if (!reasons.length) reasons.push('A fresh find from the public feed')
  return reasons.slice(0, 3)
}

/* ────────────────────────── exploration & ranking ────────────────────── */

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-9), v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Thompson-style draw from Beta(alpha, beta) via a normal approximation, clamped to 0..1. */
export function betaDraw(alpha: number, beta: number, rand: () => number): number {
  const s = alpha + beta
  const mean = alpha / s
  const sd = Math.sqrt((alpha * beta) / (s * s * (s + 1)))
  return Math.max(0, Math.min(1, mean + sd * gauss(rand)))
}

export const MODE_PARAMS: Record<TasteMode, { epsilon: number; lambda: number }> = {
  familiar: { epsilon: 0.05, lambda: 0.86 },
  balanced: { epsilon: 0.14, lambda: 0.72 },
  adventurous: { epsilon: 0.32, lambda: 0.55 },
}

export interface TasteRecommendation {
  item: MediaLite
  /** 0–100. */
  score: number
  reasons: string[]
  kind: 'exploit' | 'explore'
  breakdown: ScoreBreakdown
}

export interface RecommendOptions extends Omit<ScoreContext, 'now'> {
  now?: number
  seed?: number
  limit?: number
  /** Item ids to exclude entirely (already engaged with). */
  exclude?: Set<string>
  /** Keep items scoring at/above this (0–100) unless exploring. */
  minScore?: number
}

export function tagDocFrequency(items: MediaLite[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const item of items) for (const tag of canonicalTagsOf(item)) df.set(tag, (df.get(tag) ?? 0) + 1)
  return df
}

/** Whether the profile (plus priors) has anything to personalise with. */
export function hasTasteSignal(profile: TasteProfile, ctx: Pick<ScoreContext, 'followed' | 'priorTags' | 'priorCreators'> = {}): boolean {
  return profile.events > 0 || Boolean(ctx.followed?.size) ||
    Object.values(ctx.priorTags ?? {}).some((v) => v !== 0) || Object.values(ctx.priorCreators ?? {}).some((v) => v !== 0)
}

/**
 * Exploit/explore/diversify:
 *  1. score everything against the profile
 *  2. per slot, with probability epsilon fill from a Thompson-sampled
 *     exploration pool of novel-but-good items
 *  3. otherwise take the best MMR marginal (relevance minus similarity to picks)
 */
export function recommendForYou(items: MediaLite[], profile: TasteProfile, opts: RecommendOptions = {}): TasteRecommendation[] {
  const now = opts.now ?? Date.now()
  const limit = opts.limit ?? 12
  const params = MODE_PARAMS[opts.mode ?? 'balanced']
  const rand = mulberry32(opts.seed ?? Math.floor(now / (6 * 3_600_000)))
  const tagDf = opts.tagDf ?? tagDocFrequency(items)
  const ctx: ScoreContext = { ...opts, now, tagDf, totalItems: items.length }
  const pool = items.filter((item) => !opts.hidden?.has(item.id) && !opts.exclude?.has(item.id))
  const scored = pool.map((item) => ({ item, breakdown: scoreItem(item, profile, ctx) }))

  const exploit = scored
    .filter((s) => s.breakdown.score >= (opts.minScore ?? 0))
    .map((s) => ({ ...s, score: s.breakdown.score }))
    .sort((a, b) => b.score - a.score)
  const explore = scored
    .filter((s) => s.breakdown.novelty > 0.55 && s.breakdown.quality > 0.3 && s.breakdown.tags > -0.2 && s.breakdown.creator > -0.2)
    .map((s) => {
      const tags = canonicalTagsOf(s.item)
      const arms = tags.map((tag) => betaDraw(1 + (profile.tags[tag]?.p ?? 0), 1 + (profile.tags[tag]?.q ?? 0), rand))
      const theta = arms.length ? Math.max(...arms) : rand()
      return { ...s, draw: s.breakdown.quality * 0.55 + theta * 0.45 }
    })
    .sort((a, b) => b.draw - a.draw)

  const picked: TasteRecommendation[] = []
  const used = new Set<string>()
  const relScale = Math.max(1, ...exploit.map((e) => e.score))
  while (picked.length < limit && (exploit.length || explore.length)) {
    const wantExplore = explore.length > 0 && rand() < params.epsilon && picked.length >= 1
    if (wantExplore) {
      const idx = explore.findIndex((e) => !used.has(e.item.id))
      if (idx >= 0) {
        const [e] = explore.splice(idx, 1)
        used.add(e.item.id)
        picked.push({ item: e.item, score: e.breakdown.score, kind: 'explore', breakdown: e.breakdown, reasons: explainBreakdown(e.item, e.breakdown, { explore: true, profile, now }) })
        continue
      }
    }
    let bestIdx = -1, bestVal = -Infinity
    for (let i = 0; i < exploit.length; i += 1) {
      const c = exploit[i]
      if (used.has(c.item.id)) continue
      let maxSim = 0
      let sameCreator = 0
      const ck = creatorKey(c.item.creator)
      for (const p of picked) {
        maxSim = Math.max(maxSim, itemSimilarity(c.item, p.item))
        if (ck && creatorKey(p.item.creator) === ck) sameCreator += 1
      }
      // Similarity (MMR) plus an explicit per-creator repeat cost so a followed creator can't flood the rail.
      const val = params.lambda * (c.score / relScale) - (1 - params.lambda) * maxSim - 0.2 * sameCreator
      if (val > bestVal) { bestVal = val; bestIdx = i }
      if (i > 240) break
    }
    if (bestIdx < 0) break
    const [c] = exploit.splice(bestIdx, 1)
    used.add(c.item.id)
    picked.push({ item: c.item, score: c.score, kind: 'exploit', breakdown: c.breakdown, reasons: explainBreakdown(c.item, c.breakdown, { profile, now }) })
  }
  return picked
}

/** Affinity in -1..1 for a query pipeline (`runQuery({ affinity })`). */
export function affinityFn(profile: TasteProfile, ctx: Partial<Omit<ScoreContext, 'now'>> & { now?: number } = {}): (item: MediaLite) => number {
  const now = ctx.now ?? Date.now()
  return (item) => {
    const b = scoreItem(item, profile, { ...ctx, now })
    return Math.max(-1, Math.min(1, (b.creator * 0.5 + b.tags * 0.5 + b.daypart * 0.3)))
  }
}

/* ───────────────────────────── summaries ────────────────────────────── */

export interface TasteSummary {
  events: number
  updatedAt: number
  topTags: Array<{ tag: string; score: number }>
  topCreators: Array<{ creator: string; score: number }>
  dislikedTags: Array<{ tag: string; score: number }>
  dislikedCreators: Array<{ creator: string; score: number }>
  favoriteLength: string | null
  peakDaypart: Daypart | null
}

export function summarizeTaste(profile: TasteProfile, now = Date.now(), limit = 8): TasteSummary {
  const rank = (bucket: Record<string, Affinity>, hl: number) =>
    Object.entries(bucket).map(([key, aff]) => ({ key, score: Math.round(decayed(aff, now, hl) * 10) / 10 }))
  const tags = rank(profile.tags, HALF_LIFE_DAYS.tags)
  const creators = rank(profile.creators, HALF_LIFE_DAYS.creators)
  const lengths = (Object.entries(profile.lengths) as Array<[LengthBucket, Affinity]>).map(([b, a]) => ({ b, s: decayed(a, now, HALF_LIFE_DAYS.lengths) })).sort((a, b) => b.s - a.s)
  const parts = (Object.entries(profile.dayparts) as Array<[Daypart, Record<string, Affinity>]>)
    .map(([d, bucket]) => ({ d, s: Object.values(bucket).reduce((sum, a) => sum + Math.max(0, decayed(a, now, HALF_LIFE_DAYS.dayparts)), 0) }))
    .sort((a, b) => b.s - a.s)
  return {
    events: profile.events,
    updatedAt: profile.updatedAt,
    topTags: tags.filter((t) => t.score > 0.3).sort((a, b) => b.score - a.score).slice(0, limit).map((t) => ({ tag: t.key, score: t.score })),
    topCreators: creators.filter((t) => t.score > 0.3).sort((a, b) => b.score - a.score).slice(0, limit).map((t) => ({ creator: t.key, score: t.score })),
    dislikedTags: tags.filter((t) => t.score < -0.3).sort((a, b) => a.score - b.score).slice(0, limit).map((t) => ({ tag: t.key, score: t.score })),
    dislikedCreators: creators.filter((t) => t.score < -0.3).sort((a, b) => a.score - b.score).slice(0, limit).map((t) => ({ creator: t.key, score: t.score })),
    favoriteLength: lengths[0] && lengths[0].s > 0.4 ? lengthLabel(lengths[0].b) : null,
    peakDaypart: parts[0] && parts[0].s > 0.5 ? parts[0].d : null,
  }
}

/** Convenience for callers that only want a diversified top-N of already-scored entries. */
export function diversify<T extends { item: MediaLite; score: number }>(entries: T[], k: number, lambda = 0.72): T[] {
  return mmrSelect(entries, k, lambda)
}
