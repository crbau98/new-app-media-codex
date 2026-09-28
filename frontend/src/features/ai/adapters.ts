import type { MediaItem } from '../../lib/types.ts'
import { parseDurationString, type MediaLite } from './core/library.ts'
import type { SignalItem } from './taste/engine.ts'

/** Public-metadata projection of a library item. Never carries streams or image bytes. */
export function toLite(item: MediaItem): MediaLite {
  const extra = item as MediaItem & { aiTags?: string[]; aiSummary?: string; aiMood?: string[] | string }
  return {
    id: item.id,
    title: item.title || 'Untitled',
    creator: item.creator || '',
    source: item.source || '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    duration: item.isVideo ? (item.durationSeconds ?? parseDurationString(item.duration)) : 0,
    isVideo: Boolean(item.isVideo),
    views: item.views || 0,
    likes: item.likes || 0,
    createdAt: item.createdAt,
    description: item.description ? item.description.slice(0, 240) : extra.aiSummary,
    curation: item.curationScore,
    aiTags: extra.aiTags,
    aiMood: Array.isArray(extra.aiMood) ? extra.aiMood : extra.aiMood ? [extra.aiMood] : undefined,
    thumbnail: item.thumbnail,
  }
}

export function toSignalItem(item: MediaLite): SignalItem {
  return { id: item.id, creator: item.creator, source: item.source, tags: item.tags, duration: item.duration }
}
