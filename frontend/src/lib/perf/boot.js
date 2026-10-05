/* Media Codex boot script — runs before the app bundle, as a tiny blocking classic script.
 *
 * Shipped as a fingerprinted same-origin asset (see bootScript() in vite.config.ts) rather than
 * inline, because the production CSP is `script-src 'self'`: an inline <script> is blocked there,
 * which silently disabled the old pre-hydration theme script.
 *
 * 1. Theme: read the persisted preference and set data-theme + canvas colour before first paint.
 * 2. Returning, age-verified visitors only (never before the 18+ gate is confirmed):
 *      a. preload the last hero poster from the persisted hint (LCP image starts at t=0, not after
 *         the bundle has been parsed and React has rendered);
 *      b. start the live-feed request now, so the response is usually waiting when React asks.
 *         The app consumes it via takeBootFeed() when the request signature matches exactly.
 *
 * Plain ES5 on purpose: no transpile step, must never throw. Mirrors src/lib/perf/discovery-request.ts
 * and src/lib/perf/cache.ts (keys, signature, hero choice) — tests/perf-boot.test.ts enforces parity.
 */
(function () {
  var w = window
  var d = document
  var root = d.documentElement

  /* ---- 1. theme ---- */
  var storeRaw = null
  var ls = null
  try {
    ls = w.localStorage
    storeRaw = ls.getItem('media-codex-store')
  } catch (e) { /* storage unavailable */ }

  var persisted = null
  try { persisted = storeRaw ? JSON.parse(storeRaw) : null } catch (e) { persisted = null }
  var state = persisted && persisted.state ? persisted.state : null

  var theme = 'dark'
  if (state && (state.theme === 'light' || state.theme === 'dark' || state.theme === 'auto')) theme = state.theme
  var resolved = theme
  try {
    if (theme === 'auto') resolved = w.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch (e) { resolved = 'dark' }
  root.setAttribute('data-theme', resolved)
  root.style.backgroundColor = resolved === 'light' ? '#f9f5ee' : '#0c0912'

  /* ---- 2. early feed + hero poster (verified returning visitors only) ---- */
  try {
    if (!ls || ls.getItem('media-codex-adult-verified') !== '1') return
    var path = w.location.pathname
    var isHome = path === '/' || path === '/media'
    var usesFeed = isHome || path === '/explore' || path === '/search' || path === '/creators'
    if (!usesFeed) return

    var now = Date.now()
    var MAX_AGE = 6 * 60 * 60 * 1000
    var preloaded = ''

    var preload = function (url) {
      if (!url || url === preloaded || typeof url !== 'string') return
      if (url.indexOf('/api/archiver-proxy') !== 0 && url.indexOf('https://') !== 0) return
      preloaded = url
      var link = d.createElement('link')
      link.rel = 'preload'
      link.as = 'image'
      link.href = url
      link.setAttribute('fetchpriority', 'high')
      link.referrerPolicy = 'no-referrer'
      d.head.appendChild(link)
    }

    if (isHome) {
      var hint = null
      try { hint = JSON.parse(ls.getItem('mc.qc.hint') || 'null') } catch (e) { hint = null }
      if (hint && hint.v === 1 && typeof hint.at === 'number' && now - hint.at <= MAX_AGE && hint.at <= now + 60000) preload(hint.hero)
    }

    // A fresh persisted copy means the app will not refetch; an early request would be wasted.
    var last = Number(ls.getItem('mc.qc.last')) || 0
    if (last && now - last >= 0 && now - last < 5 * 60 * 1000) return
    if (typeof w.fetch !== 'function') return

    var watchlist = []
    if (state && Object.prototype.toString.call(state.creatorWatchlist) === '[object Array]') {
      for (var i = 0; i < state.creatorWatchlist.length; i += 1) {
        if (typeof state.creatorWatchlist[i] !== 'string') return // unexpected shape: let the app decide
        watchlist.push(state.creatorWatchlist[i])
      }
    }

    var url, init, sig
    if (watchlist.length === 0) {
      url = '/api/live-media?count=96&pages=3&sort=smart'
      init = { method: 'GET' }
      sig = 'GET ' + url
    } else {
      var body = JSON.stringify({ count: 96, pages: 3, sort: 'smart', query: '', watchlist: watchlist.slice(0, 40), forceFresh: false, useAI: false })
      url = '/api/live-media'
      init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: body }
      sig = 'POST ' + url + ' ' + body
    }

    var controller = typeof w.AbortController === 'function' ? new w.AbortController() : null
    var timer = controller ? w.setTimeout(function () { controller.abort() }, 25000) : 0
    if (controller) init.signal = controller.signal

    var promise = w.fetch(url, init)
      .then(function (response) {
        if (!response.ok) throw new Error('feed ' + response.status)
        return response.json()
      })
      .then(function (payload) {
        if (timer) w.clearTimeout(timer)
        if (isHome && payload && Object.prototype.toString.call(payload.items) === '[object Array]') {
          var best = null
          var bestScore = -Infinity
          for (var n = 0; n < payload.items.length; n += 1) {
            var item = payload.items[n]
            if (!item || typeof item.thumbnail !== 'string' || !item.thumbnail) continue
            var score = typeof item.curationScore === 'number' ? item.curationScore : 0
            if (score > bestScore) { best = item; bestScore = score }
          }
          if (best) preload(best.thumbnail)
        }
        return payload
      })
    promise.catch(function () { if (timer) w.clearTimeout(timer) }) // handled here; the app still observes the rejection
    w.__mcBoot = { sig: sig, p: promise, at: now }
  } catch (e) { /* the app does everything itself when this fails */ }
})()
