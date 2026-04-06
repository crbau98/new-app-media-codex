interface Screenshot {
  local_url?: string
  local_path?: string
  source_url?: string
  preview_url?: string
  page_url?: string
  source?: string
  term?: string
  id?: number
  [key: string]: unknown
}

export function getScreenshotMediaSrc(s: Screenshot): string {
  // Prefer backend-resolved local_url (works for both local files and proxy URLs)
  if (s.local_url) return s.local_url
  // Legacy: local file on disk
  if (s.local_path) {
    const name = s.local_path.split("/").pop() || ""
    if (name) return `/cached-screenshots/${name}`
  }
  // Remote-only: proxy through backend
  if (s.source_url) {
    return `/api/screenshots/proxy-media?url=${encodeURIComponent(s.source_url)}`
  }
  return s.page_url || ""
}

export function getScreenshotPreviewSrc(s: Screenshot): string {
  if (s.preview_url) return s.preview_url
  // For videos without a preview, don't return the video URL as an image src
  if (isVideoShot(s)) return ""
  return getScreenshotMediaSrc(s)
}

export function getScreenshotPosterSrc(s: Screenshot): string {
  if (s.preview_url) return s.preview_url
  return ""
}

export function getMediaDebugLabel(s: Screenshot): string {
  const parts: string[] = []
  if (s.term) parts.push(s.term)
  if (s.source) parts.push(s.source)
  if (s.id) parts.push(`#${s.id}`)
  return parts.join(" · ") || "media"
}

const _VIDEO_RE = /\.(mp4|webm|mov|avi|mkv)/i
const _VIDEO_SOURCES = new Set(["redgifs", "ytdlp"])

/** Detect if a screenshot is a video based on URL patterns and source field. */
export function isVideoShot(s: Screenshot): boolean {
  if (s.source && _VIDEO_SOURCES.has(s.source)) return true
  const url = s.source_url || s.local_url || s.local_path || s.page_url || ""
  return _VIDEO_RE.test(url)
}
