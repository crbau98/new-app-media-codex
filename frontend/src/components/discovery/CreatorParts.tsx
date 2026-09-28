import { memo, useRef, useState } from 'react'
import { Check, Plus, Sparkles } from 'lucide-react'
import type { Creator } from '@/lib/types'
import { formatMetric, relativeTime } from '@/lib/discovery'
import MediaImage from '@/components/MediaImage'
import { useFinePointer, useMotionOk } from './motion'
import { hueFor } from './mediaMeta'
import { useDepthTilt } from './useDepthTilt'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

/** Avatar with a deterministic gradient initial fallback (never a broken image). */
export function CreatorAvatar({ creator, className }: { creator: Pick<Creator, 'name' | 'avatar'> & { media?: Creator['media'] }; className?: string }) {
  const src = creator.avatar || creator.media?.[0]?.thumbnail || ''
  const [failedSrc, setFailedSrc] = useState('')
  const failed = !src || failedSrc === src
  const hue = hueFor(creator.name)
  return (
    <span
      className={cn('d-avatar-tile', className)}
      style={{ background: `linear-gradient(150deg, hsl(${hue} 42% 34%), hsl(${(hue + 50) % 360} 46% 18%))` }}
    >
      {failed ? (
        <span aria-hidden="true">{creator.name.charAt(0).toUpperCase()}</span>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
        />
      )}
    </span>
  )
}

interface StoryRingProps {
  creator: Creator
  followed: boolean
  onOpen: (creator: Creator) => void
}

/**
 * Story ring: conic-gradient halo around the avatar. On hover-capable pointers
 * the disc lifts on Z and flips to reveal a stat on its back face; touch keeps
 * the plain ring (tap opens the profile).
 */
export const StoryRing = memo(function StoryRing({ creator, followed, onOpen }: StoryRingProps) {
  const back = creator.followers != null ? `${formatMetric(creator.followers)} fans` : `${creator.mediaCount ?? creator.media?.length ?? 0} posts`
  return (
    <button
      type="button"
      className="d-story tap-highlight-none"
      data-followed={followed}
      onClick={() => onOpen(creator)}
      aria-label={`Open creator ${creator.name}`}
    >
      <span className="d-story-stage" aria-hidden="true">
        <span className="d-story-flip">
          <span className="d-story-face d-story-front">
            <span className="d-story-ring">
              <CreatorAvatar creator={creator} className="d-story-avatar" />
            </span>
          </span>
          <span className="d-story-face d-story-back">
            <span className="d-story-ring">
              <span className="d-story-stat">{back}</span>
            </span>
          </span>
        </span>
      </span>
      <span className="d-story-name">{creator.username || creator.name}</span>
    </button>
  )
})

interface CreatorCardProps {
  creator: Creator
  followed: boolean
  aiOk: boolean
  onOpen: (creator: Creator) => void
  onFollow: (creator: Creator) => void
}

/** Creator directory card with pointer-tilt depth, cover collage and follow control. */
export const CreatorCard = memo(function CreatorCard({ creator, followed, aiOk, onOpen, onFollow }: CreatorCardProps) {
  const ref = useRef<HTMLElement>(null)
  const motionOk = useMotionOk()
  const fine = useFinePointer()
  useDepthTilt(ref, motionOk && fine, 4)
  const cover = creator.media?.[0]
  const reasons = (creator.matchReasons ?? creator.discoveryReasons ?? []).slice(0, 3)
  const platforms = (creator.platforms ?? [creator.platform]).filter(Boolean).slice(0, 2).join(' · ') || creator.sourceAttribution || 'public source'

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
            <span className="d-ccard-sub">{platforms}</span>
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
      <dl className="d-ccard-stats">
        {creator.followers != null && (
          <div>
            <dt>Followers</dt>
            <dd>{formatMetric(creator.followers)}</dd>
          </div>
        )}
        <div>
          <dt>Evidence</dt>
          <dd>{creator.evidenceCount ?? creator.mediaCount ?? 0}</dd>
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
