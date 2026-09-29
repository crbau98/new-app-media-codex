/**
 * Client side of the streaming concierge protocol (NDJSON, see api/ai-concierge.ts)
 * plus the catalog builder that decides which PUBLIC metadata may leave the device.
 */

import { runQuery, parseNaturalQuery, type MediaLite } from '../core/library.ts'

export interface ToolOut {
  ids: string[]
  note: string
  reasons: Record<string, string>
  name?: string
  totalSeconds?: number
}

export type ConciergeEvent =
  | { t: 'text'; d: string }
  | { t: 'tool'; name: string; out: ToolOut }
  | { t: 'refusal'; category?: string; d: string }
  | { t: 'error'; d: string }
  | { t: 'done' }

export class ConciergeHttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ConciergeHttpError'
    this.status = status
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Validate one decoded line; unknown or malformed events are dropped. */
export function sanitizeEvent(raw: unknown): ConciergeEvent | null {
  if (!isRecord(raw) || typeof raw.t !== 'string') return null
  switch (raw.t) {
    case 'text': return typeof raw.d === 'string' ? { t: 'text', d: raw.d.slice(0, 4000) } : null
    case 'refusal': return typeof raw.d === 'string' ? { t: 'refusal', category: typeof raw.category === 'string' ? raw.category : undefined, d: raw.d.slice(0, 400) } : null
    case 'error': return { t: 'error', d: typeof raw.d === 'string' ? raw.d.slice(0, 200) : 'Something went wrong.' }
    case 'done': return { t: 'done' }
    case 'tool': {
      if (typeof raw.name !== 'string' || !isRecord(raw.out) || !Array.isArray(raw.out.ids)) return null
      const out = raw.out
      const reasons: Record<string, string> = {}
      if (isRecord(out.reasons)) for (const [k, v] of Object.entries(out.reasons)) if (typeof v === 'string') reasons[k] = v.slice(0, 160)
      return {
        t: 'tool', name: raw.name.slice(0, 40),
        out: {
          ids: (out.ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 30),
          note: typeof out.note === 'string' ? out.note.slice(0, 400) : '',
          reasons,
          name: typeof out.name === 'string' ? out.name.slice(0, 80) : undefined,
          totalSeconds: typeof out.totalSeconds === 'number' ? out.totalSeconds : undefined,
        },
      }
    }
    default: return null
  }
}

/** Incremental NDJSON decoder tolerant of chunk boundaries splitting a line. */
export function createNdjsonParser() {
  let buffer = ''
  const drain = (final: boolean): ConciergeEvent[] => {
    const events: ConciergeEvent[] = []
    const lines = buffer.split('\n')
    buffer = final ? '' : lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = sanitizeEvent(JSON.parse(trimmed))
        if (event) events.push(event)
      } catch { /* ignore a torn/garbled line */ }
    }
    return events
  }
  return { push(chunk: string) { buffer += chunk; return drain(false) }, flush() { return drain(true) } }
}

export interface ConciergeRequestBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  catalog: Array<Record<string, unknown>>
  context?: { currentId?: string | null; tasteTags?: string[] }
}

export async function* streamConcierge(body: ConciergeRequestBody, signal: AbortSignal): AsyncGenerator<ConciergeEvent> {
  const response = await fetch('/api/ai-concierge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    credentials: 'omit',
  })
  if (!response.ok || !response.body) {
    throw new ConciergeHttpError(response.status, response.status === 429 ? 'Too many requests — try again in a moment.' : 'The AI service is unavailable.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createNdjsonParser()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const event of parser.push(decoder.decode(value, { stream: true }))) yield event
    }
    for (const event of parser.push(decoder.decode())) yield event
    for (const event of parser.flush()) yield event
  } finally {
    reader.releaseLock?.()
  }
}

let availabilityPromise: Promise<{ available: boolean; model: string | null }> | null = null

/** One cheap GET per page load (no model call) to choose cloud vs on-device mode. */
export function fetchAiAvailability(force = false): Promise<{ available: boolean; model: string | null }> {
  if (!availabilityPromise || force) {
    availabilityPromise = (async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 4000)
        const response = await fetch('/api/ai-concierge', { signal: controller.signal, credentials: 'omit' })
        clearTimeout(timer)
        if (!response.ok) return { available: false, model: null }
        const data: unknown = await response.json()
        if (isRecord(data) && data.available === true) return { available: true, model: typeof data.model === 'string' ? data.model : null }
        return { available: false, model: null }
      } catch {
        return { available: false, model: null }
      }
    })()
  }
  return availabilityPromise
}

/**
 * Choose the public-metadata subset sent with a request: best lexical matches
 * for the latest message, then broad coverage by engagement, plus any anchor
 * ids. Never includes thumbnails, URLs or descriptions.
 */
export function buildCatalog(items: MediaLite[], opts: { prompt: string; anchorIds?: Array<string | null | undefined>; max?: number }): Array<Record<string, unknown>> {
  const max = Math.min(opts.max ?? 120, 150)
  const chosen = new Map<string, MediaLite>()
  const add = (item: MediaLite | undefined) => { if (item && chosen.size < max) chosen.set(item.id, item) }
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const id of opts.anchorIds ?? []) if (id) add(byId.get(id))
  const q = parseNaturalQuery(opts.prompt)
  if (!q.refused) for (const r of runQuery(items, q, { limit: Math.floor(max / 2) }).results) add(r.item)
  const rest = [...items].sort((a, b) => (b.curation ?? 0) - (a.curation ?? 0) || b.views - a.views)
  for (const item of rest) add(item)
  return [...chosen.values()].map((item) => ({
    id: item.id,
    title: item.title.slice(0, 200),
    creator: item.creator.slice(0, 80),
    source: item.source.slice(0, 40),
    tags: item.tags.slice(0, 12),
    duration: Math.round(item.duration),
    isVideo: item.isVideo,
    views: item.views,
    likes: item.likes,
    createdAt: item.createdAt,
  }))
}
