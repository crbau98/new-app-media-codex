/**
 * Cross-source creator search (non-Redgifs public sources: PeerTube channels,
 * ActivityPub/Mastodon-compatible accounts, ...). Owned by the sources stream.
 * The resolver (`api/creator-resolve.ts`) calls this alongside its Redgifs lookups.
 *
 * Contract: never throws; returns [] when nothing matches or a source is down;
 * respects `limit` and the abort signal; public metadata only.
 */
import type { SourceCreatorHit } from '../discovery-types.js'

export async function searchSourceCreators(
  _query: string,
  _opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<SourceCreatorHit[]> {
  return []
}
