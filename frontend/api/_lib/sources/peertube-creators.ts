/**
 * PeerTube creator (video-channel / account) search. Public API only.
 *
 * Endpoints:
 *   GET https://{host}/api/v1/search/video-channels?search=&count=10&nsfw=both
 *   GET https://{host}/api/v1/accounts/{name@host}      (only when the query is a handle)
 */
import type { SourceCreatorHit } from '../discovery-types.js'
import { asCount, asString, getJson, mapBounded, safeHost } from './http.js'

/**
 * Maintained list of PeerTube hosts queried for creator search. `sepiasearch.org`
 * is the official federated index (covers many instances in one call); the rest
 * are well-known general-purpose instances that accept NSFW-flagged content.
 * Instances that do not allow adult content simply return few/no hits.
 * Review periodically — this list is NOT verified live from CI.
 */
export const PEERTUBE_CREATOR_INSTANCES: readonly string[] = [
  'sepiasearch.org',
  'peertube.wtf',
  'diode.zone',
  'tilvids.com',
]

const PEERTUBE_CONCURRENCY = 3

export type PeerTubeActor = {
  name?: unknown
  displayName?: unknown
  host?: unknown
  url?: unknown
  followersCount?: unknown
  videosCount?: unknown
  avatars?: unknown
  avatar?: unknown
}

function avatarUrl(actor: PeerTubeActor, host: string): string | undefined {
  const list = Array.isArray(actor.avatars) ? actor.avatars as Array<{ path?: unknown; url?: unknown }> : []
  const single = actor.avatar as { path?: unknown; url?: unknown } | null | undefined
  const pick = [...list].reverse()[0] || single || undefined
  if (!pick) return undefined
  const url = asString(pick.url)
  if (/^https:\/\//i.test(url)) return url
  const path = asString(pick.path)
  return path.startsWith('/') ? `https://${host}${path}` : undefined
}

/** Map one PeerTube channel/account JSON object into a hit (null if unusable). */
export function mapPeerTubeActor(actor: PeerTubeActor, queriedHost: string, kind: 'channel' | 'account'): SourceCreatorHit | null {
  const name = asString(actor.name).trim()
  if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) return null
  const actorHost = safeHost(asString(actor.host)) || queriedHost
  const explicit = asString(actor.url)
  const profileUrl = /^https:\/\//i.test(explicit)
    ? explicit
    : `https://${actorHost}/${kind === 'channel' ? 'video-channels' : 'accounts'}/${name}`
  return {
    handle: `${name}@${actorHost}`,
    displayName: asString(actor.displayName).trim().slice(0, 120) || name,
    platform: 'PeerTube',
    profileUrl,
    avatar: avatarUrl(actor, actorHost),
    followers: asCount(actor.followersCount),
    mediaCount: asCount(actor.videosCount),
    confidence: 0.5,
    matchedBy: 'search',
    sourceAttribution: `PeerTube ${kind} on ${actorHost} (public API)`,
  }
}

async function searchOneInstance(host: string, query: string, signal?: AbortSignal): Promise<SourceCreatorHit[]> {
  const hits: SourceCreatorHit[] = []
  const params = new URLSearchParams({ search: query, count: '10', nsfw: 'both' })
  const channels = await getJson(`https://${host}/api/v1/search/video-channels?${params}`, { signal })
  for (const row of ((channels as { data?: PeerTubeActor[] } | null)?.data || []).slice(0, 10)) {
    const hit = mapPeerTubeActor(row, host, 'channel')
    if (hit) hits.push(hit)
  }
  const acct = query.replace(/^@/, '')
  if (host !== 'sepiasearch.org' && /^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$/.test(acct)) {
    const account = await getJson(`https://${host}/api/v1/accounts/${encodeURIComponent(acct)}`, { signal })
    if (account && typeof account === 'object') {
      const hit = mapPeerTubeActor(account as PeerTubeActor, host, 'account')
      if (hit) hits.push(hit)
    }
  }
  return hits
}

export async function searchPeerTubeCreators(
  query: string,
  opts: { signal?: AbortSignal; instances?: readonly string[]; onHits?: (hits: SourceCreatorHit[]) => void } = {},
): Promise<SourceCreatorHit[]> {
  const hosts = (opts.instances || PEERTUBE_CREATOR_INSTANCES).map(safeHost).filter((h): h is string => Boolean(h))
  try {
    const perHost = await mapBounded(hosts, PEERTUBE_CONCURRENCY, async (host) => {
      const hits = await searchOneInstance(host, query, opts.signal).catch(() => [])
      if (hits.length) opts.onHits?.(hits) // partial results survive an overall-budget cut
      return hits
    })
    return perHost.flat()
  } catch {
    return []
  }
}
