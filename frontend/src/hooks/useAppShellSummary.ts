import { useQuery } from "@tanstack/react-query"

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
      const res = await fetch("/api/app-shell-summary")
      if (!res.ok) throw new Error("Failed to fetch app shell summary")
      return res.json()
    },
    enabled,
    staleTime: 10_000,
    refetchOnMount: true,
  })
}
