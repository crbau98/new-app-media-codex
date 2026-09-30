/**
 * ActivityPub / Mastodon-compatible account search. Public, unauthenticated APIs only.
 *
 * Endpoints:
 *   GET https://{host}/.well-known/webfinger?resource=acct:user@host   (handle queries)
 *   GET https://{host}/api/v1/accounts/lookup?acct=user                (enrichment)
 *   GET https://{host}/api/v2/search?type=accounts&q=&limit=8&resolve=false
 * Instances that require auth for search answer 401/403 and are skipped silently.
 * Locked / suspended / non-discoverable accounts are never returned.
 */
import type { SourceCreatorHit } from '../discovery-types.js'
import { asCount, asString, getJson, mapBounded, safeHost } from './http.js'

/** Review periodically — not verified live from CI. */
export const ACTIVITYPUB_SEARCH_INSTANCES: readonly string[] = [
  'mastodon.social',
  'mstdn.social',
  'mastodon.online',
]

export type MastodonAccount = {
  acct?: unknown
  username?: unknown
  display_name?: unknown
  url?: unknown
  avatar?: unknown
  followers_count?: unknown
  statuses_count?: unknown
  locked?: unknown
  suspended?: unknown
  discoverable?: unknown
}

/** Parse `@user@host` / `user@host` (federated handle). */
export function parseFederatedHandle(input: string): { user: string; host: string } | null {
  const match = input.trim().match(/^@?([A-Za-z0-9_.-]{1,64})@([A-Za-z0-9.-]{3,253})$/)
  if (!match) return null
  const host = safeHost(match[2])
  return host ? { user: match[1], host } : null
}

export function mapMastodonAccount(account: MastodonAccount, instanceHost: string): SourceCreatorHit | null {
  if (account.locked === true || account.suspended === true || account.discoverable === false) return null
  const url = asString(account.url)
  if (!/^https:\/\//i.test(url)) return null
  const acct = asString(account.acct).trim()
  const username = asString(account.username).trim() || acct.split('@')[0]
  if (!username || !/^[A-Za-z0-9_.-]+$/.test(username)) return null
  let host = instanceHost
  try { host = new URL(url).hostname.toLowerCase() } catch { /* keep instance host */ }
  const avatar = asString(account.avatar)
  return {
    handle: `${username}@${host}`,
    displayName: asString(account.display_name).replace(/<[^>]+>/g, '').trim().slice(0, 120) || username,
    platform: 'Fediverse',
    profileUrl: url,
    avatar: /^https:\/\//i.test(avatar) && !/missing\.png/.test(avatar) ? avatar : undefined,
    followers: asCount(account.followers_count),
    mediaCount: asCount(account.statuses_count),
    confidence: 0.5,
    matchedBy: 'search',
    sourceAttribution: `ActivityPub/Mastodon account via ${instanceHost} (public API)`,
  }
}

/** WebFinger → profile page, enriched through the home instance's public lookup. */
export async function webfingerCreator(handle: { user: string; host: string }, signal?: AbortSignal): Promise<SourceCreatorHit | null> {
  const resource = encodeURIComponent(`acct:${handle.user}@${handle.host}`)
  const jrd = await getJson(`https://${handle.host}/.well-known/webfinger?resource=${resource}`, {
    signal,
    accept: 'application/jrd+json, application/json',
  }) as { links?: Array<{ rel?: string; href?: string }> } | null
  if (!jrd || !Array.isArray(jrd.links)) return null
  const profile = jrd.links.find((l) => l.rel === 'http://webfinger.net/rel/profile-page' && /^https:\/\//i.test(l.href || ''))
  const self = jrd.links.find((l) => l.rel === 'self' && /^https:\/\//i.test(l.href || ''))
  const profileUrl = profile?.href || self?.href
  if (!profileUrl) return null
  const lookup = await getJson(`https://${handle.host}/api/v1/accounts/lookup?acct=${encodeURIComponent(handle.user)}`, { signal }) as MastodonAccount | null
  if (lookup && typeof lookup === 'object') {
    if (lookup.locked === true || lookup.suspended === true || lookup.discoverable === false) return null
    const mapped = mapMastodonAccount({ ...lookup, url: asString(lookup.url) || profileUrl }, handle.host)
    if (mapped) return { ...mapped, matchedBy: 'exact', sourceAttribution: `WebFinger + ActivityPub lookup on ${handle.host} (public API)` }
  }
  return {
    handle: `${handle.user}@${handle.host}`,
    displayName: handle.user,
    platform: 'Fediverse',
    profileUrl,
    followers: null,
    mediaCount: null,
    confidence: 0.6,
    matchedBy: 'exact',
    sourceAttribution: `WebFinger on ${handle.host} (public)`,
  }
}

export async function searchActivityPubCreators(
  query: string,
  opts: { signal?: AbortSignal; instances?: readonly string[]; onHits?: (hits: SourceCreatorHit[]) => void } = {},
): Promise<SourceCreatorHit[]> {
  try {
    const handle = parseFederatedHandle(query)
    const q = handle ? handle.user : query.replace(/^@/, '')
    const hosts = (opts.instances || ACTIVITYPUB_SEARCH_INSTANCES).map(safeHost).filter((h): h is string => Boolean(h))
    const [found, perHost] = await Promise.all([
      handle
        ? webfingerCreator(handle, opts.signal).then((hit) => { if (hit) opts.onHits?.([hit]); return hit }).catch(() => null)
        : Promise.resolve(null),
      mapBounded(hosts, 3, async (host) => {
        const params = new URLSearchParams({ q, type: 'accounts', limit: '8', resolve: 'false' })
        const body = await getJson(`https://${host}/api/v2/search?${params}`, { signal: opts.signal }) as { accounts?: MastodonAccount[] } | null
        const hits = (body?.accounts || []).slice(0, 8).map((a) => mapMastodonAccount(a, host)).filter((h): h is SourceCreatorHit => Boolean(h))
        if (hits.length) opts.onHits?.(hits)
        return hits
      }),
    ])
    return [...(found ? [found] : []), ...perHost.flat()]
  } catch {
    return []
  }
}
