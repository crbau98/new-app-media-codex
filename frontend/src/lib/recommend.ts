import type { MediaItem } from '@/lib/types'

export type RecommendationProfile = {
  likedCreators: Record<string, number>
  likedTags: Record<string, number>
  likedSources: Record<string, number>
  dislikedCreators: Record<string, number>
  dislikedTags: Record<string, number>
  preferredDuration: { min: number; max: number } | null
}

export type ScoredMedia = {
  item: MediaItem
  score: number
  reasons: string[]
}

function bump(bucket: Record<string, number>, key: string | undefined, amount: number) {
  if (!key) return
  bucket[key] = (bucket[key] || 0) + amount
}

function durationToSeconds(duration: string): number {
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export function emptyProfile(): RecommendationProfile {
  return { likedCreators: {}, likedTags: {}, likedSources: {}, dislikedCreators: {}, dislikedTags: {}, preferredDuration: null }
}

export function buildProfile(items: MediaItem[], deltas: Record<string, { saved?: boolean; reaction?: 'like' | 'dislike' | null; progressSeconds?: number }>): RecommendationProfile {
  const profile = emptyProfile()
  const durations: number[] = []
  for (const item of items) {
    const delta = deltas[item.id]
    if (!delta) continue
    const positive = delta.saved || delta.reaction === 'like' || (delta.progressSeconds || 0) > 45
    const negative = delta.reaction === 'dislike'
    if (positive) {
      bump(profile.likedCreators, item.creator, 3)
      bump(profile.likedSources, item.source, 1)
      for (const tag of item.tags) bump(profile.likedTags, tag, 1)
      if (item.isVideo) {
        const seconds = durationToSeconds(item.duration)
        if (seconds > 0) durations.push(seconds)
      }
    }
    if (negative) {
      bump(profile.dislikedCreators, item.creator, 4)
      for (const tag of item.tags) bump(profile.dislikedTags, tag, 2)
    }
  }
  if (durations.length >= 3) {
    durations.sort((a, b) => a - b)
    profile.preferredDuration = {
      min: durations[Math.floor(durations.length * 0.25)],
      max: durations[Math.ceil(durations.length * 0.75)],
    }
  }
  return profile
}

export function scoreMedia(items: MediaItem[], profile: RecommendationProfile): ScoredMedia[] {
  return items
    .map((item) => {
      let score = 0
      const reasons: string[] = []
      const creatorBoost = profile.likedCreators[item.creator] || 0
      const creatorPenalty = profile.dislikedCreators[item.creator] || 0
      if (creatorBoost) {
        score += creatorBoost * 6
        reasons.push(`You engage with @${item.creator}`)
      }
      if (creatorPenalty) score -= creatorPenalty * 8

      let tagBoost = 0
      let tagPenalty = 0
      for (const tag of item.tags) {
        tagBoost += profile.likedTags[tag] || 0
        tagPenalty += profile.dislikedTags[tag] || 0
      }
      if (tagBoost) {
        score += Math.min(18, tagBoost * 2)
        reasons.push('Matches tags you return to')
      }
      if (tagPenalty) score -= Math.min(24, tagPenalty * 3)

      const sourceBoost = profile.likedSources[item.source] || 0
      if (sourceBoost) score += Math.min(6, sourceBoost)

      if (profile.preferredDuration && item.isVideo) {
        const { min, max } = profile.preferredDuration
        const seconds = durationToSeconds(item.duration)
        if (seconds >= min && seconds <= max) {
          score += 5
          reasons.push('Fits your usual watch length')
        } else if (seconds > max * 1.8) {
          score -= 4
        }
      }

      // Keep discovery fresh: popularity is a tie-breaker, never the whole reason.
      score += Math.log10((item.views || 1) + 10) + Math.log10((item.likes || 1) + 10)
      return { item, score, reasons: reasons.slice(0, 2) }
    })
    .sort((a, b) => b.score - a.score)
}
