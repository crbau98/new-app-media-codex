import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "../lib/api"

// NOTE: staleTime (2 min), gcTime (15 min), refetchOnWindowFocus (false),
// refetchOnMount (false) are all set as global defaults in main.tsx QueryClient.
// Individual hooks here intentionally inherit those settings — do NOT add
// shorter per-query staleTime overrides as that causes unnecessary refetches.

export function useBrowseItems(params: Record<string, string | number | boolean>) {
  return useQuery({
    queryKey: ["items", params],
    queryFn: () => api.browseItems(params),
    placeholderData: (prev) => prev,
  })
}

export function useItem(id: number) {
  return useQuery({ queryKey: ["item", id], queryFn: () => api.item(id), enabled: id > 0 })
}

export function useUpdateItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.updateItem>[1] }) => api.updateItem(id, patch),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["items"] })
      qc.invalidateQueries({ queryKey: ["item", id] })
    },
  })
}

export function useBulkUpdateItems() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: { item_ids: number[]; patch: Parameters<typeof api.bulkUpdateItems>[1] }) => api.bulkUpdateItems(args.item_ids, args.patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] })
      qc.invalidateQueries({ queryKey: ["queue-count"] })
    },
  })
}
