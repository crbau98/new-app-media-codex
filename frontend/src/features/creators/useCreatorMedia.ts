import { useMemo } from 'react'
import { useInfiniteQuery, type QueryClient } from '@tanstack/react-query'
import { fetchCreatorMediaPage, type CreatorMediaPage } from '@/lib/api'
import type { Creator, MediaItem } from '@/lib/types'
import { creatorHandle, isCatalogPlatform } from './creatorLogic'

/** Only providers with a per-creator catalog endpoint can be expanded. */
export function hasCreatorCatalog(creator: Creator | null | undefined): boolean {
  if (!creator) return false
  const platforms = [creator.platform, ...(creator.platforms ?? []), creator.sourceAttribution].filter(Boolean)
  return platforms.some((value) => isCatalogPlatform(String(value))) || isCatalogPlatform(undefined, creator.profileUrl)
}

export const creatorMediaKey = (handle: string) => ['creator-media', handle.toLowerCase(), 'explicit'] as const

/** Explicitly opened creators are always requested with `strict=0` so nothing is hidden. */
const fetchExplicitPage = (handle: string, page: number) => fetchCreatorMediaPage(handle, page, 40, { strict: false })

/** Warm the first page (used on card hover/focus so the drawer opens populated). */
export function prefetchCreatorMedia(queryClient: QueryClient, creator: Creator) {
  if (!hasCreatorCatalog(creator)) return
  const handle = creatorHandle(creator)
  void queryClient.prefetchInfiniteQuery({
    queryKey: creatorMediaKey(handle),
    queryFn: ({ pageParam }) => fetchExplicitPage(handle, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: CreatorMediaPage) => (last.hasMore ? last.page + 1 : undefined),
    staleTime: 5 * 60_000,
    pages: 1,
  })
}

export interface CreatorMediaState {
  /** Feed-sample items first (instant), then the creator's full catalog; de-duplicated. */
  items: MediaItem[]
  /** Provider-reported total for the creator's catalog, or the merged count when unknown. */
  total: number
  /** True when a catalog endpoint exists for this creator (false = link-only lead). */
  catalogAvailable: boolean
  /** Provider handle the endpoint resolved the request to, when it differs from what was asked. */
  resolvedHandle: string | null
  isLoading: boolean
  isFetchingMore: boolean
  hasMore: boolean
  error: boolean
  fetchMore: () => void
  retry: () => void
}

export function useCreatorMedia(creator: Creator | null): CreatorMediaState {
  const enabled = hasCreatorCatalog(creator)
  const handle = creator ? creatorHandle(creator) : ''
  const query = useInfiniteQuery({
    queryKey: creatorMediaKey(handle),
    queryFn: ({ pageParam }) => fetchExplicitPage(handle, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: enabled && Boolean(handle),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const sample = creator?.media
  const items = useMemo(() => {
    const seen = new Set<string>()
    const merged: MediaItem[] = []
    for (const item of [...(sample ?? []), ...(query.data?.pages.flatMap((page) => page.items) ?? [])]) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
    return merged.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
  }, [sample, query.data])

  const providerTotal = query.data?.pages[0]?.total ?? 0
  const resolved = query.data?.pages[0]?.resolvedHandle ?? null
  return {
    items,
    total: Math.max(providerTotal, items.length),
    catalogAvailable: enabled,
    resolvedHandle: resolved && resolved.toLowerCase() !== handle.toLowerCase() ? resolved : null,
    isLoading: enabled && query.isLoading,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    error: enabled && query.isError && !items.length,
    fetchMore: () => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage() },
    retry: () => { void query.refetch() },
  }
}
