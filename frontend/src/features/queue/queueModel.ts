/**
 * Pure watch-queue model (no React, no storage). The queue follows the
 * "now playing / up next / history" shape used by streaming apps:
 *
 *   history  — what already played (most recent last), enabling Previous
 *   nowPlaying — the item the viewer is on
 *   upcoming — what plays next; this is the list the viewer reorders
 *
 * Every function returns a new state and never mutates its input, so the
 * store can persist/restore and the unit tests can assert transitions.
 * Items are kept as bounded, sanitised MediaItem snapshots so a queued entry
 * stays playable after it rotates out of the live feed.
 */
import type { MediaItem } from '../../lib/types.ts'
import { cleanNumber, cleanString, cleanUrl, isRecord } from './sanitize.ts'

export const QUEUE_VERSION = 1
export const MAX_UPCOMING = 60
export const MAX_HISTORY = MAX_UPCOMING + 1

export type RepeatMode = 'off' | 'all' | 'one'
export type AutoplayPref = 'auto' | 'on' | 'off'
export type Rng = () => number

export interface QueueState {
  v: typeof QUEUE_VERSION
  nowPlaying: MediaItem | null
  upcoming: MediaItem[]
  history: MediaItem[]
  repeat: RepeatMode
  shuffle: boolean
  autoplay: AutoplayPref
  /** Pre-shuffle order of the upcoming ids, so turning shuffle off restores it. */
  order: string[] | null
}

export function emptyQueue(): QueueState {
  return { v: QUEUE_VERSION, nowPlaying: null, upcoming: [], history: [], repeat: 'off', shuffle: false, autoplay: 'auto', order: null }
}

/* ── item snapshots ───────────────────────────────────────────── */

function strings(value: unknown, maxCount: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const text = cleanString(entry, maxLength)
    if (text && !out.includes(text)) out.push(text)
    if (out.length >= maxCount) break
  }
  return out
}

function urls(value: unknown, maxCount: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const url = cleanUrl(entry, 1400)
    if (url && !out.includes(url)) out.push(url)
    if (out.length >= maxCount) break
  }
  return out
}

/**
 * Reduce a MediaItem to the bounded subset needed to display and play it
 * again later. Returns null for anything without a usable id. Also used to
 * sanitise snapshots read back from storage.
 */
export function trimItem(raw: unknown): MediaItem | null {
  if (!isRecord(raw)) return null
  const id = cleanString(raw.id, 300)
  if (!id) return null
  const item: MediaItem = {
    id,
    title: cleanString(raw.title, 200, 'Untitled'),
    thumbnail: cleanUrl(raw.thumbnail, 1400) ?? '',
    source: cleanString(raw.source, 60, 'Unknown'),
    duration: cleanString(raw.duration, 16),
    isVideo: raw.isVideo === true,
    category: cleanString(raw.category, 40),
    creator: cleanString(raw.creator, 80, 'unknown'),
    tags: strings(raw.tags, 10, 40),
    rating: cleanNumber(raw.rating, 0, 100) ?? 0,
    createdAt: cleanString(raw.createdAt, 40),
    views: cleanNumber(raw.views, 0, 1e12) ?? 0,
  }
  const mediaUrl = cleanUrl(raw.mediaUrl, 1400)
  if (mediaUrl) item.mediaUrl = mediaUrl
  const candidates = urls(raw.streamCandidates, 6)
  if (candidates.length) item.streamCandidates = candidates
  const pageUrl = cleanUrl(raw.pageUrl, 1400)
  if (pageUrl) item.pageUrl = pageUrl
  const likes = cleanNumber(raw.likes, 0, 1e12)
  if (likes !== undefined) item.likes = likes
  for (const key of ['width', 'height', 'aspect', 'durationSeconds'] as const) {
    const value = cleanNumber(raw[key], 0, 1e7)
    if (value !== undefined && value > 0) item[key] = value
  }
  if (typeof raw.dominantColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(raw.dominantColor.trim())) item.dominantColor = raw.dominantColor.trim()
  for (const key of ['hlsUrl', 'posterUrl', 'spriteUrl', 'previewUrl'] as const) {
    const url = cleanUrl(raw[key], 1400)
    if (url) item[key] = url
  }
  if (isRecord(raw.spriteGrid)) {
    const grid = raw.spriteGrid
    const cols = cleanNumber(grid.cols, 1, 64)
    const rows = cleanNumber(grid.rows, 1, 64)
    const tileWidth = cleanNumber(grid.tileWidth, 1, 4096)
    const tileHeight = cleanNumber(grid.tileHeight, 1, 4096)
    const intervalSeconds = cleanNumber(grid.intervalSeconds, 0.1, 3600)
    if (cols && rows && tileWidth && tileHeight && intervalSeconds) item.spriteGrid = { cols, rows, tileWidth, tileHeight, intervalSeconds }
  }
  const mimeType = cleanString(raw.mimeType, 60)
  if (mimeType) item.mimeType = mimeType
  const codec = cleanString(raw.codec, 80)
  if (codec) item.codec = codec
  if (typeof raw.hasAudio === 'boolean') item.hasAudio = raw.hasAudio
  if (Array.isArray(raw.gallery)) {
    const gallery: NonNullable<MediaItem['gallery']> = []
    for (const frame of raw.gallery) {
      if (!isRecord(frame)) continue
      const url = cleanUrl(frame.url, 1400)
      if (!url) continue
      const entry: { url: string; thumbnail?: string; width?: number; height?: number } = { url }
      const thumb = cleanUrl(frame.thumbnail, 1400)
      if (thumb) entry.thumbnail = thumb
      const width = cleanNumber(frame.width, 1, 1e5)
      const height = cleanNumber(frame.height, 1, 1e5)
      if (width) entry.width = width
      if (height) entry.height = height
      gallery.push(entry)
      if (gallery.length >= 12) break
    }
    if (gallery.length) item.gallery = gallery
  }
  return item
}

/* ── helpers ──────────────────────────────────────────────────── */

function pushHistory(history: MediaItem[], ...items: MediaItem[]): MediaItem[] {
  let next = history
  for (const item of items) next = [...next.filter((entry) => entry.id !== item.id), item]
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}

function capUpcoming(list: MediaItem[]): MediaItem[] {
  return list.length > MAX_UPCOMING ? list.slice(0, MAX_UPCOMING) : list
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(list: readonly T[], rng: Rng = Math.random): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

function shuffledAvoidingFirst(list: MediaItem[], avoidId: string, rng: Rng): MediaItem[] {
  const out = shuffled(list, rng)
  if (out.length > 1 && out[0].id === avoidId) {
    const j = 1 + Math.min(out.length - 2, Math.floor(rng() * (out.length - 1)))
    const swap = out[0]
    out[0] = out[j]
    out[j] = swap
  }
  return out
}

function dropFromOrder(order: string[] | null, ...ids: string[]): string[] | null {
  return order ? order.filter((id) => !ids.includes(id)) : null
}

/* ── selectors ────────────────────────────────────────────────── */

export function isInQueue(state: QueueState, id: string): boolean {
  return state.nowPlaying?.id === id || state.upcoming.some((item) => item.id === id)
}

export function isUpcoming(state: QueueState, id: string): boolean {
  return state.upcoming.some((item) => item.id === id)
}

/** The stored snapshot for an id anywhere in the queue (current, upcoming or history). */
export function findInQueue(state: QueueState, id: string): MediaItem | null {
  if (state.nowPlaying?.id === id) return state.nowPlaying
  return state.upcoming.find((item) => item.id === id) ?? state.history.find((item) => item.id === id) ?? null
}

/** True when `playingId` is the queue's current item (so queue transport applies). */
export function inQueueMode(state: QueueState, playingId: string | null | undefined): boolean {
  return Boolean(playingId) && state.nowPlaying?.id === playingId
}

/** The viewer's pref ('auto' = on while playing from the queue, off otherwise). */
export function effectiveAutoplay(state: QueueState, playingId: string | null | undefined): boolean {
  if (state.autoplay === 'on') return true
  if (state.autoplay === 'off') return false
  return inQueueMode(state, playingId)
}

/** The next *different* item the queue would play, without changing state. */
export function peekNext(state: QueueState): { item: MediaItem; via: 'upcoming' | 'wrap' } | null {
  if (!state.nowPlaying) return null
  if (state.upcoming.length > 0) return { item: state.upcoming[0], via: 'upcoming' }
  if (state.repeat === 'all' && state.history.length > 0) return { item: state.history[0], via: 'wrap' }
  return null
}

export function queuePosition(state: QueueState): { index: number; total: number } {
  if (!state.nowPlaying) return { index: 0, total: 0 }
  return { index: state.history.length + 1, total: state.history.length + 1 + state.upcoming.length }
}

/** Ids in play order (now playing first) — what "save as collection" stores. */
export function queueIds(state: QueueState): string[] {
  return [...(state.nowPlaying ? [state.nowPlaying.id] : []), ...state.upcoming.map((item) => item.id)]
}

export function queueSize(state: QueueState): number {
  return (state.nowPlaying ? 1 : 0) + state.upcoming.length
}

/* ── mutations ────────────────────────────────────────────────── */

export type EnqueueOutcome = 'added' | 'moved' | 'already' | 'playing' | 'full' | 'invalid'
export interface EnqueueResult {
  state: QueueState
  outcome: EnqueueOutcome
}

/**
 * Add an item after the current one ('next') or at the end ('last').
 * `anchor` is the item the viewer is on right now; when the queue is empty it
 * becomes the now-playing entry so the queue starts from what they are watching.
 */
export function enqueue(state: QueueState, raw: MediaItem, where: 'last' | 'next', anchor?: MediaItem | null): EnqueueResult {
  const item = trimItem(raw)
  if (!item) return { state, outcome: 'invalid' }
  let current = state
  if (!current.nowPlaying) {
    const base = anchor ? trimItem(anchor) : null
    if (!base || base.id === item.id) return { state: { ...current, nowPlaying: item, history: [], upcoming: [], order: null }, outcome: 'playing' }
    current = { ...current, nowPlaying: base, history: [], upcoming: [], order: null }
  }
  if (current.nowPlaying?.id === item.id) return { state: current, outcome: current === state ? 'already' : 'added' }
  const existing = current.upcoming.findIndex((entry) => entry.id === item.id)
  if (existing >= 0) {
    if (where === 'next' && existing > 0) {
      const upcoming = [current.upcoming[existing], ...current.upcoming.filter((_, index) => index !== existing)]
      return { state: { ...current, upcoming, order: current.order ? [item.id, ...current.order.filter((id) => id !== item.id)] : null }, outcome: 'moved' }
    }
    return { state: current, outcome: current === state ? 'already' : 'added' }
  }
  if (current.upcoming.length >= MAX_UPCOMING) return { state: current, outcome: 'full' }
  const upcoming = where === 'next' ? [item, ...current.upcoming] : [...current.upcoming, item]
  const order = current.order ? (where === 'next' ? [item.id, ...current.order] : [...current.order, item.id]) : null
  return { state: { ...current, upcoming, order }, outcome: 'added' }
}

/** Replace the whole queue (e.g. "Play all" on a collection). Keeps repeat/autoplay prefs. */
export function startFrom(state: QueueState, rawItems: MediaItem[], rng: Rng = Math.random): QueueState {
  const seen = new Set<string>()
  const items: MediaItem[] = []
  for (const raw of rawItems) {
    const item = trimItem(raw)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
    if (items.length > MAX_UPCOMING) break
  }
  if (items.length === 0) return clear(state, 'all')
  const [head, ...rest] = items
  const base: QueueState = { ...state, nowPlaying: head, upcoming: rest, history: [], order: null }
  return state.shuffle ? { ...base, order: rest.map((item) => item.id), upcoming: shuffled(rest, rng) } : base
}

export function removeUpcoming(state: QueueState, id: string): QueueState {
  if (!state.upcoming.some((item) => item.id === id)) return state
  return { ...state, upcoming: state.upcoming.filter((item) => item.id !== id), order: dropFromOrder(state.order, id) }
}

/** Move an upcoming item to `toIndex` (clamped) within the upcoming list. */
export function moveUpcoming(state: QueueState, id: string, toIndex: number): QueueState {
  const from = state.upcoming.findIndex((item) => item.id === id)
  if (from < 0) return state
  const target = Math.max(0, Math.min(state.upcoming.length - 1, Math.trunc(toIndex)))
  if (target === from) return state
  const upcoming = state.upcoming.slice()
  const [moved] = upcoming.splice(from, 1)
  upcoming.splice(target, 0, moved)
  return { ...state, upcoming }
}

export function moveUpcomingBy(state: QueueState, id: string, delta: number): QueueState {
  const from = state.upcoming.findIndex((item) => item.id === id)
  return from < 0 ? state : moveUpcoming(state, id, from + delta)
}

/** Apply a full drag-and-drop ordering of upcoming ids (unknown ids ignored, missing ones kept at the end). */
export function setUpcomingOrder(state: QueueState, ids: readonly string[]): QueueState {
  const byId = new Map(state.upcoming.map((item) => [item.id, item]))
  const ordered: MediaItem[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (item) {
      ordered.push(item)
      byId.delete(id)
    }
  }
  const upcoming = [...ordered, ...byId.values()]
  const changed = upcoming.some((item, index) => item !== state.upcoming[index])
  return changed ? { ...state, upcoming } : state
}

export function setShuffle(state: QueueState, on: boolean, rng: Rng = Math.random): QueueState {
  if (on === state.shuffle) return state
  if (on) {
    return { ...state, shuffle: true, order: state.upcoming.map((item) => item.id), upcoming: shuffled(state.upcoming, rng) }
  }
  const byId = new Map(state.upcoming.map((item) => [item.id, item]))
  const restored: MediaItem[] = []
  for (const id of state.order ?? []) {
    const item = byId.get(id)
    if (item) {
      restored.push(item)
      byId.delete(id)
    }
  }
  return { ...state, shuffle: false, order: null, upcoming: [...restored, ...byId.values()] }
}

export function setRepeat(state: QueueState, repeat: RepeatMode): QueueState {
  return repeat === state.repeat ? state : { ...state, repeat }
}

export function cycleRepeat(state: QueueState): QueueState {
  return setRepeat(state, state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off')
}

export function setAutoplay(state: QueueState, autoplay: AutoplayPref): QueueState {
  return autoplay === state.autoplay ? state : { ...state, autoplay }
}

/** 'upcoming' keeps the current item; 'all' empties the queue (prefs are kept). */
export function clear(state: QueueState, scope: 'upcoming' | 'all'): QueueState {
  if (scope === 'upcoming') return state.upcoming.length ? { ...state, upcoming: [], order: null } : state
  return { ...emptyQueue(), repeat: state.repeat, shuffle: state.shuffle, autoplay: state.autoplay }
}

export function clearHistory(state: QueueState): QueueState {
  return state.history.length ? { ...state, history: [] } : state
}

/* ── stepping ─────────────────────────────────────────────────── */

export type StepOutcome = 'moved' | 'replay' | 'wrapped' | 'end' | 'start' | 'empty'
export interface StepResult {
  state: QueueState
  item: MediaItem | null
  outcome: StepOutcome
}

/**
 * Advance to the next item. `auto` (a video ended on its own) honours
 * repeat-one by replaying; a manual "next" always moves on, like Spotify.
 * At the end of the queue: repeat-all wraps (reshuffling when shuffle is on);
 * otherwise the state is unchanged and `outcome` is 'end'.
 */
export function next(state: QueueState, reason: 'manual' | 'auto', rng: Rng = Math.random): StepResult {
  const current = state.nowPlaying
  if (!current) return { state, item: null, outcome: 'empty' }
  if (reason === 'auto' && state.repeat === 'one') return { state, item: current, outcome: 'replay' }
  if (state.upcoming.length > 0) {
    const [head, ...rest] = state.upcoming
    return {
      state: { ...state, nowPlaying: head, upcoming: rest, history: pushHistory(state.history, current), order: dropFromOrder(state.order, head.id) },
      item: head,
      outcome: 'moved',
    }
  }
  if (state.repeat === 'all') {
    const cycle = [...state.history.filter((entry) => entry.id !== current.id), current]
    if (cycle.length === 1) return { state, item: current, outcome: 'replay' }
    const ordered = state.shuffle ? shuffledAvoidingFirst(cycle, current.id, rng) : cycle
    const [head, ...rest] = ordered
    return {
      state: { ...state, nowPlaying: head, upcoming: rest, history: [], order: state.shuffle ? cycle.filter((entry) => entry.id !== head.id).map((entry) => entry.id) : null },
      item: head,
      outcome: 'wrapped',
    }
  }
  return { state, item: null, outcome: 'end' }
}

/** Step back to the previously played item (the current one returns to the front of upcoming). */
export function previous(state: QueueState): StepResult {
  const current = state.nowPlaying
  if (!current) return { state, item: null, outcome: 'empty' }
  if (state.history.length === 0) return { state, item: null, outcome: 'start' }
  const target = state.history[state.history.length - 1]
  return {
    state: {
      ...state,
      nowPlaying: target,
      history: state.history.slice(0, -1),
      upcoming: capUpcoming([current, ...state.upcoming]),
      order: state.order ? [current.id, ...state.order] : null,
    },
    item: target,
    outcome: 'moved',
  }
}

/** Jump straight to an item already in the queue (upcoming or history). */
export function jumpTo(state: QueueState, id: string): StepResult {
  const current = state.nowPlaying
  if (!current) return { state, item: null, outcome: 'empty' }
  if (current.id === id) return { state, item: current, outcome: 'replay' }
  const upIndex = state.upcoming.findIndex((item) => item.id === id)
  if (upIndex >= 0) {
    const target = state.upcoming[upIndex]
    const skipped = state.upcoming.slice(0, upIndex)
    return {
      state: {
        ...state,
        nowPlaying: target,
        upcoming: state.upcoming.slice(upIndex + 1),
        history: pushHistory(state.history, current, ...skipped),
        order: dropFromOrder(state.order, target.id, ...skipped.map((item) => item.id)),
      },
      item: target,
      outcome: 'moved',
    }
  }
  const histIndex = state.history.findIndex((item) => item.id === id)
  if (histIndex >= 0) {
    const target = state.history[histIndex]
    const after = state.history.slice(histIndex + 1)
    return {
      state: {
        ...state,
        nowPlaying: target,
        history: state.history.slice(0, histIndex),
        upcoming: capUpcoming([...after, current, ...state.upcoming]),
        order: state.order ? [...after.map((item) => item.id), current.id, ...state.order] : null,
      },
      item: target,
      outcome: 'moved',
    }
  }
  return { state, item: null, outcome: 'empty' }
}

/* ── persistence shape ────────────────────────────────────────── */

export function serializeQueue(state: QueueState): string {
  return JSON.stringify(state)
}

/** Parse + sanitise stored data. Anything malformed degrades to an empty queue. */
export function parseQueue(raw: unknown): QueueState {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return emptyQueue()
    }
  }
  if (!isRecord(data) || data.v !== QUEUE_VERSION) return emptyQueue()
  const seen = new Set<string>()
  const nowPlaying = trimItem(data.nowPlaying)
  if (nowPlaying) seen.add(nowPlaying.id)
  const upcoming: MediaItem[] = []
  if (Array.isArray(data.upcoming)) {
    for (const entry of data.upcoming) {
      const item = trimItem(entry)
      if (!item || seen.has(item.id)) continue
      seen.add(item.id)
      upcoming.push(item)
      if (upcoming.length >= MAX_UPCOMING) break
    }
  }
  const history: MediaItem[] = []
  if (Array.isArray(data.history)) {
    const historySeen = new Set<string>()
    for (const entry of data.history) {
      const item = trimItem(entry)
      if (!item || historySeen.has(item.id)) continue
      historySeen.add(item.id)
      history.push(item)
    }
  }
  const upcomingIds = new Set(upcoming.map((item) => item.id))
  const order = Array.isArray(data.order) ? data.order.filter((id): id is string => typeof id === 'string' && upcomingIds.has(id)) : null
  const shuffle = data.shuffle === true
  return {
    v: QUEUE_VERSION,
    // A queue without a current item has nothing to play; drop orphans.
    nowPlaying,
    upcoming: nowPlaying ? upcoming : [],
    history: nowPlaying ? history.slice(-MAX_HISTORY).filter((item) => item.id !== nowPlaying.id) : [],
    repeat: data.repeat === 'all' || data.repeat === 'one' ? data.repeat : 'off',
    shuffle,
    autoplay: data.autoplay === 'on' || data.autoplay === 'off' ? data.autoplay : 'auto',
    order: shuffle && nowPlaying ? (order ?? upcoming.map((item) => item.id)) : null,
  }
}
