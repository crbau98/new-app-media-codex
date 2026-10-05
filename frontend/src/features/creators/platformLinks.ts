/**
 * "Find them on": turn what the app already knows about a creator (primary profile URL,
 * `profileLinks`, platform names, self-published "Elsewhere" links) into a deduplicated list of
 * outbound platform links.
 *
 * Nothing here guesses. A platform name without a known profile URL becomes a non-clickable
 * entry (`url: null`); a URL is only ever the creator's own link as published by a source.
 * Pure: no React, no DOM, no network.
 */
import type { Creator } from '../../lib/types.ts'
import {
  displayHandle,
  parseProfileInput,
  platformById,
  platformIdFromName,
  type AnyPlatformId,
  type PlatformKind,
} from './platforms.ts'

export interface PlatformLink {
  /** Dedupe key (`platform:handle`; `platform:` for name-only entries). */
  key: string
  platform: AnyPlatformId
  /** Platform label ("OnlyFans") or, for generic links, the host. */
  label: string
  handle: string
  /** Visible handle ("@name", "u/name"). */
  display: string
  /** Safe https URL of the creator's own page, or null when only the platform name is known. */
  url: string | null
  kind: PlatformKind | 'external'
  /** True when the creator or registry published the link (never inferred from similarity). */
  verified: boolean
  source: 'profile' | 'elsewhere' | 'platform-name'
  /** True when the platform was guessed from the URL shape on an unknown host. */
  inferred: boolean
}

export interface ElsewhereInput {
  platform?: string
  handle?: string
  url?: string
  verified?: boolean
}

export const MAX_PLATFORM_LINKS = 12

const KIND_ORDER: Record<PlatformKind | 'external', number> = {
  playable: 0,
  'public-link': 1,
  'link-in-bio': 2,
  subscription: 3,
  external: 4,
}

/** Pseudo-platform for creators whose source label is not a registry platform. */
export const OTHER_PLATFORM = 'other'

function platformNames(creator: Creator): string[] {
  return [creator.platform, ...(creator.platforms ?? []), creator.sourceAttribution].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
}

/**
 * Deduplicated outbound links for a creator, ordered playable -> public -> link-in-bio ->
 * subscription -> website. `elsewhere` links are re-validated here, never trusted as-is.
 */
export function creatorPlatformLinks(
  creator: Creator | null | undefined,
  elsewhere: readonly ElsewhereInput[] = [],
  cap = MAX_PLATFORM_LINKS,
): PlatformLink[] {
  if (!creator) return []
  const byKey = new Map<string, PlatformLink>()

  const addUrl = (raw: string | undefined, source: PlatformLink['source'], verified: boolean, allowGeneric: boolean) => {
    if (!raw) return
    const parsed = parseProfileInput(raw)
    if (!parsed.ok) return
    const profile = parsed.profile
    if (profile.platform === 'generic' && !allowGeneric) return
    const existing = byKey.get(profile.key)
    if (existing) {
      existing.verified = existing.verified || verified
      return
    }
    byKey.set(profile.key, {
      key: profile.key,
      platform: profile.platform,
      label: profile.platform === 'generic' ? profile.host.replace(/^www\./, '') : platformById(profile.platform)!.label,
      handle: profile.handle,
      display: displayHandle(profile.platform, profile.handle),
      url: profile.url,
      kind: profile.kind,
      verified,
      source,
      inferred: Boolean(profile.inferred),
    })
  }

  addUrl(creator.profileUrl, 'profile', false, false)
  for (const link of creator.profileLinks ?? []) addUrl(link?.url, 'profile', false, false)
  for (const link of elsewhere) addUrl(link?.url, 'elsewhere', link?.verified === true, true)

  // Platform names the sources reported without a URL: shown, never linked.
  const linked = new Set([...byKey.values()].map((link) => link.platform))
  for (const name of platformNames(creator)) {
    const id = platformIdFromName(name)
    if (!id || linked.has(id)) continue
    linked.add(id)
    const def = platformById(id)!
    byKey.set(`${id}:`, {
      key: `${id}:`,
      platform: id,
      label: def.label,
      handle: '',
      display: def.label,
      url: null,
      kind: def.kind,
      verified: false,
      source: 'platform-name',
      inferred: false,
    })
  }

  return [...byKey.values()]
    .map((link, index) => ({ link, index }))
    .sort((a, b) => KIND_ORDER[a.link.kind] - KIND_ORDER[b.link.kind] || a.index - b.index)
    .map((entry) => entry.link)
    .slice(0, Math.max(1, cap))
}

export interface SplitPlatformLinks {
  /** Everything except subscription platforms: rendered as chips. */
  chips: PlatformLink[]
  /** Subscription platforms with a known profile URL: rendered as outbound "Subscribe on" buttons. */
  subscribe: PlatformLink[]
}

export function splitPlatformLinks(links: readonly PlatformLink[]): SplitPlatformLinks {
  const subscribe: PlatformLink[] = []
  const chips: PlatformLink[] = []
  for (const link of links) {
    if (link.kind === 'subscription' && link.url) subscribe.push(link)
    else chips.push(link)
  }
  return { chips, subscribe }
}

/** Registry platform ids a creator appears on (plus `other` when it only has an unrecognised source label). */
export function creatorPlatformIds(creator: Creator): Set<string> {
  const ids = new Set<string>()
  for (const link of creatorPlatformLinks(creator, [], 40)) if (link.platform !== 'generic') ids.add(link.platform)
  if (ids.size === 0 && platformNames(creator).length > 0) ids.add(OTHER_PLATFORM)
  return ids
}

export interface PlatformFilterOption {
  id: string
  label: string
  count: number
  kind: PlatformKind | 'external'
}

/** Count how many entries each platform id covers; options come back biggest first, `other` last. */
export function platformFilterOptions(idSets: Iterable<ReadonlySet<string>>): PlatformFilterOption[] {
  const counts = new Map<string, number>()
  for (const ids of idSets) for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  const options: PlatformFilterOption[] = []
  for (const [id, count] of counts) {
    const def = platformById(id)
    options.push({ id, label: def?.label ?? 'Other', count, kind: def?.kind ?? 'external' })
  }
  return options.sort((a, b) => {
    if (a.id === OTHER_PLATFORM) return 1
    if (b.id === OTHER_PLATFORM) return -1
    return b.count - a.count || a.label.localeCompare(b.label)
  })
}
