/**
 * Related-creator scoring and "elsewhere" link extraction.
 *
 * Pure logic plus two small public-profile fetchers (Bluesky, Mastodon). Design rules:
 *  - `related` is derived only from public tag overlap between posts; no identity inference.
 *  - `elsewhere` lists ONLY links an account published itself (registry entries the product
 *    owner supplied, or a Bluesky/Mastodon bio / verified profile field). Two accounts are never
 *    linked because they look alike. Link-in-bio pages are surfaced as links and never fetched.
 *  - Every URL passes the SSRF policy in `net-safe.ts` before it is surfaced or fetched.
 */
import type { CreatorRegistryEntry } from './creator-registry.js'
import { assertPublicHttpUrl, safeFetch } from './net-safe.js'
import {
  canonicalCreator, isEligibleScopedItem, proxiedMediaUrl, safeProviderMediaUrl, sanitizeProviderItem,
  type RedgifsItem,
} from './redgifs.js'

/* ── Related creators ── */

/** Tags that describe the whole catalog rather than a niche; never used to relate creators. */
export const GENERIC_TAGS = new Set([
  'gay', 'male', 'men', 'man', 'guy', 'guys', 'boy', 'boys', 'video', 'videos', 'gif', 'gifs', 'porn', 'sex',
  'nsfw', 'hot', 'sexy', 'hd', '4k', '1080p', 'real', 'gaysex', 'gayporn', 'gaymale', 'lgbt', 'lgbtq', 'homemade',
  'amateur', 'onlyfans', 'redgifs', 'new', 'trending', 'fyp',
])

export const normalizeTag = (tag: string): string => tag.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, ' ')

export const isGenericTag = (tag: string): boolean => {
  const t = normalizeTag(tag)
  return t.length < 3 || t.length > 32 || GENERIC_TAGS.has(t.replace(/[\s_-]+/g, ''))
}

export type TagWeight = { tag: string; weight: number }

/**
 * TF-IDF-ish tag profile. tf = share of the creator's posts carrying the tag;
 * idf (optional) comes from `background`, the share of a wider pool carrying it, so a tag that
 * is on everything counts for less than a distinctive one. Generic tags are dropped.
 */
export function buildTagProfile(
  items: Array<Pick<RedgifsItem, 'tags'>>,
  background?: Map<string, number>,
): TagWeight[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const seen = new Set<string>()
    for (const raw of item.tags || []) {
      const tag = normalizeTag(raw)
      if (!tag || isGenericTag(tag) || seen.has(tag)) continue
      seen.add(tag)
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }
  const total = Math.max(1, items.length)
  return [...counts.entries()]
    .map(([tag, n]) => {
      const tf = n / total
      const idf = background ? Math.log(1 + 1 / ((background.get(tag) ?? 0) + 0.05)) : 1
      return { tag, weight: Number((tf * idf).toFixed(6)) }
    })
    .sort((a, b) => b.weight - a.weight || a.tag.localeCompare(b.tag))
}

/** The 2-3 heaviest profile tags to query the provider with. */
export function pickQueryTags(profile: TagWeight[], max = 3): string[] {
  return profile.slice(0, Math.max(0, max)).map((entry) => entry.tag)
}

/** Share of pool items carrying each (non-generic) tag: the background for `buildTagProfile`. */
export function backgroundFrequency(items: Array<Pick<RedgifsItem, 'tags'>>): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of items) {
    for (const tag of new Set((item.tags || []).map(normalizeTag))) {
      if (tag && !isGenericTag(tag)) map.set(tag, (map.get(tag) || 0) + 1)
    }
  }
  const total = Math.max(1, items.length)
  for (const [tag, n] of map) map.set(tag, n / total)
  return map
}

export type RelatedCreator = {
  handle: string
  displayName: string
  platform: string
  avatar?: string
  score: number
  reason: string
  sharedTags: string[]
}

export const reasonText = (sharedTags: string[]): string =>
  sharedTags.length
    ? `Shares ${sharedTags.slice(0, 3).map((tag) => `#${tag.replace(/\s+/g, '')}`).join(', ')}`
    : 'Similar public posts'

const DAY_MS = 86_400_000
const itemTime = (item: RedgifsItem): number => {
  const value = Number(item.createDate) || 0
  return value > 1_000_000_000_000 ? value : value * 1000
}

export function recencyScore(newestMs: number, now = Date.now()): number {
  if (!newestMs) return 0
  return Math.exp(-Math.max(0, now - newestMs) / DAY_MS / 90)
}

/** Log-scaled engagement in 0..1 (likes + a fraction of views per post). */
export function engagementScore(items: RedgifsItem[]): number {
  if (!items.length) return 0
  const avg = items.reduce((sum, item) => sum + Math.max(0, item.likes || 0) + Math.max(0, item.views || 0) / 25, 0) / items.length
  return Math.min(1, Math.log10(1 + avg) / 4)
}

const playable = (item: RedgifsItem): boolean => Boolean(
  item.id && safeProviderMediaUrl(item.urls?.thumbnail || item.urls?.poster)
    && (safeProviderMediaUrl(item.urls?.hd) || safeProviderMediaUrl(item.urls?.sd)),
)

/**
 * Score creators found in tag-scoped search hits against `profile`.
 * Excludes `selfHandle`, ineligible items (tags/userName only) and items without playable media.
 */
export function rankRelated(
  pool: RedgifsItem[],
  profile: TagWeight[],
  selfHandle: string,
  limit = 12,
  now = Date.now(),
): RelatedCreator[] {
  const self = canonicalCreator(selfHandle)
  const weights = new Map(profile.map((entry) => [entry.tag, entry.weight]))
  const denominator = profile.slice(0, 8).reduce((sum, entry) => sum + entry.weight, 0) || 1
  const byCreator = new Map<string, { name: string; items: RedgifsItem[] }>()
  const seenIds = new Set<string>()
  for (const raw of pool) {
    const item = sanitizeProviderItem(raw)
    const name = (item.userName || '').trim()
    const key = canonicalCreator(name)
    if (!key || name === 'Public creator' || key === self) continue
    if (!isEligibleScopedItem({ userName: item.userName, tags: item.tags, niches: item.niches })) continue
    if (!playable(item) || seenIds.has(String(item.id))) continue
    seenIds.add(String(item.id))
    const entry = byCreator.get(key) || { name, items: [] }
    entry.items.push(item)
    byCreator.set(key, entry)
  }
  const out: RelatedCreator[] = []
  for (const { name, items } of byCreator.values()) {
    const tags = new Set(items.flatMap((item) => (item.tags || []).map(normalizeTag)))
    const sharedTags = [...tags]
      .filter((tag) => weights.has(tag))
      .sort((a, b) => (weights.get(b)! - weights.get(a)!) || a.localeCompare(b))
    if (!sharedTags.length) continue
    const overlap = Math.min(1, sharedTags.reduce((sum, tag) => sum + weights.get(tag)!, 0) / denominator)
    const newest = Math.max(...items.map(itemTime))
    const score = 0.6 * overlap + 0.2 * recencyScore(newest, now) + 0.2 * engagementScore(items)
    const lead = items[0]
    out.push({
      handle: name,
      displayName: name,
      platform: 'Redgifs',
      avatar: proxiedMediaUrl(safeProviderMediaUrl(lead.urls?.thumbnail || lead.urls?.poster)),
      score: Number(score.toFixed(3)),
      reason: reasonText(sharedTags),
      sharedTags: sharedTags.slice(0, 5),
    })
  }
  return out.sort((a, b) => b.score - a.score || a.handle.localeCompare(b.handle)).slice(0, Math.max(1, limit))
}

/* ── Elsewhere links ── */

export type ElsewhereLink = {
  platform: string
  handle: string
  url: string
  label: string
  /** True only for registry entries and Mastodon rel=me verified profile fields. */
  verified: boolean
  source: 'bio' | 'registry'
  /** True when Media Codex cannot browse the platform: the link just opens on the source. */
  linkOnly: boolean
}

export const MAX_ELSEWHERE = 12

type ParsedLink = { platform: string; handle: string; url: string; label: string; linkOnly: boolean }

const HANDLE_RE = /^[A-Za-z0-9_.-]{1,50}$/
const RESERVED = new Set([
  'i', 'home', 'search', 'intent', 'share', 'hashtag', 'explore', 'settings', 'login', 'signup', 'about', 'privacy',
  'tos', 'help', 'www', 'notifications', 'messages', 'compose', 'watch', 'users', 'user', 'u', 'r', 'post', 'posts',
])

/** Map one outbound URL to a known creator platform + handle. Returns null for anything else or unsafe. */
export function parseProfileLink(raw: string): ParsedLink | null {
  let url: URL
  try {
    url = assertPublicHttpUrl(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p) } catch { return p } })
  const first = parts[0] || ''
  const ok = (h: string) => Boolean(h) && !RESERVED.has(h.toLowerCase())
  const make = (platform: string, handle: string, href: string, linkOnly: boolean, label = platform): ParsedLink | null =>
    HANDLE_RE.test(handle) ? { platform, handle, url: href, label: `${label} · @${handle}`, linkOnly } : null
  const plain = (platform: string, handle: string, base: string, linkOnly: boolean) =>
    make(platform, handle, `${base}/${encodeURIComponent(handle)}`, linkOnly)

  if (host === 'redgifs.com') {
    return first.toLowerCase() === 'users' && parts[1] ? plain('Redgifs', parts[1].toLowerCase(), 'https://www.redgifs.com/users', false) : null
  }
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    return ok(first) ? plain('X', first, 'https://x.com', true) : null
  }
  if (host === 'tumblr.com') {
    const h = (first.toLowerCase() === 'blog' ? parts[1] : first) || ''
    return ok(h) ? make('Tumblr', h.toLowerCase(), `https://${h.toLowerCase()}.tumblr.com`, true) : null
  }
  if (host.endsWith('.tumblr.com')) {
    const h = host.slice(0, -'.tumblr.com'.length)
    return ok(h) && !h.includes('.') ? make('Tumblr', h, `https://${h}.tumblr.com`, true) : null
  }
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    const kind = first.toLowerCase()
    return (kind === 'user' || kind === 'u') && parts[1] ? plain('Reddit', parts[1], 'https://www.reddit.com/user', true) : null
  }
  if (host === 'onlyfans.com') return ok(first) && !/^\d+$/.test(first) ? plain('OnlyFans', first, 'https://onlyfans.com', true) : null
  if (host === 'fansly.com') return ok(first) ? plain('Fansly', first, 'https://fansly.com', true) : null
  if (host === 'justfor.fans' || host === 'justforfans.com') return ok(first) ? plain('JustFor.Fans', first, 'https://justfor.fans', true) : null
  if (host === 'linktr.ee') return ok(first) ? make('Linktree', first, `https://linktr.ee/${encodeURIComponent(first)}`, true, 'Link in bio (Linktree)') : null
  if (host === 'beacons.ai') return ok(first) ? make('Beacons', first, `https://beacons.ai/${encodeURIComponent(first)}`, true, 'Link in bio (Beacons)') : null
  if (host === 'allmylinks.com') return ok(first) ? make('AllMyLinks', first, `https://allmylinks.com/${encodeURIComponent(first)}`, true, 'Link in bio (AllMyLinks)') : null
  if (host === 'bsky.app') {
    return first.toLowerCase() === 'profile' && parts[1]
      ? make('Bluesky', parts[1].toLowerCase(), `https://bsky.app/profile/${encodeURIComponent(parts[1].toLowerCase())}`, true)
      : null
  }
  return null
}

const BARE_HOSTS = 'redgifs\\.com|x\\.com|twitter\\.com|[a-z0-9-]+\\.tumblr\\.com|tumblr\\.com|reddit\\.com|onlyfans\\.com|fansly\\.com|justfor\\.fans|justforfans\\.com|linktr\\.ee|beacons\\.ai|allmylinks\\.com|bsky\\.app'
const URL_RE = new RegExp(`(?:https?:\\/\\/[^\\s<>"'\\])]+)|(?:\\b(?:www\\.)?(?:${BARE_HOSTS})\\/[^\\s<>"'\\])]+)`, 'gi')

/** URLs written in free text (bio/notes); bare `linktr.ee/x` style mentions on known hosts count too. */
export function extractUrls(text: string): string[] {
  const out: string[] = []
  for (const match of (text || '').matchAll(URL_RE)) {
    const cleaned = match[0].replace(/[.,;:!?)\]]+$/, '')
    out.push(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`)
  }
  return out
}

/** Dedupe by platform+handle (verified/registry win), cap, stable order: verified first. */
export function dedupeLinks(links: ElsewhereLink[], cap = MAX_ELSEWHERE): ElsewhereLink[] {
  const map = new Map<string, ElsewhereLink>()
  for (const link of links) {
    const key = `${link.platform}:${link.handle.toLowerCase()}`
    const prev = map.get(key)
    if (!prev) map.set(key, { ...link })
    else {
      prev.verified = prev.verified || link.verified
      if (link.source === 'registry') prev.source = 'registry'
    }
  }
  return [...map.values()]
    .map((link, index) => ({ link, index }))
    .sort((a, b) => Number(b.link.verified) - Number(a.link.verified) || a.index - b.index)
    .map((entry) => entry.link)
    .slice(0, cap)
}

/** Links found in free text. Not verified: the text is self-published but not cryptographically tied to the target. */
export function linksFromText(text: string, verified = false, source: ElsewhereLink['source'] = 'bio'): ElsewhereLink[] {
  const out: ElsewhereLink[] = []
  for (const raw of extractUrls(text)) {
    const parsed = parseProfileLink(raw)
    if (parsed) out.push({ ...parsed, verified, source })
  }
  return out
}

/** Registry-published handles (supplied by the product owner) become verified links. */
export function registryLinks(entries: CreatorRegistryEntry[], selfHandle: string): ElsewhereLink[] {
  const self = canonicalCreator(selfHandle)
  const out: ElsewhereLink[] = []
  for (const entry of entries) {
    for (const h of entry.handles.redgifs || []) {
      if (canonicalCreator(h) === self) continue
      const p = parseProfileLink(`https://www.redgifs.com/users/${h}`)
      if (p) out.push({ ...p, verified: true, source: 'registry' })
    }
    for (const h of entry.handles.x || []) {
      const p = parseProfileLink(`https://x.com/${h.replace(/^@/, '')}`)
      if (p) out.push({ ...p, verified: true, source: 'registry' })
    }
  }
  return out
}

/* ── Public profile fetchers (Bluesky, Mastodon) ── */

const BSKY_API = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile'
const BSKY_HANDLE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/
const MASTODON_ACCT = /^([A-Za-z0-9_.-]{1,64})@((?:[a-z0-9-]+\.)+[a-z]{2,})$/i

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await safeFetch(url, { timeoutMs, maxBytes: 256 * 1024, headers: { Accept: 'application/json' } })
  if (res.status !== 200 || res.truncated) throw new Error(`profile_fetch_${res.status}`)
  return JSON.parse(new TextDecoder().decode(res.body))
}

/** Outbound links in the creator's own public Bluesky bio. Throws on transport failure. */
export async function fetchBlueskyLinks(handle: string, timeoutMs = 4_000): Promise<ElsewhereLink[]> {
  const actor = handle.replace(/^@/, '').toLowerCase()
  if (!BSKY_HANDLE.test(actor)) return []
  const body = await fetchJson(`${BSKY_API}?actor=${encodeURIComponent(actor)}`, timeoutMs) as { description?: unknown; handle?: unknown }
  const own = typeof body.handle === 'string' ? parseProfileLink(`https://bsky.app/profile/${body.handle}`) : null
  const links = linksFromText(typeof body.description === 'string' ? body.description : '')
  return own ? [{ ...own, verified: false, source: 'bio' as const }, ...links] : links
}

const decodeEntities = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const stripHtml = (html: string) => decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
const hrefs = (html: string) => [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]))

/** Links from a Mastodon account payload: note + profile fields; verified only when `verified_at` is set on the field. */
export function linksFromMastodonAccount(account: unknown): ElsewhereLink[] {
  const a = (account && typeof account === 'object' ? account : {}) as { note?: unknown; fields?: unknown }
  const out: ElsewhereLink[] = []
  if (typeof a.note === 'string') {
    for (const h of [...hrefs(a.note), ...extractUrls(stripHtml(a.note))]) {
      const p = parseProfileLink(h)
      if (p) out.push({ ...p, verified: false, source: 'bio' })
    }
  }
  for (const field of Array.isArray(a.fields) ? a.fields : []) {
    const f = field as { value?: unknown; verified_at?: unknown }
    if (typeof f?.value !== 'string') continue
    const verified = typeof f.verified_at === 'string' && f.verified_at.length > 0
    for (const h of [...hrefs(f.value), ...extractUrls(stripHtml(f.value))]) {
      const p = parseProfileLink(h)
      if (p) out.push({ ...p, verified, source: 'bio' })
    }
  }
  return out
}

/** `user@instance.tld` -> links from that instance's public account lookup. Throws on transport failure. */
export async function fetchMastodonLinks(acct: string, timeoutMs = 4_000): Promise<ElsewhereLink[]> {
  const m = MASTODON_ACCT.exec(acct.replace(/^@/, '').trim())
  if (!m) return []
  const instance = m[2].toLowerCase()
  assertPublicHttpUrl(`https://${instance}/`)
  const body = await fetchJson(`https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(m[1])}`, timeoutMs)
  return linksFromMastodonAccount(body)
}
