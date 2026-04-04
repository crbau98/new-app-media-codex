const CACHE_NAME = 'codex-v2'
const PRECACHE = ['/', '/manifest.json', '/favicon.svg']

/* ââ Install: precache shell ââââââââââââââââââââââââââââââââââââââ */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE))
  )
  self.skipWaiting()
})

/* ââ Activate: purge old caches âââââââââââââââââââââââââââââââââââ */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

/* ââ Fetch strategy âââââââââââââââââââââââââââââââââââââââââââââââ */
self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)

  // Skip non-GET and cross-origin
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return

  // Hashed assets â cache-first (immutable)
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(request, clone))
            return res
          })
      )
    )
    return
  }

  // Navigation & API â network-first, fallback to cache
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(request, clone))
        }
        return res
      })
      .catch(() => caches.match(request))
  )
})
