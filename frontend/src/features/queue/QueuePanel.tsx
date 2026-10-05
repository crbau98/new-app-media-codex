import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import {
  AudioLines,
  FolderPlus,
  GripVertical,
  History,
  ListVideo,
  Repeat,
  Repeat1,
  Shuffle,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import { durationToSeconds, progressRatio } from '@/lib/collections'
import type { MediaItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useQueue } from './hooks'
import { useProgressMap } from './progressStore'
import { effectiveAutoplay, queueSize } from './queueModel'
import { queueActions } from './queueStore'
import { CompletionRingView } from './CompletionRing'
import '@/styles/queue.css'

interface QueuePanelProps {
  /** True when rendered inside the open detail sheet (absolute), false when floating over the page (fixed). */
  inside: boolean
  onClose: () => void
  /** Open an item in the sheet (used by the "now playing" row). */
  onOpenItem?: (item: MediaItem) => void
}

function totalMinutes(items: MediaItem[]): number {
  return Math.round(items.reduce((sum, item) => sum + (item.isVideo ? durationToSeconds(item.duration) : 0), 0) / 60)
}

const iconBtn =
  'grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-3 outline-none transition-colors hover:bg-white/10 hover:text-ink focus-visible:ring-2 focus-visible:ring-heat/70'

function Thumb({ item, className }: { item: MediaItem; className?: string }) {
  return (
    <span className={cn('relative block aspect-video w-[4.75rem] shrink-0 overflow-hidden rounded-lg bg-sunken ring-1 ring-white/10', className)}>
      <MediaImage sources={[item.thumbnail]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" />
      {item.isVideo && item.duration && (
        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 font-mono text-[9px] tabular-nums text-white">{item.duration}</span>
      )}
    </span>
  )
}

interface RowProps {
  item: MediaItem
  index: number
  total: number
  onPlay: (item: MediaItem) => void
  onCommit: () => void
  onKeyMove: (id: string, delta: number) => void
  progress: ReturnType<typeof useProgressMap>[string] | undefined
}

function UpcomingRow({ item, index, total, onPlay, onCommit, onKeyMove, progress }: RowProps) {
  const controls = useDragControls()
  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      onKeyMove(item.id, event.key === 'ArrowUp' ? -1 : 1)
    }
  }
  return (
    <Reorder.Item
      as="li"
      value={item.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onCommit}
      className="q-row group/row flex items-center gap-1 rounded-2xl border border-white/[0.07] bg-elevated pr-0.5"
      whileDrag={{ scale: 1.015, zIndex: 5, boxShadow: '0 18px 40px -12px rgb(0 0 0 / 0.8)' }}
      data-testid="queue-row"
      data-id={item.id}
    >
      <button
        type="button"
        data-handle={item.id}
        onPointerDown={(event) => {
          event.preventDefault()
          controls.start(event)
        }}
        onKeyDown={onHandleKey}
        className="q-handle grid h-12 w-9 shrink-0 cursor-grab touch-none place-items-center rounded-l-2xl text-ink-3 outline-none transition-colors hover:text-ink focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-heat/70 active:cursor-grabbing"
        aria-label={`Reorder ${item.title}, position ${index + 1} of ${total}. Use the up and down arrow keys to move.`}
      >
        <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onPlay(item)}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-heat/70"
        aria-label={`Play ${item.title} now`}
      >
        <span className="relative shrink-0">
          <Thumb item={item} />
          <CompletionRingView entry={progress} size={18} className="left-1 right-auto top-1" />
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{item.title}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">@{item.creator}</span>
        </span>
      </button>
      <button type="button" onClick={() => queueActions.remove(item.id)} className={iconBtn} aria-label={`Remove ${item.title} from queue`}>
        <X size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </Reorder.Item>
  )
}

/**
 * The queue drawer: now playing, a draggable (and keyboard-reorderable) "Up
 * next" list, shuffle / repeat / autoplay-next, clear, previously played, and
 * save-as-collection. Everything is stored on this device.
 */
export default function QueuePanel({ inside, onClose, onOpenItem }: QueuePanelProps) {
  const queue = useQueue()
  const progress = useProgressMap()
  const addToast = useAppStore((state) => state.addToast)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const dragOrderRef = useRef<string[] | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [saving, setSaving] = useState(false)
  const [collectionName, setCollectionName] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const pendingFocus = useRef<string | null>(null)

  const { nowPlaying, upcoming, history } = queue
  const storeIds = useMemo(() => upcoming.map((item) => item.id), [upcoming])
  const order = dragOrder ?? storeIds
  const byId = useMemo(() => new Map(upcoming.map((item) => [item.id, item])), [upcoming])
  const rows = order.map((id) => byId.get(id)).filter((item): item is MediaItem => Boolean(item))
  const size = queueSize(queue)
  const autoplayOn = effectiveAutoplay(queue, nowPlaying?.id)
  const minutes = totalMinutes(upcoming)

  // Focus the drawer on open; return focus to whatever opened it on close.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 60)
    return () => {
      window.clearTimeout(timer)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  // Keyboard reorder: keep focus on the grip that just moved.
  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    pendingFocus.current = null
    rootRef.current?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(id)}"]`)?.focus({ preventScroll: false })
  }, [storeIds])

  const onReorder = useCallback((ids: string[]) => {
    dragOrderRef.current = ids
    setDragOrder(ids)
  }, [])
  const commitDrag = useCallback(() => {
    const ids = dragOrderRef.current
    dragOrderRef.current = null
    setDragOrder(null)
    if (ids) queueActions.reorder(ids)
  }, [])

  const keyMove = useCallback(
    (id: string, delta: number) => {
      const from = storeIds.indexOf(id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= storeIds.length) return
      pendingFocus.current = id
      queueActions.moveBy(id, delta)
      const title = byId.get(id)?.title ?? 'Item'
      setAnnouncement(`${title} moved to position ${to + 1} of ${storeIds.length}`)
    },
    [byId, storeIds],
  )

  const play = useCallback(
    (item: MediaItem) => {
      queueActions.jumpTo(item.id)
    },
    [],
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (saving) setSaving(false)
      else onClose()
      return
    }
    if (!typing && (event.key === 'q' || event.key === 'Q')) {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => el.offsetParent !== null)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const saveCollection = () => {
    const collection = queueActions.saveAsCollection(collectionName.trim())
    setSaving(false)
    setCollectionName('')
    if (collection) addToast({ type: 'success', title: 'Saved as a collection', message: `“${collection.name}” · ${collection.itemIds.length} items — find it under Collections.` })
  }

  const repeatLabel = queue.repeat === 'off' ? 'Repeat off' : queue.repeat === 'all' ? 'Repeat all' : 'Repeat one'
  const RepeatIcon = queue.repeat === 'one' ? Repeat1 : Repeat

  return (
    <div
      ref={rootRef}
      className={cn('q-root z-[260] flex items-end justify-end md:items-stretch', inside ? 'absolute inset-0' : 'fixed inset-0')}
      role="dialog"
      aria-modal="true"
      aria-label="Queue"
      data-testid="queue-panel"
      onKeyDown={onKeyDown}
    >
      <button type="button" className="q-scrim absolute inset-0 h-full w-full cursor-default bg-scrim" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <aside className="q-drawer relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-b-0 border-white/10 bg-elevated shadow-overlay md:h-full md:max-h-none md:w-[420px] md:rounded-none md:border-y-0 md:border-r-0">
        <header className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 pb-3 pt-4 sm:px-5">
          <span className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-white/15 md:hidden" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow inline-flex items-center gap-1.5">
              <ListVideo size={12} strokeWidth={1.75} aria-hidden="true" /> On this device
            </p>
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">Queue</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
              {size === 0 ? 'Empty' : `${upcoming.length} up next${minutes > 0 ? ` · ~${minutes} min` : ''}`}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className={iconBtn} aria-label="Close queue">
            <X size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-4 pt-3 sm:px-5">
          <button
            type="button"
            className="chip"
            aria-pressed={queue.shuffle}
            onClick={() => queueActions.setShuffle(!queue.shuffle)}
            data-testid="queue-shuffle"
          >
            <Shuffle size={13} strokeWidth={1.75} aria-hidden="true" /> Shuffle
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={queue.repeat !== 'off'}
            onClick={() => queueActions.cycleRepeat()}
            aria-label={`${repeatLabel}. Activate to change.`}
            data-testid="queue-repeat"
            data-repeat={queue.repeat}
          >
            <RepeatIcon size={13} strokeWidth={1.75} aria-hidden="true" /> {repeatLabel}
          </button>
          <button
            type="button"
            className="chip"
            role="switch"
            aria-checked={autoplayOn}
            onClick={() => queueActions.toggleAutoplay(nowPlaying?.id)}
            aria-label="Autoplay next"
            data-testid="queue-autoplay"
          >
            <SkipForward size={13} strokeWidth={1.75} aria-hidden="true" /> Autoplay
            <span className="font-mono text-[10px] opacity-70">{autoplayOn ? 'On' : 'Off'}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3 sm:px-5">
          {size === 0 ? (
            <div className="grid place-items-center px-4 py-12 text-center" data-testid="queue-empty">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-white/[0.05] text-ink-3 ring-1 ring-white/10">
                <ListVideo size={20} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-ink">Your queue is empty</p>
              <p className="mt-1 max-w-[16rem] text-[13px] leading-5 text-ink-3">
                Use <span className="text-ink-2">Add to queue</span> or <span className="text-ink-2">Play next</span> on any item, or press{' '}
                <kbd className="rounded border border-line-strong px-1 font-mono text-[11px] text-ink-2">Shift+Q</kbd> while watching.
              </p>
            </div>
          ) : (
            <>
              {nowPlaying && (
                <section aria-label="Now playing">
                  <h3 className="eyebrow">Now playing</h3>
                  <button
                    type="button"
                    onClick={() => onOpenItem?.(nowPlaying)}
                    className="q-now mt-2 flex w-full items-center gap-2.5 rounded-2xl border border-gold-line bg-gold-dim p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-heat/70"
                    data-testid="queue-now-playing"
                    aria-label={`Now playing: ${nowPlaying.title}. Open.`}
                  >
                    <span className="relative shrink-0">
                      <Thumb item={nowPlaying} className="w-[5.5rem]" />
                      <CompletionRingView entry={progress[nowPlaying.id]} size={18} className="left-1 right-auto top-1" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{nowPlaying.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">@{nowPlaying.creator}</span>
                      {progressRatio(progress[nowPlaying.id]) !== null && (
                        <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                          <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.round((progressRatio(progress[nowPlaying.id]) ?? 0) * 100)}%` }} />
                        </span>
                      )}
                    </span>
                    <span className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/35 text-gold-ink" aria-hidden="true">
                      <AudioLines size={15} strokeWidth={2} />
                    </span>
                  </button>
                </section>
              )}

              <section aria-label="Up next" className="mt-5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="eyebrow">
                    Up next {upcoming.length > 0 && <span className="font-mono text-[10px] text-ink-3">· {upcoming.length}</span>}
                  </h3>
                  {queue.shuffle && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-gold-ink">Shuffled</span>}
                </div>
                {rows.length === 0 ? (
                  <p className="mt-2 rounded-2xl border border-dashed border-line-strong p-4 text-center text-[13px] text-ink-3">
                    Nothing queued after this. Add more with <span className="text-ink-2">Add to queue</span>.
                  </p>
                ) : (
                  <Reorder.Group axis="y" as="ol" values={order} onReorder={onReorder} className="mt-2 space-y-1.5" data-testid="queue-list">
                    {rows.map((item, index) => (
                      <UpcomingRow
                        key={item.id}
                        item={item}
                        index={index}
                        total={rows.length}
                        onPlay={play}
                        onCommit={commitDrag}
                        onKeyMove={keyMove}
                        progress={progress[item.id]}
                      />
                    ))}
                  </Reorder.Group>
                )}
              </section>

              {history.length > 0 && (
                <section aria-label="Previously played" className="mt-5">
                  <button
                    type="button"
                    onClick={() => setShowHistory((value) => !value)}
                    className="eyebrow inline-flex min-h-11 items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-heat/70"
                    aria-expanded={showHistory}
                  >
                    <History size={12} strokeWidth={1.75} aria-hidden="true" /> Previously played · {history.length}
                  </button>
                  {showHistory && (
                    <ol className="mt-1 space-y-1">
                      {history
                        .slice()
                        .reverse()
                        .slice(0, 12)
                        .map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => play(item)}
                              className="flex min-h-12 w-full items-center gap-2.5 rounded-xl px-1.5 py-1 text-left opacity-80 outline-none transition-opacity hover:bg-white/[0.04] hover:opacity-100 focus-visible:ring-2 focus-visible:ring-heat/70"
                              aria-label={`Play ${item.title} again`}
                            >
                              <Thumb item={item} className="w-14" />
                              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{item.title}</span>
                            </button>
                          </li>
                        ))}
                    </ol>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        {size > 0 && (
          <footer className="shrink-0 border-t border-white/[0.06] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-5">
            {saving ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  saveCollection()
                }}
              >
                <input
                  autoFocus
                  value={collectionName}
                  onChange={(event) => setCollectionName(event.target.value)}
                  placeholder="Collection name"
                  aria-label="Collection name"
                  maxLength={60}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-transparent px-3 text-base text-ink outline-none placeholder:text-ink-3 focus:border-line-strong sm:text-[13px]"
                />
                <button type="submit" className="btn-primary min-h-11 px-4 text-xs">
                  Save
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setSaving(true)} className="btn-secondary min-h-11 flex-1 text-xs" data-testid="queue-save">
                  <FolderPlus size={14} strokeWidth={1.75} aria-hidden="true" /> Save as collection
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmClear) {
                      setConfirmClear(true)
                      return
                    }
                    setConfirmClear(false)
                    queueActions.clear('all')
                  }}
                  onBlur={() => setConfirmClear(false)}
                  className={cn('min-h-11 text-xs', confirmClear ? 'btn-heat' : 'btn-secondary')}
                  data-testid="queue-clear"
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" /> {confirmClear ? 'Confirm clear' : 'Clear'}
                </button>
              </div>
            )}
          </footer>
        )}
        <div className="sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
      </aside>
    </div>
  )
}
