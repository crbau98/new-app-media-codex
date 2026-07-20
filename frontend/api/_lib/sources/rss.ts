const MAX_FEED_BYTES = 512_000
const DEFAULT_TIMEOUT_MS = 6000

export type ParsedFeedItem = {
  id: string
  title: string
  url: string
  publishedAt?: string
  mediaUrl?: string
  thumbnail?: string
  kind: 'video' | 'image' | 'link'
}

export type FeedParseResult = {
  feedUrl: string
  title: string
  items: ParsedFeedItem[]
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  const match = host.match(/^172\.(\d{1,3})\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

export function assertPublicHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported_protocol')
  if (isPrivateHost(url.hostname)) throw new Error('private_host_blocked')
  return url
}

async function readLimitedText(response: Response): Promise<string> {
  if (!response.body) return response.text()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_FEED_BYTES) throw new Error('feed_too_large')
    output += decoder.decode(value, { stream: true })
  }
  output += decoder.decode()
  return output
}

function firstMatch(block: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = block.match(pattern)
    if (match?.[1]) return match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
  }
  return undefined
}

function classifyMedia(url?: string, type?: string): ParsedFeedItem['kind'] {
  const value = `${type || ''} ${url || ''}`.toLowerCase()
  if (/(video|mp4|webm|mov|m3u8)/.test(value)) return 'video'
  if (/(image|jpg|jpeg|png|webp|avif|gif)/.test(value)) return 'image'
  return 'link'
}

function parseJsonFeed(text: string, feedUrl: string): FeedParseResult {
  const data = JSON.parse(text) as {
    title?: string
    items?: Array<{
      id?: string
      url?: string
      external_url?: string
      title?: string
      date_published?: string
      attachments?: Array<{ url?: string; mime_type?: string; title?: string }>
      image?: string
    }>
  }
  const items = (data.items || []).slice(0, 60).map((item, index) => {
    const attachment = item.attachments?.find((candidate) => candidate.url)
    const mediaUrl = attachment?.url || item.image
    const url = item.url || item.external_url || feedUrl
    return {
      id: item.id || `${url}#${index}`,
      title: item.title || attachment?.title || 'Feed item',
      url,
      publishedAt: item.date_published,
      mediaUrl,
      thumbnail: item.image,
      kind: classifyMedia(mediaUrl, attachment?.mime_type),
    }
  })
  return { feedUrl, title: data.title || 'JSON Feed', items }
}

function parseXmlFeed(text: string, feedUrl: string): FeedParseResult {
  const title = firstMatch(text, [/<title[^>]*>([\s\S]*?)<\/title>/i]) || 'Feed'
  const blocks = [...text.matchAll(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi)].map((match) => match[0]).slice(0, 60)
  const items = blocks.map((block, index) => {
    const itemTitle = firstMatch(block, [/<title[^>]*>([\s\S]*?)<\/title>/i]) || `Feed item ${index + 1}`
    const url = firstMatch(block, [
      /<link[^>]+href=["']([^"']+)["'][^>]*>/i,
      /<link[^>]*>([\s\S]*?)<\/link>/i,
      /<guid[^>]*>([\s\S]*?)<\/guid>/i,
    ]) || feedUrl
    const enclosureUrl = firstMatch(block, [/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i])
    const enclosureType = firstMatch(block, [/<enclosure[^>]+type=["']([^"']+)["'][^>]*>/i])
    const mediaUrl = firstMatch(block, [
      /<media:content[^>]+url=["']([^"']+)["'][^>]*>/i,
      /<media:player[^>]+url=["']([^"']+)["'][^>]*>/i,
    ]) || enclosureUrl
    const thumbnail = firstMatch(block, [/<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/i])
    const publishedAt = firstMatch(block, [/<pubdate[^>]*>([\s\S]*?)<\/pubdate>/i, /<published[^>]*>([\s\S]*?)<\/published>/i, /<updated[^>]*>([\s\S]*?)<\/updated>/i])
    return {
      id: `${url}#${index}`,
      title: itemTitle,
      url,
      publishedAt,
      mediaUrl,
      thumbnail,
      kind: classifyMedia(mediaUrl, enclosureType),
    }
  })
  return { feedUrl, title, items }
}

/**
 * Explicit-feed connector only. The caller must supply the feed URL; this never
 * discovers, crawls, or follows page links beyond the provided feed document.
 */
export async function fetchExplicitFeed(rawUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FeedParseResult> {
  const url = assertPublicHttpUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/json, text/xml;q=0.8, */*;q=0.1' },
    })
    if (!response.ok) throw new Error(`feed_http_${response.status}`)
    const text = await readLimitedText(response)
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('json') || text.trim().startsWith('{')) return parseJsonFeed(text, url.toString())
    return parseXmlFeed(text, url.toString())
  } finally {
    clearTimeout(timer)
  }
}
