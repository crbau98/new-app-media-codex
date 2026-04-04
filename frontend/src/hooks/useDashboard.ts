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
