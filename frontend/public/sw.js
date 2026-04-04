const CACHE_NAME = 'codex-v2';
const OFFLINE_URL = '/';

// Pre-cache the shell on install
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache the app shell and critical assets
    await cache.addAll([OFFLINE_URL]).catch(() => {});
    await self.skipWaiting();
  })());
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.allSettled(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Network-first strategy for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API requests Ã¢ÂÂ network only, no caching
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;

  // Static assets with hashes Ã¢ÂÂ cache first (immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests Ã¢ÂÂ network first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }
});
const CACHE_NAME = 'codex-v2';
const OFFLINE_URL = '/';

// Pre-cache the shell on install
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Cache the app shell and critical assets
    await cache.addAll([OFFLINE_URL]).catch(() => {});
    await self.skipWaiting();
  })());
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.allSettled(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Network-first strategy for API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API requests â network only, no caching
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;

  // Static assets with hashes â cache first (immutable)
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests â network first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }
});
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.allSettled(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    await Promise.allSettled(
      clients.map((client) => client.navigate(client.url))
    );
  })());
});
