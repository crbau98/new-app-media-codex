import { fetchMastodonPublicTag } from './_lib/sources/activitypub'
import { searchPeerTube } from './_lib/sources/peertube'

export const config = { runtime: 'edge' }

const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
}

type SourceSearchBody = {
  source?: 'peertube' | 'mastodon'
  instance?: string
  query?: string
  tag?: string
  includeNsfw?: boolean
  limit?: number
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: NO_STORE })
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: NO_STORE })

  const body = await req.json().catch(() => null) as SourceSearchBody | null
  if (!body?.source || !body.instance) return Response.json({ error: 'source_and_instance_required' }, { status: 400, headers: NO_STORE })

  try {
    if (body.source === 'peertube') {
      if (!body.query?.trim()) return Response.json({ error: 'query_required' }, { status: 400, headers: NO_STORE })
      const items = await searchPeerTube(body.instance, body.query.trim(), body.includeNsfw === true)
      return Response.json({
        source: 'peertube',
        instance: body.instance,
        metadataOnly: true,
        attribution: 'PeerTube video URL + channel/account + license',
        termsUrl: `https://${body.instance}/about`,
        items,
      }, { headers: NO_STORE })
    }

    if (body.source === 'mastodon') {
      if (!body.tag?.trim()) return Response.json({ error: 'tag_required' }, { status: 400, headers: NO_STORE })
      const items = await fetchMastodonPublicTag(body.instance, body.tag, body.limit || 20)
      return Response.json({
        source: 'mastodon',
        instance: body.instance,
        metadataOnly: true,
        attribution: 'status URL + account acct; sensitive/spoiler flags preserved',
        termsUrl: `https://${body.instance}/about/more`,
        items,
      }, { headers: NO_STORE })
    }

    return Response.json({ error: 'unsupported_source' }, { status: 400, headers: NO_STORE })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'source_search_failed'
    const status = message.includes('required') || message.includes('invalid') ? 400 : 502
    return Response.json({ error: message }, { status, headers: NO_STORE })
  }
}
