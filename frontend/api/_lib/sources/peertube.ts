const TIMEOUT_MS = 6500

export type PeerTubeSearchItem = {
  id: string
  title: string
  url: string
  embedUrl?: string
  thumbnail?: string
  preview?: string
  duration?: number
  publishedAt?: string
  creator?: string
  channel?: string
  license?: string
  nsfw?: boolean
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

export async function searchPeerTube(instance: string, query: string, includeNsfw = false): Promise<PeerTubeSearchItem[]> {
  const host = assertInstance(instance)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const url = new URL(`https://${host}/api/v1/search/videos`)
    url.searchParams.set('search', query)
    url.searchParams.set('count', '20')
    url.searchParams.set('nsfw', includeNsfw ? 'both' : 'false')
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`peertube_http_${response.status}`)
    const data = await response.json() as { data?: Array<Record<string, unknown>> }
    return (data.data || []).slice(0, 20).map((video) => {
      const account = video.account as { displayName?: string; name?: string } | undefined
      const channel = video.channel as { displayName?: string; name?: string } | undefined
      const licence = video.licence as { label?: string } | undefined
      const thumbnailPath = typeof video.thumbnailPath === 'string' ? video.thumbnailPath : undefined
      const previewPath = typeof video.previewPath === 'string' ? video.previewPath : undefined
      return {
        id: String(video.uuid || video.id || video.url || crypto.randomUUID()),
        title: String(video.name || 'PeerTube video'),
        url: String(video.url || `https://${host}/w/${video.uuid || video.id || ''}`),
        embedUrl: typeof video.embedPath === 'string' ? `https://${host}${video.embedPath}` : undefined,
        thumbnail: thumbnailPath ? `https://${host}${thumbnailPath}` : undefined,
        preview: previewPath ? `https://${host}${previewPath}` : undefined,
        duration: typeof video.duration === 'number' ? video.duration : undefined,
        publishedAt: typeof video.publishedAt === 'string' ? video.publishedAt : undefined,
        creator: account?.displayName || account?.name,
        channel: channel?.displayName || channel?.name,
        license: licence?.label,
        nsfw: Boolean(video.nsfw),
      }
    })
  } finally {
    clearTimeout(timer)
  }
}
