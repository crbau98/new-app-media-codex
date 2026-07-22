import type { VideoQuality } from '@/store'

/** Keep provider fallback order stable while moving device-appropriate streams first. */
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
  if (!tokens.length) return candidates

  return candidates
    .map((url, index) => ({ url, index, match: tokens.some((token) => url.toLowerCase().includes(token)) ? 1 : 0 }))
    .sort((a, b) => b.match - a.match || a.index - b.index)
    .map((entry) => entry.url)
}
