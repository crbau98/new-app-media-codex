import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { MediaItem } from '@/lib/types'
import QueueDock from './QueueDock'
import QueuePanel from './QueuePanel'
import ShortcutHelp from './ShortcutHelp'
import { useQueue, useSurface } from './hooks'
import { queueSize } from './queueModel'
import { QUEUE_NAV_EVENT, type QueueNavDetail } from './queueStore'
import { setStartIntent } from './startIntent'
import { surface } from './surface'

interface QueueLayerProps {
  /** Open the full detail sheet for an item (the dock's expand button, the drawer's now-playing row). */
  onOpenItem: (item: MediaItem) => void
}

/**
 * App-level queue surfaces for when no detail sheet is open: the persistent
 * mini-player dock, plus the queue drawer and shortcut help if summoned from
 * it. (While a sheet is open it renders its own drawer/help inside itself so
 * focus stays trapped in one dialog.) Mounted by GlobalMediaHost.
 */
export default function QueueLayer({ onOpenItem }: QueueLayerProps) {
  const queue = useQueue()
  const surf = useSurface()
  const size = queueSize(queue)
  const previousSize = useRef(size)
  const nowId = queue.nowPlaying?.id ?? null

  // A new current item, or more items, bring a dismissed dock back.
  useEffect(() => {
    if (size > previousSize.current) surface.reviveDock()
    previousSize.current = size
  }, [size])
  useEffect(() => {
    if (nowId) surface.reviveDock()
  }, [nowId])

  // With no sheet open, the dock follows the queue: whatever just became current should play.
  useEffect(() => {
    const onNav = (event: Event) => {
      const detail = (event as CustomEvent<QueueNavDetail>).detail
      if (detail?.item && surface.get().sheets === 0) setStartIntent({ id: detail.item.id, play: true })
    }
    window.addEventListener(QUEUE_NAV_EVENT, onNav)
    return () => window.removeEventListener(QUEUE_NAV_EVENT, onNav)
  }, [])

  const noSheet = surf.sheets === 0
  const dockVisible = Boolean(queue.nowPlaying) && noSheet && !surf.dockDismissed

  return createPortal(
    <>
      {dockVisible && <QueueDock onExpand={onOpenItem} />}
      {noSheet && surf.panelOpen && <QueuePanel inside={false} onClose={surface.closePanel} onOpenItem={onOpenItem} />}
      {noSheet && surf.helpOpen && <ShortcutHelp inside={false} onClose={surface.closeHelp} />}
    </>,
    document.body,
  )
}
