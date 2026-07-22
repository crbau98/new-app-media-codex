import { getSource } from './_lib/sources/registry.js'
import { assertPublicHttpUrl, fetchExplicitFeed } from './_lib/sources/rss.js'

export const config = { runtime: 'edge' }

const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
}

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function hostSource(hostname: string): string {
  const host = hostname.toLowerCase()
  if (isHostOrSubdomain(host, 'redgifs.com')) return 'redgifs'
  if (isHostOrSubdomain(host, 'x.com') || isHostOrSubdomain(host, 'twitter.com')) return 'x'
  if (isHostOrSubdomain(host, 'tumblr.com')) return 'tumblr'
  return 'rss'
}

function looksLikeFeed(url: URL): boolean {
  const value = `${url.pathname}${url.search}`.toLowerCase()
  return /(\.xml|\.rss|\.atom|feed|rss|atom|\.json)(\?|$)/.test(value)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: NO_STORE })
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: NO_STORE })

  const body = await req.json().catch(() => null) as { url?: string } | null
  if (!body?.url) return Response.json({ error: 'url_required' }, { status: 400, headers: NO_STORE })

  try {
    const url = assertPublicHttpUrl(body.url)
    const sourceId = hostSource(url.hostname)
    const source = getSource(sourceId)

    if (looksLikeFeed(url)) {
      const feed = await fetchExplicitFeed(url.toString())
      return Response.json({
        mode: 'feed',
        source: source?.id || 'rss',
        attribution: source?.attributionFormat || 'feed title + item link + publisher',
        termsUrl: source?.termsUrl || 'about:blank',
        feed,
      }, { headers: NO_STORE })
    }

    // Preserve a non-feed page as a direct, attributed source shortcut.
    return Response.json({
      mode: 'outbound',
      source: source?.id || 'external',
      attribution: source?.attributionFormat || 'source link',
      termsUrl: source?.termsUrl || 'about:blank',
      url: url.toString(),
      usableInApp: false,
      reason: 'This URL is available as an attributed source link.',
    }, { headers: NO_STORE })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'import_failed'
    const status = message === 'private_host_blocked' || message === 'unsupported_protocol' ? 400 : 502
    return Response.json({ error: message }, { status, headers: NO_STORE })
  }
}
