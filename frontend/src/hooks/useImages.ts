import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAppStore } from '@/store'

export function useImages() {
  const imageTheme = useAppStore((s) => s.filters.imageTheme)
  return useInfiniteQuery({
    queryKey: ['images', imageTheme],
    queryFn: ({ pageParam }) =>
      api.browseImages({ ...(imageTheme && { theme: imageTheme }), offset: pageParam, limit: 40 }),
    getNextPageParam: (last) =>
      last.has_more ? last.offset + last.images.length : undefined,
    initialPageParam: 0,
  })
}
