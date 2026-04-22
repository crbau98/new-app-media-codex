/**
 * Vercel Edge: stream coomer/kemono file URLs when the primary API host cannot
 * reach those CDNs. Only allowlisted hosts are forwarded.
 *
 * Must live under `frontend/api/` when the Vercel project root is `frontend/`.
 *
 * For coomer/kemono image URLs we rewrite to the `img.*` thumbnail host, which is
 * reachable from datacenter IPs (including Vercel/Render) unlike `n*.coomer.st`
 * which frequently blocks datacenter ranges and causes `Connection reset by peer`.
 *
 * For video URLs we do NOT rewrite to the thumbnail host (no /thumbnail/…/*.mp4
 * mirror exists). Instead we:
 *   1. Ask the apex host (coomer.st) for a 302 so we discover the chosen n* shard.
 *   2. If the Edge region cannot reach the primary shard, try sibling n1..n8 shards
 *      — CDN pools are partially independent and sometimes only a subset are blocked.
 *   3. Stream the first reachable shard through, preserving Range headers.
 */
export const config = { runtime: "edge" }

const ALLOWED = new Set([
  "coomer.st",
  "coomer.su",
  "kemono.su",
  "kemono.party",
  "kemono.cr",
])

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i
const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov|mkv|avi)(?:$|\?)/i

function allowedArchiverHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (ALLOWED.has(h)) return true
  if (/^(?:img|n\d+|c\d+)\.coomer\.(st|su)$/i.test(h)) return true
  if (/^(?:img|n\d+|c\d+)\.kemono\.(su|party|cr)$/i.test(h)) return true
  return false
}

function rewriteArchiverUrlToThumbnail(target: URL): URL {
  const host = target.hostname.toLowerCase()
  if (!target.pathname.startsWith("/data/")) return target
  if (!IMAGE_EXT_RE.test(target.pathname)) return target

  let nextHost: string | null = null
  if (/coomer\.su$/i.test(host)) nextHost = "img.coomer.su"
  else if (/coomer\.st$/i.test(host)) nextHost = "img.coomer.st"
  else if (/kemono\.su$/i.test(host)) nextHost = "img.kemono.su"
  else if (/kemono\.party$/i.test(host)) nextHost = "img.kemono.party"
  else if (/kemono\.cr$/i.test(host)) nextHost = "img.kemono.cr"

  if (!nextHost) return target
  const next = new URL(`https://${nextHost}/thumbnail${target.pathname}${target.search}`)
  return next
}

function buildUpstreamHeaders(target: URL, range: string | null): Headers {
  const referer = `${target.protocol}//${target.host}/`
  const h = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: referer,
    Origin: referer.replace(/\/$/, ""),
    Accept: "image/webp,image/avif,image/apng,image/*,video/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
  })
  if (range) h.set("Range", range)
  return h
}

/** Generate sibling CDN shards for a coomer/kemono `n*` host. */
function siblingShards(host: string, maxShards = 8): string[] {
  const m = host.match(/^n(\d+)\.(coomer|kemono)\.(st|su|party|cr)$/i)
  if (!m) return []
  const [, , brand, tld] = m
  const out: string[] = []
  for (let i = 1; i <= maxShards; i++) {
    out.push(`n${i}.${brand.toLowerCase()}.${tld.toLowerCase()}`)
  }
  return out
}

/**
 * Follow the apex host's 302 to find which CDN shard it currently points at,
 * then attempt sibling shards if that one fails. Returns the first upstream
 * Response whose status is OK (2xx) or a non-retry error (4xx other than 404).
 */
async function fetchVideoWithShardFallback(
  target: URL,
  headers: Headers,
  method: string,
): Promise<Response> {
  // If the apex host was used (coomer.st), first do a non-following GET to find
  // the 302 target. If it's already an n* host, follow the 302 directly.
  let primary: Response
  try {
    primary = await fetch(target.href, {
      method,
      headers,
      redirect: "manual",
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "apex_fetch_failed", detail: String(err), target: target.href }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    )
  }

  let resolvedShardUrl: URL | null = null
  if (primary.status === 301 || primary.status === 302 || primary.status === 303 || primary.status === 307 || primary.status === 308) {
    const loc = primary.headers.get("location")
    if (loc) {
      try {
        resolvedShardUrl = new URL(loc, target.href)
      } catch {
        /* ignore */
      }
    }
    await primary.body?.cancel()
  } else if (primary.ok || (primary.status >= 400 && primary.status < 500 && primary.status !== 404)) {
    // Apex returned directly — rare, but handle.
    return primary
  } else {
    await primary.body?.cancel()
  }

  // Try the resolved shard first, then fall back to sibling shards.
  const shardCandidates: string[] = []
  if (resolvedShardUrl) shardCandidates.push(resolvedShardUrl.hostname)
  // If target was an apex or we could not parse the location, we still try
  // common shards in order.
  if (shardCandidates.length === 0 || !/^n\d+\./i.test(shardCandidates[0])) {
    // infer brand from target TLD
    const apexMatch = target.hostname.match(/(coomer|kemono)\.(st|su|party|cr)$/i)
    if (apexMatch) {
      for (let i = 1; i <= 8; i++) {
        const h = `n${i}.${apexMatch[1].toLowerCase()}.${apexMatch[2].toLowerCase()}`
        if (!shardCandidates.includes(h)) shardCandidates.push(h)
      }
    }
  } else {
    // add sibling shards behind the resolved one
    for (const h of siblingShards(shardCandidates[0])) {
      if (!shardCandidates.includes(h)) shardCandidates.push(h)
    }
  }

  let lastStatus = 502
  let lastError: string | null = null
  const pathAndQuery = (resolvedShardUrl?.pathname ?? target.pathname) + (resolvedShardUrl?.search ?? target.search)

  for (const shardHost of shardCandidates) {
    const shardUrl = `https://${shardHost}${pathAndQuery}`
    try {
      const resp = await fetch(shardUrl, {
        method,
        headers,
        redirect: "follow",
      })
      if (resp.ok || (resp.status >= 200 && resp.status < 400) || resp.status === 206) {
        return resp
      }
      // Treat 403/429 as worth trying siblings; 404 means the file isn't there
      if (resp.status === 404) {
        return resp
      }
      lastStatus = resp.status
      await resp.body?.cancel()
    } catch (err) {
      lastError = String(err)
      lastStatus = 502
      continue
    }
  }

  return new Response(
    JSON.stringify({
      error: "all_shards_failed",
      detail: lastError ?? `last status ${lastStatus}`,
      shards_tried: shardCandidates,
      target: target.href,
    }),
    { status: lastStatus === 404 ? 404 : 502, headers: { "Content-Type": "application/json" } },
  )
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

  target = rewriteArchiverUrlToThumbnail(target)

  const range = req.headers.get("range")
  const headers = buildUpstreamHeaders(target, range)
  const isVideoTarget = VIDEO_EXT_RE.test(target.pathname)

  let upstream: Response
  if (isVideoTarget) {
    // Video paths: try apex → resolved shard → sibling shards. Each shard
    // attempt uses `redirect: "follow"` so the browser Range header is
    // preserved through any further redirect.
    upstream = await fetchVideoWithShardFallback(target, headers, req.method)
  } else {
    try {
      upstream = await fetch(target.href, {
        method: req.method,
        headers,
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
  }

  const out = new Headers(upstream.headers)
  out.set("Cross-Origin-Resource-Policy", "cross-origin")
  out.set("Access-Control-Allow-Origin", "*")
  out.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
  if (!upstream.ok && !upstream.headers.get("cache-control")) {
    out.set("Cache-Control", "no-store")
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  })
}
