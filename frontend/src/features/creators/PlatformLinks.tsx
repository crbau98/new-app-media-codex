import { memo, useMemo } from 'react'
import { ArrowUpRight, Bookmark, BookmarkCheck, Check, ExternalLink, Globe, Lock } from 'lucide-react'
import type { Creator } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  OUTBOUND_REL,
  PAYWALL_NOTE,
  platformById,
  safeOutboundUrl,
  type AnyPlatformId,
} from './platforms'
import { creatorPlatformLinks, splitPlatformLinks, type ElsewhereInput, type PlatformLink } from './platformLinks'
import './platforms.css'

const style = (accent: string | undefined) => (accent ? { ['--pf' as string]: accent } : undefined)

/** Tinted monogram tile for a platform. Brand-neutral: no logo or remote image is ever loaded. */
export function PlatformMark({ platform, className }: { platform: AnyPlatformId | string; className?: string }) {
  const def = platformById(platform)
  return (
    <span className={cn('pf-mark', className)} style={style(def?.accent)} data-len={def?.mark.length} aria-hidden="true">
      {def ? def.mark : <Globe size={14} strokeWidth={1.75} />}
    </span>
  )
}

function chipName(link: PlatformLink): string {
  return link.platform === 'generic' || !link.handle ? link.label : `${link.label} ${link.display}`
}

/** One outbound platform chip (or a dashed, non-clickable chip when only the platform name is known). */
export function PlatformChip({ link, showHandle = false }: { link: PlatformLink; showHandle?: boolean }) {
  const href = link.url ? safeOutboundUrl(link.url) : null
  const def = platformById(link.platform)
  const inner = (
    <>
      <PlatformMark platform={link.platform} />
      <span className="pf-chip-label">{link.label}</span>
      {showHandle && link.handle && link.platform !== 'generic' && <span className="pf-chip-handle">{link.display}</span>}
      {link.verified && <Check size={13} strokeWidth={2} className="shrink-0 text-heat" aria-hidden="true" />}
      {href && <ExternalLink size={12} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />}
    </>
  )
  if (!href) {
    return (
      <span className="pf-chip pf-chip-static" style={style(def?.accent)} title="Listed by the source, but no profile link is known">
        {inner}
        <span className="sr-only"> (no profile link known)</span>
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel={OUTBOUND_REL}
      className="pf-chip"
      style={style(def?.accent)}
      data-testid="platform-chip"
      data-platform={link.platform}
      aria-label={`${chipName(link)} — opens in a new tab`}
    >
      {inner}
      {link.verified && <span className="sr-only"> (published by the creator or registry)</span>}
    </a>
  )
}

/** "Subscribe on <platform> ↗ — opens their page": outbound only, to the creator's OWN profile URL. */
export function SubscribeButton({ link, className }: { link: PlatformLink; className?: string }) {
  const href = link.url ? safeOutboundUrl(link.url) : null
  if (!href) return null
  const def = platformById(link.platform)
  return (
    <a
      href={href}
      target="_blank"
      rel={OUTBOUND_REL}
      className={cn('pf-sub', className)}
      style={style(def?.accent)}
      data-testid="subscribe-link"
      data-platform={link.platform}
      aria-label={`Subscribe on ${link.label} — opens their page in a new tab`}
    >
      <PlatformMark platform={link.platform} />
      <span className="pf-sub-text">
        <span className="pf-sub-title">
          Subscribe on {link.label}
          <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="pf-sub-hint">opens their page{link.handle ? ` · ${link.display}` : ''}</span>
      </span>
    </a>
  )
}

export function PaywallNote({ className }: { className?: string }) {
  return (
    <p className={cn('pf-note', className)} data-testid="paywall-note">
      <Lock size={11} strokeWidth={1.75} aria-hidden="true" />
      <span>{PAYWALL_NOTE}</span>
    </p>
  )
}

const CARD_CHIP_CAP = 3
const CARD_SUBSCRIBE_CAP = 2

/**
 * Compact "Find them on" block for directory cards. Hidden when the creator's only link is the
 * playable source that the card already badges (the drawer lists everything).
 */
export const CardPlatformLinks = memo(function CardPlatformLinks({ creator }: { creator: Creator }) {
  const { chips, subscribe, extra } = useMemo(() => {
    const split = splitPlatformLinks(creatorPlatformLinks(creator))
    const onlySource = split.chips.length === 1 && split.chips[0].kind === 'playable' && split.subscribe.length === 0
    const shown = onlySource ? [] : split.chips
    return {
      chips: shown.slice(0, CARD_CHIP_CAP),
      subscribe: split.subscribe.slice(0, CARD_SUBSCRIBE_CAP),
      extra: Math.max(0, shown.length - CARD_CHIP_CAP) + Math.max(0, split.subscribe.length - CARD_SUBSCRIBE_CAP),
    }
  }, [creator])
  if (chips.length === 0 && subscribe.length === 0) return null
  return (
    <div className="grid gap-2 px-4 pb-3" data-testid="card-platform-links">
      <p className="pf-eyebrow">Find them on</p>
      {chips.length > 0 && (
        <ul className="pf-chips" aria-label="Find them on">
          {chips.map((link) => (
            <li key={link.key} className="min-w-0 max-w-full">
              <PlatformChip link={link} />
            </li>
          ))}
          {extra > 0 && <li className="pf-chip-more">+{extra} more</li>}
        </ul>
      )}
      {subscribe.length > 0 && (
        <>
          <ul className="pf-subs" aria-label="Subscription pages">
            {subscribe.map((link) => (
              <li key={link.key}>
                <SubscribeButton link={link} />
              </li>
            ))}
          </ul>
          <PaywallNote />
        </>
      )}
    </div>
  )
})

interface PlatformLinksSectionProps {
  creator: Creator
  elsewhere?: readonly ElsewhereInput[]
  /** Save every listed link (with a handle) to the on-device saved profiles. */
  onSaveAll?: (links: PlatformLink[]) => void
  /** Keys (`platform:handle`) already in the saved profiles. */
  savedKeys?: ReadonlySet<string>
}

/** Drawer section: platform chips, subscription link-out buttons, the paywall note and "save these links". */
export function PlatformLinksSection({ creator, elsewhere, onSaveAll, savedKeys }: PlatformLinksSectionProps) {
  const links = useMemo(() => creatorPlatformLinks(creator, elsewhere ?? []), [creator, elsewhere])
  const { chips, subscribe } = useMemo(() => splitPlatformLinks(links), [links])
  const savable = useMemo(() => links.filter((link) => link.url && link.handle), [links])
  const allSaved = savable.length > 0 && savable.every((link) => savedKeys?.has(link.key))
  if (links.length === 0) return null
  return (
    <section className="mt-5" aria-labelledby="find-them-on-h" data-testid="find-them-on">
      <h3 id="find-them-on-h" className="eyebrow">Find them on</h3>
      {chips.length > 0 && (
        <ul className="pf-chips mt-2.5" aria-label="Platforms">
          {chips.map((link) => (
            <li key={link.key} className="min-w-0 max-w-full">
              <PlatformChip link={link} showHandle />
            </li>
          ))}
        </ul>
      )}
      {subscribe.length > 0 && (
        <div className="mt-3 grid gap-2">
          <ul className="pf-subs" aria-label="Subscription pages">
            {subscribe.map((link) => (
              <li key={link.key}>
                <SubscribeButton link={link} />
              </li>
            ))}
          </ul>
          <PaywallNote />
        </div>
      )}
      {onSaveAll && savable.length > 0 && (
        <button
          type="button"
          onClick={() => onSaveAll(savable)}
          disabled={allSaved}
          className="btn-secondary mt-3 min-h-11"
          data-testid="save-platform-links"
        >
          {allSaved ? <BookmarkCheck size={14} strokeWidth={1.75} aria-hidden="true" /> : <Bookmark size={14} strokeWidth={1.75} aria-hidden="true" />}
          {allSaved ? 'Saved to your profiles' : `Save ${savable.length === 1 ? 'this link' : `these ${savable.length} links`}`}
        </button>
      )}
      <p className="mt-2 font-mono text-[10px] leading-4 text-ink-3">
        Links open on each creator&apos;s own page. Media Codex never loads or shows content from subscription sites.
      </p>
    </section>
  )
}
