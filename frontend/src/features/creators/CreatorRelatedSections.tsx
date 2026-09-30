import { memo } from 'react'
import { Check, ExternalLink } from 'lucide-react'
import type { ElsewhereLink, RelatedCreator } from '@/lib/api'
import type { CreatorRelatedState } from './useCreatorRelated'
import { CreatorAvatar } from '@/components/discovery/CreatorParts'
import { cn } from '@/lib/utils'

/** Hard ceiling on avatars mounted in the rail (phones kill tabs that decode many images). */
export const RELATED_IMAGE_CAP = 12

const PLATFORM_CLASS = 'rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-2'

function Skeletons({ count, className }: { count: number; className: string }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={cn('d-skel', className)} />
      ))}
    </>
  )
}

interface RelatedProps {
  state: CreatorRelatedState
  onOpen: (related: RelatedCreator) => void
  onWarm?: (related: RelatedCreator) => void
}

const RelatedCard = memo(function RelatedCard({ related, onOpen, onWarm }: { related: RelatedCreator } & Omit<RelatedProps, 'state'>) {
  return (
    <li className="w-[148px] shrink-0 snap-start">
      <button
        type="button"
        onClick={() => onOpen(related)}
        onPointerEnter={() => onWarm?.(related)}
        onFocus={() => onWarm?.(related)}
        className="tap-highlight-none flex min-h-[44px] w-full flex-col items-start gap-2 rounded-2xl border border-line bg-elevated/60 p-3 text-left transition-colors hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label={`Open creator ${related.displayName}. ${related.reason}`}
        data-testid="related-card"
      >
        <CreatorAvatar creator={{ name: related.displayName, avatar: related.avatar ?? '' }} className="!h-12 !w-12 !rounded-full" />
        <span className="block w-full">
          <span className="block truncate text-[13px] font-medium text-ink">{related.displayName}</span>
          <span className="mono-meta block truncate">@{related.handle}</span>
        </span>
        <span className="flex flex-wrap gap-1">
          {related.sharedTags.slice(0, 2).map((tag) => (
            <span key={tag} className="max-w-full truncate rounded-full bg-heat-dim px-2 py-0.5 font-mono text-[10px] text-heat">#{tag.replace(/\s+/g, '')}</span>
          ))}
        </span>
      </button>
    </li>
  )
})

/** Horizontal rail of creators with overlapping public tags. */
export function RelatedCreatorsSection({ state, onOpen, onWarm }: RelatedProps) {
  const related = (state.data?.related ?? []).slice(0, RELATED_IMAGE_CAP)
  return (
    <section className="mt-6" aria-labelledby="related-creators-h" data-testid="related-section">
      <h3 id="related-creators-h" className="eyebrow">Related creators</h3>
      {state.isLoading ? (
        <div className="mt-3 flex gap-2 overflow-hidden" aria-busy="true" aria-label="Loading related creators">
          <Skeletons count={3} className="h-[128px] w-[148px] shrink-0 rounded-2xl" />
        </div>
      ) : state.error ? (
        <p role="alert" className="mt-3 rounded-2xl border border-dashed border-line-strong p-4 text-center text-[13px] text-ink-2">
          Couldn&apos;t load related creators.{' '}
          <button type="button" onClick={state.retry} className="min-h-11 px-2 underline">Retry</button>
        </p>
      ) : related.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-line-strong p-4 text-center text-[13px] text-ink-2">
          No related creators found yet
        </p>
      ) : (
        <>
          <ul className="-mx-5 mt-3 flex snap-x scroll-px-5 gap-2 overflow-x-auto px-5 pb-2" aria-label="Related creators">
            {related.map((entry) => (
              <RelatedCard key={entry.handle.toLowerCase()} related={entry} onOpen={onOpen} onWarm={onWarm} />
            ))}
          </ul>
          <p className="mt-1 font-mono text-[10px] leading-4 text-ink-3">Matched on shared public tags only.</p>
        </>
      )}
    </section>
  )
}

function ElsewhereRow({ link }: { link: ElsewhereLink }) {
  const linkOnly = link.linkOnly !== false && link.platform.toLowerCase() !== 'redgifs'
  return (
    <li>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-[13px] text-ink transition-colors hover:bg-sunken"
        data-testid="elsewhere-link"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className={PLATFORM_CLASS}>{link.platform}</span>
            <span className="truncate">@{link.handle}</span>
            {link.verified && (
              <span className="inline-flex shrink-0 items-center text-heat" title="Verified: published by the creator or listed in our registry">
                <Check size={14} strokeWidth={2} aria-hidden="true" />
                <span className="sr-only">Verified</span>
              </span>
            )}
          </span>
          {linkOnly && <span className="mt-0.5 block font-mono text-[10px] text-ink-3">link only — opens on the source</span>}
        </span>
        <ExternalLink size={14} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
      </a>
    </li>
  )
}

/** Links the creator published themselves (never inferred). Renders nothing while loading or when empty. */
export function ElsewhereSection({ state }: { state: CreatorRelatedState }) {
  const links = state.data?.elsewhere ?? []
  if (state.isLoading || state.error || links.length === 0) return null
  return (
    <section className="mt-6" aria-labelledby="elsewhere-h" data-testid="elsewhere-section">
      <h3 id="elsewhere-h" className="eyebrow">Elsewhere</h3>
      <ul className="mt-2.5 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {links.map((link) => <ElsewhereRow key={`${link.platform}:${link.handle}`} link={link} />)}
      </ul>
      <p className="mt-2 font-mono text-[10px] leading-4 text-ink-3">
        Links this creator published themselves. Nothing is inferred or imported.
      </p>
    </section>
  )
}
