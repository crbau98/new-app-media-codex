/**
 * Platform registry + profile-link parsing (pure: no React, no DOM, no network).
 *
 * Media Codex never scrapes, embeds or rehosts paywalled content. This module only answers
 * "which platform is this profile link, what is the handle, and what is its canonical public
 * URL?" so the UI can send people OUT to a creator's own page (where the creator earns the
 * traffic and the revenue) and remember links the user already knows.
 *
 * Safety rules enforced by `safeHttpUrl` for every URL that is parsed, saved or rendered:
 * http(s) only, no credentials, no IP literals / single-label / internal hosts, default ports
 * only, no control characters, bounded length.
 */

export type PlatformKind = 'playable' | 'public-link' | 'subscription' | 'link-in-bio'

export type PlatformId =
  | 'redgifs' | 'x' | 'bluesky' | 'mastodon' | 'tumblr' | 'reddit' | 'peertube' | 'lemmy'
  | 'instagram' | 'tiktok' | 'youtube' | 'twitch' | 'threads' | 'pornhub'
  | 'onlyfans' | 'fansly' | 'justforfans' | 'fanvue' | 'patreon'
  | 'linktree' | 'beacons' | 'allmylinks' | 'solo' | 'biolink'

/** `generic` = a safe http(s) link on a host the registry does not know. */
export type AnyPlatformId = PlatformId | 'generic'

export const MAX_INPUT_LENGTH = 2048

interface UrlContext {
  url: URL
  /** Lowercase hostname without a leading `www.` / `m.` / `mobile.`. */
  host: string
  /** Decoded, non-empty path segments. */
  segments: string[]
}

interface FromUrlResult {
  handle: string
  /** Canonical URL when it cannot be rebuilt from the handle alone. */
  url?: string
}

export interface PlatformDef {
  id: PlatformId
  label: string
  kind: PlatformKind
  /** 1-3 character monogram shown in the accent tile (brand-neutral: no logos are bundled). */
  mark: string
  /** "r g b" triplet; only ever used as a tint behind ink-coloured text. */
  accent: string
  /** Exact hostnames (after stripping www./m./mobile.). Fediverse platforms have none. */
  hosts: readonly string[]
  /** Subdomain wildcards such as `.tumblr.com`. */
  hostSuffixes?: readonly string[]
  /** Lowercased, punctuation-free names the APIs use for this platform. */
  aliases: readonly string[]
  /** True when the handle is `user@instance` (host-dynamic platforms). */
  federated?: boolean
  handleRe: RegExp
  fromUrl: (ctx: UrlContext) => FromUrlResult | null
  profileUrl: (handle: string) => string
  /** Visible handle text. Defaults to `@handle`. */
  display?: (handle: string) => string
  /** Case-sensitive handles (YouTube channel ids) keep their case. */
  keepCase?: (handle: string) => boolean
}

/* ───────── URL safety ───────── */

const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa', '.corp', '.intranet', '.private', '.onion']
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal'])
const TLD_RE = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/
const LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/

/** True for names that may be dialled: 2+ labels, alphabetic TLD (so never an IP), not an internal suffix. */
export function isPublicHostname(hostnameRaw: string): boolean {
  const host = hostnameRaw.toLowerCase().replace(/\.$/, '')
  if (!host || host.length > 253 || host.includes(':') || host.startsWith('[')) return false
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false
  const labels = host.split('.')
  if (labels.length < 2) return false
  if (!TLD_RE.test(labels[labels.length - 1])) return false
  return labels.every((label) => LABEL_RE.test(label))
}

export type SafeUrlFailure = 'unsupported-scheme' | 'credentials' | 'private-host' | 'invalid-url' | 'too-long'

export function safeHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: SafeUrlFailure } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { ok: false, reason: 'invalid-url' }
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, reason: 'too-long' }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s\\]/.test(text)) return { ok: false, reason: 'invalid-url' }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'unsupported-scheme' }
  if (url.username || url.password) return { ok: false, reason: 'credentials' }
  if (!isPublicHostname(url.hostname)) return { ok: false, reason: 'private-host' }
  if (url.port !== '') return { ok: false, reason: 'private-host' }
  return { ok: true, url }
}

/** Re-validate a URL that arrived from an API payload or storage before it is used as an href. */
export function safeOutboundUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const result = safeHttpUrl(raw)
  return result.ok ? result.url.toString() : null
}

/** Outbound-link attributes shared by every external anchor in the app's creator UI. */
export const OUTBOUND_REL = 'noopener noreferrer nofollow'

/* ───────── Registry ───────── */

const RESERVED = new Set([
  'login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'logout', 'home', 'search', 'explore', 'discover',
  'about', 'privacy', 'terms', 'tos', 'help', 'support', 'settings', 'contact', 'legal', 'careers', 'jobs', 'press', 'api',
  'apps', 'download', 'downloads', 'notifications', 'messages', 'compose', 'share', 'intent', 'hashtag', 'i', 'post',
  'posts', 'status', 'watch', 'live', 'trending', 'popular', 'categories', 'category', 'faq', 'dmca', '2257', 'cookies',
  'pricing', 'static', 'assets', 'embed', 'my', 'feed', 'lists', 'bookmarks', 'collections', 'subscriptions', 'checkout',
])

const stripAt = (value: string) => value.replace(/^@+/, '')
const lower = (value: string) => value.toLowerCase()
const first = (ctx: UrlContext) => ctx.segments[0] ?? ''

/** `/{handle}` style profile paths on a single known host. */
const topLevel = (extraReserved: readonly string[] = []) => {
  const blocked = new Set([...RESERVED, ...extraReserved])
  return (ctx: UrlContext): FromUrlResult | null => {
    const head = first(ctx)
    return head && !blocked.has(lower(head)) ? { handle: head } : null
  }
}

const atHandle = (ctx: UrlContext): FromUrlResult | null => {
  const head = first(ctx)
  return head.startsWith('@') && head.length > 1 ? { handle: stripAt(head) } : null
}

const YT_CHANNEL = /^UC[\w-]{22}$/

export const PLATFORMS: readonly PlatformDef[] = [
  /* playable: the only platform whose public catalog the app can browse */
  {
    id: 'redgifs', label: 'Redgifs', kind: 'playable', mark: 'RG', accent: '255 106 122',
    hosts: ['redgifs.com'], aliases: ['redgifs'],
    handleRe: /^[a-z0-9][a-z0-9_.-]{0,49}$/,
    fromUrl: (ctx) => (lower(first(ctx)) === 'users' && ctx.segments[1] ? { handle: ctx.segments[1] } : null),
    profileUrl: (handle) => `https://www.redgifs.com/users/${encodeURIComponent(handle)}`,
  },

  /* public posts, link-out */
  {
    id: 'x', label: 'X', kind: 'public-link', mark: 'X', accent: '176 172 190',
    hosts: ['x.com', 'twitter.com'], aliases: ['x', 'twitter', 'xtwitter', 'xcom'],
    handleRe: /^[a-z0-9_]{1,15}$/,
    fromUrl: topLevel(['i', 'intent', 'hashtag', 'share', 'who_to_follow', 'communities', 'topics', 'premium', 'grok']),
    profileUrl: (handle) => `https://x.com/${encodeURIComponent(handle)}`,
  },
  {
    id: 'bluesky', label: 'Bluesky', kind: 'public-link', mark: 'Bs', accent: '66 158 255',
    hosts: ['bsky.app'], aliases: ['bluesky', 'bsky', 'bskyapp'],
    handleRe: /^(?:did:[a-z0-9]+:[a-z0-9._:%-]{1,200}|(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62})$/,
    fromUrl: (ctx) => (lower(first(ctx)) === 'profile' && ctx.segments[1] ? { handle: ctx.segments[1] } : null),
    profileUrl: (handle) => `https://bsky.app/profile/${handle}`,
  },
  {
    id: 'mastodon', label: 'Mastodon', kind: 'public-link', mark: 'Ma', accent: '134 122 255', federated: true,
    hosts: [], aliases: ['mastodon', 'fediverse'],
    handleRe: /^[a-z0-9_.-]{1,64}@[a-z0-9.-]+$/,
    fromUrl: () => null,
    profileUrl: (handle) => {
      const [user, instance] = handle.split('@')
      return `https://${instance}/@${user}`
    },
    display: (handle) => `@${handle}`,
  },
  {
    id: 'tumblr', label: 'Tumblr', kind: 'public-link', mark: 'Tb', accent: '96 140 200',
    hosts: ['tumblr.com'], hostSuffixes: ['.tumblr.com'], aliases: ['tumblr'],
    handleRe: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
    fromUrl: (ctx) => {
      if (ctx.host === 'tumblr.com') {
        const head = lower(first(ctx))
        const name = head === 'blog' ? ctx.segments[1] : first(ctx)
        const reserved = new Set([...RESERVED, 'dashboard', 'tagged', 'likes', 'following', 'followers', 'blog', 'policy', 'docs', 'new', 'reblog', 'privacy'])
        return name && !reserved.has(lower(name)) ? { handle: name } : null
      }
      const sub = ctx.host.slice(0, -'.tumblr.com'.length)
      const blockedSubs = new Set(['www', 'api', 'assets', 'static', 'media', 'at', 'href', 't', 'staff', 'engineering', 'help', 'support', 'dashboard', 'vtt', 'px'])
      return sub && !sub.includes('.') && !blockedSubs.has(sub) ? { handle: sub } : null
    },
    profileUrl: (handle) => `https://${handle}.tumblr.com/`,
  },
  {
    id: 'reddit', label: 'Reddit', kind: 'public-link', mark: 'Rd', accent: '255 117 72',
    hosts: ['reddit.com'], hostSuffixes: ['.reddit.com'], aliases: ['reddit'],
    handleRe: /^[a-z0-9_-]{3,32}$/,
    fromUrl: (ctx) => {
      const kind = lower(first(ctx))
      return (kind === 'user' || kind === 'u') && ctx.segments[1] ? { handle: ctx.segments[1] } : null
    },
    profileUrl: (handle) => `https://www.reddit.com/user/${encodeURIComponent(handle)}`,
    display: (handle) => `u/${handle}`,
  },
  {
    id: 'peertube', label: 'PeerTube', kind: 'public-link', mark: 'Pt', accent: '255 168 80', federated: true,
    hosts: [], aliases: ['peertube'],
    handleRe: /^[a-z0-9_.-]{1,64}@[a-z0-9.-]+$/,
    fromUrl: () => null,
    profileUrl: (handle) => {
      const [name, instance] = handle.split('@')
      return `https://${instance}/accounts/${name}`
    },
  },
  {
    id: 'lemmy', label: 'Lemmy', kind: 'public-link', mark: 'Lm', accent: '70 206 140', federated: true,
    hosts: [], aliases: ['lemmy'],
    handleRe: /^[a-z0-9_.-]{1,64}@[a-z0-9.-]+$/,
    fromUrl: () => null,
    profileUrl: (handle) => {
      const [name, instance] = handle.split('@')
      return `https://${instance}/u/${name}`
    },
  },
  {
    id: 'instagram', label: 'Instagram', kind: 'public-link', mark: 'IG', accent: '236 92 160',
    hosts: ['instagram.com', 'instagr.am'], aliases: ['instagram'],
    handleRe: /^[a-z0-9._]{1,30}$/,
    fromUrl: topLevel(['p', 'reel', 'reels', 'stories', 'accounts', 'direct', 'tv', 'directory', 'web', 'challenge', 'emails', 'oauth', 'locations', 'tags', 'developer']),
    profileUrl: (handle) => `https://www.instagram.com/${encodeURIComponent(handle)}/`,
  },
  {
    id: 'tiktok', label: 'TikTok', kind: 'public-link', mark: 'TT', accent: '60 214 222',
    hosts: ['tiktok.com'], aliases: ['tiktok'],
    handleRe: /^[a-z0-9._]{2,24}$/,
    fromUrl: atHandle,
    profileUrl: (handle) => `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
  },
  {
    id: 'youtube', label: 'YouTube', kind: 'public-link', mark: 'YT', accent: '255 84 84',
    hosts: ['youtube.com'], aliases: ['youtube'],
    handleRe: /^(?:UC[\w-]{22}|[a-z0-9._-]{3,30})$/i,
    fromUrl: (ctx) => {
      const head = first(ctx)
      if (head.startsWith('@') && head.length > 1) return { handle: stripAt(head) }
      if (lower(head) === 'channel' && YT_CHANNEL.test(ctx.segments[1] ?? '')) return { handle: ctx.segments[1] }
      return null
    },
    profileUrl: (handle) => (YT_CHANNEL.test(handle) ? `https://www.youtube.com/channel/${handle}` : `https://www.youtube.com/@${encodeURIComponent(handle)}`),
    keepCase: (handle) => YT_CHANNEL.test(handle),
  },
  {
    id: 'twitch', label: 'Twitch', kind: 'public-link', mark: 'Tw', accent: '165 120 255',
    hosts: ['twitch.tv'], aliases: ['twitch'],
    handleRe: /^[a-z0-9_]{3,25}$/,
    fromUrl: topLevel(['directory', 'videos', 'p', 'downloads', 'turbo', 'wallet', 'friends', 'inventory', 'drops', 'store', 'team', 'popout', 'moderator', 'broadcast', 'dashboard']),
    profileUrl: (handle) => `https://www.twitch.tv/${encodeURIComponent(handle)}`,
  },
  {
    id: 'threads', label: 'Threads', kind: 'public-link', mark: 'Th', accent: '190 186 200',
    hosts: ['threads.net', 'threads.com'], aliases: ['threads'],
    handleRe: /^[a-z0-9._]{1,30}$/,
    fromUrl: atHandle,
    profileUrl: (handle) => `https://www.threads.com/@${encodeURIComponent(handle)}`,
  },
  {
    id: 'pornhub', label: 'Pornhub', kind: 'public-link', mark: 'PH', accent: '255 170 30',
    hosts: ['pornhub.com'], aliases: ['pornhub'],
    handleRe: /^[a-z0-9_.-]{2,50}$/,
    fromUrl: (ctx) => {
      const section = lower(first(ctx))
      const name = ctx.segments[1]
      if (!name || !['model', 'pornstar', 'users', 'channels'].includes(section)) return null
      return { handle: name, url: `https://www.pornhub.com/${section}/${encodeURIComponent(name)}` }
    },
    profileUrl: (handle) => `https://www.pornhub.com/model/${encodeURIComponent(handle)}`,
  },

  /* subscription: link-only, the creator's paywall stays intact */
  {
    id: 'onlyfans', label: 'OnlyFans', kind: 'subscription', mark: 'OF', accent: '0 176 240',
    hosts: ['onlyfans.com'], aliases: ['onlyfans'],
    handleRe: /^[a-z0-9][a-z0-9_.-]{2,49}$/,
    fromUrl: (ctx) => {
      const head = first(ctx)
      if (!head || RESERVED.has(lower(head)) || /^\d+$/.test(head)) return null
      return { handle: head }
    },
    profileUrl: (handle) => `https://onlyfans.com/${encodeURIComponent(handle)}`,
  },
  {
    id: 'fansly', label: 'Fansly', kind: 'subscription', mark: 'Fs', accent: '58 128 255',
    hosts: ['fansly.com'], aliases: ['fansly'],
    handleRe: /^[a-z0-9_.-]{3,30}$/,
    fromUrl: topLevel(),
    profileUrl: (handle) => `https://fansly.com/${encodeURIComponent(handle)}`,
  },
  {
    id: 'justforfans', label: 'JustFor.Fans', kind: 'subscription', mark: 'JFF', accent: '240 84 150',
    hosts: ['justfor.fans', 'justforfans.com'], aliases: ['justforfans', 'justforfansapp', 'jff'],
    handleRe: /^[a-z0-9_.-]{2,40}$/,
    fromUrl: topLevel(['blog', 'tags', 'models', 'videos']),
    profileUrl: (handle) => `https://justfor.fans/${encodeURIComponent(handle)}`,
  },
  {
    id: 'fanvue', label: 'Fanvue', kind: 'subscription', mark: 'Fv', accent: '150 100 255',
    hosts: ['fanvue.com'], aliases: ['fanvue'],
    handleRe: /^[a-z0-9_.-]{2,40}$/,
    fromUrl: topLevel(['signin', 'signup', 'creators', 'fans']),
    profileUrl: (handle) => `https://www.fanvue.com/${encodeURIComponent(handle)}`,
  },
  {
    id: 'patreon', label: 'Patreon', kind: 'subscription', mark: 'Pa', accent: '255 108 96',
    hosts: ['patreon.com'], aliases: ['patreon'],
    handleRe: /^[a-z0-9_-]{2,40}$/,
    fromUrl: (ctx) => {
      const head = first(ctx)
      const name = lower(head) === 'c' ? ctx.segments[1] : head
      const reserved = new Set([...RESERVED, 'user', 'join', 'c', 'collection', 'product', 'bepatron', 'pledges', 'creators', 'policy', 'legal', 'become-a-patron'])
      return name && !reserved.has(lower(name)) ? { handle: name } : null
    },
    profileUrl: (handle) => `https://www.patreon.com/${encodeURIComponent(handle)}`,
  },

  /* link-in-bio pages: surfaced as links, never fetched */
  {
    id: 'linktree', label: 'Linktree', kind: 'link-in-bio', mark: 'Lt', accent: '92 214 170',
    hosts: ['linktr.ee'], aliases: ['linktree', 'linktrees', 'linkinbiolinktree'],
    handleRe: /^[a-z0-9_.-]{2,40}$/,
    fromUrl: topLevel(['s', 'admin']),
    profileUrl: (handle) => `https://linktr.ee/${encodeURIComponent(handle)}`,
  },
  {
    id: 'beacons', label: 'Beacons', kind: 'link-in-bio', mark: 'Bc', accent: '110 220 190',
    hosts: ['beacons.ai'], aliases: ['beacons', 'beaconsai', 'linkinbiobeacons'],
    handleRe: /^[a-z0-9_.-]{2,40}$/,
    fromUrl: topLevel(['i']),
    profileUrl: (handle) => `https://beacons.ai/${encodeURIComponent(handle)}`,
  },
  {
    id: 'allmylinks', label: 'AllMyLinks', kind: 'link-in-bio', mark: 'Am', accent: '120 210 150',
    hosts: ['allmylinks.com'], aliases: ['allmylinks', 'linkinbioallmylinks'],
    handleRe: /^[a-z0-9_.-]{2,40}$/,
    fromUrl: topLevel(),
    profileUrl: (handle) => `https://allmylinks.com/${encodeURIComponent(handle)}`,
  },
  {
    id: 'solo', label: 'Solo.to', kind: 'link-in-bio', mark: 'So', accent: '100 200 210',
    hosts: ['solo.to'], aliases: ['soloto', 'solo'],
    handleRe: /^[a-z0-9_.-]{2,40}$/,
    fromUrl: topLevel(),
    profileUrl: (handle) => `https://solo.to/${encodeURIComponent(handle)}`,
  },
  {
    id: 'biolink', label: 'Bio.link', kind: 'link-in-bio', mark: 'Bl', accent: '130 200 120',
    hosts: ['bio.link'], aliases: ['biolink'],
    handleRe: /^[a-z0-9_.-]{2,40}$/,
    fromUrl: topLevel(),
    profileUrl: (handle) => `https://bio.link/${encodeURIComponent(handle)}`,
  },
]

const BY_ID = new Map<string, PlatformDef>(PLATFORMS.map((def) => [def.id, def]))

export function platformById(id: string | null | undefined): PlatformDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function platformKind(id: AnyPlatformId): PlatformKind | 'external' {
  return platformById(id)?.kind ?? 'external'
}

export function isSubscriptionPlatform(id: string | null | undefined): boolean {
  return platformById(id)?.kind === 'subscription'
}

export const PLATFORM_KIND_LABEL: Record<PlatformKind | 'external', string> = {
  playable: 'Public catalog',
  'public-link': 'Public profile',
  subscription: 'Subscription',
  'link-in-bio': 'Link in bio',
  external: 'Website',
}

/** The line shown wherever a subscription link appears. */
export const PAYWALL_NOTE = "Subscription content stays behind the creator's paywall."

const normName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Map a platform name used by an API ("Redgifs public profile", "X", "Link in bio (Linktree)")
 * to a registry id. Short aliases (<5 chars) must match exactly; longer ones may be contained.
 */
export function platformIdFromName(name: string | null | undefined): PlatformId | null {
  const norm = normName(name ?? '')
  if (!norm) return null
  let best: { id: PlatformId; len: number } | null = null
  for (const def of PLATFORMS) {
    for (const alias of def.aliases) {
      const hit = norm === alias || (alias.length >= 5 && norm.includes(alias))
      if (hit && (!best || alias.length > best.len)) best = { id: def.id, len: alias.length }
    }
  }
  return best?.id ?? null
}

/* ───────── Parsing ───────── */

export type ParseFailure =
  | 'empty' | 'too-long' | 'unsupported-scheme' | 'credentials' | 'private-host' | 'invalid-url'
  | 'not-a-profile' | 'needs-platform' | 'invalid-handle' | 'email' | 'subreddit'

export interface ParsedProfile {
  platform: AnyPlatformId
  /** Normalised handle (`user@instance` for federated platforms, host + path for generic links). */
  handle: string
  /** Canonical, safe, outbound URL. */
  url: string
  host: string
  kind: PlatformKind | 'external'
  /** Dedupe key: `${platform}:${handle}` (lowercase unless the handle is case-sensitive). */
  key: string
  /** True when the platform was guessed from the URL shape on an unknown host (fediverse). */
  inferred?: boolean
}

export interface ParseError {
  ok: false
  reason: ParseFailure
  message: string
}

export type ParseResult = { ok: true; profile: ParsedProfile } | ParseError

const MESSAGES: Record<ParseFailure, string> = {
  empty: 'Nothing to save.',
  'too-long': 'That is too long to be a profile link.',
  'unsupported-scheme': 'Only http(s) links are accepted.',
  credentials: 'Links with a username or password are not accepted.',
  'private-host': 'That address is not a public website.',
  'invalid-url': 'That does not look like a link or @handle.',
  'not-a-profile': 'That is a page on the site, not a profile link.',
  'needs-platform': 'Pick a platform for bare @handles.',
  'invalid-handle': 'That handle has characters or a length the platform does not allow.',
  email: 'That looks like an email address, which is never stored.',
  subreddit: 'That is a subreddit, not a profile. Use a u/name profile.',
}

const fail = (reason: ParseFailure, message?: string): ParseError => ({ ok: false, reason, message: message ?? MESSAGES[reason] })

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|igshid$|igsh$|si$|ref$|ref_|mc_|s$|t$)/i

function pathSegments(url: URL): string[] | null {
  const out: string[] = []
  for (const part of url.pathname.split('/')) {
    if (!part) continue
    let decoded = part
    try {
      decoded = decodeURIComponent(part)
    } catch {
      return null
    }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f/\\\s]/.test(decoded)) return null
    out.push(decoded)
  }
  return out
}

const normalizeHandle = (def: PlatformDef, handle: string) => (def.keepCase?.(handle) ? handle : lower(handle))

function build(def: PlatformDef, rawHandle: string, opts: { url?: string; inferred?: boolean } = {}): ParseResult {
  const handle = normalizeHandle(def, stripAt(rawHandle.trim()))
  if (!def.handleRe.test(handle)) return fail('invalid-handle')
  const safe = safeHttpUrl(opts.url ?? def.profileUrl(handle))
  if (!safe.ok) return fail(safe.reason)
  const url = safe.url.toString()
  return {
    ok: true,
    profile: {
      platform: def.id,
      handle,
      url,
      host: safe.url.hostname,
      kind: def.kind,
      key: `${def.id}:${handle}`,
      ...(opts.inferred ? { inferred: true } : {}),
    },
  }
}

function genericProfile(url: URL): ParseResult {
  const clean = new URL(url.toString())
  clean.hash = ''
  for (const key of [...clean.searchParams.keys()]) if (TRACKING_PARAM.test(key)) clean.searchParams.delete(key)
  const host = clean.hostname.replace(/^www\./, '')
  const path = clean.pathname.replace(/\/+$/, '')
  const label = `${host}${path}${clean.search}`.slice(0, 80)
  return {
    ok: true,
    profile: {
      platform: 'generic',
      handle: label,
      url: clean.toString(),
      host: clean.hostname,
      kind: 'external',
      key: `generic:${lower(`${host}${path}${clean.search}`)}`,
    },
  }
}

const FEDI_NOT_HOSTS = new Set(['medium.com', 'substack.com', 'tiktok.com', 'youtube.com', 'threads.net', 'threads.com', 'vimeo.com', 'github.com', 'gitlab.com'])

function fediverseFromUrl(ctx: UrlContext): ParseResult | null {
  if (FEDI_NOT_HOSTS.has(ctx.host)) return null
  const head = ctx.segments[0] ?? ''
  const mastodon = platformById('mastodon')!
  if (head.startsWith('@') && head.length > 1 && ctx.segments.length <= 2) {
    const [user, remote] = stripAt(head).split('@')
    const instance = remote || ctx.host
    if (!user || !isPublicHostname(instance)) return null
    return build(mastodon, `${user}@${instance}`, { inferred: true })
  }
  const lemmy = platformById('lemmy')!
  if (lower(head) === 'u' && ctx.segments[1] && ctx.segments.length <= 2) return build(lemmy, `${ctx.segments[1]}@${ctx.host}`, { inferred: true })
  const peertube = platformById('peertube')!
  const section = lower(head)
  if ((section === 'a' || section === 'accounts' || section === 'video-channels') && ctx.segments[1] && ctx.segments.length <= 2) {
    return build(peertube, `${ctx.segments[1]}@${ctx.host}`, { inferred: true })
  }
  return null
}

function findDef(host: string): PlatformDef | undefined {
  for (const def of PLATFORMS) {
    if (def.hosts.includes(host)) return def
    if (def.hostSuffixes?.some((suffix) => host.endsWith(suffix))) return def
  }
  return undefined
}

function parseUrlInput(text: string): ParseResult {
  const safe = safeHttpUrl(text)
  if (!safe.ok) return fail(safe.reason)
  const url = safe.url
  const host = lower(url.hostname).replace(/\.$/, '').replace(/^(?:www|m|mobile)\./, '')
  const segments = pathSegments(url)
  if (!segments) return fail('invalid-url')
  const ctx: UrlContext = { url, host, segments }

  const def = findDef(host)
  if (def) {
    const hit = def.fromUrl(ctx)
    if (!hit) {
      if (def.id === 'reddit' && lower(segments[0] ?? '') === 'r') return fail('subreddit')
      return fail('not-a-profile', `That is a ${def.label} page, not a profile link.`)
    }
    return build(def, hit.handle, { url: hit.url })
  }
  const fedi = fediverseFromUrl(ctx)
  if (fedi) return fedi
  return genericProfile(url)
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const HOST_LIKE_RE = /^(?:[a-z0-9_-]+\.)+[a-z]{2,24}(?::\d+)?(?:[/?#]|$)/i
const BSKY_BARE_RE = /^@?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.bsky\.social$/i
const FEDI_BARE_RE = /^@([a-z0-9_.-]{1,64})@((?:[a-z0-9-]+\.)+[a-z]{2,24})$/i

/**
 * Parse one pasted profile URL or @handle.
 * `hint` names the platform for bare handles; a pasted URL always wins over the hint.
 */
export function parseProfileInput(input: string, hint?: PlatformId | null): ParseResult {
  let text = typeof input === 'string' ? input.trim() : ''
  if (!text) return fail('empty')
  if (text.length > MAX_INPUT_LENGTH) return fail('too-long')
  text = text.replace(/^[<("'[]+/, '').replace(/[>)"'\],;]+$/, '').trim()
  if (!text) return fail('empty')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(text)) return fail('invalid-url')

  const fedi = FEDI_BARE_RE.exec(text)
  if (fedi) return build(platformById(hint === 'lemmy' || hint === 'peertube' ? hint : 'mastodon')!, `${fedi[1]}@${fedi[2]}`)

  if (/^https?:\/\//i.test(text)) return parseUrlInput(text)
  if (text.startsWith('//')) return parseUrlInput(`https:${text}`)
  if (SCHEME_RE.test(text) && !/^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(text)) return fail('unsupported-scheme')

  // Bare host/path ("onlyfans.com/name"): only when it is not a handle for the chosen platform.
  const hostLike = HOST_LIKE_RE.test(text) && !text.startsWith('@')
  if (hostLike && !(hint && !text.includes('/'))) {
    if (BSKY_BARE_RE.test(text) && !text.includes('/')) return build(platformById('bluesky')!, text)
    return parseUrlInput(`https://${text}`)
  }

  const redditMatch = /^\/?(r|u|user)\/([^/]+)\/?$/i.exec(text)
  if (redditMatch) {
    if (redditMatch[1].toLowerCase() === 'r') return fail('subreddit')
    return build(platformById('reddit')!, redditMatch[2])
  }

  if (EMAIL_RE.test(text)) return fail('email')
  if (BSKY_BARE_RE.test(text)) return build(platformById('bluesky')!, text)

  const bare = stripAt(text)
  if (!bare || /[/?#:@]/.test(bare)) return fail('invalid-url')
  const def = platformById(hint ?? undefined)
  if (!def) return fail('needs-platform')
  if (def.federated) return fail('invalid-handle', `${def.label} handles look like @name@instance.tld.`)
  return build(def, bare)
}

export interface ListParseResult {
  profiles: ParsedProfile[]
  /** The first `MAX_ERRORS_SHOWN` failures (for display). */
  errors: { input: string; reason: ParseFailure; message: string }[]
  /** Every entry that could not be read, including those beyond `errors`. */
  errorCount: number
  /** Inputs that repeated an earlier line of the same paste. */
  duplicates: number
  /** True when the paste held more entries than `max`. */
  truncated: boolean
}

export const MAX_ERRORS_SHOWN = 12

/** Parse a pasted block of links/@handles (whitespace, commas or semicolons between entries). */
export function parseProfileList(raw: string, hint?: PlatformId | null, max = 100): ListParseResult {
  const tokens = (typeof raw === 'string' ? raw : '').split(/[\s,;]+/).filter(Boolean)
  const profiles: ParsedProfile[] = []
  const errors: ListParseResult['errors'] = []
  const seen = new Set<string>()
  let errorCount = 0
  let duplicates = 0
  let truncated = false
  for (const token of tokens) {
    if (profiles.length + errorCount >= max) {
      truncated = true
      break
    }
    const result = parseProfileInput(token, hint)
    if (!result.ok) {
      errorCount += 1
      if (errors.length < MAX_ERRORS_SHOWN) errors.push({ input: token.slice(0, 80), reason: result.reason, message: result.message })
      continue
    }
    if (seen.has(result.profile.key)) {
      duplicates += 1
      continue
    }
    seen.add(result.profile.key)
    profiles.push(result.profile)
  }
  return { profiles, errors, errorCount, duplicates, truncated }
}

/** Visible handle text for a parsed or stored profile. */
export function displayHandle(platform: AnyPlatformId, handle: string): string {
  const def = platformById(platform)
  if (!def) return handle
  return def.display ? def.display(handle) : `@${handle}`
}

/** Build a canonical profile URL from a platform + handle (null when the handle is invalid). */
export function buildProfileUrl(platform: AnyPlatformId, handle: string): string | null {
  const def = platformById(platform)
  if (!def) return null
  const result = build(def, handle)
  return result.ok ? result.profile.url : null
}
