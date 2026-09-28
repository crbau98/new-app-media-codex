/**
 * HLS manifest rewriting for the edge media proxy. Every reference (variant
 * playlists, segments, init maps, keys, renditions) is made absolute and, when
 * its host is allowlisted, routed back through the proxy so the browser never
 * needs direct provider access and relative URIs cannot resolve against the
 * proxy path. References to hosts that are not allowed are left as absolute
 * direct URLs (never proxied).
 */

export interface HlsRewriteOptions {
  /** Same-origin proxy endpoint, e.g. `/api/archiver-proxy`. */
  proxyPath: string
  /** Host allowlist predicate; must enforce https + host rules. */
  isAllowed: (url: URL) => boolean
}

export const MAX_MANIFEST_BYTES = 1024 * 1024

const URI_ATTRIBUTE = /URI="([^"]*)"/gi

function mapReference(reference: string, base: URL, options: HlsRewriteOptions): string {
  const trimmed = reference.trim()
  if (!trimmed || trimmed.startsWith('data:')) return reference
  let absolute: URL
  try {
    absolute = new URL(trimmed, base)
  } catch {
    return reference
  }
  if (absolute.protocol !== 'https:') return reference
  if (!options.isAllowed(absolute)) return absolute.href
  return `${options.proxyPath}?url=${encodeURIComponent(absolute.href)}`
}

export function rewriteHlsManifest(text: string, manifestUrl: string | URL, options: HlsRewriteOptions): string {
  const base = typeof manifestUrl === 'string' ? new URL(manifestUrl) : manifestUrl
  return text
    .split(/(\r?\n)/)
    .map((line) => {
      if (line === '\n' || line === '\r\n') return line
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) {
        if (!/URI="/i.test(trimmed)) return line
        return line.replace(URI_ATTRIBUTE, (_match, uri: string) => `URI="${mapReference(uri, base, options)}"`)
      }
      return mapReference(trimmed, base, options)
    })
    .join('')
}

/** Cheap structural check so we never "rewrite" HTML error pages as manifests. */
export function looksLikeHlsManifest(text: string): boolean {
  return text.trimStart().startsWith('#EXTM3U')
}
