/**
 * Bluesky (AT Protocol) public AppView collector + actor search. No auth.
 *
 * Endpoints (https://public.api.bsky.app/xrpc/):
 *   app.bsky.actor.searchActors?q=&limit=
 *   app.bsky.feed.getAuthorFeed?actor=&filter=posts_with_media&limit=
 *   app.bsky.feed.searchPosts?q=&tag=&limit=   (may answer 401/403 unauthenticated: soft-fail)
 *
 * Adult-labelled content is kept (adults-only app); posts/accounts carrying
 * non-consensual / illegal / underage labels or `!no-unauthenticated` are skipped.
 * Items link back to https://bsky.app/profile/<handle>/post/<rkey>.
 */
import type { CreatorLead, SourceCreatorHit, UnifiedMediaItem } from '../discovery-types.js'
import {
  FED_MAX_MEDIA, FED_PARALLELISM, RequestBudget, asArray, asRecord, buildFedItem, cleanTerm, fedStatus, httpsUrl,
  normKey, num, redact, settleBounded, str, uniqueById,
  type CollectorOpts, type CollectorResult,
} from './federated-common.js'

export const BLUESKY_APPVIEW = 'https://public.api.bsky.app/xrpc'
const DEFAULT_QUERIES = ['gay nsfw', 'gaymen']
const WATCHLIST_ACTOR_SEARCHES = 3
const SEARCH_POST_REQUESTS = 2

/** Label values that make an item/account ineligible (matched case-insensitively, substring). */
const BLOCKED_LABEL = /(^|[-_!])(csam|cp|child|minor|underage|loli|shota|teen|nonconsensual|non-consensual|ncii|revenge|rape|illegal|takedown|doxx|dox|suspend)([-_]|$)/i
const HIDDEN_LABEL = '!no-unauthenticated'

function labelValues(labels: unknown): string[] {
  return asArray(labels).map((l) => str(asRecord(l)?.val).trim()).filter(Boolean)
}

/** True when labels mean this must not be surfaced. */
export function hasBlockedLabel(...labelSets: unknown[]): boolean {
  return labelSets.some((set) => labelValues(set).some((v) => v.toLowerCase() === HIDDEN_LABEL || BLOCKED_LABEL.test(v)))
}

export function rkeyOf(uri: string): string {
  const match = uri.match(/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]+)$/)
  return match ? match[1] : ''
}

type MediaPart = { kind: 'image'; thumb?: string; full: string; width?: number; height?: number; alt: string }
  | { kind: 'video'; playlist: string; thumb?: string; width?: number; height?: number; alt: string }

function dims(value: unknown): { width?: number; height?: number } {
  const r = asRecord(value)
  const width = num(r?.width)
  const height = num(r?.height)
  return width && height ? { width, height } : {}
}

/** Extract image/video parts from an embed view (images, video, recordWithMedia). */
export function embedMedia(embedValue: unknown): MediaPart[] {
  const embed = asRecord(embedValue)
  if (!embed) return []
  const type = str(embed.$type)
  if (type.startsWith('app.bsky.embed.recordWithMedia')) return embedMedia(embed.media)
  if (type.startsWith('app.bsky.embed.images')) {
    const parts: MediaPart[] = []
    for (const raw of asArray(embed.images).slice(0, 4)) {
      const img = asRecord(raw)
      const full = httpsUrl(img?.fullsize) || httpsUrl(img?.thumb)
      if (!img || !full) continue
      parts.push({ kind: 'image', full, thumb: httpsUrl(img.thumb), alt: str(img.alt), ...dims(img.aspectRatio) })
    }
    return parts
  }
  if (type.startsWith('app.bsky.embed.video')) {
    const playlist = httpsUrl(embed.playlist)
    if (!playlist || !/\.m3u8(\?|$)/i.test(playlist)) return []
    return [{ kind: 'video', playlist, thumb: httpsUrl(embed.thumbnail), alt: str(embed.alt), ...dims(embed.aspectRatio) }]
  }
  return []
}

/** Map one `app.bsky.feed.defs#postView` to media items (one per embedded image/video). */
export function mapBlueskyPost(postValue: unknown, opts: { watched?: boolean } = {}): UnifiedMediaItem[] {
  const post = asRecord(postValue)
  const author = asRecord(post?.author)
  if (!post || !author) return []
  const handle = str(author.handle).trim()
  const rkey = rkeyOf(str(post.uri))
  if (!handle || !/^[a-z0-9.-]+$/i.test(handle) || !rkey) return []
  const record = asRecord(post.record)
  // Record self-labels are shaped { values: [{ val }] }, same as label objects.
  const selfLabels = asRecord(record?.labels)?.values
  if (hasBlockedLabel(post.labels, author.labels, selfLabels)) return []
  const parts = embedMedia(post.embed)
  if (!parts.length) return []
  const pageUrl = `https://bsky.app/profile/${handle}/post/${rkey}`
  const profileUrl = `https://bsky.app/profile/${handle}`
  const creator = redact(str(author.displayName)) || handle
  const text = redact(str(record?.text))
  const tags = asArray(record?.tags).map((t) => str(t)).filter(Boolean)
  const adult = labelValues(post.labels).concat(labelValues(selfLabels)).some((v) => /porn|sexual|nudity/i.test(v))
  return parts.map((part, index): UnifiedMediaItem => buildFedItem({
    id: `bsky-${rkey}-${str(author.did).slice(-8) || handle}${parts.length > 1 ? `-${index}` : ''}`,
    source: 'Bluesky',
    category: 'Bluesky public post',
    title: text || part.alt || `Bluesky post by ${creator}`,
    creator,
    thumbnail: part.thumb || (part.kind === 'image' ? part.full : undefined),
    isVideo: part.kind === 'video',
    streams: part.kind === 'video' ? [part.playlist] : [],
    imageUrl: part.kind === 'image' ? part.full : undefined,
    pageUrl,
    profileUrl,
    description: text || part.alt,
    tags,
    createdAt: str(record?.createdAt) || str(post.indexedAt),
    likes: num(post.likeCount),
    comments: num(post.replyCount),
    width: part.width,
    height: part.height,
    reason: `public Bluesky post by @${handle}${adult ? ' (adult-labelled)' : ''}`,
    watched: opts.watched,
  }))
}

export type BlueskyActor = {
  did: string
  handle: string
  displayName: string
  avatar?: string
  followersCount: number
  postsCount: number
}

export function mapBlueskyActor(value: unknown): BlueskyActor | null {
  const actor = asRecord(value)
  if (!actor) return null
  const handle = str(actor.handle).trim()
  const did = str(actor.did)
  if (!handle || !/^[a-z0-9.-]+$/i.test(handle) || handle === 'handle.invalid' || !did) return null
  if (hasBlockedLabel(actor.labels)) return null
  return {
    did,
    handle,
    displayName: redact(str(actor.displayName)).slice(0, 120) || handle,
    avatar: httpsUrl(actor.avatar),
    followersCount: num(actor.followersCount),
    postsCount: num(actor.postsCount),
  }
}

function actorToLead(actor: BlueskyActor, exactWatchMatch: boolean, sourceAttribution = 'Bluesky public AppView'): CreatorLead {
  return {
    id: `bsky-${actor.did}`,
    name: actor.displayName,
    username: actor.handle,
    platform: 'Bluesky',
    profileUrl: `https://bsky.app/profile/${actor.handle}`,
    avatar: actor.avatar,
    tags: [],
    observedAt: new Date().toISOString(),
    sourceAttribution,
    confidence: exactWatchMatch ? 0.8 : 0.45,
    exactWatchMatch,
  }
}

/** True when the actor plausibly is the named creator (exact handle/name match only). */
export function actorMatchesName(actor: BlueskyActor, name: string): boolean {
  const target = normKey(name)
  if (!target) return false
  return normKey(actor.handle) === target || normKey(actor.handle.split('.')[0]) === target || normKey(actor.displayName) === target
}

const xrpc = (method: string, params: Record<string, string>) => `${BLUESKY_APPVIEW}/${method}?${new URLSearchParams(params)}`

export async function collectBluesky(opts: CollectorOpts = {}): Promise<CollectorResult> {
  const budget = new RequestBudget(opts.maxRequests ?? 8, opts.signal)
  const media: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  const query = cleanTerm(opts.query)
  const names = (opts.watchlist || []).map(cleanTerm).filter((v): v is string => Boolean(v)).slice(0, WATCHLIST_ACTOR_SEARCHES)
  try {
    // 1) hashtag / keyword post search (often requires auth; soft-fails)
    const queries = (query ? [query] : DEFAULT_QUERIES).slice(0, SEARCH_POST_REQUESTS)
    const feedActors: BlueskyActor[] = []
    await settleBounded([
      ...queries.map((q) => async () => {
        const params: Record<string, string> = { q: q.startsWith('#') ? q.slice(1) : q, limit: '25', sort: 'latest' }
        if (q.startsWith('#')) params.tag = q.slice(1)
        const body = asRecord(await budget.json(xrpc('app.bsky.feed.searchPosts', params)))
        for (const post of asArray(body?.posts)) {
          const items = mapBlueskyPost(post)
          media.push(...items)
          const actor = items.length ? mapBlueskyActor(asRecord(post)?.author) : null
          if (actor && !leads.has(actor.did)) leads.set(actor.did, actorToLead(actor, false))
        }
      }),
      // 2) watchlist creators: actor search by handle/name
      ...names.map((name) => async () => {
        const body = asRecord(await budget.json(xrpc('app.bsky.actor.searchActors', { q: name, limit: '5' })))
        const match = asArray(body?.actors).map(mapBlueskyActor).find((a): a is BlueskyActor => Boolean(a) && actorMatchesName(a as BlueskyActor, name))
        if (!match) return
        leads.set(match.did, actorToLead(match, true, 'Bluesky actor search (public AppView)'))
        feedActors.push(match)
      }),
    ], FED_PARALLELISM, (task) => task())

    // 3) author feeds for matched watchlist creators
    await settleBounded(feedActors.slice(0, 3), FED_PARALLELISM, async (actor) => {
      const body = asRecord(await budget.json(xrpc('app.bsky.feed.getAuthorFeed', { actor: actor.handle, filter: 'posts_with_media', limit: '20' })))
      for (const entry of asArray(body?.feed)) {
        const rec = asRecord(entry)
        if (rec?.reason) continue // skip reposts: attribution stays with the original author's own posts
        media.push(...mapBlueskyPost(rec?.post, { watched: true }))
      }
    })
  } catch {
    // never throws
  }
  const items = uniqueById(media).slice(0, FED_MAX_MEDIA)
  const leadList = [...leads.values()]
  return {
    media: items,
    leads: leadList,
    attempted: budget.attempted,
    succeeded: budget.succeeded,
    status: fedStatus(
      { id: 'bluesky', name: 'Bluesky', searchUrl: `https://bsky.app/search?q=${encodeURIComponent(query || 'gay')}` },
      budget,
      { media: items.length, creators: leadList.length },
      {
        ok: 'Public Bluesky posts and creators from the AT Protocol AppView.',
        blocked: 'Bluesky public search requires authentication right now; only account lookups are available.',
        down: 'The Bluesky public AppView is temporarily unreachable.',
        nothing: 'Bluesky discovery did not run.',
      },
    ),
  }
}

/** Creator search: `app.bsky.actor.searchActors`. Never throws; [] on any failure. */
export async function searchBlueskyCreators(
  query: string,
  opts: { signal?: AbortSignal; onHits?: (hits: SourceCreatorHit[]) => void } = {},
): Promise<SourceCreatorHit[]> {
  try {
    const q = query.replace(/^@/, '').trim()
    if (!q || q.includes('@')) return []
    const budget = new RequestBudget(1, opts.signal)
    const body = asRecord(await budget.json(xrpc('app.bsky.actor.searchActors', { q, limit: '8' })))
    const hits = asArray(body?.actors).slice(0, 8).map(mapBlueskyActor).filter((a): a is BlueskyActor => Boolean(a)).map((actor): SourceCreatorHit => ({
      handle: actor.handle,
      displayName: actor.displayName,
      platform: 'Bluesky',
      profileUrl: `https://bsky.app/profile/${actor.handle}`,
      avatar: actor.avatar,
      followers: actor.followersCount,
      mediaCount: actor.postsCount,
      confidence: 0.5,
      matchedBy: 'search',
      sourceAttribution: 'Bluesky actor search (public AppView)',
    }))
    if (hits.length) opts.onHits?.(hits)
    return hits
  } catch {
    return []
  }
}
