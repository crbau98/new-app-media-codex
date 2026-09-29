/**
 * Provider-agnostic normalisation for the live feed: media-intelligence
 * contract fields, best-first stream ordering, playability gating and
 * cross-provider dedupe. Pure functions (unit tested).
 */
import type { UnifiedMediaItem } from './discovery-types.js'

const PROXY_PREFIX = '/api/archiver-proxy?url='

/** Underlying URL of a (possibly proxy-wrapped) stream candidate. */
export function underlyingUrl(candidate: string): string {
  if (candidate.startsWith(PROXY_PREFIX)) {
    try { return decodeURIComponent(candidate.slice(PROXY_PREFIX.length).split('&')[0]) } catch { return candidate }
  }
  return candidate
}

/** 0 = progressive MP4 (best), 1 = other progressive, 2 = HLS, 3 = DASH/unknown. */
export function streamRank(candidate: string): number {
  const path = underlyingUrl(candidate).toLowerCase().split('?')[0]
  if (/\.(mp4|m4v|mov)$/.test(path)) return 0
  if (/\.(webm|ogv)$/.test(path)) return 1
  if (path.endsWith('.m3u8')) return 2
  return path.endsWith('.mpd') ? 3 : 1
}

/**
 * Order candidates progressive-mp4 -> other progressive -> hls -> dash. Within a
 * rank the same-origin proxied variant stays ahead of the direct URL (that is the
 * playback-stream contract) and the original relative order is otherwise kept.
 */
export function orderStreamCandidates(candidates: string[]): string[] {
  const seen = new Set<string>()
  const unique = candidates.filter((c) => Boolean(c) && (seen.has(c) ? false : (seen.add(c), true)))
  return unique
    .map((c, i) => ({ c, i, r: streamRank(c), direct: c.startsWith(PROXY_PREFIX) ? 0 : 1 }))
    .sort((a, b) => a.r - b.r || a.direct - b.direct || a.i - b.i)
    .map((x) => x.c)
}

export function aspectOf(width?: number, height?: number): number | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined
  return Math.round((width / height) * 10_000) / 10_000
}

export function isPlayable(item: Pick<UnifiedMediaItem, 'mediaUrl' | 'streamCandidates' | 'isVideo' | 'thumbnail'>): boolean {
  if (item.isVideo) return Boolean(item.mediaUrl || item.streamCandidates?.length)
  return Boolean(item.mediaUrl || item.thumbnail)
}

/** Fill contract fields that are knowable from provider metadata (never guessed). */
export function withContract<T extends UnifiedMediaItem>(
  item: T,
  meta: { width?: number; height?: number; durationSeconds?: number; hasAudio?: boolean; mimeType?: string; hlsUrl?: string; posterUrl?: string; codec?: string } = {},
): T {
  const streams = orderStreamCandidates(item.streamCandidates || [])
  const hls = meta.hlsUrl || streams.map(underlyingUrl).find((u) => u.toLowerCase().split('?')[0].endsWith('.m3u8'))
  const first = streams[0] ? underlyingUrl(streams[0]).toLowerCase().split('?')[0] : ''
  const next: T = { ...item, streamCandidates: streams }
  if (streams.length && !next.mediaUrl) next.mediaUrl = streams[0]
  const width = meta.width ?? item.width
  const height = meta.height ?? item.height
  if (width && height) { next.width = width; next.height = height; next.aspect = aspectOf(width, height) }
  if (meta.durationSeconds && meta.durationSeconds > 0) next.durationSeconds = Math.round(meta.durationSeconds * 1000) / 1000
  if (meta.hasAudio !== undefined) next.hasAudio = meta.hasAudio
  if (hls) next.hlsUrl = hls
  if (meta.posterUrl) next.posterUrl = meta.posterUrl
  if (meta.codec) next.codec = meta.codec
  next.mimeType = meta.mimeType || (item.isVideo ? (/\.m3u8$/.test(first) ? 'application/vnd.apple.mpegurl' : /\.webm$/.test(first) ? 'video/webm' : first ? 'video/mp4' : undefined) : undefined)
  if (!next.mimeType) delete next.mimeType
  return next
}

function dedupeKey(item: UnifiedMediaItem): string[] {
  const keys = [`id:${item.id}`]
  const media = item.streamCandidates?.[0] ? underlyingUrl(item.streamCandidates[0]) : item.mediaUrl ? underlyingUrl(item.mediaUrl) : ''
  if (media) keys.push(`media:${media.split('?')[0]}`)
  if (item.pageUrl) keys.push(`page:${item.pageUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/$/, '')}`)
  if (item.durationSeconds && item.creator && item.title) {
    keys.push(`sig:${item.creator.toLowerCase()}|${item.title.toLowerCase().slice(0, 60)}|${Math.round(item.durationSeconds)}`)
  }
  return keys
}

/** Cross-provider dedupe; on a collision the richer (more metadata, higher score) item wins. */
export function dedupeItems<T extends UnifiedMediaItem>(items: T[]): T[] {
  const richness = (i: T) => (i.width ? 2 : 0) + (i.durationSeconds ? 1 : 0) + (i.streamCandidates?.length || 0) * 0.1 + (i.curationScore || 0) / 1000
  const winners: T[] = []
  const owner = new Map<string, number>()
  for (const item of items) {
    const keys = dedupeKey(item)
    const hit = keys.map((k) => owner.get(k)).find((v) => v !== undefined)
    if (hit === undefined) {
      winners.push(item)
      keys.forEach((k) => owner.set(k, winners.length - 1))
    } else {
      if (richness(item) > richness(winners[hit])) winners[hit] = item
      keys.forEach((k) => owner.set(k, hit))
    }
  }
  return winners
}

/** Drop unplayable items; returns the survivors plus how many were removed. */
export function pruneUnplayable<T extends UnifiedMediaItem>(items: T[]): { items: T[]; dropped: number } {
  const kept = items.filter((i) => isPlayable(i))
  return { items: kept, dropped: items.length - kept.length }
}

/** Pick the best poster/thumbnail: prefer an explicit poster over a thumbnail. */
export function pickPoster(...urls: Array<string | undefined>): string | undefined {
  return urls.find((u) => Boolean(u))
}

export type PeerTubeVideoDetail = {
  duration?: number
  files?: Array<{ fileUrl?: string; resolution?: { id?: number }; width?: number; height?: number }>
  streamingPlaylists?: Array<{ playlistUrl?: string }>
}

/** Pick playable public streams (progressive MP4 <=1080p, then HLS) from a PeerTube video document. */
export function peerTubeStreams(detail: PeerTubeVideoDetail): { streams: string[]; height?: number } {
  const files = (detail.files || [])
    .filter((f) => f.fileUrl && /^https:\/\//.test(f.fileUrl))
    .map((f) => ({ url: f.fileUrl as string, h: Number(f.resolution?.id || f.height || 0) }))
    .filter((f) => f.h <= 1080)
    .sort((a, b) => b.h - a.h)
  const hls = (detail.streamingPlaylists || []).map((p) => p.playlistUrl).filter((u): u is string => Boolean(u && /^https:\/\//.test(u)))
  return { streams: orderStreamCandidates([...files.map((f) => f.url), ...hls]), height: files[0]?.h || undefined }
}

