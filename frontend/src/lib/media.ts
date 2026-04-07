import { useCallback, useState } from "react"
import type { Screenshot } from "./api"

const BROKEN_MEDIA_STORAGE_KEY = "codex:broken-media-urls"
const BROKEN_MEDIA_LIMIT = 300
const brokenMediaUrls = new Set<string>()
let brokenMediaLoaded = false

function normalizeMediaUrl(url: string | null | undefined): string {
  return (url ?? "").trim()
}

function isRenderableRemoteUrl(url: string): boolean {
  return Boolean(url) && (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/api/screenshots/proxy-media?url=") ||
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

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|avi|mkv)$/i.test(url)
}

function isGifUrl(url: string): boolean {
  return /\.gif$/i.test(url)
}

function ensureBrokenMediaUrlsLoaded() {
  if (brokenMediaLoaded || typeof window === "undefined") return
  brokenMediaLoaded = true
  try {
    const raw = window.sessionStorage.getItem(BROKEN_MEDIA_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    for (const entry of parsed) {
      const normalized = normalizeMediaUrl(typeof entry === "string" ? entry : "")
      if (normalized) brokenMediaUrls.add(normalized)
    }
  } catch {
    brokenMediaUrls.clear()
  }
}

function persistBrokenMediaUrls() {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(BROKEN_MEDIA_STORAGE_KEY, JSON.stringify([...brokenMediaUrls]))
  } catch {
    // Ignore storage write failures.
  }
}

function pickUsableMediaUrl(candidates: Array<string | null | undefined>): string {
  ensureBrokenMediaUrlsLoaded()
  return uniqueMediaCandidates(candidates).find((url) => !brokenMediaUrls.has(url)) ?? ""
}

export function rememberBrokenMediaUrl(url: string | null | undefined): boolean {
  ensureBrokenMediaUrlsLoaded()
  const normalized = normalizeMediaUrl(url)
  if (!normalized || brokenMediaUrls.has(normalized)) return false
  brokenMediaUrls.add(normalized)
  while (brokenMediaUrls.size > BROKEN_MEDIA_LIMIT) {
    const oldest = brokenMediaUrls.values().next().value
    if (!oldest) break
    brokenMediaUrls.delete(oldest)
  }
  persistBrokenMediaUrls()
  return true
}

export function isKnownBrokenMediaUrl(url: string | null | undefined): boolean {
  ensureBrokenMediaUrlsLoaded()
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

export function getScreenshotPreviewSrc(s: Screenshot): string {
  if (s.preview_url) return s.preview_url
  const mediaSrc = getScreenshotMediaSrc(s)
  return isVideoShot(s) ? "" : mediaSrc
}

export function getScreenshotPosterSrc(s: Screenshot): string {
  if (s.preview_url) return s.preview_url
  const mediaSrc = getScreenshotMediaSrc(s)
  return isVideoShot(s) ? "" : mediaSrc
}

export function getBestAvailableMediaSrc(s: Screenshot): string {
  const mediaSrc = getScreenshotMediaSrc(s)
  return pickUsableMediaUrl([mediaSrc, buildProxyMediaUrl(mediaSrc)])
}

export function getBestAvailablePreviewSrc(s: Screenshot): string {
  const previewSrc = getScreenshotPreviewSrc(s)
  if (previewSrc) return pickUsableMediaUrl([previewSrc, buildProxyMediaUrl(previewSrc)])
  const mediaSrc = getScreenshotMediaSrc(s)
  return isVideoUrl(mediaSrc) ? "" : pickUsableMediaUrl([mediaSrc, buildProxyMediaUrl(mediaSrc)])
}

export function getBestAvailablePosterSrc(s: Screenshot): string {
  const previewSrc = getScreenshotPreviewSrc(s)
  if (previewSrc) return pickUsableMediaUrl([previewSrc, buildProxyMediaUrl(previewSrc)])
  const mediaSrc = getScreenshotMediaSrc(s)
  return isVideoUrl(mediaSrc) ? "" : pickUsableMediaUrl([mediaSrc, buildProxyMediaUrl(mediaSrc)])
}

export function useResolvedScreenshotMedia(s: Screenshot) {
  const [, setVersion] = useState(0)
  const rawMediaSrc = getScreenshotMediaSrc(s)
  const mediaSrc = getBestAvailableMediaSrc(s)
  const previewSrc = getBestAvailablePreviewSrc(s)
  const posterSrc = getBestAvailablePosterSrc(s)
  const displaySrc = previewSrc || mediaSrc

  const markPreviewBroken = useCallback(() => {
    const target = previewSrc || displaySrc
    if (rememberBrokenMediaUrl(target)) {
      setVersion((version) => version + 1)
    }
  }, [displaySrc, previewSrc])

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
