import type { Page } from '@playwright/test'
import { TINY_WEBM_BASE64 } from './clip-webm'

/**
 * Deterministic mocks for the viewing features (queue, moments, player). The
 * sandbox Chromium cannot decode H.264, so every stream here is a 4.9 s VP8
 * WebM; stream URLs end in `.webm` so the app's codec probe accepts them.
 */

export const CLIP_SECONDS = 4.88

export interface FixtureItem {
  id: string
  title: string
  creator: string
  isVideo: boolean
  hue: number
}

export const ITEMS: FixtureItem[] = [
  { id: 'q-alpha', title: 'Alpha clip', creator: 'Signal Studio', isVideo: true, hue: 330 },
  { id: 'q-bravo', title: 'Bravo clip', creator: 'Signal Studio', isVideo: true, hue: 210 },
  { id: 'q-charlie', title: 'Charlie clip', creator: 'Night Shift', isVideo: true, hue: 150 },
  { id: 'q-photo', title: 'Harbour light', creator: 'Night Shift', isVideo: false, hue: 40 },
]

const posterHost = 'https://fixture.invalid'

function posterSvg(item: FixtureItem): string {
  const { hue } = item
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 22%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 8%)"/></linearGradient></defs>` +
    `<rect width="640" height="360" fill="url(#g)"/><circle cx="470" cy="150" r="90" fill="hsl(${hue} 70% 60%)" opacity=".28"/>` +
    `</svg>`
  )
}

export const posterUrl = (id: string) => `${posterHost}/poster-${id}.svg`
const proxied = (id: string) => `/api/archiver-proxy?url=${encodeURIComponent(`https://media.redgifs.com/${id}.webm`)}`

export function liveMediaPayload() {
  const now = Date.now()
  return {
    items: ITEMS.map((item, index) => ({
      id: item.id,
      title: item.title,
      thumbnail: posterUrl(item.id),
      source: 'Public test source',
      duration: item.isVideo ? '0:05' : '',
      isVideo: item.isVideo,
      category: 'Featured',
      creator: item.creator,
      tags: ['Gay', 'Studio'],
      rating: 4.8,
      createdAt: new Date(now - index * 3_600_000).toISOString(),
      views: 4200 - index * 100,
      likes: 320,
      comments: 12,
      ...(item.isVideo
        ? { mediaUrl: proxied(item.id), streamCandidates: [proxied(item.id)], durationSeconds: CLIP_SECONDS, width: 320, height: 180 }
        : { mediaUrl: posterUrl(item.id) }),
      pageUrl: 'https://example.com/source',
      isNew: true,
      isTrending: true,
      curationScore: 90 - index,
      curationReasons: ['Strong public engagement'],
    })),
    performers: [
      {
        id: 'signal-studio', name: 'Signal Studio', username: 'signalstudio', avatar: posterUrl('q-alpha'), followers: 4200, hasStory: false, storySeen: false,
        platform: 'Public test source', mediaCount: 2, viewCount: 8400, likeCount: 640, curationScore: 88, isSimilar: true, similarityScore: 84, discoveryReasons: ['Shared public studio tags'],
      },
    ],
    updatedAt: new Date(now).toISOString(),
    counts: { received: ITEMS.length, eligible: ITEMS.length, playable: 3, pagesScanned: 1, sourcesConnected: 1, creatorsDiscovered: 1 },
    watchlist: { requested: [], matched: [] },
    aiDiscovery: { model: 'test-model', state: 'model', explainable: true, suggestedCreators: 1, autoAddedCreators: 0, sensitiveAttributeInference: false },
    sources: [{ id: 'test', name: 'Public test source', mode: 'stream', state: 'connected', mediaFound: ITEMS.length, creatorsFound: 1, detail: 'Deterministic browser fixture.' }],
  }
}

export interface FixtureOptions {
  /** localStorage entries to seed before the app boots (JSON-encoded where not a string). */
  seed?: Record<string, unknown>
}

export async function installQueueFixture(page: Page, options: FixtureOptions = {}) {
  const seed = options.seed ?? {}
  await page.addInitScript((entries) => {
    // Adult gate + a clean slate on first load only, so reloads keep the queue.
    localStorage.setItem('media-codex-adult-verified', '1')
    if (!sessionStorage.getItem('fixture-seeded')) {
      sessionStorage.setItem('fixture-seeded', '1')
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
    }
  }, seed)

  for (const item of ITEMS) {
    await page.route(posterUrl(item.id), (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: posterSvg(item) }))
  }
  await page.route('**/api/archiver-proxy*', async (route) => {
    const body = Buffer.from(TINY_WEBM_BASE64, 'base64')
    await route.fulfill({ status: 200, contentType: 'video/webm', headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(body.byteLength) }, body })
  })
  await page.route('**/api/live-media*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(liveMediaPayload()) }))
}

/** Open the detail sheet for a fixture item from the library grid. */
export async function openItem(page: Page, title: string) {
  await page.goto('/media')
  // Dispatch the click directly: the feed's hero carousels keep moving, which would make an actionability wait flaky.
  await page.getByRole('button', { name: new RegExp(`^(Play|View) ${title} by`) }).first().dispatchEvent('click')
  // The sheet's name changes as the viewer moves between items, so address it by its stable label hook.
  const sheet = page.locator('[role="dialog"][aria-labelledby="media-title"]')
  await sheet.getByRole('heading', { name: title }).waitFor()
  return sheet
}
