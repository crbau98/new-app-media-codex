import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchLiveDiscovery } from '@/lib/api'
import { creatorKey as discoveryCreatorKey } from '@/lib/discovery'
import type { Creator, MediaItem } from '@/lib/types'
import { useAppStore } from '@/store'
import { toLite } from '../adapters'
import { buildVocab, indexFor, type MediaLite, type Vocab } from '../core/library'
import { affinityFn, type TasteMode, type TasteProfile } from '../taste/engine'
import { getCachedTasteProfile, isTasteLearningEnabled, loadTasteProfile, subscribeTaste } from '../taste/storage'
import { useSyncExternalStore } from 'react'

const EMPTY_ITEMS: MediaItem[] = []
const EMPTY_PERFORMERS: Creator[] = []

export interface LibraryState {
  items: MediaItem[]
  performers: Creator[]
  lites: MediaLite[]
  byId: Map<string, MediaItem>
  vocab: Vocab
  isLoading: boolean
}

/**
 * The same TanStack Query the pages use (`['live-discovery', watchlist]`), so
 * opening the AI surfaces never triggers an extra scan when the page has
 * already loaded the feed.
 */
export function useLibrary(enabled = true): LibraryState {
  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const query = useQuery({
    queryKey: ['live-discovery', creatorWatchlist],
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
    enabled,
    staleTime: 60_000,
  })
  const items = query.data?.items ?? EMPTY_ITEMS
  const performers = query.data?.performers ?? EMPTY_PERFORMERS
  return useMemo(() => {
    const lites = items.map(toLite)
    indexFor(lites) // warm the BM25 index once per library snapshot
    return {
      items, performers, lites,
      byId: new Map(items.map((item) => [item.id, item])),
      vocab: buildVocab(lites),
      isLoading: query.isLoading,
    }
  }, [items, performers, query.isLoading])
}

function subscribe(listener: () => void) { return subscribeTaste(listener) }
let cachedVersionProfile: TasteProfile | null = null
function snapshot(): TasteProfile | null {
  const next = getCachedTasteProfile()
  if (next !== cachedVersionProfile) cachedVersionProfile = next
  return cachedVersionProfile
}

/** Current on-device taste profile (null when there is none or learning is paused). */
export function useTasteProfile(): TasteProfile | null {
  return useSyncExternalStore(subscribe, snapshot, () => null)
}

export function useTasteLearning(): boolean {
  return useSyncExternalStore(subscribe, () => isTasteLearningEnabled(), () => true)
}

/** Personalisation hook for `runQuery`/`planSession`: -1..1 affinity from taste + follows. */
export function useAffinity(): { affinity?: (item: MediaLite) => number; profile: TasteProfile | null; followed: Set<string>; mode: TasteMode } {
  const profile = useTasteProfile()
  const followCache = useAppStore((s) => s.followCache)
  const tagPreferences = useAppStore((s) => s.tagPreferences)
  const creatorPreferences = useAppStore((s) => s.creatorPreferences)
  const mode = useAppStore((s) => s.discoveryMode)
  return useMemo(() => {
    const followed = new Set(Object.entries(followCache).filter(([, on]) => on).map(([id]) => id.replace(/^creator-/, '')))
    const priorCreators = Object.fromEntries(Object.entries(creatorPreferences).map(([k, v]) => [discoveryCreatorKey(k), v]))
    const base = profile ?? loadTasteProfile()
    const hasAny = Boolean(profile) || followed.size > 0 || Object.keys(tagPreferences).length > 0 || Object.keys(creatorPreferences).length > 0
    return {
      profile,
      followed,
      mode,
      affinity: hasAny ? affinityFn(base, { followed, priorTags: tagPreferences, priorCreators }) : undefined,
    }
  }, [profile, followCache, tagPreferences, creatorPreferences, mode])
}
