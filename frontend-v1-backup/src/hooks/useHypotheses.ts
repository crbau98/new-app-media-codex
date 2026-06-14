import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../lib/api"

export function useHypotheses(limit?: number) {
  return useQuery({ queryKey: ["hypotheses", limit], queryFn: () => api.hypotheses(limit) })
}

export function useUpdateHypothesis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.updateHypothesis>[1] }) => api.updateHypothesis(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hypotheses"] }) },
  })
}

export function useBrowseHypotheses(params: Record<string, string | number | boolean>) {
  return useQuery({
    queryKey: ['hypotheses', params],
    queryFn: () => api.browseHypotheses(params),
    staleTime: 30_000,
  })
}
