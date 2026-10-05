import { resolveMediaAssetUrl } from '@/lib/backendOrigin'
import type { MediaItem } from '@/lib/types'

const warmed: string[] = []
const MAX_WARMED = 40

function warmImage(url: string) {
  if (!url || warmed.includes(url)) return
  warmed.push(url)
  if (warmed.length > MAX_WARMED) warmed.shift()
  const image = new Image()
  image.decoding = 'async'
  image.referrerPolicy = 'no-referrer'
  image.src = url
}

/**
 * Warm what the viewer will see first when `item` plays next: its poster
 * (videos) or first photo (photos, skipped on data-saver). Cheap, bounded and
 * idempotent — safe to call every time the "next" candidate changes.
 */
export function preloadForPlayback(item: MediaItem, options: { saveData?: boolean } = {}): void {
  if (typeof Image === 'undefined') return
  warmImage(resolveMediaAssetUrl(item.posterUrl || item.thumbnail))
  if (item.isVideo || options.saveData) return
  const first = item.gallery?.[0]?.url ?? item.mediaUrl
  if (first) warmImage(resolveMediaAssetUrl(first))
}
