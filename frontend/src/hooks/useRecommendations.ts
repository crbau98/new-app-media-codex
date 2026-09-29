import { useEffect, useMemo, useState } from 'react'
import type { MediaItem } from '@/lib/types'
import type { ScoredMedia } from '@/lib/recommend'
import { loadProgress, PROGRESS_EVENT } from '@/lib/collections'
import { creatorKey } from '@/lib/discovery'
import { useAppStore } from '@/store'
import { toLite, toSignalItem } from '@/features/ai/adapters'
import { clock } from '@/features/ai/clock'
import { emptyTasteProfile, hasTasteSignal, recommendForYou } from '@/features/ai/taste/engine'
import { ingestSnapshot, type AppSignalSnapshot } from '@/features/ai/taste/ingest'
import { isTasteLearningEnabled, loadTasteProfile, saveTasteProfile, subscribeTaste } from '@/features/ai/taste/storage'

/** Bumps whenever watch progress is recorded so scoring picks it up after playback. */
function useProgressVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1)
    window.addEventListener(PROGRESS_EVENT, bump)
    return () => window.removeEventListener(PROGRESS_EVENT, bump)
  }, [])
  return version
}

/** Bumps whenever the on-device taste profile changes (signal recorded, reset, imported, paused). */
function useTasteVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribeTaste(() => setVersion((value) => value + 1)), [])
  return version
}

export type RecommendationKind = 'exploit' | 'explore'
export type ScoredRecommendation = ScoredMedia & { kind: RecommendationKind }

/**
 * Private, on-device recommendations. Signals come only from this device's
 * likes, follows, watch progress (dwell/completion/skips), views and
 * "more/less like this" feedback — decayed over time — and nothing is sent
 * anywhere. Items the user already engaged with are excluded so the rail stays
 * fresh; the list is diversified (MMR) with a little Thompson-style
 * exploration, and every entry carries human-readable reasons.
 *
 * Signature and return shape are unchanged (`scored` entries gain `kind`).
 */
export function useRecommendations(items: MediaItem[], limit = 12): { scored: ScoredRecommendation[]; hasSignals: boolean } {
  const likeCache = useAppStore((state) => state.likeCache)
  const followCache = useAppStore((state) => state.followCache)
  const recentlyViewed = useAppStore((state) => state.recentlyViewed)
  const hiddenMedia = useAppStore((state) => state.hiddenMedia)
  const tagPreferences = useAppStore((state) => state.tagPreferences)
  const creatorPreferences = useAppStore((state) => state.creatorPreferences)
  const discoveryMode = useAppStore((state) => state.discoveryMode)
  const progressVersion = useProgressVersion()
  const tasteVersion = useTasteVersion()

  const computed = useMemo(() => {
    void progressVersion // re-read localStorage when progress changes
    void tasteVersion
    const now = clock.now()
    const progress = loadProgress()
    const lites = items.map(toLite)
    const learning = isTasteLearningEnabled()
    const snapshot: AppSignalSnapshot = {
      likes: Object.fromEntries(items.map((item) => [item.id, Boolean(likeCache[item.id] ?? item.isLiked)])),
      follows: followCache,
      recentlyViewed,
      hidden: hiddenMedia,
      progress,
    }
    const stored = learning ? loadTasteProfile() : emptyTasteProfile(now)
    const profile = ingestSnapshot(stored, snapshot, lites.map(toSignalItem), now)

    const engaged = new Set<string>()
    for (const item of items) {
      const liked = likeCache[item.id] ?? item.isLiked
      const entry = progress[item.id]
      if (liked || (entry && entry.seconds > 0)) engaged.add(item.id)
    }
    const followed = new Set(Object.entries(followCache).filter(([, on]) => on).map(([id]) => id.replace(/^creator-/, '')))
    const priorCreators = Object.fromEntries(Object.entries(creatorPreferences).map(([key, value]) => [creatorKey(key), value]))
    const signal = hasTasteSignal(profile, { followed, priorTags: tagPreferences, priorCreators }) || engaged.size > 0
    if (!signal) return { scored: [] as ScoredRecommendation[], hasSignals: false, profile, learning, changed: false, stored }

    const seen = new Map<string, number>(recentlyViewed.map((id, index) => [id, now - index * 3_600_000]))
    const recs = recommendForYou(lites, profile, {
      now, limit: limit * 2, mode: discoveryMode, followed, hidden: new Set(hiddenMedia), exclude: engaged,
      priorTags: tagPreferences, priorCreators, seen,
      seed: Math.floor(now / (6 * 3_600_000)),
      minScore: 30,
    })
    const byId = new Map(items.map((item) => [item.id, item]))
    const scored: ScoredRecommendation[] = []
    for (const rec of recs) {
      const item = byId.get(rec.item.id)
      if (item && rec.score > 0) scored.push({ item, score: rec.score, reasons: rec.reasons.slice(0, 2), kind: rec.kind })
      if (scored.length >= limit) break
    }
    return { scored, hasSignals: true, profile, learning, changed: profile !== stored, stored }
  }, [items, likeCache, followCache, recentlyViewed, hiddenMedia, tagPreferences, creatorPreferences, discoveryMode, progressVersion, tasteVersion, limit])

  // Persist newly ingested signals (side effect kept out of the memo). A second
  // pass ingests nothing, so this never loops.
  const { profile, learning, changed } = computed
  useEffect(() => {
    if (learning && changed) saveTasteProfile(profile)
  }, [profile, learning, changed])

  return { scored: computed.scored, hasSignals: computed.hasSignals }
}
