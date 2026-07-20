const SHELL_CACHE = 'media-codex-shell-v4'
const IMAGE_CACHE = 'media-codex-images-v2'
const IMAGE_CACHE_LIMIT = 120
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== IMAGE_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

async function trimImageCache(cache) {
  const keys = await cache.keys()
  if (keys.length <= IMAGE_CACHE_LIMIT) return
  await Promise.all(keys.slice(0, keys.length - IMAGE_CACHE_LIMIT).map((request) => cache.delete(request)))
}

async function imageStaleWhileRevalidate(request) {
  const cache = await caches.open(IMAGE_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      const contentType = response.headers.get('content-type') || ''
      const cacheControl = response.headers.get('cache-control') || ''
      if (response.ok && contentType.startsWith('image/') && !/no-store|private/i.test(cacheControl)) {
        cache.put(request, response.clone()).then(() => trimImageCache(cache))
      }
      return response
    })
    .catch(() => cached)
  return cached || network
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')))
    return
  }

  const url = new URL(request.url)
  const isSameOriginImage = url.origin === self.location.origin && request.destination === 'image'
  const isRange = Boolean(request.headers.get('range'))
  if (isSameOriginImage && !isRange) {
    event.respondWith(imageStaleWhileRevalidate(request))
  }
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
