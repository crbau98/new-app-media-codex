import type { Page } from '@playwright/test'

const poster = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22500%22%3E%3Crect width=%22400%22 height=%22500%22 fill=%22%23181720%22/%3E%3Ccircle cx=%22200%22 cy=%22210%22 r=%2280%22 fill=%22%23e879a9%22 opacity=%22.35%22/%3E%3C/svg%3E'

export async function installAppFixture(page: Page) {
  await page.addInitScript(() => localStorage.setItem('media-codex-adult-verified', '1'))
  await page.route('**/api/live-media*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: 'rg-signal-studio', title: 'Studio signal', thumbnail: poster, source: 'Public test source',
          duration: '0:12', isVideo: true, category: 'Featured', creator: 'Signal Studio', tags: ['Gay', 'Studio'],
          rating: 4.8, createdAt: new Date().toISOString(), views: 4200, likes: 320, comments: 12,
          mediaUrl: 'https://media.redgifs.com/test.mp4', streamCandidates: ['https://media.redgifs.com/test.mp4'],
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
