/*
 * Media Codex service worker (v6).
 *
 * What it caches:
 *  - App shell (index.html, manifest, small icon): precached, stale-while-revalidate.
 *  - Navigations: navigation-preload + network-first (3 s budget); a slow or offline
 *    network falls back to the cached shell. Only real text/html responses are stored.
 *  - Hashed /assets/*: cache-first (immutable filenames), type-checked so an SPA-fallback
 *    HTML page can never be stored under a .js/.css URL, bounded by entry count.
 *  - App images (icons, brand art): stale-while-revalidate, small bounded cache.
 *  - API metadata, strict allowlist, GET only, no user text in the URL:
 *      /api/live-media (default feed: count/pages/sort only)  network-first, 6 s budget, cache = offline fallback
 *      /api/creator-directory (first page: limit/sort/tag only)  stale-while-revalidate
 *    Entries carry their save time and expire after 6 h.
 *
 * What it NEVER caches (see docs/PERFORMANCE_FRAMEWORK.md): video/audio, byte-range requests,
 * HLS manifests/segments, anything under /api/archiver-proxy (explicit media, thumbnails included),
 * any other /api/ route (search, creator lookups, AI, diagnostics), POSTs (personalised feeds),
 * responses marked private/no-store, cross-origin requests.
 *
 * Messages: SKIP_WAITING, CLEAR_CACHES (everything), CLEAR_API_CACHE (feed metadata only).
 */
const VERSION = 'v6'
const SHELL_CACHE = `media-codex-shell-${VERSION}`
const ASSET_CACHE = `media-codex-assets-${VERSION}`
const IMAGE_CACHE = `media-codex-images-${VERSION}`
const API_CACHE = `media-codex-api-${VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE, API_CACHE]
const ASSET_CACHE_LIMIT = 120
const IMAGE_CACHE_LIMIT = 40
const API_CACHE_LIMIT = 8
const IMAGE_MAX_BYTES = 512 * 1024
const NAVIGATION_TIMEOUT_MS = 3000
const API_NETWORK_TIMEOUT_MS = 6000
const API_MAX_AGE_MS = 6 * 60 * 60 * 1000
const CACHED_AT = 'x-mc-cached-at'
// icon-512 is 140 KB and only needed for installs; it is fetched by the browser on demand, not precached.
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png']

/** Exact-path allowlist for API metadata. `params` are the only query parameters a cacheable URL may carry. */
const API_RULES = {
  '/api/live-media': { strategy: 'network-first', params: ['count', 'pages', 'sort'] },
  '/api/creator-directory': { strategy: 'swr', params: ['limit', 'sort', 'tag'] },
}

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

function contentType(response) {
  return (response.headers.get('content-type') || '').toLowerCase()
}

async function trimCache(cache, limit) {
  const keys = await cache.keys()
  if (keys.length <= limit) return
  await Promise.all(keys.slice(0, keys.length - limit).map((request) => cache.delete(request)))
}

/** Never lets an HTML fallback masquerade as a script/style/font under an /assets/ URL. */
function assetTypeMatches(url, response) {
  const type = contentType(response)
  if (/\.js$/i.test(url.pathname)) return /javascript|ecmascript/.test(type)
  if (/\.css$/i.test(url.pathname)) return type.includes('text/css')
  if (/\.(woff2?|ttf|otf)$/i.test(url.pathname)) return /font|octet-stream/.test(type)
  return !type.includes('text/html')
}

async function imageStaleWhileRevalidate(request) {
  const cache = await caches.open(IMAGE_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      const length = Number(response.headers.get('content-length') || 0)
      if (!isUncacheable(response) && contentType(response).startsWith('image/') && (!length || length <= IMAGE_MAX_BYTES)) {
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

async function immutableAsset(request, url) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (!isUncacheable(response) && assetTypeMatches(url, response)) {
    cache.put(request, response.clone()).then(() => trimCache(cache, ASSET_CACHE_LIMIT))
  }
  return response
}

async function navigate(event) {
  const cache = await caches.open(SHELL_CACHE)
  const network = (async () => {
    const preload = event.preloadResponse ? await event.preloadResponse : undefined
    const response = preload || (await fetch(event.request))
    if (!isUncacheable(response) && contentType(response).includes('text/html')) cache.put('./index.html', response.clone())
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

/* ── API metadata ── */

function apiRuleFor(url) {
  const rule = API_RULES[url.pathname]
  if (!rule) return null
  for (const key of url.searchParams.keys()) if (!rule.params.includes(key)) return null
  // Pagination cursors are tied to a ranking snapshot: only first pages are ever cached.
  if (url.pathname === '/api/creator-directory' && url.searchParams.has('cursor')) return null
  return rule
}

async function storeApi(cache, request, response) {
  if (isUncacheable(response) || !/json/.test(contentType(response))) return
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT, String(Date.now()))
  const copy = response.clone()
  await cache.put(request, new Response(await copy.blob(), { status: copy.status, statusText: copy.statusText, headers }))
  await trimCache(cache, API_CACHE_LIMIT)
}

async function freshEntry(cache, request) {
  const cached = await cache.match(request, { ignoreVary: true })
  if (!cached) return null
  const savedAt = Number(cached.headers.get(CACHED_AT) || 0)
  if (!savedAt || Date.now() - savedAt > API_MAX_AGE_MS || savedAt > Date.now() + 60_000) {
    await cache.delete(request)
    return null
  }
  return cached
}

async function apiNetworkFirst(request, event) {
  const cache = await caches.open(API_CACHE)
  const network = fetch(request).then(async (response) => {
    await storeApi(cache, request, response).catch(() => undefined)
    return response
  })
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), API_NETWORK_TIMEOUT_MS))
  try {
    const first = await Promise.race([network, timeout])
    if (first) return first
  } catch {
    // network failed outright: fall through to the cached copy
  }
  const cached = await freshEntry(cache, request)
  if (cached) {
    event.waitUntil(network.catch(() => undefined))
    return cached
  }
  return network
}

async function apiStaleWhileRevalidate(request, event) {
  const cache = await caches.open(API_CACHE)
  const cached = await freshEntry(cache, request)
  const refresh = fetch(request).then(async (response) => {
    await storeApi(cache, request, response).catch(() => undefined)
    return response
  })
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined))
    return cached
  }
  return refresh
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

  if (url.pathname.startsWith('/api/')) {
    // An explicit cache bypass from the app always wins.
    if (request.cache === 'no-store' || request.cache === 'reload') return
    const rule = apiRuleFor(url)
    if (!rule) return
    event.respondWith(rule.strategy === 'swr' ? apiStaleWhileRevalidate(request, event) : apiNetworkFirst(request, event))
    return
  }

  if (request.destination === 'image') {
    event.respondWith(imageStaleWhileRevalidate(request))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(immutableAsset(request, url))
    return
  }

  if (SHELL.some((entry) => new URL(entry, self.location.href).pathname === url.pathname)) {
    event.respondWith(shellStaleWhileRevalidate(request, event))
  }
})

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type
  if (type === 'SKIP_WAITING') self.skipWaiting()
  if (type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('media-codex-')).map((key) => caches.delete(key)))))
  }
  if (type === 'CLEAR_API_CACHE') event.waitUntil(caches.delete(API_CACHE))
})
