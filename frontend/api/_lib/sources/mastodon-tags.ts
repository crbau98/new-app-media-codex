/**
 * Mastodon-compatible public hashtag timelines. No auth.
 *
 *   GET https://{instance}/api/v1/timelines/tag/{tag}?limit=40&only_media=true
 *   GET https://{instance}/api/v2/search?type=accounts&q=&limit=3&resolve=false   (watchlist names)
 *   GET https://{instance}/api/v1/accounts/{id}/statuses?only_media=true&...      (matched watchlist names)
 *
 * Env: MASTODON_TAG_INSTANCES (comma separated hosts), MASTODON_TAGS (comma separated hashtags).
 * Instances that require auth for public timelines answer 401/403 and are skipped silently.
 * `sensitive` media is kept (adults-only app). Boosts, non-public statuses and
 * locked / suspended / non-discoverable accounts are skipped.
 */
import type { CreatorLead, UnifiedMediaItem } from '../discovery-types.js'
import {
  FED_MAX_MEDIA, FED_PARALLELISM, RequestBudget, asArray, asRecord, buildFedItem, cleanTerm, fedStatus, httpsUrl,
  normKey, num, parseHostList, parseTokenList, redact, settleBounded, str, stripHtml, uniqueById,
  type CollectorOpts, type CollectorResult,
} from './federated-common.js'

/** Review periodically; not verified live from CI. Override with MASTODON_TAG_INSTANCES. */
export const DEFAULT_MASTODON_TAG_INSTANCES: readonly string[] = ['mastodon.social', 'mstdn.social']
export const DEFAULT_MASTODON_TAGS: readonly string[] = ['gay', 'gaymen', 'gaysofmastodon', 'gaynsfw', 'twink', 'bear', 'hunk', 'malenude']
const TAG_PATTERN = /^[\p{L}\p{N}_]{2,40}$/u

export function mastodonInstances(env: Record<string, string | undefined> = process.env): string[] {
  return parseHostList(env.MASTODON_TAG_INSTANCES, DEFAULT_MASTODON_TAG_INSTANCES, 3)
}
export function mastodonTags(env: Record<string, string | undefined> = process.env): string[] {
  return parseTokenList(env.MASTODON_TAGS, DEFAULT_MASTODON_TAGS, TAG_PATTERN, 8)
}

type Account = { handle: string; displayName: string; url: string; avatar?: string; followers: number; id: string }

/** Validate + map a Mastodon account; null for locked / suspended / non-discoverable / malformed. */
export function mapMastodonTagAccount(value: unknown, instanceHost: string): Account | null {
  const a = asRecord(value)
  if (!a) return null
  if (a.locked === true || a.suspended === true || a.discoverable === false) return null
  const url = httpsUrl(a.url)
  const username = str(a.username).trim()
  if (!url || !username || !/^[A-Za-z0-9_.-]+$/.test(username)) return null
  let host = instanceHost
  try { host = new URL(url).hostname.toLowerCase() } catch { /* keep */ }
  const avatar = httpsUrl(a.avatar)
  return {
    handle: `${username}@${host}`,
    displayName: stripHtml(str(a.display_name)).slice(0, 120) || username,
    url,
    avatar: avatar && !/missing\.png/.test(avatar) ? avatar : undefined,
    followers: num(a.followers_count),
    id: str(a.id),
  }
}

function accountLead(account: Account, exactWatchMatch: boolean, instanceHost: string, tags: string[] = []): CreatorLead {
  return {
    id: `masto-${account.handle}`,
    name: account.displayName,
    username: account.handle,
    platform: 'Mastodon',
    profileUrl: account.url,
    avatar: account.avatar,
    tags: tags.slice(0, 6),
    observedAt: new Date().toISOString(),
    sourceAttribution: `Mastodon-compatible public API via ${instanceHost}`,
    confidence: exactWatchMatch ? 0.75 : 0.4,
    exactWatchMatch,
  }
}

/** Map one Mastodon status to media items (one per video/gifv/image attachment). */
export function mapMastodonStatus(value: unknown, instanceHost: string, opts: { watched?: boolean } = {}): { items: UnifiedMediaItem[]; account: Account | null } {
  const s = asRecord(value)
  if (!s) return { items: [], account: null }
  if (s.reblog) return { items: [], account: null } // boost: attribute only original posts
  const visibility = str(s.visibility)
  if (visibility && visibility !== 'public') return { items: [], account: null }
  const account = mapMastodonTagAccount(s.account, instanceHost)
  const pageUrl = httpsUrl(s.url)
  const statusId = str(s.id)
  if (!account || !pageUrl || !statusId) return { items: [], account: null }
  const text = stripHtml(str(s.content))
  const tags = asArray(s.tags).map((t) => str(asRecord(t)?.name)).filter(Boolean)
  const items: UnifiedMediaItem[] = []
  for (const raw of asArray(s.media_attachments).slice(0, 4)) {
    const att = asRecord(raw)
    const type = str(att?.type)
    const url = httpsUrl(att?.url)
    if (!att || !url || !['video', 'gifv', 'image'].includes(type)) continue
    const preview = httpsUrl(att.preview_url)
    const original = asRecord(asRecord(att.meta)?.original)
    const isVideo = type !== 'image'
    items.push(buildFedItem({
      id: `masto-${instanceHost}-${statusId}-${str(att.id) || items.length}`,
      source: 'Mastodon',
      category: 'Mastodon public hashtag',
      title: text || stripHtml(str(att.description)) || `Post by ${account.displayName}`,
      creator: account.displayName,
      thumbnail: preview || (isVideo ? undefined : url),
      isVideo,
      streams: isVideo ? [url] : [],
      imageUrl: isVideo ? undefined : url,
      pageUrl,
      profileUrl: account.url,
      description: text || stripHtml(str(att.description)),
      tags,
      createdAt: str(s.created_at),
      likes: num(s.favourites_count),
      comments: num(s.replies_count),
      width: num(original?.width) || undefined,
      height: num(original?.height) || undefined,
      durationSeconds: num(original?.duration) || undefined,
      reason: `public ${type} post by ${account.handle}${s.sensitive === true ? ' (marked sensitive)' : ''}`,
      watched: opts.watched,
    }))
  }
  return { items, account }
}

export async function collectMastodonTags(opts: CollectorOpts = {}): Promise<CollectorResult> {
  const env = opts.env || process.env
  const budget = new RequestBudget(opts.maxRequests ?? 8, opts.signal)
  const media: UnifiedMediaItem[] = []
  const leads = new Map<string, CreatorLead>()
  const instances = mastodonInstances(env)
  const query = cleanTerm(opts.query)
  const queryTag = query && TAG_PATTERN.test(query.replace(/^#/, '')) ? query.replace(/^#/, '').toLowerCase() : null
  const tags = [...new Set([...(queryTag ? [queryTag] : []), ...mastodonTags(env)])]
  const names = (opts.watchlist || []).map(cleanTerm).filter((v): v is string => Boolean(v)).slice(0, 2)
  const reserve = instances.length ? names.length * 2 : 0
  try {
    const tagJobs: Array<{ host: string; tag: string }> = []
    for (const tag of tags) for (const host of instances) tagJobs.push({ host, tag })
    const cap = Math.max(0, budget.max - reserve)
    const matched: Array<{ host: string; account: Account }> = []
    await Promise.all([
      settleBounded(tagJobs.slice(0, cap), FED_PARALLELISM, async ({ host, tag }) => {
        const params = new URLSearchParams({ limit: '40', only_media: 'true' })
        const body = await budget.json(`https://${host}/api/v1/timelines/tag/${encodeURIComponent(tag)}?${params}`)
        for (const status of asArray(body).slice(0, 40)) {
          const { items, account } = mapMastodonStatus(status, host)
          media.push(...items)
          if (account && items.length && !leads.has(account.handle)) leads.set(account.handle, accountLead(account, false, host, [tag]))
        }
      }),
      settleBounded(instances.length ? names : [], 2, async (name) => {
        const host = instances[0]
        const params = new URLSearchParams({ q: name, type: 'accounts', limit: '3', resolve: 'false' })
        const body = asRecord(await budget.json(`https://${host}/api/v2/search?${params}`))
        for (const raw of asArray(body?.accounts)) {
          const account = mapMastodonTagAccount(raw, host)
          const local = account?.handle.split('@')[0] || ''
          if (account && account.id && (normKey(local) === normKey(name) || normKey(account.displayName) === normKey(name))) {
            leads.set(account.handle, accountLead(account, true, host))
            matched.push({ host, account })
            break
          }
        }
      }),
    ])
    await settleBounded(matched, 2, async ({ host, account }) => {
      const params = new URLSearchParams({ only_media: 'true', exclude_replies: 'true', exclude_reblogs: 'true', limit: '20' })
      const body = await budget.json(`https://${host}/api/v1/accounts/${encodeURIComponent(account.id)}/statuses?${params}`)
      for (const status of asArray(body).slice(0, 20)) media.push(...mapMastodonStatus(status, host, { watched: true }).items)
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
      { id: 'mastodon', name: 'Mastodon hashtags', searchUrl: host ? `https://${host}/tags/${encodeURIComponent(tags[0] || 'gay')}` : undefined },
      budget,
      { media: items.length, creators: leadList.length },
      {
        ok: 'Public Mastodon-compatible hashtag timelines (media posts).',
        blocked: 'Configured Mastodon instances require authentication for public timelines.',
        down: 'Configured Mastodon instances are temporarily unreachable.',
        nothing: redact(instances.length ? 'Mastodon discovery did not run.' : 'No valid Mastodon instances are configured.'),
      },
    ),
  }
}
