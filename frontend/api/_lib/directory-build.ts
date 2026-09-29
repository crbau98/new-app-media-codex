/**
 * Pure aggregation of provider items into directory `Creator` objects.
 * Uses the same sanitising / mapping helpers as the feed so both surfaces agree.
 */
import { creatorKeyOf, isEligibleCreatorItem } from './discovery-lanes.js'
import {
  hasPlayableUrls, mapRedgifsItem, proxiedMediaUrl, safeProviderMediaUrl, sanitizeProviderItem, toIsoDate,
  type RedgifsItem,
} from './redgifs.js'
import type { UnifiedMediaItem } from './discovery-types.js'

export type DirectorySort = 'smart' | 'newest' | 'popular'

export interface DirectoryCreator {
  id: string
  name: string
  username: string
  avatar: string
  followers: null
  platform: 'Redgifs'
  platforms: string[]
  profileUrl: string
  profileLinks: Array<{ label: string; url: string }>
  mediaCount: number
  evidenceCount: number
  viewCount: number
  likeCount: number
  curationScore: number
  lastSeenAt: string | null
  observedAt: string
  discoveryTags: string[]
  sourceAttribution: string
  media: UnifiedMediaItem[]
  /** Internal stable key (canonical handle). */
  key: string
}

function percentile(value: number, cohort: number[]): number {
  if (cohort.length <= 1) return 0.5
  const below = cohort.filter((candidate) => candidate < value).length
  const equal = cohort.filter((candidate) => candidate === value).length
  return (below + Math.max(0, equal - 1) / 2) / (cohort.length - 1)
}

/** Aggregate raw provider items (any lanes) into one entry per provider userName. */
export function aggregateCreators(rawItems: RedgifsItem[], laneTagsById: Map<string, Set<string>> = new Map()): DirectoryCreator[] {
  const byId = new Map<string, RedgifsItem>()
  for (const raw of rawItems) {
    const item = sanitizeProviderItem(raw)
    if (!item.id || !creatorKeyOf(item) || !isEligibleCreatorItem(item) || !hasPlayableUrls(item)) continue
    byId.set(item.id, item)
  }
  const items = [...byId.values()]
  const viewCohort = items.map((item) => Math.log1p(item.views || 0))
  const likeCohort = items.map((item) => Math.log1p(item.likes || 0))
  const scored = new Map<string, number>()
  for (const item of items) {
    const created = Date.parse(toIsoDate(item.createDate)) || 0
    const hoursOld = created ? Math.max(0, (Date.now() - created) / 3_600_000) : Number.POSITIVE_INFINITY
    scored.set(item.id!, Math.min(100, Math.round((
      percentile(Math.log1p(item.views || 0), viewCohort) * 0.48
      + percentile(Math.log1p(item.likes || 0), likeCohort) * 0.29
      + Math.exp(-hoursOld / (24 * 14)) * 0.14
    ) * 100)))
  }

  const groups = new Map<string, RedgifsItem[]>()
  for (const item of items) {
    const key = creatorKeyOf(item)
    groups.set(key, [...(groups.get(key) || []), item])
  }

  return [...groups.entries()].map(([key, group]): DirectoryCreator => {
    const ranked = [...group].sort((a, b) => (scored.get(b.id!) || 0) - (scored.get(a.id!) || 0) || (b.views || 0) - (a.views || 0) || String(a.id).localeCompare(String(b.id)))
    const top = ranked.slice(0, 6)
    const media = top.map((item) => mapRedgifsItem(item, false))
    const handle = group[0].userName || key
    const newest = group.reduce((max, item) => Math.max(max, item.createDate || 0), 0)
    const lastSeenAt = toIsoDate(newest) || null
    const tags = new Map<string, number>()
    for (const item of group) {
      for (const tag of [...(item.tags || []), ...(laneTagsById.get(item.id!) || [])]) {
        const label = tag.trim()
        if (label) tags.set(label, (tags.get(label) || 0) + 1)
      }
    }
    const thumb = proxiedMediaUrl(safeProviderMediaUrl(top[0].urls?.thumbnail || top[0].urls?.poster)) || media[0]?.thumbnail || ''
    const profileUrl = `https://www.redgifs.com/users/${encodeURIComponent(handle)}`
    return {
      id: `creator-${key}`,
      key,
      name: handle,
      username: handle,
      avatar: thumb,
      followers: null,
      platform: 'Redgifs',
      platforms: ['Redgifs'],
      profileUrl,
      profileLinks: [{ label: 'redgifs.com', url: profileUrl }],
      mediaCount: group.length,
      evidenceCount: group.length,
      viewCount: group.reduce((sum, item) => sum + Math.max(0, item.views || 0), 0),
      likeCount: group.reduce((sum, item) => sum + Math.max(0, item.likes || 0), 0),
      curationScore: Math.max(...group.map((item) => scored.get(item.id!) || 0)),
      lastSeenAt,
      observedAt: lastSeenAt || '',
      discoveryTags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag).slice(0, 20),
      sourceAttribution: 'Public source metadata: Redgifs',
      media,
    }
  })
}

export function sortDirectory(creators: DirectoryCreator[], sort: DirectorySort): DirectoryCreator[] {
  const byName = (a: DirectoryCreator, b: DirectoryCreator) => a.key.localeCompare(b.key)
  const sorted = [...creators]
  if (sort === 'newest') return sorted.sort((a, b) => (Date.parse(b.lastSeenAt || '') || 0) - (Date.parse(a.lastSeenAt || '') || 0) || byName(a, b))
  if (sort === 'popular') return sorted.sort((a, b) => b.viewCount - a.viewCount || b.likeCount - a.likeCount || byName(a, b))
  return sorted.sort((a, b) => b.curationScore - a.curationScore || b.viewCount - a.viewCount || byName(a, b))
}
