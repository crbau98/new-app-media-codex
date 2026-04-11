import { useQuery } from "@tanstack/react-query"
import {
  api,
  type CaptureQueueEntry,
  type MediaStatsPayload,
  type PerformerStats,
  type ScreenshotTerm,
  type UserTagCount,
} from "@/lib/api"
import { useDebounce } from "@/hooks/useDebounce"

type RefetchIntervalOption = number | false | ((query: any) => number | false | undefined)

export const sharedQueryKeys = {
  mediaStats: () => ["media-stats"] as const,
  performerStats: () => ["performer-stats"] as const,
  captureQueue: () => ["capture-queue"] as const,
  screenshotTerms: () => ["screenshot-terms"] as const,
  screenshotAllTags: () => ["screenshot-all-tags"] as const,
  performerSearchSuggestions: (query: string, limit = 6) =>
    ["performer-search-suggestions", query.trim().toLowerCase(), limit] as const,
}

export function useMediaStatsQuery(enabled = true) {
  return useQuery<MediaStatsPayload>({
    queryKey: sharedQueryKeys.mediaStats(),
    queryFn: api.mediaStats,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function usePerformerStatsQuery(enabled = true) {
  return useQuery<PerformerStats>({
    queryKey: sharedQueryKeys.performerStats(),
    queryFn: api.performerStats,
    staleTime: 30_000,
    enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useCaptureQueueQuery({
  enabled = true,
  staleTime = 15_000,
  refetchInterval,
}: {
  enabled?: boolean
  staleTime?: number
  refetchInterval?: RefetchIntervalOption
} = {}) {
  return useQuery<{ queue: CaptureQueueEntry[] }>({
    queryKey: sharedQueryKeys.captureQueue(),
    queryFn: api.getCaptureQueue,
    enabled,
    staleTime,
    refetchInterval,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useScreenshotTermsQuery(enabled = true) {
  return useQuery<ScreenshotTerm[]>({
    queryKey: sharedQueryKeys.screenshotTerms(),
    queryFn: api.screenshotTerms,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function useScreenshotAllTagsQuery(enabled = true) {
  return useQuery<UserTagCount[]>({
    queryKey: sharedQueryKeys.screenshotAllTags(),
    queryFn: api.screenshotAllTags,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    enabled,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export function usePerformerSearchSuggestionsQuery(
  query: string,
  {
    enabled = true,
    limit = 6,
    debounceMs = 220,
  }: {
    enabled?: boolean
    limit?: number
    debounceMs?: number
  } = {},
) {
  const debouncedQuery = useDebounce(query.trim(), debounceMs)
  const queryEnabled = enabled && debouncedQuery.length >= 2
  const result = useQuery({
    queryKey: sharedQueryKeys.performerSearchSuggestions(debouncedQuery, limit),
    queryFn: () => api.searchPerformers(debouncedQuery, limit),
    enabled: queryEnabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return {
    ...result,
    debouncedQuery,
  }
}
