/**
 * Lemmy public API collector. No auth.
 *
 *   GET https://{instance}/api/v3/post/list?community_name=&sort=New&limit=20
 *   GET https://{instance}/api/v3/search?type_=Users&q=&limit=3            (watchlist names)
 *   GET https://{instance}/api/v3/user?username=&sort=New&limit=20         (matched watchlist names)
 *
 * Env: LEMMY_INSTANCES (comma separated hosts), LEMMY_COMMUNITIES (comma separated
 * community names, optionally `name@host`). Only NSFW-enabled instances return NSFW
 * posts unauthenticated; others soft-fail or return nothing.
 * Only direct media URLs (image/video/gifv) and a short list of known embed hosts are mapped.
 */
import type { CreatorLead, UnifiedMediaItem } from '../discovery-types.js'
import { safeHost } from './http.js'
import {
  FED_MAX_MEDIA, FED_PARALLELISM, RequestBudget, asArray, asRecord, buildFedItem, cleanTerm, fedStatus, httpsUrl,
  normKey, num, parseHostList, parseTokenList, settleBounded, str, stripHtml, uniqueById,
  type CollectorOpts, type CollectorResult,
} from './federated-common.js'

/** Review periodically; not verified live from CI. Override with LEMMY_INSTANCES. */
export const DEFAULT_LEMMY_INSTANCES: readonly string[] = ['lemmynsfw.com', 'lemmy.world']
/** Names that may not exist on every instance; missing communities simply 404 (soft-fail). */
export const DEFAULT_LEMMY_COMMUNITIES: readonly string[] = ['gaybros', 'gaynsfw', 'gayporn']
const COMMUNITY_PATTERN = /^[a-z0-9_]{2,50}(@[a-z0-9.-]{3,253})?$/i
const EMBED_HOSTS = /(^|\.)(redgifs\.com|imgur\.com|gfycat\.com|i\.redd\.it|v\.redd\.it|streamable\.com)$/i

export function lemmyInstances(env: Record<string, string | undefined> = process.env): string[] {
  return parseHostList(env.LEMMY_INSTANCES, DEFAULT_LEMMY_INSTANCES, 3)
}
export function lemmyCommunities(env: Record<string, string | undefined> = process.env): string[] {
  return parseTokenList(env.LEMMY_COMMUNITIES, DEFAULT_LEMMY_COMMUNITIES, COMMUNITY_PATTERN, 6)
    .filter((c) => !c.includes('@') || Boolean(safeHost(c.split('@')[1])))
}

export type LemmyMedia =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'embed'; url: string }

/** Classify a post link: direct image/video/gifv, known embed host, or null. */
export function classifyLemmyUrl(value: unknown): LemmyMedia | null {
  const href = httpsUrl(value)
  if (!href) return null
  const url = new URL(href)
  const path = url.pathname.toLowerCase()
  if (/\.(jpe?g|png|gif|webp|avif)$/.test(path)) return { kind: 'image', url: href }
  if (/\.(mp4|webm|m4v|mov|m3u8)$/.test(path)) return { kind: 'video', url: href }
  if (/\.gifv$/.test(path)) {
    url.pathname = url.pathname.replace(/\.gifv$/i, '.mp4')
    return { kind: 'video', url: url.href }
  }
  if (EMBED_HOSTS.test(url.hostname)) return { kind: 'embed', url: href }
  return null
}

type Person = { handle: string; displayName: string; url: string; avatar?: string; posts: number }

export function mapLemmyPerson(value: unknown, instanceHost: string): Person | null {
  const p = asRecord(value)
  if (!p || p.banned === true || p.deleted === true) return null
  const name = str(p.name).trim()
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) return null
  const url = httpsUrl(p.actor_id) || `https://${instanceHost}/u/${name}`
  let host = instanceHost
  try { host = new URL(url).hostname.toLowerCase() } catch { /* keep */ }
  return { handle: `${name}@${host}`, displayName: stripHtml(str(p.display_name)).slice(0, 120) || name, url, avatar: httpsUrl(p.avatar), posts: 0 }
}

function personLead(person: Person, exactWatchMatch: boolean, instanceHost: string, tags: string[] = []): CreatorLead {
  return {
    id: `lemmy-${person.handle}`,
    name: person.displayName,
    username: person.handle,
    platform: 'Lemmy',
    profileUrl: person.url,
    avatar: person.avatar,
    tags: tags.slice(0, 6),
    observedAt: new Date().toISOString(),
    sourceAttribution: `Lemmy public API via ${instanceHost}`,
    confidence: exactWatchMatch ? 0.75 : 0.4,
    exactWatchMatch,
  }
}

/** Map a Lemmy PostView to at most one media item. */
export function mapLemmyPost(value: unknown, instanceHost: string, opts: { watched?: boolean } = {}): { item: UnifiedMediaItem | null; person: Person | null } {
  const v = asRecord(value)
  const post = asRecord(v?.post)
  if (!v || !post || post.deleted === true || post.removed === true) return { item: null, person: null }
  const community = asRecord(v.community)
  if (community && (community.removed === true || community.deleted === true)) return { item: null, person: null }
  const person = mapLemmyPerson(v.creator, instanceHost)
  if (!person) return { item: null, person: null }
  if (asRecord(v.creator)?.bot_account === true) return { item: null, person: null }
  const media = classifyLemmyUrl(post.url)
  const thumb = httpsUrl(post.thumbnail_url)
  if (!media) return { item: null, person }
  if (media.kind === 'embed' && !thumb) return { item: null, person }
  const id = num(post.id)
  const pageUrl = httpsUrl(post.ap_id) || (id ? `https://${instanceHost}/post/${id}` : undefined)
  if (!pageUrl) return { item: null, person }
  const isVideo = media.kind === 'video'
  const counts = asRecord(v.counts)
  const communityName = str(community?.name)
  const body = stripHtml(str(post.body))
  const item = buildFedItem({
    id: `lemmy-${instanceHost}-${id || normKey(pageUrl)}`,
    source: 'Lemmy',
    category: 'Lemmy public community',
    title: stripHtml(str(post.name)) || `Post by ${person.displayName}`,
    creator: person.displayName,
    thumbnail: thumb || (media.kind === 'image' ? media.url : undefined),
    isVideo,
    streams: isVideo ? [media.url] : [],
    imageUrl: media.kind === 'image' ? media.url : media.kind === 'embed' ? thumb : undefined,
    pageUrl,
    profileUrl: person.url,
    description: body,
    tags: communityName ? [communityName] : [],
    createdAt: str(post.published),
    likes: num(counts?.score),
    comments: num(counts?.comments),
    reason: `public Lemmy post by ${person.handle}${communityName ? ` in c/${communityName}` : ''}${post.nsfw === true ? ' (NSFW)' : ''}`,
    watched: opts.watched,
  })
  return { item, person }
}

export async function collectLemmy(opts: CollectorOpts = {}): Promise<CollectorResult> {
  const env = opts.env || process.env
  const budget = new RequestBudget(opts.maxRequests ?? 8, opts.signal)
  const media: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  const instances = lemmyInstances(env)
  const communities = lemmyCommunities(env)
  const names = (opts.watchlist || []).map(cleanTerm).filter((v): v is string => Boolean(v)).slice(0, 2)
  const reserve = instances.length ? names.length * 2 : 0
  try {
    const jobs: Array<{ host: string; community: string }> = []
    for (const community of communities) for (const host of instances) jobs.push({ host, community })
    const cap = Math.max(0, budget.max - reserve)
    const matched: Array<{ host: string; person: Person; username: string }> = []
    await Promise.all([
      settleBounded(jobs.slice(0, cap), FED_PARALLELISM, async ({ host, community }) => {
        const params = new URLSearchParams({ community_name: community, sort: 'New', limit: '20' })
        const body = asRecord(await budget.json(`https://${host}/api/v3/post/list?${params}`))
        for (const view of asArray(body?.posts).slice(0, 20)) {
          const { item, person } = mapLemmyPost(view, host)
          if (item) media.push(item)
          if (item && person && !leads.has(person.handle)) leads.set(person.handle, personLead(person, false, host, [community.split('@')[0]]))
        }
      }),
      settleBounded(instances.length ? names : [], 2, async (name) => {
        const host = instances[0]
        const params = new URLSearchParams({ type_: 'Users', q: name, limit: '3', sort: 'TopAll' })
        const body = asRecord(await budget.json(`https://${host}/api/v3/search?${params}`))
        for (const raw of asArray(body?.users)) {
          const person = mapLemmyPerson(asRecord(raw)?.person, host)
          const local = person?.handle.split('@')[0] || ''
          if (person && (normKey(local) === normKey(name) || normKey(person.displayName) === normKey(name))) {
            leads.set(person.handle, personLead(person, true, host))
            matched.push({ host, person, username: local })
            break
          }
        }
      }),
    ])
    await settleBounded(matched, 2, async ({ host, username }) => {
      const params = new URLSearchParams({ username, sort: 'New', limit: '20' })
      const body = asRecord(await budget.json(`https://${host}/api/v3/user?${params}`))
      for (const view of asArray(body?.posts).slice(0, 20)) {
        const { item } = mapLemmyPost(view, host, { watched: true })
        if (item) media.push(item)
      }
    })
  } catch {
    // never throws
  }
  const items = uniqueById(media).slice(0, FED_MAX_MEDIA)
  const leadList = [...leads.values()]
  const host = instances[0]
  return {
    media: items,
    leads: leadList,
    attempted: budget.attempted,
    succeeded: budget.succeeded,
    status: fedStatus(
      { id: 'lemmy', name: 'Lemmy', searchUrl: host ? `https://${host}/search?q=gay&type=Posts` : undefined },
      budget,
      { media: items.length, creators: leadList.length },
      {
        ok: 'Public Lemmy community posts with direct media.',
        blocked: 'Configured Lemmy instances require authentication for this content.',
        down: 'Configured Lemmy instances are temporarily unreachable.',
        nothing: instances.length ? 'Lemmy discovery did not run.' : 'No valid Lemmy instances are configured.',
      },
    ),
  }
}
