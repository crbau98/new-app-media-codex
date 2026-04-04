import { useQuery } from "@tanstack/react-query"
import { api } from "../lib/api"

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    staleTime: 5 * 60_000,    // 5 min â dashboard data changes slowly
    gcTime: 15 * 60_000,
    refetchInterval: (query) => (query.state.data?.is_running ? 10_000 : 5 * 60_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    placeholderData: (prev: unknown) => prev,  // Keep stale data during refetch
  })
}
import { useQuery } from "@tanstack/react-query"
import { api } from "../lib/api"

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: api.dashboard,
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
    refetchInterval: (query) => (query.state.data?.is_running ? 10_000 : 2 * 60_000),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
}
