import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { CURRENT_MEDIA_EVENT, OPEN_MEDIA_EVENT } from '@/features/ai/events'
import { useLibrary } from '@/features/ai/hooks/useLibrary'
import { useQueue, useSurface } from '@/features/queue/hooks'
import { findInQueue } from '@/features/queue/queueModel'
import type { MediaItem } from '@/lib/types'

const MediaDetail = lazy(() => import('@/components/MediaDetail'))
// The dock / drawer / shortcut help chunk loads only once there is a queue (or one is summoned).
const QueueLayer = lazy(() => import('@/features/queue/QueueLayer'))

/**
 * App-level host, mounted once for every route. It:
 *
 *  - opens the standard detail sheet for `codex:open-media` (command bar and
 *    concierge), resolving the id against the live feed first and then the
 *    watch queue, so AI results are never a dead end;
 *  - owns the queue's persistent surfaces — the mini-player dock that keeps the
 *    queue playing while you browse, the queue drawer and the shortcut help —
 *    so they survive navigation and a reload (restored paused).
 */
export default function GlobalMediaHost() {
  const { items, byId } = useLibrary(true)
  const queue = useQueue()
  const surf = useSurface()
  const [active, setActive] = useState<MediaItem | null>(null)

  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      const found = byId.get(id) ?? findInQueue(queue, id)
      if (!found) return // unresolved: let the AI surface fall back to search
      event.preventDefault()
      setActive(found)
    }
    window.addEventListener(OPEN_MEDIA_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_MEDIA_EVENT, onOpen)
  }, [byId, queue])

  const close = useCallback(() => setActive(null), [])
  const open = useCallback((next: MediaItem) => setActive(byId.get(next.id) ?? next), [byId])

  const activeId = active?.id ?? null
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CURRENT_MEDIA_EVENT, { detail: { id: activeId } }))
  }, [activeId])

  // Keep the open sheet's copy fresh when the live feed refreshes; queue-only items keep their snapshot.
  const item = useMemo(() => (active ? byId.get(active.id) ?? active : null), [active, byId])
  const needsLayer = Boolean(queue.nowPlaying) || surf.panelOpen || surf.helpOpen

  return (
    <>
      {item && (
        <Suspense fallback={null}>
          <MediaDetail item={item} open onClose={close} items={items} onNavigate={open} />
        </Suspense>
      )}
      {needsLayer && (
        <Suspense fallback={null}>
          <QueueLayer onOpenItem={open} />
        </Suspense>
      )}
    </>
  )
}
