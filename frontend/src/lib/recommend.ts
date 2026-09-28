import type { MediaItem } from './types.ts'
import { canonicalTag, mmrSelect } from '../features/ai/core/library.ts'
import { toLite } from '../features/ai/adapters.ts'

/**
 * Stateless, explicit-signal recommender (kept for backward compatibility).
 * The richer, persistent, time-decayed ranker lives in `features/ai/taste`;
 * `useRecommendations` uses that. This module now shares its tag aliasing
 * (Muscular == gym), rarity weighting and MMR diversification.
 */

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

type Delta = { saved?: boolean; reaction?: 'like' | 'dislike' | null; progressSeconds?: number; completed?: boolean }

function bump(bucket: Record<string, number>, key: string | undefined, amount: number) {
  if (!key) return
  bucket[key] = (bucket[key] || 0) + amount
}

function durationToSeconds(duration: string): number {
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const tagKey = (tag: string) => canonicalTag(tag) || tag

export function emptyProfile(): RecommendationProfile {
  return { likedCreators: {}, likedTags: {}, likedSources: {}, dislikedCreators: {}, dislikedTags: {}, preferredDuration: null }
}

export function buildProfile(items: MediaItem[], deltas: Record<string, Delta>): RecommendationProfile {
  const profile = emptyProfile()
  const durations: number[] = []
  for (const item of items) {
    const delta = deltas[item.id]
    if (!delta) continue
    const positive = delta.saved || delta.reaction === 'like' || delta.completed || (delta.progressSeconds || 0) > 45
    const negative = delta.reaction === 'dislike'
    // Finishing something is a stronger signal than a like alone.
    const weight = delta.completed ? 1.5 : 1
    if (positive) {
      bump(profile.likedCreators, item.creator, 3 * weight)
      bump(profile.likedSources, item.source, 1)
      for (const tag of item.tags) bump(profile.likedTags, tagKey(tag), weight)
      if (item.isVideo) {
        const seconds = durationToSeconds(item.duration)
        if (seconds > 0) durations.push(seconds)
      }
    }
    if (negative) {
      bump(profile.dislikedCreators, item.creator, 4)
      for (const tag of item.tags) bump(profile.dislikedTags, tagKey(tag), 2)
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
  // Rarity: a shared niche tag says more than a shared ubiquitous one.
  const df = new Map<string, number>()
  for (const item of items) for (const tag of new Set(item.tags.map(tagKey))) df.set(tag, (df.get(tag) ?? 0) + 1)
  const rarity = (tag: string) => 0.8 + 0.4 * Math.min(1, Math.log(1 + items.length / (1 + (df.get(tag) ?? 0))) / Math.log(1 + Math.max(2, items.length)))

  const scored = items.map((item) => {
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
    const matched: string[] = []
    for (const raw of new Set(item.tags.map(tagKey))) {
      const liked = (profile.likedTags[raw] || 0) * rarity(raw)
      if (liked > 0) matched.push(raw)
      tagBoost += liked
      tagPenalty += (profile.dislikedTags[raw] || 0) * rarity(raw)
    }
    if (tagBoost) {
      score += Math.min(18, tagBoost * 2)
      reasons.push(matched.length ? `Matches ${matched.slice(0, 2).map((t) => `#${t}`).join(' and ')}` : 'Matches tags you return to')
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
  }).sort((a, b) => b.score - a.score)

  // Diversify the head of the list so one creator / one tag cluster can't own it.
  const HEAD = 48
  if (scored.length <= 2) return scored
  const head = scored.slice(0, HEAD)
  const lite = new Map(head.map((entry) => [entry.item.id, toLite(entry.item)]))
  const wrapped = head.map((entry) => ({ entry, item: lite.get(entry.item.id)!, score: entry.score }))
  const diversified = mmrSelect(wrapped, head.length, 0.8).map((w) => w.entry)
  return [...diversified, ...scored.slice(HEAD)]
}
