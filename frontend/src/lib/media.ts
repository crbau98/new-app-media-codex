import { useCallback, useState } from "react"
import type { Screenshot } from "./api"

const BROKEN_MEDIA_STORAGE_KEY = "codex:broken-media-urls"
const BROKEN_MEDIA_LIMIT = 300
const brokenMediaUrls = new Set<string>()
let brokenMediaLoaded = false

function normalizeMediaUrl(url: string | null | undefined): string {
  return (url ?? "").trim()
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

export function getBestAvailableMediaSrc(s: Screenshot): string {
  const mediaSrc = getScreenshotMediaSrc(s)
  const previewSrc = getScreenshotPreviewSrc(s)
  return pickUsableMediaUrl([mediaSrc, previewSrc])
}

export function getBestAvailablePreviewSrc(s: Screenshot): string {
  const mediaSrc = getScreenshotMediaSrc(s)
  const previewSrc = getScreenshotPreviewSrc(s)
  return pickUsableMediaUrl([previewSrc, !isVideoUrl(mediaSrc) ? mediaSrc : null])
}

export function getBestAvailablePosterSrc(s: Screenshot): string {
  return pickUsableMediaUrl([getScreenshotPosterSrc(s), getScreenshotPreviewSrc(s), getScreenshotMediaSrc(s)])
}

export function useResolvedScreenshotMedia(s: Screenshot) {
  const [, setVersion] = useState(0)
  const mediaSrc = getBestAvailableMediaSrc(s)
  const previewSrc = getBestAvailablePreviewSrc(s)
  const posterSrc = getBestAvailablePosterSrc(s)
  const mediaKindUrl = mediaSrc || getScreenshotMediaSrc(s) || previewSrc || posterSrc

  const markPreviewBroken = useCallback(() => {
    const target = previewSrc || getScreenshotPreviewSrc(s) || mediaSrc
    if (rememberBrokenMediaUrl(target)) {
      setVersion((version) => version + 1)
    }
  }, [mediaSrc, previewSrc, s])

  const markMediaBroken = useCallback(() => {
    const target = mediaSrc || getScreenshotMediaSrc(s) || previewSrc
    if (rememberBrokenMediaUrl(target)) {
      setVersion((version) => version + 1)
    }
  }, [mediaSrc, previewSrc, s])

  return {
    mediaSrc,
    previewSrc,
    posterSrc,
    isVideo: isVideoUrl(mediaKindUrl),
    isGif: isGifUrl(mediaKindUrl),
    hasRenderableMedia: Boolean(mediaSrc || previewSrc || posterSrc),
    previewPending: isVideoUrl(mediaKindUrl) && Boolean(mediaSrc) && !previewSrc,
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
