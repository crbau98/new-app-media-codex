import { useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { fetchCreatorDirectory, type CreatorDirectoryLane, type DirectorySort } from '@/lib/api'
import type { Creator } from '@/lib/types'

export const DIRECTORY_PAGE_SIZE = 48

export interface CreatorDirectoryState {
  creators: Creator[]
  lanes: CreatorDirectoryLane[]
  total: number | null
  isLoading: boolean
  isFetchingMore: boolean
  hasMore: boolean
  error: boolean
  fetchMore: () => void
  retry: () => void
}

/** Cursor-paged cross-lane directory (`/api/creator-directory`). */
export function useCreatorDirectory(tag: string | null, sort: DirectorySort): CreatorDirectoryState {
  const query = useInfiniteQuery({
    queryKey: ['creator-directory', tag ?? '', sort],
    queryFn: ({ pageParam }) => fetchCreatorDirectory({ cursor: pageParam, limit: DIRECTORY_PAGE_SIZE, tag, sort }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const creators = useMemo(() => query.data?.pages.flatMap((page) => page.creators) ?? [], [query.data])
  const lanes = useMemo(() => {
    const seen = new Set<string>()
    const out: CreatorDirectoryLane[] = []
    for (const page of query.data?.pages ?? []) {
      for (const lane of page.lanes) {
        if (seen.has(lane.tag.toLowerCase())) continue
        seen.add(lane.tag.toLowerCase())
        out.push(lane)
      }
    }
    return out
  }, [query.data])
  return {
    creators,
    lanes,
    total: query.data?.pages[0]?.total ?? null,
    isLoading: query.isLoading,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    error: query.isError,
    fetchMore: () => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage() },
    retry: () => { void query.refetch() },
  }
}
