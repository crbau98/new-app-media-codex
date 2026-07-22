export const MAX_MEDIA_RANGE_BYTES = 12 * 1024 * 1024

/**
 * Normalize a browser byte range into a bounded, single upstream request.
 * Browsers commonly ask for a very large explicit or suffix range while
 * probing MP4 metadata. Clamping those requests keeps the edge proxy bounded
 * without replying 416 and aborting otherwise valid playback.
 */
export function normalizeMediaRange(value: string | null): string | null | false {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return false

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false
    return `bytes=-${Math.min(suffixLength, MAX_MEDIA_RANGE_BYTES)}`
  }

  const start = Number(match[1])
  if (!Number.isSafeInteger(start) || start < 0) return false
  const maximumEnd = start + MAX_MEDIA_RANGE_BYTES - 1
  if (!Number.isSafeInteger(maximumEnd)) return false

  if (!match[2]) return `bytes=${start}-${maximumEnd}`
  const requestedEnd = Number(match[2])
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return false
  return `bytes=${start}-${Math.min(requestedEnd, maximumEnd)}`
}
