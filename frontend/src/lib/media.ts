import { useCallback, useState } from "react"
import type { Screenshot } from "./api"

const BROKEN_MEDIA_LIMIT = 300
const brokenMediaUrls = new Set<string>()

function normalizeMediaUrl(url: string | null | undefined): string {
  return (url ?? "").trim()
}

function isRenderableRemoteUrl(url: string): boolean {
  return Boolean(url) && (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/api/screenshots/proxy-media?url=") ||
    url.startsWith("/api/screenshots/video-poster/") ||
    url.startsWith("/cached-")
  )
}

function buildProxyMediaUrl(url: string): string {
  return isRenderableRemoteUrl(url) && !url.startsWith("/api/screenshots/proxy-media?url=")
    ? `/api/screenshots/proxy-media?url=${encodeURIComponent(url)}`
    : ""
}

function uniqueMediaCandidates(candidates: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  for (const candidate of candidates) {
    const normalized = normalizeMediaUrl(candidate)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    urls.push(normalized)
  }
  return urls
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv)($|\?)/i.test(url)
}

function isGifUrl(url: string): boolean {
  return /\.gif($|\?)/i.test(url)
}

/**
 * Returns true if the URL is a video URL or a proxy URL wrapping a video URL.
 * Used to prevent video files from being rendered as <img> preview thumbnails.
 */
function isVideoProxyUrl(url: string): boolean {
  if (!url) return false
  // Direct video URL
  if (isVideoUrl(url)) return true
  // Proxy URL wrapping a video
  const PROXY_PREFIX = "/api/screenshots/proxy-media?url="
  if (url.startsWith(PROXY_PREFIX)) {
    try {
      const inner = decodeURIComponent(url.slice(PROXY_PREFIX.length).split("&")[0])
      if (isVideoUrl(inner)) return true
    } catch {
      // ignore decode errors
    }
  }
  return false
}

function pickUsableMediaUrl(candidates: Array<string | null | undefined>): string {
  return uniqueMediaCandidates(candidates).find((url) => !brokenMediaUrls.has(url)) ?? ""
}

export function rememberBrokenMediaUrl(url: string | null | undefined): boolean {
  const normalized = normalizeMediaUrl(url)
  if (!normalized || brokenMediaUrls.has(normalized)) return false
  brokenMediaUrls.add(normalized)
  while (brokenMediaUrls.size > BROKEN_MEDIA_LIMIT) {
    const oldest = brokenMediaUrls.values().next().value
    if (!oldest) break
    brokenMediaUrls.delete(oldest)
  }
  return true
}

export function isKnownBrokenMediaUrl(url: string | null | undefined): boolean {
  const normalized = normalizeMediaUrl(url)
  return normalized ? brokenMediaUrls.has(normalized) : false
}

export function getScreenshotMediaSrc(s: Screenshot): string {
  const localUrl = normalizeMediaUrl(s.local_url)
  if (isRenderableRemoteUrl(localUrl)) return localUrl

  const sourceUrl = normalizeMediaUrl(s.source_url)
  if (isRenderableRemoteUrl(sourceUrl)) return sourceUrl

  const pageUrl = normalizeMediaUrl(s.page_url)
  if (isRenderableRemoteUrl(pageUrl)) return pageUrl

  return ""
}

/**
 * Returns a preview image src for the screenshot card.
 * IMPORTANT: Must NEVER return a video URL — that would cause <img> to break.
 * Video-poster endpoint URLs (/api/screenshots/video-poster/N) are images and are allowed.
 */
export function getScreenshotPreviewSrc(s: Screenshot): string {
  const preview = normalizeMediaUrl(s.preview_url)
  // Only use preview_url if it's a renderable URL that isn't a raw video or a proxy
  // wrapping a video (e.g. preview_url accidentally set to the .mp4 source URL).
  if (preview && isRenderableRemoteUrl(preview) && !isVideoProxyUrl(preview)) {
    return preview
  }
  // For non-video items, fall back to the media src
  const mediaSrc = getScreenshotMediaSrc(s)
  return isVideoShot(s) ? "" : mediaSrc
}

/**
 * Returns a poster image src to show before a video starts playing.
 * Same rules as preview src — never return a raw video URL.
 */
export function getScreenshotPosterSrc(s: Screenshot): string {
  const preview = normalizeMediaUrl(s.preview_url)
  if (preview && isRenderableRemoteUrl(preview) && !isVideoProxyUrl(preview)) {
    return preview
  }
  const mediaSrc = getScreenshotMediaSrc(s)
  return isVideoShot(s) ? "" : mediaSrc
}

export function getBestAvailableMediaSrc(s: Screenshot): string {
  const mediaSrc = getScreenshotMediaSrc(s)
  // When the proxy URL fails, fall back to the raw source_url so the browser
  // can attempt a direct CDN request (works for some hosts from real IPs).
  const rawSource = normalizeMediaUrl(s.source_url)
  const directFallback = rawSource !== mediaSrc && isRenderableRemoteUrl(rawSource) ? rawSource : ""
  return pickUsableMediaUrl([mediaSrc, directFallback, buildProxyMediaUrl(mediaSrc)])
}

export function getBestAvailablePreviewSrc(s: Screenshot): string {
  const previewSrc = getScreenshotPreviewSrc(s)
  const rawThumb = normalizeMediaUrl(s.thumbnail_url)
  const rawSource = normalizeMediaUrl(s.source_url)
  if (previewSrc) {
    // Thumbnail direct → proxy of preview as fallbacks
    const directFallback =
      (rawThumb && rawThumb !== previewSrc && isRenderableRemoteUrl(rawThumb) && !isVideoProxyUrl(rawThumb)) ? rawThumb :
      (rawSource && rawSource !== previewSrc && isRenderableRemoteUrl(rawSource) && !isVideoUrl(rawSource)) ? rawSource : ""
    return pickUsableMediaUrl([previewSrc, directFallback, buildProxyMediaUrl(previewSrc)])
  }
  const mediaSrc = getScreenshotMediaSrc(s)
  if (isVideoUrl(mediaSrc)) return ""
  const directFallback = rawSource !== mediaSrc && isRenderableRemoteUrl(rawSource) && !isVideoUrl(rawSource) ? rawSource : ""
  return pickUsableMediaUrl([mediaSrc, directFallback, buildProxyMediaUrl(mediaSrc)])
}

export function getBestAvailablePosterSrc(s: Screenshot): string {
  const previewSrc = getScreenshotPosterSrc(s)
  const rawThumb = normalizeMediaUrl(s.thumbnail_url)
  const rawSource = normalizeMediaUrl(s.source_url)
  if (previewSrc) {
    const directFallback =
      (rawThumb && rawThumb !== previewSrc && isRenderableRemoteUrl(rawThumb) && !isVideoProxyUrl(rawThumb)) ? rawThumb :
      (rawSource && rawSource !== previewSrc && isRenderableRemoteUrl(rawSource) && !isVideoUrl(rawSource)) ? rawSource : ""
    return pickUsableMediaUrl([previewSrc, directFallback, buildProxyMediaUrl(previewSrc)])
  }
  const mediaSrc = getScreenshotMediaSrc(s)
  if (isVideoUrl(mediaSrc)) return ""
  const directFallback = rawSource !== mediaSrc && isRenderableRemoteUrl(rawSource) && !isVideoUrl(rawSource) ? rawSource : ""
  return pickUsableMediaUrl([mediaSrc, directFallback, buildProxyMediaUrl(mediaSrc)])
}

export function useResolvedScreenshotMedia(s: Screenshot) {
  const [, setVersion] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  const rawMediaSrc = getScreenshotMediaSrc(s)
  const mediaSrc = getBestAvailableMediaSrc(s)
  const previewSrc = getBestAvailablePreviewSrc(s)
  const posterSrc = getBestAvailablePosterSrc(s)
  const displaySrc = previewSrc || mediaSrc

  const markPreviewBroken = useCallback(() => {
    const target = previewSrc || displaySrc
    if (retryCount === 0) {
      // First error: attempt a cache-busted retry by marking the current URL broken
      // and incrementing retry counter — the next render will pick the proxy variant
      setRetryCount(1)
      if (target && target.startsWith("/api/screenshots/proxy-media?url=") && !target.includes("&bust=")) {
        // Already a proxy URL — add cache bust param to force fresh fetch
        const bustedUrl = target + "&bust=1"
        // Temporarily register the original as broken so the hook returns the busted URL
        rememberBrokenMediaUrl(target)
        // Unregister the busted URL so it can be tried
        brokenMediaUrls.delete(bustedUrl)
        setVersion((v) => v + 1)
      } else {
        // Non-proxy URL: mark broken and let the proxy variant be tried
        if (rememberBrokenMediaUrl(target)) {
          setVersion((v) => v + 1)
        }
      }
    } else {
      // Second error: give up and mark definitively broken
      if (rememberBrokenMediaUrl(target)) {
        setVersion((version) => version + 1)
      }
    }
  }, [displaySrc, previewSrc, retryCount])

  const markMediaBroken = useCallback(() => {
    if (rememberBrokenMediaUrl(rawMediaSrc)) {
      setVersion((version) => version + 1)
    }
  }, [rawMediaSrc])

  return {
    mediaSrc,
    previewSrc,
    posterSrc,
    displaySrc,
    isVideo: isVideoShot(s),
    isGif: isGifUrl(rawMediaSrc),
    hasRenderableMedia: Boolean(displaySrc),
    previewPending: isVideoShot(s) && Boolean(rawMediaSrc) && !previewSrc,
    markPreviewBroken,
    markMediaBroken,
  }
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
