import { useState, useCallback, useMemo, startTransition } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { useAppStore } from "@/store"
import { api } from "@/lib/api"
import { cn } from "@/lib/cn"
import { getBestAvailablePreviewSrc } from "@/lib/media"
import { EmptyState } from "@/components/EmptyState"
import { Spinner } from "@/components/Spinner"

type ProfileTab = "media" | "liked" | "playlists" | "following"

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-sm font-semibold text-text-primary">{value}</span>
      <span className="text-[10px] text-text-muted uppercase tracking-wider">{label}</span>
    </div>
  )
}

function ProfileGrid({ shots, onOpen }: { shots: Array<{ id: number; src?: string | null; alt?: string }>; onOpen: (id: number) => void }) {
  if (shots.length === 0) {
    return (
      <div className="py-12">
        <EmptyState
          icon="📂"
          eyebrow="Empty"
          title="No items yet"
          description="Content you interact with will appear here."
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-px sm:gap-0.5">
      {shots.map((shot, idx) => (
        <motion.button
          key={shot.id}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: Math.min(idx * 0.02, 0.3), duration: 0.3 }}
          onClick={() => onOpen(shot.id)}
          className="group relative aspect-square overflow-hidden bg-black/20"
        >
          {shot.src ? (
            <img
              src={shot.src}
              alt={shot.alt || ""}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/5">
              <span className="text-2xl text-text-muted">📷</span>
            </div>
          )}
        </motion.button>
      ))}
    </div>
  )
}

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<ProfileTab>("media")
  const setActiveView = useAppStore((s) => s.setActiveView)
  const addToast = useAppStore((s) => s.addToast)

  const { data: mediaStats } = useQuery({
    queryKey: ["media-stats"],
    queryFn: () => api.mediaStats(),
    staleTime: 60_000,
  })

  const { data: screenshotsData, isLoading: shotsLoading } = useQuery({
    queryKey: ["screenshots", "profile", "recent"],
    queryFn: () => api.browseScreenshots({ limit: 60, offset: 0, sort: "newest" }),
    staleTime: 60_000,
  })

  const { data: topRated } = useQuery({
    queryKey: ["screenshots", "top-rated"],
    queryFn: () => api.topRatedScreenshots(),
    staleTime: 120_000,
  })

  const { data: playlists } = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.playlists(),
    staleTime: 120_000,
  })

  const { data: followsData } = useQuery({
    queryKey: ["performers", "following"],
    queryFn: () => api.browsePerformers({ limit: 60, offset: 0, sort: "most_media" }),
    staleTime: 120_000,
  })

  const recentShots = useMemo(() => {
    return (screenshotsData?.screenshots ?? []).map((s) => ({
      id: s.id,
      src: getBestAvailablePreviewSrc(s),
      alt: s.term,
    }))
  }, [screenshotsData])

  const likedShots = useMemo(() => {
    return (topRated ?? []).map((s) => ({
      id: s.id,
      src: getBestAvailablePreviewSrc(s),
      alt: s.term,
    }))
  }, [topRated])

  const handleOpenShot = useCallback((id: number) => {
    addToast(`Opened screenshot #${id} — viewer integration coming soon`, "info")
  }, [addToast])

  const tabs: { id: ProfileTab; label: string }[] = [
    { id: "media", label: "My Media" },
    { id: "liked", label: "Liked" },
    { id: "playlists", label: "Playlists" },
    { id: "following", label: "Following" },
  ]

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="flex flex-col items-center gap-4 px-4 py-6 sm:flex-row sm:items-start sm:gap-6">
        {/* Avatar */}
        <div className="relative">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-accent to-fuchsia-500 ring-2 ring-white/10 sm:h-[80px] sm:w-[80px]">
            <span className="text-2xl font-bold text-white">U</span>
          </div>
        </div>

        {/* Info */}
        <div className="flex flex-1 flex-col items-center gap-3 sm:items-start">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text-primary">default_user</h1>
            <button
              onClick={() => startTransition(() => setActiveView("settings"))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:text-text-primary"
              aria-label="Settings"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-text-secondary text-center sm:text-left">
            Media collector & curator
          </p>

          {/* Stats */}
          <div className="flex items-center gap-6">
            <StatCard label="Media" value={(mediaStats?.total ?? 0).toLocaleString()} />
            <StatCard label="Likes" value={(mediaStats?.favorites_count ?? 0).toLocaleString()} />
            <StatCard label="Following" value={(followsData?.total ?? 0).toLocaleString()} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-14 z-10 border-b border-white/5 bg-bg-base/80 backdrop-blur-md">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors",
                activeTab === tab.id ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="profile-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="min-h-[300px] py-4">
        {shotsLoading && activeTab === "media" ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : activeTab === "media" ? (
          <ProfileGrid shots={recentShots} onOpen={handleOpenShot} />
        ) : activeTab === "liked" ? (
          <ProfileGrid shots={likedShots} onOpen={handleOpenShot} />
        ) : activeTab === "playlists" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {(playlists ?? []).length === 0 ? (
              <div className="col-span-full py-12">
                <EmptyState
                  icon="🎵"
                  eyebrow="No playlists"
                  title="Create your first playlist"
                  description="Organize your favorite media into collections."
                />
              </div>
            ) : (
              (playlists ?? []).map((playlist) => (
                <button
                  key={playlist.id}
                  className="flex flex-col gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M9 3v18" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">{playlist.name}</p>
                      <p className="text-[11px] text-text-muted">{playlist.item_count} items</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(followsData?.performers ?? []).length === 0 ? (
              <div className="col-span-full py-12">
                <EmptyState
                  icon="👤"
                  eyebrow="Not following anyone"
                  title="Discover creators"
                  description="Follow creators to see their latest content here."
                />
              </div>
            ) : (
              (followsData?.performers ?? []).map((performer) => (
                <button
                  key={performer.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-accent/15 text-accent ring-1 ring-white/10">
                    <span className="text-sm font-semibold">
                      {(performer.display_name || performer.username).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">@{performer.username}</p>
                    <p className="text-[11px] text-text-muted">
                      {(performer.screenshots_count ?? 0).toLocaleString()} shots · {performer.platform}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  )
}
