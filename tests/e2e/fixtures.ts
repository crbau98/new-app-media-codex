import type { Page } from '@playwright/test'
import { TINY_VIDEO_BASE64 } from './tiny-video'

const poster = 'https://fixture.invalid/poster.svg'
const proxyHd = '/api/archiver-proxy?url=https%3A%2F%2Fmedia.redgifs.com%2Ffixture-hd.mp4'
const proxyMobile = '/api/archiver-proxy?url=https%3A%2F%2Fmedia.redgifs.com%2Ffixture-mobile.mp4'

export async function installAppFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem('media-codex-adult-verified', '1'))
  await page.route(poster, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#181720"/><circle cx="200" cy="210" r="80" fill="#e879a9" opacity=".35"/></svg>',
    })
  })
  await page.route('**/api/archiver-proxy*', async (route) => {
    const body = Buffer.from(TINY_VIDEO_BASE64, 'base64')
    await route.fulfill({
      status: 200,
      contentType: 'video/mp4',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(body.byteLength),
      },
      body,
    })
  })
  await page.route('**/api/live-media*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: 'rg-signal-studio', title: 'Studio signal', thumbnail: poster, source: 'Public test source',
          duration: '0:12', isVideo: true, category: 'Featured', creator: 'Signal Studio', tags: ['Gay', 'Studio'],
          rating: 4.8, createdAt: new Date().toISOString(), views: 4200, likes: 320, comments: 12,
          mediaUrl: proxyHd, streamCandidates: [proxyHd, proxyMobile],
          pageUrl: 'https://example.com/source', isNew: true, isTrending: true, curationScore: 88,
          curationReasons: ['Strong public engagement'],
        }],
        performers: [{
          id: 'signal-studio', name: 'Signal Studio', username: 'signalstudio', avatar: poster, followers: 4200,
          hasStory: true, storySeen: false, platform: 'Public test source', mediaCount: 1, viewCount: 4200,
          likeCount: 320, curationScore: 88, isSimilar: true, similarityScore: 84,
          discoveryReasons: ['Shared public studio tags'],
        }],
        updatedAt: new Date().toISOString(),
        counts: { received: 1, eligible: 1, playable: 1, pagesScanned: 1, sourcesConnected: 1, creatorsDiscovered: 1 },
        watchlist: { requested: [], matched: [] },
        aiDiscovery: { model: 'test-model', state: 'model', explainable: true, suggestedCreators: 1, autoAddedCreators: 0, sensitiveAttributeInference: false },
        sources: [{ id: 'test', name: 'Public test source', mode: 'stream', state: 'connected', mediaFound: 1, creatorsFound: 1, detail: 'Deterministic browser fixture.' }],
      }),
    })
  })
}
