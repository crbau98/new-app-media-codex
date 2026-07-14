import type { MediaItem } from './mockData'

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

function key(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
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
  const creatorKey = key(item.creator)
  const matchingTags = item.tags
    .filter((tag) => (profile.tagPreferences[key(tag)] || 0) > 0)
    .sort((a, b) => (profile.tagPreferences[key(b)] || 0) - (profile.tagPreferences[key(a)] || 0))

  if (profile.followCache[`redgifs-${creatorKey}`]) reasons.push(`Because you follow @${item.creator}`)
  else if ((profile.creatorPreferences[creatorKey] || 0) > 0) reasons.push(`More from @${item.creator}`)
  if (matchingTags.length) reasons.push(`Matches ${matchingTags.slice(0, 2).map((tag) => `#${tag}`).join(' and ')}`)
  if ((item.curationScore || 0) >= 65) reasons.push('Popular with viewers right now')
  if (ageHours(item.createdAt) <= 72) reasons.push('Recently published')
  if (!reasons.length) reasons.push('A fresh discovery from the public feed')
  return reasons.slice(0, 3)
}

function scoreItem(item: MediaItem, profile: DiscoveryProfile): number {
  const creatorKey = key(item.creator)
  const tagAffinity = item.tags.reduce((sum, tag) => sum + (profile.tagPreferences[key(tag)] || 0), 0)
  const creatorAffinity = profile.creatorPreferences[creatorKey] || 0
  const followed = profile.followCache[`redgifs-${creatorKey}`] ? 1 : 0
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
}

/**
 * Explainable, on-device recommendation ranking. It learns only from explicit
 * local feedback, follows, likes, and viewing history. It does not inspect
 * bodies/faces or send a private taste profile to a model provider.
 */
export function rankForYou(items: MediaItem[], profile: DiscoveryProfile): MediaItem[] {
  const hidden = new Set(profile.hiddenMedia)
  const candidates = items
    .filter((item) => !hidden.has(item.id))
    .map((item) => ({
      ...item,
      personalizedScore: Math.round(scoreItem(item, profile) * 10) / 10,
      recommendationReasons: affinityReasons(item, profile),
    }))
    .sort((a, b) => (b.personalizedScore || 0) - (a.personalizedScore || 0))

  // Greedy diversification keeps one prolific creator from consuming the feed.
  const ranked: MediaItem[] = []
  const creatorCount = new Map<string, number>()
  const remaining = [...candidates]
  while (remaining.length) {
    let bestIndex = 0
    let bestAdjusted = Number.NEGATIVE_INFINITY
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index]
      const repeats = creatorCount.get(key(item.creator)) || 0
      const penalty = repeats * (profile.mode === 'familiar' ? 5 : 14)
      const adjusted = (item.personalizedScore || 0) - penalty
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted
        bestIndex = index
      }
    }
    const [next] = remaining.splice(bestIndex, 1)
    ranked.push(next)
    const creatorKey = key(next.creator)
    creatorCount.set(creatorKey, (creatorCount.get(creatorKey) || 0) + 1)
  }
  return ranked
}

export function discoveryStrength(tagPreferences: Record<string, number>, creatorPreferences: Record<string, number>): number {
  const signals = [...Object.values(tagPreferences), ...Object.values(creatorPreferences)]
  return Math.min(100, Math.round(signals.reduce((sum, value) => sum + Math.abs(value), 0) * 7))
}

