interface Screenshot {
  local_url?: string
  local_path?: string
  preview_url?: string
  page_url?: string
  source?: string
  term?: string
  id?: number
  [key: string]: unknown
}

export function getScreenshotMediaSrc(s: Screenshot): string {
  if (s.local_url) return s.local_url
  if (s.local_path) {
    const name = s.local_path.split("/").pop() || ""
    return `/cached-screenshots/${name}`
  }
  return s.page_url || ""
}

export function getScreenshotPreviewSrc(s: Screenshot): string {
  if (s.preview_url) return s.preview_url
  return getScreenshotMediaSrc(s)
}

export function getScreenshotPosterSrc(s: Screenshot): string {
  if (s.preview_url) return s.preview_url
  return getScreenshotPreviewSrc(s)
}

export function getMediaDebugLabel(s: Screenshot): string {
  const parts: string[] = []
  if (s.term) parts.push(s.term)
  if (s.source) parts.push(s.source)
  if (s.id) parts.push(`#${s.id}`)
  return parts.join(" · ") || "media"
}
