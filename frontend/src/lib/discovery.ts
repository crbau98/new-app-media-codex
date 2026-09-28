import type { MediaItem } from './types.ts'
import { itemSimilarity } from '../features/ai/core/library.ts'
import { toLite } from '../features/ai/adapters.ts'
import { explainBreakdown, scoreItem as tasteScore, type ScoreBreakdown, type TasteProfile } from '../features/ai/taste/engine.ts'
import { getCachedTasteProfile } from '../features/ai/taste/storage.ts'

export type DiscoveryMode = 'balanced' | 'familiar' | 'adventurous'

export interface DiscoveryProfile {
  tagPreferences: Record<string, number>
  creatorPreferences: Record<string, number>
  followCache: Record<string, boolean>
  likeCache: Record<string, boolean>
  recentlyViewed: string[]
  hiddenMedia: string[]
  mode: DiscoveryMode
}

/** Canonical lowercase key for a creator name or handle. */
export function creatorKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * ONE follow-id scheme used by the Creators page, MediaDetail and the
 * For-You ranker, so a Follow anywhere feeds recommendations everywhere.
 */
export function creatorFollowId(name: string): string {
  return `creator-${creatorKey(name)}`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function ageHours(createdAt: string): number {
  const created = Date.parse(createdAt)
  return Number.isFinite(created) ? Math.max(0, (Date.now() - created) / 3_600_000) : 720
}

function affinityReasons(item: MediaItem, profile: DiscoveryProfile): string[] {
  const reasons: string[] = []
  const key = creatorKey(item.creator)
  const matchingTags = item.tags
    .filter((tag) => (profile.tagPreferences[creatorKey(tag)] || 0) > 0)
    .sort((a, b) => (profile.tagPreferences[creatorKey(b)] || 0) - (profile.tagPreferences[creatorKey(a)] || 0))

  if (profile.followCache[creatorFollowId(item.creator)]) reasons.push(`Because you follow @${item.creator}`)
  else if ((profile.creatorPreferences[key] || 0) > 0) reasons.push(`More from @${item.creator}`)
  if (matchingTags.length) reasons.push(`Matches ${matchingTags.slice(0, 2).map((tag) => `#${tag}`).join(' and ')}`)
  if ((item.curationScore || 0) >= 65) reasons.push('Popular with viewers right now')
  if (ageHours(item.createdAt) <= 72) reasons.push('Recently published')
  if (!reasons.length) reasons.push('A fresh discovery from the public feed')
  return reasons.slice(0, 3)
}

function scoreItem(item: MediaItem, profile: DiscoveryProfile, taste: ScoreBreakdown | null): number {
  const key = creatorKey(item.creator)
  const tagAffinity = item.tags.reduce((sum, tag) => sum + (profile.tagPreferences[creatorKey(tag)] || 0), 0)
  const creatorAffinity = profile.creatorPreferences[key] || 0
  const followed = profile.followCache[creatorFollowId(item.creator)] ? 1 : 0
  const liked = profile.likeCache[item.id] ? 1 : 0
  const seen = profile.recentlyViewed.includes(item.id) ? 1 : 0
  const freshness = clamp(14 - Math.log2(ageHours(item.createdAt) + 1) * 2, 0, 14)
  const publicSignal = clamp(item.curationScore || 0, 0, 100)

  const familiarWeight = profile.mode === 'familiar' ? 1.45 : profile.mode === 'adventurous' ? 0.55 : 1
  const noveltyBoost = profile.mode === 'adventurous' && !creatorAffinity && !followed ? 16 : 0
  return publicSignal * 0.58
    + freshness
    + clamp(tagAffinity, -8, 12) * 3.5 * familiarWeight
    + clamp(creatorAffinity, -5, 8) * 5 * familiarWeight
    + followed * 18
    + liked * 10
    + noveltyBoost
    - seen * 9
    // Persistent on-device taste (decayed likes/follows/dwell/skips); 0 when there is no history.
    + (taste ? (taste.score - 50) * 0.5 : 0)
}

export interface RankOptions {
  /** Persistent taste profile. `undefined` = use the cached on-device profile, `null` = disable. */
  taste?: TasteProfile | null
  now?: number
}

/**
 * Explainable, on-device recommendation ranking. It learns only from explicit
 * local feedback, follows, likes, dwell time and viewing history. It does not
 * inspect bodies/faces or send a private taste profile to a model provider.
 *
 * Backward compatible: the third argument is optional. When the on-device
 * taste engine has history, its decayed affinities and "why" reasons are
 * blended in; the head of the list is diversified by tag/creator similarity
 * (MMR-style) so one cluster can never own the feed.
 */
export function rankForYou(items: MediaItem[], profile: DiscoveryProfile, options: RankOptions = {}): MediaItem[] {
  const hidden = new Set(profile.hiddenMedia)
  const now = options.now ?? Date.now()
  const taste = options.taste === undefined ? getCachedTasteProfile() : options.taste
  const followed = new Set(Object.entries(profile.followCache).filter(([, on]) => on).map(([id]) => id.replace(/^creator-/, '')))
  const lites = new Map<string, ReturnType<typeof toLite>>()
  const candidates = items
    .filter((item) => !hidden.has(item.id))
    .map((item) => {
      const lite = toLite(item)
      lites.set(item.id, lite)
      const breakdown = taste
        ? tasteScore(lite, taste, {
            now, followed, hidden, mode: profile.mode,
            priorTags: profile.tagPreferences, priorCreators: profile.creatorPreferences,
          })
        : null
      const base = affinityReasons(item, profile)
      const reasons = breakdown && (breakdown.creator > 0.3 || breakdown.topTags.length || breakdown.daypart > 0.15)
        ? [...new Set([...explainBreakdown(lite, breakdown, { now, profile: taste ?? undefined }), ...base])].slice(0, 3)
        : base
      return {
        ...item,
        personalizedScore: Math.round(scoreItem(item, profile, breakdown) * 10) / 10,
        recommendationReasons: reasons,
      }
    })
    .sort((a, b) => (b.personalizedScore || 0) - (a.personalizedScore || 0))

  // Greedy diversification keeps one prolific creator / tag cluster from consuming the feed.
  const ranked: MediaItem[] = []
  const creatorCount = new Map<string, number>()
  const remaining = [...candidates]
  const window = 60
  while (remaining.length) {
    let bestIndex = 0
    let bestAdjusted = Number.NEGATIVE_INFINITY
    const scan = Math.min(remaining.length, window)
    for (let index = 0; index < scan; index += 1) {
      const item = remaining[index]
      const repeats = creatorCount.get(creatorKey(item.creator)) || 0
      const penalty = repeats * (profile.mode === 'familiar' ? 5 : 14)
      let similar = 0
      const lite = lites.get(item.id)
      if (lite) for (const prev of ranked.slice(-5)) { const other = lites.get(prev.id); if (other) similar = Math.max(similar, itemSimilarity(lite, other)) }
      const adjusted = (item.personalizedScore || 0) - penalty - similar * (profile.mode === 'familiar' ? 4 : 10)
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted
        bestIndex = index
      }
    }
    const [next] = remaining.splice(bestIndex, 1)
    ranked.push(next)
    const key = creatorKey(next.creator)
    creatorCount.set(key, (creatorCount.get(key) || 0) + 1)
  }
  return ranked
}

export function discoveryStrength(tagPreferences: Record<string, number>, creatorPreferences: Record<string, number>): number {
  const signals = [...Object.values(tagPreferences), ...Object.values(creatorPreferences)]
  return Math.min(100, Math.round(signals.reduce((sum, value) => sum + Math.abs(value), 0) * 7))
}

/** Compact metric formatting: 1.2k / 3.4m. */
export function formatMetric(value = 0): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

/** Relative "x ago" formatting for timestamps. */
export function relativeTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}
