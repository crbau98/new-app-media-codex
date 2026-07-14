/**
 * Vercel Edge: stream a narrowly allowlisted public-source media URL when a
 * browser cannot reach the provider CDN directly. This is a transient proxy:
 * it does not persist, archive, or expose subscription-creator libraries.
 */
export const config = { runtime: "edge" }

const ALLOWED = new Set(["media.redgifs.com"])

function allowedArchiverHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (ALLOWED.has(h)) return true
  if (/^(?:media|thumbs\d*)\.redgifs\.com$/i.test(h)) return true
  return false
}

function buildUpstreamHeaders(target: URL, range: string | null): Headers {
  const isRedgifs = target.hostname.toLowerCase().endsWith('.redgifs.com')
  const referer = isRedgifs ? 'https://www.redgifs.com/' : `${target.protocol}//${target.host}/`
  const h = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: referer,
    Origin: referer.replace(/\/$/, ""),
    Accept: "image/webp,image/avif,image/apng,image/*,video/*,*/*;q=0.8",
  })
  if (range) h.set("Range", range)
  return h
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Max-Age": "86400",
      },
    })
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    })
  }

  let targetUrl: string
  try {
    const u = new URL(req.url)
    targetUrl = u.searchParams.get("url") || ""
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers: { "Content-Type": "application/json" } })
  }
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return new Response(JSON.stringify({ error: "invalid_url" }), { status: 400, headers: { "Content-Type": "application/json" } })
  }

  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    return new Response(JSON.stringify({ error: "invalid_url" }), { status: 400, headers: { "Content-Type": "application/json" } })
  }
  if (!allowedArchiverHost(target.hostname)) {
    return new Response(JSON.stringify({ error: "host_not_allowed" }), { status: 403, headers: { "Content-Type": "application/json" } })
  }

  const range = req.headers.get("range")
  let upstream: Response
  try {
    upstream = await fetch(target.href, {
      method: req.method,
      headers: buildUpstreamHeaders(target, range),
      redirect: "follow",
      // @ts-expect-error edge-specific: disable caching by default for media
      cf: { cacheTtl: 3600 },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "upstream_fetch_failed", detail: String(err), target: target.href }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )
  }

  const out = new Headers(upstream.headers)
  out.set("Cross-Origin-Resource-Policy", "cross-origin")
  out.set("Access-Control-Allow-Origin", "*")
  if (!upstream.ok && !upstream.headers.get("cache-control")) {
    out.set("Cache-Control", "no-store")
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  })
}
