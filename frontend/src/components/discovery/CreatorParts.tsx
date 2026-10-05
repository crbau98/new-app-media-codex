import { memo, useState } from 'react'
import type { Creator } from '@/lib/types'
import { formatMetric } from '@/lib/discovery'
import { hueFor } from './mediaMeta'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

// CreatorCard / CreatorBadges live in ./CreatorCard so the eager Home chunk (which only needs the
// avatar and story ring) does not pull the card, tilt and platform-link code.

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
