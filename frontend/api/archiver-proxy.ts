/**
 * Vercel Edge: stream a narrowly allowlisted public-source media URL when a
 * browser cannot reach the provider CDN directly. This is a transient proxy:
 * it does not persist, archive, or expose subscription-creator libraries.
 *
 * Capabilities: byte ranges (206/416), conditional requests (ETag /
 * Last-Modified / If-Range / If-None-Match), HEAD, content-type repair for
 * providers that answer `application/octet-stream`, and HLS manifest
 * rewriting so segments/keys/variants also flow through this proxy.
 *
 * This file is the canonical, self-contained implementation (the repo-root
 * /api copy was removed — the Vercel project's root is frontend/).
 */
import { MAX_MANIFEST_BYTES, looksLikeHlsManifest, rewriteHlsManifest } from "./_lib/hls.js"
import { normalizeMediaRange, partialContentLength, unsatisfiedRangeHeader } from "./_lib/range.js"
import {
  cacheHeadersFor,
  classifyProxyResponse,
  conditionalHeaders,
  relayHeaders,
  resolveContentType,
  safeProxyTarget,
  totalFromContentRange,
  NO_STORE,
} from "./_lib/proxy-utils.js"

export const config = { runtime: "edge" }

const PROXY_PATH = "/api/archiver-proxy"
const MAX_REDIRECTS = 2
const HEADER_TIMEOUT_MS = 15_000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_KEY_BYTES = 4096
const REDIRECTS = [301, 302, 303, 307, 308]

const PRIVACY_HEADERS = {
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
}

function jsonError(error: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE, ...PRIVACY_HEADERS, ...extra },
  })
}

function buildUpstreamHeaders(
  target: URL,
  range: string | null,
  conditional: Record<string, string>,
): Headers {
  const isRedgifs = target.hostname.toLowerCase().endsWith(".redgifs.com")
  const referer = isRedgifs ? "https://www.redgifs.com/" : `${target.protocol}//${target.host}/`
  const h = new Headers({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Referer: referer,
    Origin: referer.replace(/\/$/, ""),
    Accept: "image/avif,image/webp,image/apng,image/*,video/*,application/vnd.apple.mpegurl,*/*;q=0.8",
  })
  if (range) h.set("Range", range)
  for (const [name, value] of Object.entries(conditional)) h.set(name, value)
  return h
}

/** Follow at most MAX_REDIRECTS hops, re-validating every hop against the allowlist. */
async function fetchUpstream(
  start: URL,
  method: string,
  range: string | null,
  conditional: Record<string, string>,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = start
  let redirects = 0
  while (true) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HEADER_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(current.href, {
        method,
        headers: buildUpstreamHeaders(current, range, conditional),
        redirect: "manual",
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    if (!REDIRECTS.includes(response.status)) return { response, finalUrl: current }
    response.body?.cancel()
    if (redirects >= MAX_REDIRECTS) throw new Error("redirect_limit")
    const location = response.headers.get("location")
    const next = location ? safeProxyTarget(new URL(location, current).href) : null
    if (!next) throw new Error("unsafe_redirect")
    current = next
    redirects += 1
  }
}

async function readBounded(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") || 0)
  if (declared > limit) return null
  const text = await response.text()
  return text.length > limit ? null : text
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, If-Range, If-None-Match, If-Modified-Since",
        "Access-Control-Max-Age": "86400",
      },
    })
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return jsonError("method_not_allowed", 405, { Allow: "GET, HEAD, OPTIONS" })
  }

  let targetUrl: string
  try {
    targetUrl = new URL(req.url).searchParams.get("url") || ""
  } catch {
    return jsonError("bad_request", 400)
  }
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return jsonError("invalid_url", 400)
  }

  const target = safeProxyTarget(targetUrl)
  if (!target) {
    return jsonError("host_not_allowed", 403)
  }

  const range = normalizeMediaRange(req.headers.get("range"))
  if (range === false) {
    return jsonError("invalid_range", 416, { "Content-Range": unsatisfiedRangeHeader() })
  }
  const conditional = conditionalHeaders(req.headers, Boolean(range))

  let upstream: Response
  let finalUrl: URL
  let headOnly = false
  try {
    ;({ response: upstream, finalUrl } = await fetchUpstream(target, req.method, range, conditional))
    if (req.method === "HEAD" && [403, 405, 501].includes(upstream.status)) {
      // Some CDNs reject HEAD outright. Probe with a one-byte GET instead and
      // answer the HEAD from its headers.
      upstream.body?.cancel()
      ;({ response: upstream, finalUrl } = await fetchUpstream(target, "GET", "bytes=0-0", {}))
      headOnly = true
    }
  } catch {
    return jsonError("upstream_fetch_failed", 502)
  }

  // Conditional hit: forward the validator-only response untouched.
  if (upstream.status === 304) {
    const headers = relayHeaders(upstream.headers)
    for (const [name, value] of Object.entries({ ...NO_STORE, ...PRIVACY_HEADERS })) headers.set(name, value)
    headers.set("Vary", "Range")
    headers.set("Cross-Origin-Resource-Policy", "same-origin")
    return new Response(null, { status: 304, headers })
  }

  // Unsatisfiable range: pass the upstream Content-Range (`bytes */total`) through.
  if (upstream.status === 416) {
    upstream.body?.cancel()
    return jsonError("range_not_satisfiable", 416, {
      "Content-Range": upstream.headers.get("content-range") || unsatisfiedRangeHeader(),
    })
  }

  const contentType = resolveContentType(upstream.headers.get("content-type"), finalUrl.pathname)
  const kind = classifyProxyResponse(contentType, finalUrl.pathname)
  if (upstream.ok && kind === "unsupported") {
    upstream.body?.cancel()
    return jsonError("unsupported_media_type", 415)
  }

  const length = Number(upstream.headers.get("content-length") || 0)
  if (upstream.ok && kind === "image" && length > MAX_IMAGE_BYTES) {
    upstream.body?.cancel()
    return jsonError("image_too_large", 413)
  }
  if (upstream.ok && kind === "key" && length > MAX_KEY_BYTES) {
    upstream.body?.cancel()
    return jsonError("key_too_large", 413)
  }

  const out = relayHeaders(upstream.headers)
  out.set("Cross-Origin-Resource-Policy", "same-origin")
  out.set("X-Content-Type-Options", "nosniff")
  out.set("Referrer-Policy", "no-referrer")
  out.set("X-Robots-Tag", "noindex")
  out.set("Vary", "Range")
  if (contentType) out.set("Content-Type", kind === "key" ? "application/octet-stream" : contentType)

  // HLS: rewrite every reference so sub-playlists, segments, maps and keys
  // are fetched through this proxy (when their host is allowlisted).
  if (upstream.ok && kind === "manifest" && !headOnly) {
    const text = await readBounded(upstream, MAX_MANIFEST_BYTES)
    if (text === null || !looksLikeHlsManifest(text)) return jsonError("invalid_manifest", 502)
    const body = req.method === "HEAD" ? null : rewriteHlsManifest(text, finalUrl, {
      proxyPath: PROXY_PATH,
      isAllowed: (url) => safeProxyTarget(url.href) !== null,
    })
    out.set("Content-Type", "application/vnd.apple.mpegurl")
    out.delete("Content-Length")
    out.delete("Content-Range")
    out.delete("Accept-Ranges")
    out.delete("ETag")
    for (const [name, value] of Object.entries(NO_STORE)) out.set(name, value)
    return new Response(body, { status: 200, headers: out })
  }

  const upstreamAcceptRanges = upstream.headers.get("accept-ranges")
  if (upstream.status === 206 || upstreamAcceptRanges) {
    out.set("Accept-Ranges", upstreamAcceptRanges || "bytes")
  } else {
    // Do not advertise byte ranges when the provider ignored Range and sent a
    // full 200 body; otherwise browsers can wait on seeks that never satisfy.
    out.delete("Accept-Ranges")
  }

  // Some provider responses omit Content-Length on a valid 206. Mobile Safari
  // can leave the media element on a black frame while waiting for the partial
  // response boundary, so derive the exact length from Content-Range.
  if (upstream.status === 206 && !upstream.headers.get("content-encoding")) {
    const partialLength = partialContentLength(upstream.headers.get("content-range"))
    if (partialLength !== null) out.set("Content-Length", String(partialLength))
  }

  // fetch() transparently decodes bodies; never forward a stale encoding/length.
  const encoding = upstream.headers.get("content-encoding")
  if (encoding && encoding.toLowerCase() !== "identity") {
    out.delete("Content-Length")
  }

  const cache = cacheHeadersFor({
    kind,
    ok: upstream.ok,
    hasRange: Boolean(range) || upstream.status === 206,
    upstreamCacheControl: upstream.headers.get("cache-control"),
  })
  for (const [name, value] of Object.entries(cache)) out.set(name, value)

  if (headOnly) {
    // Answer HEAD from the probe: report the full size, not the 1-byte slice.
    const total = totalFromContentRange(upstream.headers.get("content-range"))
    upstream.body?.cancel()
    out.delete("Content-Range")
    out.delete("Content-Length")
    if (total !== null) out.set("Content-Length", String(total))
    out.set("Accept-Ranges", "bytes")
    return new Response(null, { status: 200, headers: out })
  }

  return new Response(req.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  })
}
