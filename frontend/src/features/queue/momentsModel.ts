/**
 * Moments: timestamps (or A–B clips) a viewer bookmarked while watching.
 * Pure model — storage and UI live elsewhere. Only the item id plus minimal
 * display metadata is kept (title, creator, thumbnail URL, timestamps);
 * no media bytes ever.
 */
import { formatTime } from '../../lib/player/controls.ts'
import { cleanNumber, cleanString, cleanUrl, isRecord, stableId } from './sanitize.ts'

export const MOMENTS_VERSION = 1
export const MAX_MOMENTS = 300
export const MAX_PER_ITEM = 40
export const MAX_LABEL = 80
/** Saving again within this many seconds of an existing moment updates it instead of duplicating. */
export const DEDUPE_WINDOW = 1.5
/** A–B ranges shorter than this are treated as a plain moment. */
export const MIN_CLIP = 0.75
const MAX_SECONDS = 60 * 60 * 24

export interface Moment {
  id: string
  itemId: string
  /** Start time in seconds. */
  t: number
  /** Present for clips: the loop end in seconds. */
  end?: number
  label: string
  createdAt: number
  title: string
  creator: string
  thumbnail: string
  /** Item length in seconds when known (drives progress ticks). */
  duration?: number
  source?: string
}

export interface MomentInput {
  itemId: string
  t: number
  end?: number | null
  label?: string
  title: string
  creator: string
  thumbnail?: string
  duration?: number
  source?: string
}

export type AddOutcome = 'added' | 'updated' | 'limit' | 'invalid'
export interface AddResult {
  list: Moment[]
  moment: Moment | null
  outcome: AddOutcome
}

const round = (value: number) => Math.round(value * 100) / 100

export function isClip(moment: Pick<Moment, 'end'>): boolean {
  return typeof moment.end === 'number'
}

export function sanitizeMoment(raw: unknown): Moment | null {
  if (!isRecord(raw)) return null
  const itemId = cleanString(raw.itemId, 300)
  const t = cleanNumber(raw.t, 0, MAX_SECONDS)
  if (!itemId || t === undefined) return null
  const id = cleanString(raw.id, 80) || stableId('mom')
  const end = cleanNumber(raw.end, 0, MAX_SECONDS)
  const moment: Moment = {
    id,
    itemId,
    t: round(t),
    label: cleanString(raw.label, MAX_LABEL),
    createdAt: cleanNumber(raw.createdAt, 0, 8.64e15) ?? 0,
    title: cleanString(raw.title, 140, 'Untitled'),
    creator: cleanString(raw.creator, 80, 'unknown'),
    thumbnail: cleanUrl(raw.thumbnail, 1400) ?? '',
  }
  if (end !== undefined && end - t >= MIN_CLIP) moment.end = round(end)
  const duration = cleanNumber(raw.duration, 1, MAX_SECONDS)
  if (duration) moment.duration = Math.round(duration)
  const source = cleanString(raw.source, 60)
  if (source) moment.source = source
  return moment
}

function byNewest(a: Moment, b: Moment): number {
  return b.createdAt - a.createdAt
}

/** Sanitise a stored/imported array: valid entries only, unique ids, newest first, bounded. */
export function sanitizeMoments(raw: unknown): Moment[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const perItem = new Map<string, number>()
  const out: Moment[] = []
  for (const entry of raw) {
    const moment = sanitizeMoment(entry)
    if (!moment || seen.has(moment.id)) continue
    const count = perItem.get(moment.itemId) ?? 0
    if (count >= MAX_PER_ITEM) continue
    seen.add(moment.id)
    perItem.set(moment.itemId, count + 1)
    out.push(moment)
  }
  return out.sort(byNewest).slice(0, MAX_MOMENTS)
}

export function momentsForItem(list: readonly Moment[], itemId: string): Moment[] {
  return list.filter((moment) => moment.itemId === itemId).sort((a, b) => a.t - b.t)
}

export function defaultLabel(moment: Pick<Moment, 't' | 'end' | 'label'>): string {
  if (moment.label) return moment.label
  return isClip(moment) ? `Clip ${formatTime(moment.t)}–${formatTime(moment.end ?? moment.t)}` : `Moment at ${formatTime(moment.t)}`
}

/**
 * Bookmark a point (or clip). Saving within DEDUPE_WINDOW of an existing
 * moment on the same item updates it in place (label and/or clip end).
 */
export function addMoment(list: readonly Moment[], input: MomentInput, now = Date.now(), rng: () => number = Math.random): AddResult {
  const itemId = cleanString(input.itemId, 300)
  const t = cleanNumber(input.t, 0, MAX_SECONDS)
  if (!itemId || t === undefined) return { list: list.slice(), moment: null, outcome: 'invalid' }
  const end = typeof input.end === 'number' ? cleanNumber(input.end, 0, MAX_SECONDS) : undefined
  const clipEnd = end !== undefined && end - t >= MIN_CLIP ? round(end) : undefined
  const label = cleanString(input.label, MAX_LABEL)

  const twin = list.find((moment) => moment.itemId === itemId && Math.abs(moment.t - t) <= DEDUPE_WINDOW && isClip(moment) === (clipEnd !== undefined))
  if (twin) {
    const updated: Moment = { ...twin, label: label || twin.label, end: clipEnd ?? twin.end }
    if (clipEnd === undefined) delete updated.end
    return { list: list.map((moment) => (moment.id === twin.id ? updated : moment)), moment: updated, outcome: 'updated' }
  }
  if (list.filter((moment) => moment.itemId === itemId).length >= MAX_PER_ITEM) return { list: list.slice(), moment: null, outcome: 'limit' }

  const moment: Moment = {
    id: stableId('mom', now, rng),
    itemId,
    t: round(t),
    label,
    createdAt: now,
    title: cleanString(input.title, 140, 'Untitled'),
    creator: cleanString(input.creator, 80, 'unknown'),
    thumbnail: cleanUrl(input.thumbnail, 1400) ?? '',
  }
  if (clipEnd !== undefined) moment.end = clipEnd
  const duration = cleanNumber(input.duration, 1, MAX_SECONDS)
  if (duration) moment.duration = Math.round(duration)
  const source = cleanString(input.source, 60)
  if (source) moment.source = source
  // Newest first; drop the oldest overall if the global cap is exceeded.
  return { list: [moment, ...list].sort(byNewest).slice(0, MAX_MOMENTS), moment, outcome: 'added' }
}

export function removeMoment(list: readonly Moment[], id: string): Moment[] {
  return list.filter((moment) => moment.id !== id)
}

export function renameMoment(list: readonly Moment[], id: string, label: string): Moment[] {
  const next = cleanString(label, MAX_LABEL)
  return list.map((moment) => (moment.id === id ? { ...moment, label: next } : moment))
}

/** Remove every moment for an item (when the viewer wants a clean slate). */
export function removeMomentsForItem(list: readonly Moment[], itemId: string): Moment[] {
  return list.filter((moment) => moment.itemId !== itemId)
}

/* ── export / import ──────────────────────────────────────────── */

export interface MomentsFile {
  app: 'media-codex'
  kind: 'moments'
  version: typeof MOMENTS_VERSION
  exportedAt: string
  moments: Moment[]
}

export const MAX_IMPORT_BYTES = 2_000_000

export function exportMoments(list: readonly Moment[], now: Date = new Date()): string {
  const file: MomentsFile = { app: 'media-codex', kind: 'moments', version: MOMENTS_VERSION, exportedAt: now.toISOString(), moments: list.slice() }
  return JSON.stringify(file, null, 2)
}

export type ImportParse = { ok: true; moments: Moment[]; skipped: number } | { ok: false; error: string }

/** Strictly validate an exported file (or a bare array of moments). Invalid entries are skipped, never trusted. */
export function parseMomentsImport(text: string): ImportParse {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'The file is empty.' }
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to be a moments export.' }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  let entries: unknown
  if (Array.isArray(data)) entries = data
  else if (isRecord(data) && data.kind === 'moments' && Array.isArray(data.moments)) {
    if (typeof data.version === 'number' && data.version > MOMENTS_VERSION) return { ok: false, error: 'This export was made by a newer version.' }
    entries = data.moments
  } else return { ok: false, error: 'This does not look like a Media Codex moments export.' }
  const list = entries as unknown[]
  const moments = sanitizeMoments(list)
  return { ok: true, moments, skipped: Math.max(0, list.length - moments.length) }
}

export interface MergeResult {
  list: Moment[]
  added: number
  duplicates: number
}

/** Merge imported moments into the current list, skipping ones already present (same id, or same item/time/kind). */
export function mergeMoments(list: readonly Moment[], incoming: readonly Moment[]): MergeResult {
  let merged = list.slice()
  let added = 0
  let duplicates = 0
  for (const moment of incoming) {
    const exists = merged.some(
      (entry) => entry.id === moment.id || (entry.itemId === moment.itemId && Math.abs(entry.t - moment.t) <= DEDUPE_WINDOW && isClip(entry) === isClip(moment)),
    )
    if (exists) {
      duplicates += 1
      continue
    }
    if (merged.filter((entry) => entry.itemId === moment.itemId).length >= MAX_PER_ITEM) {
      duplicates += 1
      continue
    }
    merged = [...merged, moment]
    added += 1
  }
  return { list: merged.sort(byNewest).slice(0, MAX_MOMENTS), added, duplicates }
}

/** Where a moment sits on the item's timeline, 0–100, for progress ticks. */
export function momentPercent(moment: Pick<Moment, 't' | 'duration'>, fallbackDuration = 0): number {
  const duration = moment.duration ?? fallbackDuration
  return duration > 0 ? Math.max(0, Math.min(100, (moment.t / duration) * 100)) : 0
}
