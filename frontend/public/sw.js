/* Media Codex Service Worker — cache-first strategy */

const CACHE_NAME = 'media-codex-v1'
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip cross-origin, non-GET, API routes, and range requests
  if (
    url.origin !== location.origin ||
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    request.headers.get('range')
  ) {
    return
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      // Cache-first: return immediately if cached
      if (cached) return cached

      const response = await fetch(request)
      if (response.ok && response.status < 400) {
        cache.put(request, response.clone())
      }
      return response
    })
  )
})
