import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './styles/fonts.css'
import './index.css'
import './styles/lite.css'
import App from './App'
import { applyLiteGraphics } from '@/lib/lite'
import { useAppStore } from '@/store'
import { shareDiscovery } from '@/lib/perf/share'
import { restoreDiscoveryCache } from '@/lib/perf/persist'

applyLiteGraphics()

// Live queries: one retry, 5-minute staleness, no focus refetch storms.
// Home additionally polls every 120s. Inactive feeds are kept 30 minutes so
// hopping between Library, For You and Search never refetches or re-renders cold.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
})

// Every feed variant shares one cheap, identity-preserving merge instead of a deep compare of the whole payload.
queryClient.setQueryDefaults(['live-discovery'], { structuralSharing: shareDiscovery })

// Repeat visit: paint the last feed (<= 6 h old, metadata only) synchronously, revalidate in the background.
restoreDiscoveryCache(queryClient, useAppStore.getState().creatorWatchlist)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)

// Vitals, persistence writes, route prefetch and the service worker are not needed for first paint:
// they load as their own chunk once the browser is idle (observers are buffered, so nothing is missed).
const startPostRender = () => void import('@/lib/perf/post-boot').then((module) => module.startPostRenderWork(queryClient))
if (typeof requestIdleCallback === 'function') requestIdleCallback(startPostRender, { timeout: 1500 })
else window.setTimeout(startPostRender, 300)

// A deploy replaces hashed chunk files. If a lazy route/chunk 404s (stale tab or cached shell),
// reload once to pick up the new build instead of leaving a dead screen.
window.addEventListener('vite:preloadError', (event) => {
  try {
    const key = 'mc.chunk-reload'
    const last = Number(window.sessionStorage.getItem(key) || 0)
    if (Date.now() - last < 30_000) return
    window.sessionStorage.setItem(key, String(Date.now()))
    event.preventDefault()
    window.location.reload()
  } catch {
    // storage blocked: let the error surface normally
  }
})
