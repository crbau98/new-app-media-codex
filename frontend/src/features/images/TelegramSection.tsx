import React, { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { TelegramMedia, TelegramChannelCandidate } from "@/lib/api"
import { useAppStore } from "@/store"
import { Spinner } from "@/components/Spinner"
import { SkeletonGrid } from "@/components/Skeleton"
import { cn } from "@/lib/cn"

function FilterChip({
  active,
  children,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-2 text-xs transition-all",
        active
          ? "border-accent/40 bg-accent/12 text-text-primary"
          : "border-white/8 bg-white/[0.03] text-text-secondary hover:border-accent/30 hover:text-text-primary"
      )}
    >
      {children}
    </button>
  )
}

function VideoPlayerModal({
  media,
  onClose,
}: {
  media: TelegramMedia
  onClose: () => void
}) {
  const streamUrl = api.telegramStreamUrl(media.id)
  const duration = media.duration != null ? `${Math.floor(media.duration / 60)}:${String(media.duration % 60).padStart(2, '0')}` : null

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] max-w-[90vw] flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close video player"
          className="absolute -right-3 -top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white/70 transition-colors hover:text-white"
        >
          ×
        </button>
        <video
          src={streamUrl}
          controls
          autoPlay
          className="max-h-[80vh] max-w-[90vw] rounded-[16px] bg-black"
          style={{ minWidth: '320px' }}
        />
        <div className="flex items-center justify-between px-1">
          <p className="text-sm text-text-secondary line-clamp-2">{media.caption || `@${media.channel_username}`}</p>
          <div className="flex shrink-0 items-center gap-3 text-xs text-text-muted">
            {duration && <span>⏱ {duration}</span>}
            {media.file_size && <span>{(media.file_size / 1_048_576).toFixed(1)} MB</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function TelegramVideosTab() {
  const [playingMedia, setPlayingMedia] = useState<TelegramMedia | null>(null)
  const [channelFilter, setChannelFilter] = useState<string | null>(null)

  const { data: channelsData } = useQuery({
    queryKey: ['telegram-channels'],
    queryFn: api.telegramChannels,
    staleTime: 60_000,
  })

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['telegram-media', channelFilter],
    queryFn: ({ pageParam = 0 }) =>
      api.browseTelegramMedia({
        media_type: 'video',
        ...(channelFilter ? { channel: channelFilter } : {}),
        limit: 40,
        offset: pageParam as number,
      }),
    getNextPageParam: (last) => (last.has_more ? last.offset + last.items.length : undefined),
    initialPageParam: 0,
  })

  const allMedia = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])

  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect()
      if (!node) return
      observerRef.current = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      })
      observerRef.current.observe(node)
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  )

  const channels = channelsData ?? []

  return (
    <div className="space-y-4">
      {/* Channel filter chips */}
      {channels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <FilterChip active={channelFilter === null} onClick={() => setChannelFilter(null)}>
            All channels
          </FilterChip>
          {channels.map((ch) => (
            <FilterChip
              key={ch.username}
              active={channelFilter === ch.username}
              onClick={() => setChannelFilter(ch.username === channelFilter ? null : ch.username)}
            >
              @{ch.username}
            </FilterChip>
          ))}
        </div>
      )}

      {isLoading && <SkeletonGrid count={12} />}

      {!isLoading && allMedia.length === 0 && (
        <div className="panel-surface flex flex-col items-center justify-center gap-4 rounded-[32px] px-6 py-20 text-center">
          <p className="text-2xl font-semibold text-text-primary">No videos yet</p>
          <p className="text-text-secondary">Add channels in the Channels tab and run a scan.</p>
        </div>
      )}

      {allMedia.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {allMedia.map((media) => (
            <article
              key={media.id}
              role="button"
              tabIndex={0}
              onClick={() => setPlayingMedia(media)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPlayingMedia(media) } }}
              aria-label={`Play video: ${media.caption || media.channel_username}`}
              className="card-lift group panel-surface relative cursor-pointer overflow-hidden rounded-[24px]"
            >
              <div className="relative aspect-[4/5] flex items-center justify-center bg-black/40">
                {/* Play button overlay */}
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/25 bg-black/50 backdrop-blur-sm transition-all group-hover:scale-105 group-hover:border-accent/50">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="ml-1 text-white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </div>
                {/* Duration badge */}
                {media.duration != null && (
                  <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2 py-1 text-[10px] font-mono text-white/90">
                    {Math.floor(media.duration / 60)}:{String(media.duration % 60).padStart(2, '0')}
                  </span>
                )}
                {/* Channel badge */}
                <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2 py-1 text-[10px] font-mono uppercase tracking-widest text-white/85">
                  @{media.channel_username}
                </span>
              </div>
              {media.caption && (
                <div className="px-4 py-3">
                  <p className="line-clamp-2 text-sm text-text-secondary">{media.caption}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-4" />
      {isFetchingNextPage && <div className="flex justify-center py-4"><Spinner /></div>}

      {playingMedia && (
        <VideoPlayerModal media={playingMedia} onClose={() => setPlayingMedia(null)} />
      )}
    </div>
  )
}

function TelegramChannelsTab() {
  const addToast = useAppStore((s) => s.addToast)
  const [newUsername, setNewUsername] = useState('')
  const [discoverQuery, setDiscoverQuery] = useState('')
  const [showDiscoverModal, setShowDiscoverModal] = useState(false)
  const [candidates, setCandidates] = useState<TelegramChannelCandidate[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [discovering, setDiscovering] = useState(false)
  const [adding, setAdding] = useState(false)

  const { data: channels = [], refetch: refetchChannels } = useQuery({
    queryKey: ['telegram-channels'],
    queryFn: api.telegramChannels,
    staleTime: 30_000,
  })

  const { data: scanStatus, refetch: refetchScanStatus } = useQuery({
    queryKey: ['telegram-scan-status'],
    queryFn: api.telegramScanStatus,
    refetchInterval: (q) => (q.state.data?.running ? 2_000 : false),
    staleTime: 30_000,
  })
  const scanning = scanStatus?.running ?? false
  const qc = useQueryClient()
  const prevScanningRef = useRef(scanning)
  useEffect(() => {
    if (prevScanningRef.current && !scanning) {
      qc.invalidateQueries({ queryKey: ['telegram-media'] })
    }
    prevScanningRef.current = scanning
  }, [scanning, qc])

  async function handleAdd() {
    if (!newUsername.trim()) return
    setAdding(true)
    try {
      await api.addTelegramChannel(newUsername.trim())
      setNewUsername('')
      await refetchChannels()
      addToast('Channel added', 'success')
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : 'Failed to add channel', 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleDiscover() {
    if (!discoverQuery.trim()) return
    setDiscovering(true)
    setCandidates([])
    try {
      const result = await api.discoverTelegramChannels(discoverQuery.trim())
      setCandidates(result.candidates.filter((c) => c.valid))
      if (result.candidates.filter((c) => c.valid).length === 0) {
        addToast('No valid channels found for that query', 'info')
      }
    } catch {
      addToast('Discovery failed', 'error')
    } finally {
      setDiscovering(false)
    }
  }

  async function handleAddSelected() {
    const usernames = Array.from(selectedCandidates)
    for (const username of usernames) {
      try {
        await api.addTelegramChannel(username)
      } catch {
        // ignore individual failures
      }
    }
    await refetchChannels()
    setShowDiscoverModal(false)
    setCandidates([])
    setSelectedCandidates(new Set())
    addToast(`Added ${usernames.length} channel${usernames.length === 1 ? '' : 's'}`, 'success')
  }

  async function handleScan() {
    try {
      const r = await api.triggerTelegramScan()
      await refetchScanStatus()
      addToast(r.status === 'already_running' ? 'Scan already running' : 'Telegram scan started', 'success')
    } catch {
      addToast('Failed to start scan', 'error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            placeholder="@channelname"
            className="rounded-2xl border border-white/10 bg-black/15 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newUsername.trim()}
            className="rounded-2xl border border-accent/35 bg-accent/12 px-4 py-2.5 text-sm font-medium text-text-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add channel'}
          </button>
        </div>
        <button
          onClick={() => setShowDiscoverModal(true)}
          className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          Discover channels
        </button>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
        >
          {scanning ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Scanning…
            </span>
          ) : (
            'Scan now'
          )}
        </button>
        {scanStatus?.last_result && !scanning && (
          <span className="text-xs text-text-muted">
            Last scan: {scanStatus.last_result.photos} photos, {scanStatus.last_result.videos} videos
          </span>
        )}
      </div>

      {/* Channel list */}
      {channels.length === 0 ? (
        <div className="panel-surface rounded-[24px] px-6 py-12 text-center text-text-secondary">
          No channels configured. Add a channel above or use Discover.
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch) => (
            <div
              key={ch.username}
              className="panel-surface flex items-center gap-4 rounded-[20px] px-5 py-4"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary">{ch.display_name}</p>
                <p className="text-xs text-text-muted font-mono">
                  @{ch.username}
                  {ch.member_count != null && ` · ${ch.member_count.toLocaleString()} members`}
                  {ch.last_scanned_at && ` · scanned ${new Date(ch.last_scanned_at).toLocaleDateString()}`}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(ch.enabled)}
                  onChange={async (e) => {
                    await api.toggleTelegramChannel(ch.username, e.target.checked)
                    refetchChannels()
                  }}
                  className="accent-accent"
                />
                Enabled
              </label>
              <button
                onClick={async () => {
                  await api.removeTelegramChannel(ch.username)
                  refetchChannels()
                  addToast('Channel removed', 'success')
                }}
                className="rounded-full p-2 text-text-muted transition-colors hover:text-red-300"
                title="Remove channel"
                aria-label="Remove channel"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Discover modal */}
      {showDiscoverModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setShowDiscoverModal(false)}
        >
          <div
            className="panel-surface w-full max-w-lg rounded-[28px] p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-text-primary">Discover Telegram channels</h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDiscover() }}
                placeholder="e.g. gay sex videos"
                className="flex-1 rounded-2xl border border-white/10 bg-black/15 px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted"
                autoFocus
              />
              <button
                onClick={handleDiscover}
                disabled={discovering || !discoverQuery.trim()}
                className="rounded-2xl border border-accent/35 bg-accent/12 px-4 py-2.5 text-sm font-medium text-text-primary disabled:opacity-50"
              >
                {discovering ? '…' : 'Search'}
              </button>
            </div>
            {candidates.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {candidates.map((c) => (
                  <label
                    key={c.username}
                    className="flex cursor-pointer items-start gap-3 rounded-[16px] border border-white/8 bg-white/[0.03] px-4 py-3 hover:border-accent/30"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCandidates.has(c.username)}
                      onChange={(e) => {
                        setSelectedCandidates((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(c.username)
                          else next.delete(c.username)
                          return next
                        })
                      }}
                      className="mt-0.5 accent-accent"
                    />
                    <div>
                      <p className="text-sm font-medium text-text-primary">{c.display_name || c.username}</p>
                      <p className="text-xs text-text-muted">
                        @{c.username}
                        {c.member_count != null && ` · ${c.member_count.toLocaleString()} members`}
                      </p>
                      {c.description && <p className="mt-1 text-xs text-text-secondary line-clamp-2">{c.description}</p>}
                    </div>
                  </label>
                ))}
              </div>
            )}
            {candidates.length > 0 && (
              <button
                onClick={handleAddSelected}
                disabled={selectedCandidates.size === 0}
                className="w-full rounded-2xl border border-accent/35 bg-accent/12 py-2.5 text-sm font-medium text-text-primary disabled:opacity-50"
              >
                Add {selectedCandidates.size} selected
              </button>
            )}
            <button
              onClick={() => setShowDiscoverModal(false)}
              className="w-full py-2 text-sm text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function TelegramSection() {
  const [telegramTab, setTelegramTab] = useState<'channels' | 'videos'>('channels')

  return (
    <section className="panel-surface rounded-[28px] px-6 py-6 space-y-4">
      <div className="flex items-center gap-1">
        {(['channels', 'videos'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setTelegramTab(tab)}
            className={cn(
              'rounded-2xl px-4 py-2 text-sm capitalize transition-colors',
              telegramTab === tab
                ? 'bg-accent/12 text-text-primary border border-accent/35'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      {telegramTab === 'channels' ? <TelegramChannelsTab /> : <TelegramVideosTab />}
    </section>
  )
}
