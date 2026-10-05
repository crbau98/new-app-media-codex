import type { MediaItem } from '@/lib/types'
import type { Toast } from '@/store'
import type { EnqueueOutcome } from './queueModel'
import { queueActions } from './queueStore'

type AddToast = (toast: Omit<Toast, 'id'>) => string

/** Add (or move) an item in the queue and tell the viewer what happened. */
export function enqueueWithToast(item: MediaItem, where: 'last' | 'next', anchor: MediaItem | null, addToast: AddToast): EnqueueOutcome {
  const outcome = queueActions.enqueue(item, where, anchor)
  switch (outcome) {
    case 'added':
      addToast({ type: 'success', title: where === 'next' ? 'Playing next' : 'Added to queue', message: item.title })
      break
    case 'playing':
      addToast({ type: 'success', title: 'Queue started', message: 'Add more with Q, then press N for the next one.' })
      break
    case 'moved':
      addToast({ type: 'success', title: 'Moved to play next', message: item.title })
      break
    case 'already':
      addToast({ type: 'info', title: 'Already in your queue' })
      break
    case 'full':
      addToast({ type: 'info', title: 'Queue is full', message: 'Remove something to add more.' })
      break
    default:
      break
  }
  return outcome
}
