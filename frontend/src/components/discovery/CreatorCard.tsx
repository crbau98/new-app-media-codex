import { memo, useRef } from 'react'
import { Check, ExternalLink, Library, Plus, Sparkles } from 'lucide-react'
import type { Creator } from '@/lib/types'
import { formatMetric, relativeTime } from '@/lib/discovery'
import MediaImage from '@/components/MediaImage'
import { useFinePointer, useMotionOk } from './motion'
import { hueFor } from './mediaMeta'
import { useDepthTilt } from './useDepthTilt'
import { CreatorAvatar } from './CreatorParts'
import { hasCreatorCatalog } from '@/features/creators/useCreatorMedia'
import { CardPlatformLinks } from '@/features/creators/PlatformLinks'
import '@/styles/discovery.css'

interface CreatorCardProps {
  creator: Creator
  followed: boolean
  aiOk: boolean
  onOpen: (creator: Creator) => void
  onFollow: (creator: Creator) => void
  /** Render the cover image (off for far-down cards so image count stays bounded on phones). */
  showCover?: boolean
}

/** Platform badge + catalog/link-only affordance shared by cards and search results. */
export function CreatorBadges({ creator }: { creator: Creator }) {
  const catalog = hasCreatorCatalog(creator)
  const platform = creator.platform || creator.platforms?.[0]
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {platform && (
        <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2">{platform}</span>
      )}
      {catalog ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-heat-dim px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-heat">
          <Library size={10} strokeWidth={1.75} aria-hidden="true" /> Full catalog
        </span>
      ) : !creator.media?.length ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 font-mono text-[10px] tracking-[0.04em] text-ink-3">
          <ExternalLink size={10} strokeWidth={1.75} aria-hidden="true" /> Profile link — opens on the source
        </span>
      ) : null}
    </span>
  )
}

/** Creator directory card with pointer-tilt depth, cover collage and follow control. */
export const CreatorCard = memo(function CreatorCard({ creator, followed, aiOk, onOpen, onFollow, showCover = true }: CreatorCardProps) {
  const ref = useRef<HTMLElement>(null)
  const motionOk = useMotionOk()
  const fine = useFinePointer()
  useDepthTilt(ref, motionOk && fine, 4)
  const cover = showCover ? creator.media?.[0] : undefined
  const reasons = (creator.matchReasons ?? creator.discoveryReasons ?? []).slice(0, 3)
  const handle = creator.username || creator.name

  return (
    <article ref={ref} className="d-ccard d-tilt-soft" data-followed={followed}>
      <div className="d-ccard-cover" aria-hidden="true" style={{ ['--h' as string]: hueFor(creator.name) }}>
        {cover && (
          <MediaImage
            sources={cover.isVideo ? [cover.thumbnail] : [cover.thumbnail, cover.mediaUrl]}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
            skeletonClassName="absolute inset-0 !bg-transparent !animate-none opacity-0"
          />
        )}
      </div>
      <div className="d-ccard-body">
        <button
          type="button"
          onClick={() => onOpen(creator)}
          className="d-ccard-open tap-highlight-none"
          aria-label={`Open profile of ${creator.name}`}
        >
          <CreatorAvatar creator={creator} className="d-ccard-avatar" />
          <span className="min-w-0 flex-1">
            <span className="d-ccard-name">
              <h3>{creator.name}</h3>
              {creator.aiSuggested && aiOk && (
                <span className="d-chip-ai">
                  <Sparkles size={10} strokeWidth={1.75} aria-hidden="true" /> AI
                </span>
              )}
            </span>
            <span className="d-ccard-sub">@{handle.replace(/^@/, '')}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onFollow(creator)}
          className="d-follow"
          data-on={followed}
          aria-pressed={followed}
          aria-label={followed ? `Unfollow ${creator.name}` : `Follow ${creator.name}`}
        >
          <span className="d-follow-icon" aria-hidden="true">
            {followed ? <Check size={13} strokeWidth={2.25} /> : <Plus size={13} strokeWidth={2.25} />}
          </span>
          {followed ? 'Following' : 'Follow'}
        </button>
      </div>
      <div className="px-4 pb-2">
        <CreatorBadges creator={creator} />
      </div>
      <CardPlatformLinks creator={creator} />
      <dl className="d-ccard-stats">
        {creator.followers != null && (
          <div>
            <dt>Followers</dt>
            <dd>{formatMetric(creator.followers)}</dd>
          </div>
        )}
        <div>
          <dt>{creator.mediaCount ? 'Posts' : 'Evidence'}</dt>
          <dd>{creator.mediaCount ?? creator.evidenceCount ?? 0}</dd>
        </div>
        <div>
          <dt>Seen</dt>
          <dd>{relativeTime(creator.lastSeenAt ?? creator.observedAt)}</dd>
        </div>
      </dl>
      {reasons.length > 0 && (
        <ul className="d-ccard-reasons">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </article>
  )
})
