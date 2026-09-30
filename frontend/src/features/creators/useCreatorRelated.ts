import { useQuery, type QueryClient } from '@tanstack/react-query'
import { fetchCreatorRelated, type CreatorRelated } from '@/lib/api'
import type { Creator } from '@/lib/types'
import { creatorHandle, isCatalogPlatform } from './creatorLogic'

export const CREATOR_RELATED_LIMIT = 12
const STALE_MS = 10 * 60_000

export const creatorRelatedKey = (handle: string) => ['creator-related', handle.toLowerCase()] as const

/** Related creators exist only where the provider exposes a per-creator catalog (Redgifs). */
export function canRelate(creator: Creator | null | undefined): boolean {
  if (!creator) return false
  const handle = creatorHandle(creator)
  if (handle.length < 2) return false
  const platforms = [creator.platform, ...(creator.platforms ?? []), creator.sourceAttribution].filter(Boolean)
  return platforms.some((value) => isCatalogPlatform(String(value))) || isCatalogPlatform(undefined, creator.profileUrl)
}

/** Warm the lookup when a related card is hovered or focused so the next drawer opens populated. */
export function prefetchCreatorRelated(queryClient: QueryClient, handle: string) {
  void queryClient.prefetchQuery({
    queryKey: creatorRelatedKey(handle),
    queryFn: () => fetchCreatorRelated(handle, 'redgifs', CREATOR_RELATED_LIMIT),
    staleTime: STALE_MS,
  })
}

export interface CreatorRelatedState {
  data: CreatorRelated | undefined
  isLoading: boolean
  error: boolean
  retry: () => void
}

/** Related creators + self-published links for the open drawer creator. */
export function useCreatorRelated(creator: Creator | null, open = true): CreatorRelatedState {
  const handle = creator ? creatorHandle(creator) : ''
  const enabled = open && canRelate(creator)
  const query = useQuery({
    queryKey: creatorRelatedKey(handle),
    queryFn: () => fetchCreatorRelated(handle, 'redgifs', CREATOR_RELATED_LIMIT),
    enabled,
    staleTime: STALE_MS,
    retry: 1,
  })
  return {
    data: query.data,
    isLoading: enabled && query.isLoading,
    error: enabled && query.isError,
    retry: () => { void query.refetch() },
  }
}
