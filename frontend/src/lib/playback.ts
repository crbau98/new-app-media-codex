import type { VideoQuality } from '@/store'

function isProxiedPlaybackUrl(url: string): boolean {
  try {
    return new URL(url, 'https://media-codex.local').pathname === '/api/archiver-proxy'
  } catch {
    return false
  }
}

/**
 * Keep same-origin proxy candidates ahead of provider-direct URLs. Several
 * provider CDNs return an HTML denial page when mobile Safari requests the
 * video directly, so direct URLs are a final fallback rather than the next
 * quality variant.
 */
export function orderPlaybackCandidates(
  candidates: string[],
  quality: VideoQuality,
  preferMobile = false,
): string[] {
  if (candidates.length < 2) return candidates
  const tokens = quality === '1080p'
    ? ['1080', 'hd']
    : quality === '720p' || preferMobile
      ? ['mobile', 'sd', '720']
      : []
  return candidates
    .map((url, index) => ({
      url,
      index,
      proxied: isProxiedPlaybackUrl(url) ? 1 : 0,
      qualityMatch: tokens.some((token) => url.toLowerCase().includes(token)) ? 1 : 0,
    }))
    .sort((a, b) => b.proxied - a.proxied || b.qualityMatch - a.qualityMatch || a.index - b.index)
    .map((entry) => entry.url)
}
