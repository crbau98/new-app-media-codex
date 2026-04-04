import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/api/stats/dashboard').then((r) => r.data),
    staleTime: 5 * 60_000,
    refetchInterval: (query) => {
      // Back off when tab is hidden
      if (document.hidden) return false
      // Refresh every 2 min when visible
      return 2 * 60_000
    },
  })
}
