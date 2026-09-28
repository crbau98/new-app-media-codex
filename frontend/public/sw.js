/*
 * Media Codex service worker.
 *
 *  - App shell: precached once, refreshed stale-while-revalidate.
 *  - Navigations: navigation-preload + network-first (3s budget) with an
 *    offline fallback to the cached shell.
 *  - Hashed /assets/*: cache-first (immutable filenames).
 *  - Same-origin images: stale-while-revalidate in a size- and count-bounded cache.
 *  - NEVER cached: video/audio, byte-range requests, HLS manifests/segments,
 *    responses marked private/no-store, API calls, cross-origin requests.
 */
const VERSION = 'v5'
const SHELL_CACHE = `media-codex-shell-${VERSION}`
const IMAGE_CACHE = `media-codex-images-${VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, IMAGE_CACHE]
const IMAGE_CACHE_LIMIT = 140
const IMAGE_MAX_BYTES = 2 * 1024 * 1024
const NAVIGATION_TIMEOUT_MS = 3000
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('media-codex-') && !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => undefined)
      }
      await self.clients.claim()
    })()
  )
})

function isUncacheable(response) {
  if (!response || !response.ok || response.status !== 200) return true
  const cacheControl = response.headers.get('cache-control') || ''
  if (/no-store|private/i.test(cacheControl)) return true
  const type = response.headers.get('content-type') || ''
  if (/^(video|audio)\//i.test(type) || /mpegurl/i.test(type)) return true
  return false
}

async function trimCache(cache, limit) {
  const keys = await cache.keys()
  if (keys.length <= limit) return
  await Promise.all(keys.slice(0, keys.length - limit).map((request) => cache.delete(request)))
}

async function imageStaleWhileRevalidate(request) {
  const cache = await caches.open(IMAGE_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      const type = response.headers.get('content-type') || ''
      const length = Number(response.headers.get('content-length') || 0)
      if (!isUncacheable(response) && type.startsWith('image/') && (!length || length <= IMAGE_MAX_BYTES)) {
        cache.put(request, response.clone()).then(() => trimCache(cache, IMAGE_CACHE_LIMIT))
      }
      return response
    })
    .catch((error) => {
      if (cached) return cached
      throw error
    })
  return cached || network
}

async function shellStaleWhileRevalidate(request, event) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  const refresh = fetch(request)
    .then((response) => {
      if (!isUncacheable(response)) cache.put(request, response.clone())
      return response
    })
    .catch(() => cached)
  if (cached) {
    event.waitUntil(refresh)
    return cached
  }
  return refresh
}

async function immutableAsset(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (!isUncacheable(response)) cache.put(request, response.clone())
  return response
}

async function navigate(event) {
  const cache = await caches.open(SHELL_CACHE)
  const network = (async () => {
    const preload = event.preloadResponse ? await event.preloadResponse : undefined
    const response = preload || (await fetch(event.request))
    if (!isUncacheable(response)) cache.put('./index.html', response.clone())
    return response
  })()
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS))
  try {
    const first = await Promise.race([network, timeout])
    if (first) return first
    // Slow network: show the cached shell now, let the fetch finish in the background.
    event.waitUntil(network.catch(() => undefined))
    return (await cache.match('./index.html')) || network
  } catch {
    return (await cache.match('./index.html')) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  // Media and partial-content requests always go straight to the network.
  if (request.headers.get('range') || request.destination === 'video' || request.destination === 'audio' || request.destination === 'track') return

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event))
    return
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (/\.(?:m3u8|ts|m4s|mp4|webm|m4v|mov)$/i.test(url.pathname)) return

  if (request.destination === 'image') {
    event.respondWith(imageStaleWhileRevalidate(request))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(immutableAsset(request))
    return
  }

  if (SHELL.some((entry) => new URL(entry, self.location.href).pathname === url.pathname)) {
    event.respondWith(shellStaleWhileRevalidate(request, event))
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('media-codex-')).map((key) => caches.delete(key)))))
  }
})
