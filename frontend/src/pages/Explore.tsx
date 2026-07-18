import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Dice5, Library, RefreshCw, Sparkles } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { fetchLiveDiscovery } from '@/lib/api'
import { discoveryStrength, rankForYou, type DiscoveryMode } from '@/lib/discovery'
import { useAppStore, type GridDensity } from '@/store'
import MediaCard from '@/components/MediaCard'
import MediaDetail from '@/components/MediaDetail'
import EmptyState from '@/components/EmptyState'
import SkeletonGrid from '@/components/SkeletonGrid'
import UpdatedChip from '@/components/UpdatedChip'
import { cn } from '@/lib/utils'

const densityCols: Record<GridDensity, string> = {
  compact: 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7',
  normal: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6',
  spacious: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5',
}

const modeCopy: Record<DiscoveryMode, string> = {
  balanced: 'A steady mix of what you love and a few new directions.',
  familiar: 'Mostly the creators and themes you already lean into.',
  adventurous: 'More novelty: fresh tags and creators you have not engaged with yet.',
}

export default function Explore() {
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null)
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
  const addToast = useAppStore((s) => s.addToast)

  const discoveryQuery = useQuery({
    queryKey: ['live-discovery', creatorWatchlist],
    queryFn: () => fetchLiveDiscovery(creatorWatchlist),
  })

  const strength = discoveryStrength(tagPreferences, creatorPreferences)

  const rankedItems = useMemo(() => {
    const items = discoveryQuery.data?.items ?? []
    return rankForYou(items, {
      tagPreferences,
      creatorPreferences,
      followCache,
      likeCache,
      recentlyViewed,
      hiddenMedia,
      mode: discoveryMode,
    })
  }, [creatorPreferences, discoveryMode, discoveryQuery.data, followCache, hiddenMedia, likeCache, recentlyViewed, tagPreferences])

  const surprise = () => {
    if (!rankedItems.length) {
      addToast({ type: 'info', title: 'Nothing to surprise you with yet', message: 'The feed is still loading or fully filtered.' })
      return
    }
    const pick = rankedItems[Math.floor(Math.random() * Math.min(rankedItems.length, 40))]
    setSelectedItem(pick)
  }

  return (
    <div className="animate-page-enter space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="eyebrow">For you · private on-device ranking</p>
          <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-ink">Your after-hours mix</h1>
          <p className="mt-1.5 max-w-xl text-[13px] leading-5 text-ink-2">{modeCopy[discoveryMode]}</p>
        </div>
        <div className="flex items-center gap-2">
          <UpdatedChip updatedAt={discoveryQuery.data?.updatedAt ?? null} />
          <button onClick={surprise} className="btn-secondary">
            <Dice5 size={14} strokeWidth={1.75} aria-hidden="true" /> Surprise me
          </button>
        </div>
      </div>

      {/* Personalization strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-line p-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Profile strength</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-1 w-24 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full rounded-full bg-heat transition-all" style={{ width: `${strength}%` }} />
            </span>
            <span className="font-mono text-xs text-ink">{strength}%</span>
          </div>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Discovery balance</p>
          <div className="mt-1 flex gap-1">
            {(['familiar', 'balanced', 'adventurous'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setDiscoveryMode(mode)}
                className={cn('chip !min-h-10 !px-3', discoveryMode === mode && 'chip-active')}
                aria-pressed={discoveryMode === mode}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <p className="font-mono text-[10px] leading-4 text-ink-3">
          {strength >= 40 ? 'Learned from your follows, likes and views.' : 'Follow creators and like posts to sharpen this mix.'}
          {' '}All signals stay on this device.
        </p>
      </div>

      {/* Content */}
      {discoveryQuery.isLoading ? (
        <SkeletonGrid count={12} />
      ) : discoveryQuery.error ? (
        <EmptyState
          icon={RefreshCw}
          title="For You could not load"
          description="The live archive could not be reached. Try again in a moment."
          actionLabel="Retry"
          onAction={() => discoveryQuery.refetch()}
        />
      ) : rankedItems.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Nothing ranked yet"
          description="Once the live feed arrives, your private mix appears here."
          actionLabel="Open library"
          onAction={() => navigate('/media')}
        />
      ) : (
        <div className={cn('media-grid grid gap-4', densityCols[gridDensity])}>
          {rankedItems.slice(0, 60).map((item) => (
            <MediaCard key={item.id} item={item} aspectRatio="2/3" onSelect={(id) => setSelectedItem(rankedItems.find((entry) => entry.id === id) ?? null)} />
          ))}
        </div>
      )}

      {rankedItems.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-line p-4">
          <Library size={14} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
          <p className="text-[13px] leading-5 text-ink-2">
            Every suggestion carries its reason inside the detail sheet — follows, tags, and freshness.
            Nothing is inferred from your body or identity.
          </p>
        </div>
      )}

      <MediaDetail
        item={selectedItem}
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        items={rankedItems}
        onNavigate={setSelectedItem}
      />
    </div>
  )
}
