const TIMEOUT_MS = 6500

export type ActivityPubMediaItem = {
  id: string
  url: string
  createdAt?: string
  account?: string
  sensitive: boolean
  spoilerText?: string
  mediaUrl?: string
  previewUrl?: string
  kind: 'video' | 'image' | 'link'
  description?: string
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true
  const match = host.match(/^172\.(\d{1,3})\./)
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31)
}

function assertInstance(instance: string): string {
  const host = instance.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!host || host.includes('..') || isPrivateHost(host)) throw new Error('invalid_instance')
  return host
}

export async function fetchMastodonPublicTag(instance: string, tag: string, limit = 20): Promise<ActivityPubMediaItem[]> {
  const host = assertInstance(instance)
  const cleanedTag = tag.trim().replace(/^#/, '')
  if (!cleanedTag) throw new Error('tag_required')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = new URL(`https://${host}/api/v1/timelines/tag/${encodeURIComponent(cleanedTag)}`)
    url.searchParams.set('limit', String(Math.min(40, Math.max(1, limit))))
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`activitypub_http_${response.status}`)
    const statuses = await response.json() as Array<Record<string, unknown>>
    const items: ActivityPubMediaItem[] = []
    for (const status of statuses.slice(0, limit)) {
      const account = status.account as { acct?: string } | undefined
      const attachments = Array.isArray(status.media_attachments) ? status.media_attachments as Array<Record<string, unknown>> : []
      if (!attachments.length) continue
      for (const attachment of attachments) {
        const type = String(attachment.type || '')
        const kind = type === 'video' || type === 'gifv' ? 'video' : type === 'image' ? 'image' : 'link'
        items.push({
          id: String(status.id || attachment.id || crypto.randomUUID()),
          url: String(status.url || attachment.url || ''),
          createdAt: typeof status.created_at === 'string' ? status.created_at : undefined,
          account: account?.acct,
          sensitive: Boolean(status.sensitive),
          spoilerText: typeof status.spoiler_text === 'string' ? status.spoiler_text : undefined,
          mediaUrl: typeof attachment.url === 'string' ? attachment.url : undefined,
          previewUrl: typeof attachment.preview_url === 'string' ? attachment.preview_url : undefined,
          kind,
          description: typeof attachment.description === 'string' ? attachment.description : undefined,
        })
      }
    }
    return items
  } finally {
    clearTimeout(timer)
  }
}
