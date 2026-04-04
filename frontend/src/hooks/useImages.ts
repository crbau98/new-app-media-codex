import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function useImages(articleId: string | undefined) {
  return useQuery({
    queryKey: ['images', articleId],
    queryFn: () => api.get(`/api/articles/${articleId}/images`).then((r) => r.data),
    enabled: !!articleId,
    staleTime: 10 * 60_000,
    select: (data: any) => {
      if (!data?.images?.length) return data
      const last = data.images[data.images.length - 1]
      return last?.images?.length > 0 ? last : data
    },
  })
}
