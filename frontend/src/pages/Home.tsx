import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { fetchLiveDiscovery } from '@/lib/api'
import { DISCOVERY_POLL_MS, discoveryKey } from '@/lib/perf/discovery-keys'
import { useStagedMount } from '@/lib/perf/useStagedMount'
import { useAppStore } from '@/store'
import Hero from '@/components/Hero'
import UpdatedChip from '@/components/UpdatedChip'
import '@/styles/discovery.css'

// Everything below the hero (rails, library, detail sheet) is a separate chunk. Home is part of the
// entry bundle, so request that chunk as soon as this module loads on a Home URL: it then arrives in
// parallel with the feed instead of after the first render.
const loadHomeBody = () => import('./home/HomeBody')
const HomeBody = lazy(loadHomeBody)
if (typeof window !== 'undefined' && (window.location.pathname === '/' || window.location.pathname === '/media')) void loadHomeBody()

export default function Home() {
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)

  // Home is the ONLY surface that polls (every 2 minutes). placeholderData keeps
  // the previous result visible while a background refetch is in flight.
  const discoveryQuery = useQuery({
    queryKey: discoveryKey(creatorWatchlist),
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
    refetchInterval: DISCOVERY_POLL_MS,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  })

  // Progressive mount: hero + status strip paint first (stage 0), rails follow (1), then the
  // full library grid (2). On a phone only the hero is above the fold, so this keeps ~75% of
  // the page's DOM out of the first style/layout/paint pass.
  // The rails wait for the hero artwork (the LCP element) to be revealed, or 3 s, whichever is first.
  const [heroReady, setHeroReady] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setHeroReady(true), 3000)
    return () => window.clearTimeout(timer)
  }, [])
  const stage = useStagedMount(2, { hold: !heroReady })
  const discovery = discoveryQuery.data

  const allItems = useMemo(() => discovery?.items ?? [], [discovery])
  const creators = useMemo(() => discovery?.performers ?? [], [discovery])
  const ranked = useMemo(() => [...allItems].sort((a, b) => (b.curationScore || 0) - (a.curationScore || 0)), [allItems])
  const heroItems = useMemo(() => ranked.slice(0, 5), [ranked])

  return (
    <div className="animate-page-enter d-page">
      {/* Cinematic hero */}
      <Hero
        items={heroItems}
        loading={discoveryQuery.isLoading}
        error={discoveryQuery.error}
        onRetry={() => discoveryQuery.refetch()}
        onSelect={setSelectedItem}
        onFeaturedLoad={() => setHeroReady(true)}
      />

      {/* Status strip: real counts only */}
      <div className="d-strip" style={{ marginTop: -16 }}>
        <UpdatedChip updatedAt={discovery?.updatedAt ?? null} />
        {discovery && (
          <>
            <span><b>{allItems.length}</b> items</span>
            <span><b>{creators.length}</b> creators</span>
            <span><b>{discovery.sources.filter((s) => s.state === 'connected').length}</b> live sources</span>
          </>
        )}
        {discoveryQuery.isFetching && !discoveryQuery.isLoading && (
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <RefreshCw size={11} className="animate-spin" aria-hidden="true" /> Refreshing
          </span>
        )}
      </div>

      {/* Below the hero: mounted in stages. The reserved height keeps the footer below the fold
          while sections arrive, so nothing visible is pushed around (no layout shift). */}
      <div style={{ minHeight: stage < 2 || discoveryQuery.isLoading ? '100dvh' : undefined }}>
        <Suspense fallback={null}>
          <HomeBody
            items={allItems}
            ranked={ranked}
            creators={creators}
            loading={discoveryQuery.isLoading}
            failed={Boolean(discoveryQuery.error) && !discovery}
            onRetry={() => discoveryQuery.refetch()}
            stage={stage}
            selectedItem={selectedItem}
            onSelectItem={setSelectedItem}
          />
        </Suspense>
      </div>
    </div>
  )
}
