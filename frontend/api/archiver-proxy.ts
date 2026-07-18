/**
 * Vercel Edge: stream a narrowly allowlisted public-source media URL when a
 * browser cannot reach the provider CDN directly. This is a transient proxy:
 * it does not persist, archive, or expose subscription-creator libraries.
 *
 * This file is the canonical, self-contained implementation (the repo-root
 * /api copy was removed — the Vercel project's root is frontend/).
 */
export const config = { runtime: "edge" }

const ALLOWED = new Set(["media.redgifs.com"])
const MAX_REDIRECTS = 2
const MAX_EXPLICIT_RANGE_BYTES = 12 * 1024 * 1024

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
}

const PRIVACY_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE_HEADERS, ...PRIVACY_HEADERS },
  })
}

function allowedArchiverHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (ALLOWED.has(h)) return true
  if (/^(?:media|thumbs\d*)\.redgifs\.com$/i.test(h)) return true
  return false
}

function safeTarget(value: string): URL | null {
  try {
    const target = new URL(value)
    if (target.protocol !== "https:") return null
    if (target.username || target.password || target.hash) return null
    if (target.port && target.port !== "443") return null
    if (!allowedArchiverHost(target.hostname)) return null
    return target
  } catch {
    return null
  }
}

function safeRange(value: string | null): string | null | false {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return false
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || suffixLength > MAX_EXPLICIT_RANGE_BYTES) return false
  }
  if (match[1] && match[2]) {
    const start = Number(match[1])
    const end = Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start + 1 > MAX_EXPLICIT_RANGE_BYTES) return false
  }
  if (match[1] && !match[2]) {
    const start = Number(match[1])
    if (!Number.isSafeInteger(start) || start > Number.MAX_SAFE_INTEGER - MAX_EXPLICIT_RANGE_BYTES + 1) return false
    return `bytes=${start}-${start + MAX_EXPLICIT_RANGE_BYTES - 1}`
  }
  return value.trim()
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
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Max-Age": "86400",
      },
    })
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return jsonError("method_not_allowed", 405)
  }

  let targetUrl: string
  try {
    const u = new URL(req.url)
    targetUrl = u.searchParams.get("url") || ""
  } catch {
    return jsonError("bad_request", 400)
  }
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return jsonError("invalid_url", 400)
  }

  const target = safeTarget(targetUrl)
  if (!target) {
    return jsonError("host_not_allowed", 403)
  }

  const range = safeRange(req.headers.get("range"))
  if (range === false) {
    return jsonError("invalid_range", 416)
  }
  let upstream: Response
  try {
    let current = target
    let redirects = 0
    while (true) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20_000)
      try {
        upstream = await fetch(current.href, {
          method: req.method,
          headers: buildUpstreamHeaders(current, range),
          redirect: "manual",
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break
      if (redirects >= MAX_REDIRECTS) throw new Error("redirect_limit")
      const location = upstream.headers.get("location")
      const next = location ? safeTarget(new URL(location, current).href) : null
      if (!next) throw new Error("unsafe_redirect")
      current = next
      redirects += 1
    }
  } catch {
    return jsonError("upstream_fetch_failed", 502)
  }

  const contentType = upstream.headers.get("content-type")?.toLowerCase() || ""
  if (upstream.ok && !contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    upstream.body?.cancel()
    return jsonError("unsupported_media_type", 415)
  }
  const length = Number(upstream.headers.get("content-length") || 0)
  if (contentType.startsWith("image/") && length > 15 * 1024 * 1024) {
    upstream.body?.cancel()
    return jsonError("image_too_large", 413)
  }

  const out = new Headers(upstream.headers)
  out.delete("set-cookie")
  out.delete("content-disposition")
  out.set("Cross-Origin-Resource-Policy", "same-origin")
  out.set("Accept-Ranges", "bytes")
  out.set("X-Content-Type-Options", "nosniff")
  out.set("Referrer-Policy", "no-referrer")
  out.set("X-Robots-Tag", "noindex")
  out.append("Vary", "Range")
  if (contentType.startsWith("video/") || range) {
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) out.set(name, value)
  } else if (upstream.ok && !out.has("cache-control")) {
    out.set("Cache-Control", "public, max-age=3600, s-maxage=86400")
  }
  if (!upstream.ok && !upstream.headers.get("cache-control")) {
    out.set("Cache-Control", "no-store")
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  })
}
