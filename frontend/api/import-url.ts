import { classifyUrl, ClassifyError } from './_lib/import-classify.js'
import { getSource } from './_lib/sources/registry.js'

export const config = { runtime: 'edge', maxDuration: 20 }

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

const STATUS: Record<string, number> = {
  url_required: 400, invalid_url: 400, unsupported_protocol: 400, private_host_blocked: 400, credentials_not_allowed: 400,
  port_not_allowed: 400, not_found: 404, auth_required: 401, timeout: 504,
}

/**
 * Classify a pasted URL: direct media (magic-byte sniffed), HTML pages with
 * declared media, HLS/DASH, feeds. Response modes:
 *  - `media`    playable image/video candidates (best first)
 *  - `feed`     a feed with per-item media (browse + import items)
 *  - `outbound` nothing importable; attributed source link only
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: NO_STORE })
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: NO_STORE })

  const body = await req.json().catch(() => null) as { url?: string } | null
  if (!body?.url || typeof body.url !== 'string') return Response.json({ error: 'url_required' }, { status: 400, headers: NO_STORE })

  try {
    const result = await classifyUrl(body.url)
    const source = getSource(hostSource(new URL(result.finalUrl).hostname))
    const legal = {
      source: result.source,
      attribution: source?.attributionFormat || 'source link',
      termsUrl: source?.termsUrl || 'about:blank',
    }
    if (result.kind === 'feed') {
      return Response.json({
        ...legal, mode: 'feed', classification: result,
        feed: { feedUrl: result.finalUrl, title: result.title || 'Feed', items: result.feedItems },
      }, { headers: NO_STORE })
    }
    if (result.playable) return Response.json({ ...legal, mode: 'media', classification: result }, { headers: NO_STORE })
    return Response.json({
      ...legal, mode: 'outbound', classification: result, url: result.finalUrl, usableInApp: false,
      reason: result.protected
        ? 'This stream is protected (DRM or login) and cannot be imported.'
        : 'No importable image or video was found; it is available as an attributed source link.',
    }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof ClassifyError) {
      return Response.json({ error: error.code, detail: error.message }, { status: STATUS[error.code] || 502, headers: NO_STORE })
    }
    return Response.json({ error: 'import_failed' }, { status: 502, headers: NO_STORE })
  }
}
