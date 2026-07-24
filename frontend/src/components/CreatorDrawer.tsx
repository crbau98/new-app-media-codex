import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ExternalLink, Radar, Sparkles, UserPlus, X } from 'lucide-react'
import type { Creator, MediaItem } from '@/lib/types'
import { creatorFollowId, creatorKey, formatMetric, relativeTime } from '@/lib/discovery'
import { useAppStore } from '@/store'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import MediaDetail from './MediaDetail'
import MediaImage from './MediaImage'
import { cn } from '@/lib/utils'

const easeOut = [0.16, 1, 0.3, 1] as [number, number, number, number]

function AvatarTile({ creator, size = 'md' }: { creator: Creator; size?: 'md' | 'lg' }) {
  const media = creator.media ?? []
  const src = creator.avatar || media[0]?.thumbnail || ''
  const [failed, setFailed] = useState(false)
  const dims = size === 'lg' ? 'h-20 w-20 text-2xl' : 'h-14 w-14 text-base'

  if (!src || failed) {
    // Non-explicit fallback tile: platform initial on a matte surface.
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-md bg-sunken font-mono font-medium text-ink-2', dims)} aria-hidden="true">
        {creator.name.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-md bg-sunken object-cover', dims)}
    />
  )
}

interface CreatorDrawerProps {
  creator: Creator | null
  onClose: () => void
}

export default function CreatorDrawer({ creator, onClose }: CreatorDrawerProps) {
  const panelRef = useRef<HTMLElement>(null)
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null)
  const followCache = useAppStore((state) => state.followCache)
  const toggleFollow = useAppStore((state) => state.toggleFollow)
  const addToast = useAppStore((state) => state.addToast)
  const creatorWatchlist = useAppStore((state) => state.creatorWatchlist)
  const addCreatorToWatchlist = useAppStore((state) => state.addCreatorToWatchlist)
  const removeCreatorFromWatchlist = useAppStore((state) => state.removeCreatorFromWatchlist)

  const media = creator?.media ?? []
  const followId = creator ? creatorFollowId(creator.name) : ''
  const followed = Boolean(followId && followCache[followId])
  const onRadar = creator ? creatorWatchlist.some((entry) => creatorKey(entry) === creatorKey(creator.name)) : false

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
      removeCreatorFromWatchlist(creator.name)
      addToast({ type: 'info', title: `Removed @${creator.name} from your radar` })
    } else {
      addCreatorToWatchlist(creator.name)
      addToast({ type: 'success', title: `Radar is scanning for @${creator.name}` })
    }
  }, [addCreatorToWatchlist, addToast, creator, onRadar, removeCreatorFromWatchlist])

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
            className="relative z-10 flex h-full w-full max-w-[480px] flex-col overflow-y-auto overscroll-contain border-l border-line bg-canvas shadow-overlay outline-none"
            role="dialog"
            aria-modal="true"
            aria-label={`Creator ${creator.name}`}
          >
            {/* Cover */}
            <div className="relative h-36 shrink-0 overflow-hidden bg-sunken">
              {media[0] && (
                <MediaImage
                  sources={media[0].isVideo ? [media[0].thumbnail] : [media[0].thumbnail, media[0].mediaUrl]}
                  alt=""
                  className="h-full w-full object-cover opacity-40"
                  skeletonClassName="h-full w-full"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-canvas to-transparent" aria-hidden="true" />
              <button
                onClick={onClose}
                className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] grid h-10 w-10 place-items-center rounded-md bg-canvas/70 text-ink hover:bg-canvas"
                aria-label="Close creator profile"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div className="px-5 pb-[max(2.5rem,calc(env(safe-area-inset-bottom)+1.5rem))]">
              <div className="-mt-8 flex items-end justify-between gap-3">
                <AvatarTile creator={creator} size="lg" />
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

              {/* Mono stat grid */}
              <dl className="mt-5 grid grid-cols-3 gap-y-4 border-y border-line py-4">
                {creator.followers != null && (
                  <div>
                    <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Followers</dt>
                    <dd className="mt-0.5 font-mono text-sm text-ink">{formatMetric(creator.followers)}</dd>
                  </div>
                )}
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Evidence</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{creator.evidenceCount ?? creator.mediaCount ?? media.length}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Last seen</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{relativeTime(creator.lastSeenAt ?? creator.observedAt)}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Views</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{formatMetric(creator.viewCount)}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Likes</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{formatMetric(creator.likeCount)}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Signal</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{creator.curationScore ?? '—'}</dd>
                </div>
              </dl>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={follow}
                  className={cn('min-h-10', followed ? 'btn-secondary' : 'btn-heat')}
                  aria-pressed={followed}
                >
                  {followed ? <><Check size={14} strokeWidth={1.75} /> Following</> : <><UserPlus size={14} strokeWidth={1.75} /> Follow</>}
                </button>
                <button onClick={toggleRadar} className="btn-secondary min-h-10" aria-pressed={onRadar}>
                  <Radar size={14} strokeWidth={1.75} aria-hidden="true" />
                  {onRadar ? 'On your radar' : 'Add to radar'}
                </button>
              </div>

              {/* AI reason */}
              {creator.aiSuggested && creator.aiReason && (
                <section className="mt-5 rounded-md border border-line bg-elevated p-4">
                  <h3 className="eyebrow flex items-center gap-1.5 text-heat"><Sparkles size={12} strokeWidth={1.75} /> Why the AI suggested this account</h3>
                  <p className="mt-2 text-[13px] leading-5 text-ink-2">{creator.aiReason}</p>
                </section>
              )}

              {/* Match reasons */}
              {(creator.matchReasons?.length || creator.discoveryReasons?.length) && (
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
              {(creator.profileLinks?.length || creator.profileUrl) && (
                <section className="mt-5">
                  <h3 className="eyebrow">Source links</h3>
                  <ul className="mt-2.5 divide-y divide-line rounded-md border border-line">
                    {(creator.profileLinks?.length
                      ? creator.profileLinks
                      : [{ label: creator.platform || 'Source profile', url: creator.profileUrl! }]
                    ).map((link) => (
                      <li key={link.url}>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex min-h-11 items-center justify-between gap-3 px-3 text-[13px] text-ink hover:bg-sunken"
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

              {/* Media */}
              <section className="mt-6">
                <h3 className="eyebrow">Latest public posts</h3>
                {media.length ? (
                  <div className="media-grid mt-3 grid grid-cols-2 gap-3">
                    {media.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setSelectedMedia(item)}
                        className="block text-left tap-highlight-none"
                        aria-label={`Open ${item.title}`}
                      >
                        <span className="relative block aspect-[2/3] overflow-hidden rounded-md border border-line bg-sunken">
                          <MediaImage
                            sources={item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            skeletonClassName="absolute inset-0"
                          />
                        </span>
                        <span className="mt-1.5 block truncate font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                          {item.source} · {relativeTime(item.createdAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 rounded-md border border-dashed border-line-strong p-5 text-center text-[13px] text-ink-2">
                    The creator was observed, but the source did not return playable public media.
                  </p>
                )}
              </section>
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
