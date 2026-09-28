import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { CURRENT_MEDIA_EVENT, OPEN_MEDIA_EVENT } from '@/features/ai/events'
import { useLibrary } from '@/features/ai/hooks/useLibrary'
import type { MediaItem } from '@/lib/types'

const MediaDetail = lazy(() => import('@/components/MediaDetail'))

/**
 * App-level host for `codex:open-media` (dispatched by the command bar and the
 * concierge). Resolves the id against the shared live-discovery query and opens
 * the standard detail sheet, so AI results are never a dead end on any route.
 */
export default function GlobalMediaHost() {
  const { items, byId } = useLibrary(true)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (!id || !byId.has(id)) return // unresolved: let the AI surface fall back to search
      event.preventDefault()
      setActiveId(id)
    }
    window.addEventListener(OPEN_MEDIA_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_MEDIA_EVENT, onOpen)
  }, [byId])

  const close = useCallback(() => setActiveId(null), [])
  const navigate = useCallback((next: MediaItem) => setActiveId(next.id), [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CURRENT_MEDIA_EVENT, { detail: { id: activeId } }))
  }, [activeId])

  const item = activeId ? byId.get(activeId) ?? null : null
  if (!item) return null
  return (
    <Suspense fallback={null}>
      <MediaDetail item={item} open onClose={close} items={items} onNavigate={navigate} />
    </Suspense>
  )
}
