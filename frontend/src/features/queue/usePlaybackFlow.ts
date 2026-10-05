import { useCallback, useEffect, useMemo } from 'react'
import { readNetwork } from '@/components/player/hooks'
import type { MediaItem } from '@/lib/types'
import { effectiveAutoplay, inQueueMode, isInQueue, peekNext, queuePosition, type AutoplayPref, type RepeatMode } from './queueModel'
import { QUEUE_NAV_EVENT, queueActions, type QueueNavDetail } from './queueStore'
import { setStartIntent } from './startIntent'
import { preloadForPlayback } from './preload'
import { useQueue } from './hooks'

/** 'auto': a video ended on its own; 'upnext': the viewer confirmed Up next; 'manual': next button / key. */
export type StepReason = 'manual' | 'auto' | 'upnext'

export interface PlaybackFlow {
  /** 'queue' when this item is the queue's current item; 'list' navigates siblings; 'none' has nowhere to go. */
  mode: 'queue' | 'list' | 'none'
  /** What would play after this item (queue head, or the next sibling). */
  next: MediaItem | null
  canPrev: boolean
  /** Effective autoplay-next: on in queue mode by default, off otherwise unless the viewer turned it on. */
  autoplay: boolean
  autoplayPref: AutoplayPref
  repeat: RepeatMode
  /** 'replay' means repeat-one wants the same video again. */
  goNext: (reason: StepReason) => 'moved' | 'replay' | 'none'
  goPrev: () => void
  toggleAutoplay: () => void
  /** 1-based position in the queue, or null outside queue mode. */
  position: { index: number; total: number } | null
  upcomingCount: number
  /** Item is the current or an upcoming queue entry. */
  inQueue: boolean
}

interface FlowArgs {
  item: MediaItem | null
  open: boolean
  items?: MediaItem[]
  onNavigate?: (item: MediaItem) => void
}

/**
 * One place that answers "what happens after this video, and how do I go
 * back?" for the detail sheet and its player — queue-aware, with the sibling
 * list as the fallback. Also performs the queue-driven navigation the store
 * announces (next/previous/jump/auto-advance) and warms the next poster.
 */
export function usePlaybackFlow({ item, open, items, onNavigate }: FlowArgs): PlaybackFlow {
  const queue = useQueue()
  const itemId = item?.id ?? null
  const queueMode = inQueueMode(queue, itemId)
  const siblingIndex = useMemo(() => (items && itemId ? items.findIndex((entry) => entry.id === itemId) : -1), [items, itemId])
  const siblingNext = siblingIndex >= 0 && items && onNavigate ? items[siblingIndex + 1] ?? null : null
  const siblingPrev = siblingIndex > 0 && items && onNavigate ? items[siblingIndex - 1] ?? null : null

  const canNavigate = Boolean(onNavigate)
  const queueNext = queueMode && canNavigate ? peekNext(queue)?.item ?? null : null
  const next = queueMode ? queueNext : siblingNext
  const canPrev = queueMode ? canNavigate && queue.history.length > 0 : Boolean(siblingPrev)

  // Follow queue navigation announced by the store (N / P / queue panel / dock / auto-advance).
  useEffect(() => {
    if (!open || !onNavigate) return undefined
    const onNav = (event: Event) => {
      const detail = (event as CustomEvent<QueueNavDetail>).detail
      if (!detail?.item) return
      // Prefer the fresher feed copy of the item over the stored snapshot.
      const target = items?.find((entry) => entry.id === detail.item.id) ?? detail.item
      // Jumping to the item already on screen changes nothing visible; no player will mount to consume an intent.
      if (target.id !== itemId) setStartIntent({ id: target.id, play: true })
      onNavigate(target)
    }
    window.addEventListener(QUEUE_NAV_EVENT, onNav)
    return () => window.removeEventListener(QUEUE_NAV_EVENT, onNav)
  }, [itemId, items, onNavigate, open])

  const nextId = next?.id
  useEffect(() => {
    if (!open || !next) return
    preloadForPlayback(next, { saveData: readNetwork().saveData })
    // `next` identity changes with feed refreshes; its id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nextId])

  const goNext = useCallback(
    (reason: StepReason): 'moved' | 'replay' | 'none' => {
      if (queueMode) {
        const outcome = queueActions.next(reason === 'auto' ? 'auto' : 'manual')
        if (outcome === 'replay') return 'replay'
        return outcome === 'moved' || outcome === 'wrapped' ? 'moved' : 'none'
      }
      if (siblingNext && onNavigate) {
        if (reason !== 'manual') setStartIntent({ id: siblingNext.id, play: true })
        onNavigate(siblingNext)
        return 'moved'
      }
      return 'none'
    },
    [onNavigate, queueMode, siblingNext],
  )

  const goPrev = useCallback(() => {
    if (queueMode) {
      queueActions.previous()
      return
    }
    if (siblingPrev && onNavigate) onNavigate(siblingPrev)
  }, [onNavigate, queueMode, siblingPrev])

  const toggleAutoplay = useCallback(() => queueActions.toggleAutoplay(itemId), [itemId])

  return {
    mode: queueMode ? 'queue' : siblingNext || siblingPrev ? 'list' : 'none',
    next,
    canPrev,
    autoplay: effectiveAutoplay(queue, itemId),
    autoplayPref: queue.autoplay,
    repeat: queue.repeat,
    goNext,
    goPrev,
    toggleAutoplay,
    position: queueMode ? queuePosition(queue) : null,
    upcomingCount: queue.upcoming.length,
    inQueue: itemId ? isInQueue(queue, itemId) : false,
  }
}
