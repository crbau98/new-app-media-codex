import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Dice5, Heart, Library, RefreshCw, Sparkles, UserRound } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { fetchLiveDiscovery } from '@/lib/api'
import { creatorKey, discoveryStrength, rankForYou, type DiscoveryMode } from '@/lib/discovery'
import { useAppStore } from '@/store'
import MediaDetail from '@/components/MediaDetail'
import UpdatedChip from '@/components/UpdatedChip'
import MediaBrowser from '@/components/discovery/MediaBrowser'
import MediaRail from '@/components/discovery/MediaRail'
import CategoryShelf from '@/components/discovery/CategoryShelf'
import SectionHeader from '@/components/discovery/SectionHeader'
import StatePanel from '@/components/discovery/StatePanel'
import { DensityToggle, FacetToggle, LayoutToggle, Segmented, type MediaFacet } from '@/components/discovery/Controls'
import { useLayoutMode } from '@/components/discovery/prefs'
import '@/styles/discovery.css'

const FederatedSearch = lazy(() => import('@/components/FederatedSearch'))
const ImportUrl = lazy(() => import('@/components/ImportUrl'))

const modeCopy: Record<DiscoveryMode, string> = {
  balanced: 'A steady mix of what you love and a few new directions.',
  familiar: 'Mostly the creators and themes you already lean into.',
  adventurous: 'More novelty: fresh tags and creators you have not engaged with yet.',
}

function StrengthRing({ value }: { value: number }) {
  const radius = 36
  const circumference = 2 * Math.PI * radius
  return (
    <div className="d-ring" role="img" aria-label={`Profile strength ${value} percent`}>
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle className="d-ring-track" cx="42" cy="42" r={radius} fill="none" strokeWidth="5" />
        <circle
          className="d-ring-fill"
          cx="42"
          cy="42"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, value)) / 100)}
        />
      </svg>
      <b>{value}%</b>
    </div>
  )
}

export default function Explore() {
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
  const [facet, setFacet] = useState<MediaFacet>('all')
  const [layout, setLayout] = useLayoutMode()
  const navigate = useNavigate()

  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const followCache = useAppStore((s) => s.followCache)
  const likeCache = useAppStore((s) => s.likeCache)
  const recentlyViewed = useAppStore((s) => s.recentlyViewed)
  const tagPreferences = useAppStore((s) => s.tagPreferences)
  const creatorPreferences = useAppStore((s) => s.creatorPreferences)
  const hiddenMedia = useAppStore((s) => s.hiddenMedia)
  const discoveryMode = useAppStore((s) => s.discoveryMode)
  const setDiscoveryMode = useAppStore((s) => s.setDiscoveryMode)
  const gridDensity = useAppStore((s) => s.gridDensity)
  const setGridDensity = useAppStore((s) => s.setGridDensity)
  const addToast = useAppStore((s) => s.addToast)

  const discoveryQuery = useQuery({
    queryKey: ['live-discovery', creatorWatchlist],
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
  })

  const strength = discoveryStrength(tagPreferences, creatorPreferences)
  const allItems = useMemo(() => discoveryQuery.data?.items ?? [], [discoveryQuery.data])

  const rankedItems = useMemo(
    () =>
      rankForYou(allItems, {
        tagPreferences,
        creatorPreferences,
        followCache,
        likeCache,
        recentlyViewed,
        hiddenMedia,
        mode: discoveryMode,
      }),
    [allItems, creatorPreferences, discoveryMode, followCache, hiddenMedia, likeCache, recentlyViewed, tagPreferences]
  )

  const facetCounts = useMemo(() => {
    const video = rankedItems.filter((item) => item.isVideo).length
    return { all: rankedItems.length, video, photo: rankedItems.length - video }
  }, [rankedItems])

  const mix = useMemo(() => {
    if (facet === 'video') return rankedItems.filter((item) => item.isVideo)
    if (facet === 'photo') return rankedItems.filter((item) => !item.isVideo)
    return rankedItems
  }, [facet, rankedItems])

  // "Because you liked…" shelves derived only from local preference weights.
  const tagShelves = useMemo(() => {
    const top = Object.entries(tagPreferences)
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
    return top
      .map(([key]) => ({
        key,
        items: rankedItems.filter((item) => item.tags.some((tag) => creatorKey(tag) === key)).slice(0, 14),
      }))
      .filter((shelf) => shelf.items.length >= 3)
  }, [rankedItems, tagPreferences])

  const creatorShelf = useMemo(() => {
    const top = Object.entries(creatorPreferences)
      .filter(([, weight]) => weight > 0)
      .sort((a, b) => b[1] - a[1])[0]
    if (!top) return null
    const items = rankedItems.filter((item) => creatorKey(item.creator) === top[0]).slice(0, 14)
    return items.length >= 3 ? { name: items[0].creator, items } : null
  }, [creatorPreferences, rankedItems])

  const trending = useMemo(
    () => rankedItems.filter((item) => item.isTrending).sort((a, b) => b.views - a.views).slice(0, 14),
    [rankedItems]
  )

  const surprise = () => {
    if (!rankedItems.length) {
      addToast({ type: 'info', title: 'Nothing to surprise you with yet', message: 'The feed is still loading or fully filtered.' })
      return
    }
    setSelectedItem(rankedItems[Math.floor(Math.random() * Math.min(rankedItems.length, 40))])
  }

  const selectItem = useCallback((item: MediaItem) => setSelectedItem(item), [])
  const openById = useCallback((id: string) => setSelectedItem(mix.find((entry) => entry.id === id) ?? null), [mix])
  const openCategory = useCallback((name: string) => navigate(`/media?category=${encodeURIComponent(name)}`), [navigate])

  return (
    <div className="animate-page-enter d-page">
      {/* Header */}
      <div className="d-hero">
        <div className="d-hero-row">
          <div className="min-w-0">
            <p className="d-eyebrow">For you · private on-device ranking</p>
            <h1 className="d-page-title">Your after-hours mix</h1>
            <p className="d-hero-desc">{modeCopy[discoveryMode]}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Segmented<DiscoveryMode>
                ariaLabel="Discovery balance"
                value={discoveryMode}
                onChange={setDiscoveryMode}
                options={[
                  { value: 'familiar', label: 'Familiar' },
                  { value: 'balanced', label: 'Balanced' },
                  { value: 'adventurous', label: 'Adventurous' },
                ]}
              />
              <button onClick={surprise} className="btn-secondary">
                <Dice5 size={14} strokeWidth={1.75} aria-hidden="true" /> Surprise me
              </button>
              <UpdatedChip updatedAt={discoveryQuery.data?.updatedAt ?? null} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <StrengthRing value={strength} />
            <div>
              <p className="d-eyebrow">Profile strength</p>
              <p className="mt-1.5 max-w-[26ch] text-[12px] leading-5 text-ink-2">
                {strength >= 40 ? 'Learned from your follows, likes and views.' : 'Follow creators and like posts to sharpen this mix.'} All signals stay on this device.
              </p>
            </div>
          </div>
        </div>
      </div>

      {discoveryQuery.isLoading ? (
        <MediaBrowser items={[]} layout={layout === 'list' ? 'cinema' : layout} density={gridDensity} onSelect={openById} loading ariaLabel="Loading your mix" />
      ) : discoveryQuery.error ? (
        <StatePanel
          tone="error"
          icon={RefreshCw}
          title="For You could not load"
          description="The live archive could not be reached. Try again in a moment."
          actionLabel="Retry"
          onAction={() => discoveryQuery.refetch()}
        />
      ) : rankedItems.length === 0 ? (
        <StatePanel
          icon={Sparkles}
          title="Nothing ranked yet"
          description="Once the live feed arrives, your private mix appears here."
          actionLabel="Open library"
          onAction={() => navigate('/media')}
        />
      ) : (
        <>
          <CategoryShelf items={rankedItems} onOpen={openCategory} />

          {creatorShelf && (
            <MediaRail
              title={`More from @${creatorShelf.name}`}
              eyebrow="Because you follow"
              icon={<UserRound size={12} strokeWidth={1.75} aria-hidden="true" />}
              items={creatorShelf.items}
              onSelect={selectItem}
            />
          )}
          {tagShelves.map((shelf) => (
            <MediaRail
              key={shelf.key}
              title={`Because you like #${shelf.key}`}
              eyebrow="From your taste profile"
              icon={<Heart size={12} strokeWidth={1.75} aria-hidden="true" />}
              items={shelf.items}
              onSelect={selectItem}
            />
          ))}
          {trending.length >= 4 && (
            <MediaRail title="Trending now" eyebrow="Rising on public sources" items={trending} onSelect={selectItem} variant="wide" />
          )}

          <section aria-label="Your mix">
            <SectionHeader title="The full mix" eyebrow="Ranked for you" />
            <div className="d-toolbar">
              <FacetToggle value={facet} onChange={setFacet} counts={facetCounts} />
              <span className="d-toolbar-spacer" />
              <LayoutToggle value={layout} onChange={setLayout} />
              {layout !== 'list' && <DensityToggle value={gridDensity} onChange={setGridDensity} />}
            </div>
            {mix.length === 0 ? (
              <StatePanel icon={Sparkles} title="Nothing in this view" description="Switch the media type to see the rest of your mix." actionLabel="Show everything" onAction={() => setFacet('all')} />
            ) : (
              <MediaBrowser items={mix} layout={layout} density={gridDensity} onSelect={openById} resetKey={`${facet}|${discoveryMode}`} ariaLabel="For you" />
            )}
          </section>

          <div className="d-panel flex items-center gap-3">
            <Library size={15} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
            <p className="text-[13px] leading-5 text-ink-2">
              Every suggestion carries its reason inside the detail sheet — follows, tags, and freshness.
              Nothing is inferred from your body or identity.
            </p>
          </div>
        </>
      )}

      {/* Federated web: explicit PeerTube/Mastodon instances, metadata-only with attribution */}
      <Suspense fallback={null}>
        <ImportUrl />
        <FederatedSearch />
      </Suspense>

      <MediaDetail
        item={selectedItem}
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        items={mix}
        onNavigate={setSelectedItem}
      />
    </div>
  )
}
