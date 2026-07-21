import type { MediaItem } from '@/lib/types'

export type StructuredQuery = {
  text: string
  source?: string
  creator?: string
  tag?: string
  minDuration?: number
  maxDuration?: number
  minViews?: number
  quality?: 'hd' | 'sd'
}

function parseDuration(value: string): number | undefined {
  const match = value.match(/^(\d+)(s|m)?$/i)
  if (!match) return undefined
  const amount = Number(match[1])
  return match[2]?.toLowerCase() === 'm' ? amount * 60 : amount
}

function mediaDurationSeconds(duration: string): number {
  const parts = duration.split(':').map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}

export function parseProQuery(input: string): StructuredQuery {
  const query: StructuredQuery = { text: '' }
  const freeText: string[] = []
  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const [rawKey, ...rest] = token.split(':')
    const key = rawKey.toLowerCase()
    const value = rest.join(':')
    if (!value) {
      freeText.push(token)
      continue
    }
    if (key === 'source') query.source = value.toLowerCase()
    else if (key === 'creator') query.creator = value.replace(/^@/, '').toLowerCase()
    else if (key === 'tag') query.tag = value.toLowerCase()
    else if (key === 'quality' && /^(hd|sd)$/i.test(value)) query.quality = value.toLowerCase() as 'hd' | 'sd'
    else if (key === 'views' && /^>\d+$/.test(value)) query.minViews = Number(value.slice(1))
    else if (key === 'duration') {
      const range = value.match(/^(\d+[sm]?)-(\d+[sm]?)$/i)
      if (range) {
        query.minDuration = parseDuration(range[1])
        query.maxDuration = parseDuration(range[2])
      } else if (value.startsWith('>')) query.minDuration = parseDuration(value.slice(1))
      else if (value.startsWith('<')) query.maxDuration = parseDuration(value.slice(1))
    } else freeText.push(token)
  }
  query.text = freeText.join(' ').toLowerCase()
  return query
}

function editDistance(a: string, b: string): number {
  if (!a) return b.length
  if (!b) return a.length
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (!needle) return true
  if (haystack.includes(needle)) return true
  return haystack.split(/\s+/).some((word) => editDistance(word.slice(0, needle.length + 1), needle) <= 1)
}

export function filterMedia(items: MediaItem[], structured: StructuredQuery): MediaItem[] {
  return items.filter((item) => {
    const haystack = [item.title, item.creator, item.source, ...item.tags].join(' ').toLowerCase()
    if (structured.text && !fuzzyIncludes(haystack, structured.text)) return false
    if (structured.source && item.source.toLowerCase() !== structured.source) return false
    if (structured.creator && item.creator.toLowerCase() !== structured.creator) return false
    if (structured.tag && !item.tags.some((tag) => tag.toLowerCase() === structured.tag)) return false
    const seconds = item.isVideo ? mediaDurationSeconds(item.duration) : 0
    if (structured.minDuration !== undefined && (!item.isVideo || seconds < structured.minDuration)) return false
    if (structured.maxDuration !== undefined && (!item.isVideo || seconds > structured.maxDuration)) return false
    if (structured.minViews !== undefined && item.views < structured.minViews) return false
    if (structured.quality === 'hd' && item.isVideo && seconds > 0 && item.views < 1000) return false
    return true
  })
}
