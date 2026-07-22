import { useEffect, useMemo, useState } from 'react'
import type { MediaItem } from '@/lib/types'
import { buildProfile, scoreMedia, type ScoredMedia } from '@/lib/recommend'
import { loadProgress, PROGRESS_EVENT } from '@/lib/collections'
import { useAppStore } from '@/store'

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

type DeltaMap = Parameters<typeof buildProfile>[1]

/**
 * Private, on-device recommendations. Signals come only from this device's
 * likes/saves and watch progress — nothing is sent anywhere. Items the user
 * already engaged with are excluded so the rail stays fresh.
 */
export function useRecommendations(items: MediaItem[], limit = 12): { scored: ScoredMedia[]; hasSignals: boolean } {
  const likeCache = useAppStore((state) => state.likeCache)
  const progressVersion = useProgressVersion()

  return useMemo(() => {
    void progressVersion // re-read localStorage when progress changes
    const progress = loadProgress()
    const deltas: DeltaMap = {}
    for (const item of items) {
      const liked = likeCache[item.id] ?? item.isLiked
      const entry = progress[item.id]
      if (liked) {
        deltas[item.id] = { saved: true, reaction: 'like' }
      } else if (entry && entry.seconds > 0) {
        deltas[item.id] = { progressSeconds: entry.seconds }
      }
    }
    if (Object.keys(deltas).length === 0) return { scored: [], hasSignals: false }
    const profile = buildProfile(items, deltas)
    const scored = scoreMedia(items, profile)
      .filter((entry) => entry.score > 0 && !deltas[entry.item.id])
      .slice(0, limit)
    return { scored, hasSignals: true }
  }, [items, likeCache, progressVersion, limit])
}
