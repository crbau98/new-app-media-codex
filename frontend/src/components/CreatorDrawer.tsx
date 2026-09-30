import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, ExternalLink, Library, Radar, Sparkles, UserPlus, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { Creator, MediaItem } from '@/lib/types'
import { creatorFollowId, creatorKey, formatMetric, relativeTime } from '@/lib/discovery'
import { useAppStore } from '@/store'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import MediaDetail from './MediaDetail'
import MediaImage from './MediaImage'
import MediaGrid from '@/components/discovery/MediaGrid'
import { prefetchCreatorMedia, useCreatorMedia } from '@/features/creators/useCreatorMedia'
import { prefetchCreatorRelated, useCreatorRelated } from '@/features/creators/useCreatorRelated'
import { ElsewhereSection, RelatedCreatorsSection } from '@/features/creators/CreatorRelatedSections'
import { creatorHandle, followName, handleKey, pushDrawerStack, RADAR_CAP, relatedToCreator } from '@/features/creators/creatorLogic'
import type { RelatedCreator } from '@/lib/api'
import { CreatorAvatar } from '@/components/discovery/CreatorParts'
import { hueFor } from '@/components/discovery/mediaMeta'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number]

interface CreatorDrawerProps {
  creator: Creator | null
  onClose: () => void
}

export default function CreatorDrawer({ creator: rootCreator, onClose }: CreatorDrawerProps) {
  const panelRef = useRef<HTMLElement>(null)
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const queryClient = useQueryClient()
  // History: creators opened from "Related creators" stack on top of the creator the drawer was opened with.
  const [trail, setTrail] = useState<{ root: Creator | null; stack: Creator[] }>({ root: null, stack: [] })
  const stack = useMemo(() => (trail.root === rootCreator ? trail.stack : []), [trail, rootCreator])
  const creator = stack.length ? stack[stack.length - 1] : rootCreator
  const previous = stack.length > 1 ? stack[stack.length - 2] : rootCreator
  const followCache = useAppStore((state) => state.followCache)
  const toggleFollow = useAppStore((state) => state.toggleFollow)
  const addToast = useAppStore((state) => state.addToast)
  const creatorWatchlist = useAppStore((state) => state.creatorWatchlist)
  const addCreatorToWatchlist = useAppStore((state) => state.addCreatorToWatchlist)
  const removeCreatorFromWatchlist = useAppStore((state) => state.removeCreatorFromWatchlist)

  const catalog = useCreatorMedia(creator)
  const related = useCreatorRelated(creator, Boolean(creator))
  const openRelated = useCallback((entry: RelatedCreator) => {
    if (!creator || !rootCreator) return
    setSelectedMedia(null)
    setTrail({ root: rootCreator, stack: pushDrawerStack(stack, creator, relatedToCreator(entry)) })
  }, [creator, rootCreator, stack])
  const warmRelated = useCallback((entry: RelatedCreator) => {
    prefetchCreatorRelated(queryClient, entry.handle)
    prefetchCreatorMedia(queryClient, relatedToCreator(entry))
  }, [queryClient])
  const goBack = useCallback(() => {
    setSelectedMedia(null)
    setTrail({ root: rootCreator, stack: stack.slice(0, -1) })
  }, [rootCreator, stack])
  const creatorId = creator?.id
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 })
  }, [creatorId])
  const media = catalog.items
  const sentinelRef = useRef<HTMLDivElement>(null)
  const handle = creator ? creatorHandle(creator) : ''
  const followId = creator ? creatorFollowId(followName(creator)) : ''
  const followed = Boolean(followId && followCache[followId])
  const onRadar = creator ? creatorWatchlist.some((entry) => creatorKey(entry) === handleKey(handle)) : false

  const follow = useCallback(() => {
    if (!creator) return
    const next = !followed
    toggleFollow(followId)
    addToast({
      type: next ? 'success' : 'info',
      title: next ? `Following @${creator.username || creator.name}` : `Unfollowed @${creator.username || creator.name}`,
      message: next ? 'Follows shape your For You mix on this device.' : undefined,
    })
  }, [addToast, creator, followed, followId, toggleFollow])

  const toggleRadar = useCallback(() => {
    if (!creator) return
    if (onRadar) {
      removeCreatorFromWatchlist(handle)
      addToast({ type: 'info', title: `Removed @${handle} from your radar` })
    } else if (creatorWatchlist.length >= RADAR_CAP) {
      addToast({ type: 'error', title: 'Radar is full', message: `Remove a handle first — the radar holds up to ${RADAR_CAP}.` })
    } else {
      addCreatorToWatchlist(handle)
      addToast({ type: 'success', title: `Radar is scanning for @${handle}` })
    }
  }, [addCreatorToWatchlist, addToast, creator, creatorWatchlist.length, handle, onRadar, removeCreatorFromWatchlist])

  // Escape close (focus trap handles Tab cycling)
  useEffect(() => {
    if (!creator) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !selectedMedia) {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [creator, onClose, selectedMedia])

  useEffect(() => {
    if (!creator) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [creator])

  const { hasMore, fetchMore } = catalog
  useEffect(() => {
    const node = sentinelRef.current
    if (!creator || !node || !hasMore || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) fetchMore()
    }, { root: panelRef.current, rootMargin: '600px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [creator, hasMore, fetchMore, media.length])

  useFocusTrap(panelRef, Boolean(creator))

  // Portal to <body>: transformed ancestors (page enter animations) would
  // otherwise trap this fixed overlay inside the page layout on mobile.
  return createPortal(
    <AnimatePresence>
      {creator && (
        <div className="fixed inset-0 z-[150] flex justify-end">
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 h-full w-full bg-scrim"
            onClick={onClose}
            aria-label="Close creator profile"
          />
          <motion.aside
            ref={panelRef}
            tabIndex={-1}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.25, ease: easeOut }}
            className="relative z-10 flex h-full w-full max-w-[500px] flex-col overflow-y-auto overscroll-contain border-l border-line bg-canvas shadow-overlay outline-none"
            role="dialog"
            aria-modal="true"
            aria-label={`Creator ${creator.name}`}
          >
            {/* Cover */}
            <div
              className="d-drawer-cover"
              style={{ ['--h' as string]: hueFor(creator.name) }}
            >
              {media[0] && (
                <MediaImage
                  sources={media[0].isVideo ? [media[0].thumbnail] : [media[0].thumbnail, media[0].mediaUrl]}
                  alt=""
                  className="d-drawer-cover-img h-full w-full object-cover transition-opacity duration-700"
                  skeletonClassName="h-full w-full !bg-transparent !animate-none opacity-0"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/40 to-transparent" aria-hidden="true" />
              {stack.length > 0 && previous && (
                <button
                  type="button"
                  onClick={goBack}
                  className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] inline-flex h-11 max-w-[60%] items-center gap-1.5 rounded-full bg-canvas/80 px-4 text-[13px] text-ink transition-colors hover:bg-canvas"
                  data-testid="drawer-back"
                  aria-label={`Back to ${previous.name}`}
                >
                  <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="truncate">Back</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-canvas/70 text-ink backdrop-blur transition-colors hover:bg-canvas"
                aria-label="Close creator profile"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            <div className="px-5 pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))]">
              <div className="-mt-12 flex items-end justify-between gap-3">
                <span className="d-drawer-ring">
                  <CreatorAvatar creator={creator} className="d-drawer-avatar" />
                </span>
                {creator.aiSuggested && (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-heat-dim px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-heat">
                    <Sparkles size={12} strokeWidth={1.75} aria-hidden="true" /> AI suggested
                  </span>
                )}
              </div>

              <h2 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-ink">{creator.name}</h2>
              <p className="mono-meta mt-1 uppercase">
                @{creator.username || creator.name.replace(/\s+/g, '').toLowerCase()} · {creator.sourceAttribution || creator.platform || 'Public source'}
              </p>
              {catalog.resolvedHandle && (
                <p className="mono-meta mt-1" data-testid="resolved-as">
                  resolved as <strong className="text-ink">@{catalog.resolvedHandle}</strong>
                </p>
              )}
              {catalog.catalogAvailable && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2">
                  <Library size={12} strokeWidth={1.75} aria-hidden="true" /> Full catalog
                </p>
              )}

              {/* Mono stat grid */}
              <dl className="d-drawer-stats mt-5">
                {creator.followers != null && (
                  <div>
                    <dt>Followers</dt>
                    <dd>{formatMetric(creator.followers)}</dd>
                  </div>
                )}
                <div>
                  <dt>Posts</dt>
                  <dd>{catalog.total || creator.mediaCount || creator.evidenceCount || media.length}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{relativeTime(creator.lastSeenAt ?? creator.observedAt)}</dd>
                </div>
                <div>
                  <dt>Views</dt>
                  <dd>{creator.viewCount != null ? formatMetric(creator.viewCount) : "—"}</dd>
                </div>
                <div>
                  <dt>Likes</dt>
                  <dd>{creator.likeCount != null ? formatMetric(creator.likeCount) : "—"}</dd>
                </div>
                <div>
                  <dt>Signal</dt>
                  <dd>{creator.curationScore ?? '—'}</dd>
                </div>
              </dl>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={follow}
                  className={cn('min-h-11', followed ? 'btn-secondary' : 'btn-heat')}
                  aria-pressed={followed}
                >
                  {followed ? <><Check size={14} strokeWidth={1.75} /> Following</> : <><UserPlus size={14} strokeWidth={1.75} /> Follow</>}
                </button>
                <button onClick={toggleRadar} className="btn-secondary min-h-11" aria-pressed={onRadar}>
                  <Radar size={14} strokeWidth={1.75} aria-hidden="true" />
                  {onRadar ? 'On your radar' : 'Add to radar'}
                </button>
              </div>

              {/* AI reason */}
              {creator.aiSuggested && creator.aiReason && (
                <section className="d-panel mt-5">
                  <h3 className="eyebrow flex items-center gap-1.5 text-heat"><Sparkles size={12} strokeWidth={1.75} /> Why the AI suggested this account</h3>
                  <p className="mt-2 text-[13px] leading-5 text-ink-2">{creator.aiReason}</p>
                </section>
              )}

              {/* Match reasons */}
              {((creator.matchReasons?.length ?? 0) > 0 || (creator.discoveryReasons?.length ?? 0) > 0) && (
                <section className="mt-5">
                  <h3 className="eyebrow">Why this account matches</h3>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(creator.matchReasons ?? creator.discoveryReasons ?? []).map((reason) => (
                      <span key={reason} className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ink-2">
                        {reason}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Profile links — always attributed */}
              {((creator.profileLinks?.length ?? 0) > 0 || Boolean(creator.profileUrl)) && (
                <section className="mt-5">
                  <h3 className="eyebrow">Source links</h3>
                  <ul className="mt-2.5 divide-y divide-line overflow-hidden rounded-2xl border border-line">
                    {(creator.profileLinks?.length
                      ? creator.profileLinks
                      : [{ label: creator.platform || 'Source profile', url: creator.profileUrl! }]
                    ).map((link) => (
                      <li key={link.url}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-h-12 items-center justify-between gap-3 px-4 text-[13px] text-ink transition-colors hover:bg-sunken"
                        >
                          <span className="truncate">{link.label}</span>
                          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                            {(() => {
                              try {
                                return new URL(link.url).hostname.replace(/^www\./, '')
                              } catch {
                                return 'source'
                              }
                            })()}
                            <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 font-mono text-[10px] leading-4 text-ink-3">
                    Source-provided uploader accounts. Attribution does not verify the person depicted.
                  </p>
                </section>
              )}

              <RelatedCreatorsSection state={related} onOpen={openRelated} onWarm={warmRelated} />
              <ElsewhereSection state={related} />

              {/* Media */}
              {!catalog.catalogAvailable && media.length === 0 ? (
                <section className="d-panel mt-6" data-testid="link-only">
                  <h3 className="eyebrow">Profile link — opens on the source</h3>
                  <p className="mt-2 text-[13px] leading-5 text-ink-2">
                    This platform has no public catalog Media Codex can browse. Nothing is embedded or imported —
                    the profile opens on the source site.
                  </p>
                  {creator.profileUrl && (
                    <a href={creator.profileUrl} target="_blank" rel="noreferrer" className="btn-secondary mt-3 inline-flex min-h-11">
                      Open on {creator.platform || 'source'} <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
                    </a>
                  )}
                </section>
              ) : (
              <section className="mt-6">
                <h3 className="eyebrow flex items-baseline justify-between gap-3">
                  <span>{catalog.total > media.length || catalog.hasMore ? 'All public posts' : 'Public posts'}</span>
                  {media.length > 0 && (
                    <span className="mono-meta normal-case">{media.length} of {Math.max(catalog.total, media.length)} loaded</span>
                  )}
                </h3>
                {media.length ? (
                  <div className="mt-3">
                    <MediaGrid
                      items={media}
                      layout="cinema"
                      density="normal"
                      onSelect={(id) => setSelectedMedia(media.find((entry) => entry.id === id) ?? null)}
                      ariaLabel={`Posts by ${creator.name}`}
                      hideCreator
                      pageSize={18}
                      priorityCount={2}
                    />
                    <div ref={sentinelRef} aria-hidden="true" className="h-px" />
                    {catalog.hasMore && (
                      <button
                        type="button"
                        onClick={catalog.fetchMore}
                        disabled={catalog.isFetchingMore}
                        className="btn-secondary mx-auto mt-4 flex min-h-11"
                      >
                        {catalog.isFetchingMore ? 'Loading more…' : 'Load more posts'}
                      </button>
                    )}
                    {catalog.error && (
                      <p role="alert" className="mt-3 text-center font-mono text-[11px] text-ink-3">
                        Couldn&apos;t load the full catalog.{' '}
                        <button type="button" onClick={catalog.retry} className="underline">Retry</button>
                      </p>
                    )}
                  </div>
                ) : catalog.isLoading ? (
                  <div className="mt-3 grid grid-cols-3 gap-2" aria-busy="true" aria-label="Loading posts">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="d-skel d-skel-block" style={{ height: 150 }} />
                    ))}
                  </div>
                ) : catalog.error ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-line-strong p-5 text-center text-[13px] text-ink-2">
                    Couldn&apos;t load this creator&apos;s posts.{' '}
                    <button type="button" onClick={catalog.retry} className="underline">Retry</button>
                  </p>
                ) : (
                  <p className="mt-3 rounded-2xl border border-dashed border-line-strong p-5 text-center text-[13px] text-ink-2">
                    The creator was observed, but the source did not return playable public media.
                  </p>
                )}
              </section>
              )}
            </div>
          </motion.aside>

          <MediaDetail
            item={selectedMedia}
            open={Boolean(selectedMedia)}
            onClose={() => setSelectedMedia(null)}
            items={media}
            onNavigate={setSelectedMedia}
          />
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
