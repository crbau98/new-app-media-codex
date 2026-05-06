import { useQuery } from "@tanstack/react-query"
import { apiUrl } from "../lib/backendOrigin"

interface AppShellSummary {
  app_name: string
  last_run: Record<string, unknown> | null
  stats: { totals: Record<string, number> }
  is_running: boolean
}

export function useAppShellSummary(enabled = true) {
  return useQuery<AppShellSummary>({
    queryKey: ["app-shell-summary"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/app-shell-summary"))
      if (!res.ok) throw new Error("Failed to fetch app shell summary")
      return res.json()
    },
    enabled,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
