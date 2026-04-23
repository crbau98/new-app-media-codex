import { useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useAppStore } from "@/store"
import {
  fetchTrendingMedia,
  fetchPopularCreators,
  fetchNewThisWeek,
  type TrendingItem,
  type PopularCreator,
  type NewThisWeekItem,
} from "@/lib/discovery"
import { getPerformerAvatarSrc } from "@/lib/performer"

function HorizontalRail({
  title,
  children,
  isLoading,
}: {
  title: string
  children: React.ReactNode
  isLoading?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function checkScroll() {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener("scroll", checkScroll, { passive: true })
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", checkScroll)
      ro.disconnect()
    }
  }, [children])

  function scrollBy(delta: number) {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" })
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-text-primary">{title}</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scrollBy(-400)}
            disabled={!canScrollLeft}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:bg-white/[0.08] hover:text-text-primary disabled:opacity-30"
            aria-label="Scroll left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <button
            onClick={() => scrollBy(400)}
            disabled={!canScrollRight}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:bg-white/[0.08] hover:text-text-primary disabled:opacity-30"
            aria-label="Scroll right"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-4 overflow-hidden py-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shrink-0">
              <div className="skeleton-grid-tile h-40 w-40 rounded-2xl" />
              <div className="mt-2 h-3 w-24 rounded-full skeleton-line" />
            </div>
          ))}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="hide-scrollbar flex gap-3 overflow-x-auto pb-2"
        >
          {children}
        </div>
      )}
    </section>
  )
}

function TrendingCard({ item }: { item: TrendingItem }) {
  const setActiveView = useAppStore((s) => s.setActiveView)
  return (
    <button
      onClick={() => {
        window.location.hash = `#/media?term=${encodeURIComponent(item.title)}`
        setActiveView("images")
      }}
      className="group shrink-0 text-left"
    >
      <div className="relative h-40 w-40 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] transition-colors group-hover:border-white/15">
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-white/10">
            🖼
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6">
          <p className="truncate text-[11px] font-medium text-white/90">{item.title}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/60">
            <span className="flex items-center gap-0.5">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              {item.views_count.toLocaleString()}
            </span>
            <span className="flex items-center gap-0.5">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              {item.likes_count.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

function CreatorCard({ creator }: { creator: PopularCreator }) {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const avatar = getPerformerAvatarSrc(creator as any) ?? creator.avatar_url
  return (
    <button
      onClick={() => {
        window.location.hash = `#/performers?id=${creator.id}`
        setActiveView("performers")
      }}
      className="group shrink-0 flex w-36 flex-col items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06] hover:border-white/15"
    >
      <div className="relative h-16 w-16 overflow-hidden rounded-full bg-white/10">
        {avatar ? (
          <img
            src={avatar}
            alt={creator.display_name ?? creator.username}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl text-white/40">
            {(creator.display_name ?? creator.username).charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="text-center">
        <p className="truncate text-xs font-medium text-text-primary group-hover:text-accent">
          {creator.display_name ?? creator.username}
        </p>
        <p className="truncate text-[10px] text-text-muted">{creator.platform}</p>
        <p className="mt-0.5 text-[10px] text-text-muted">
          {creator.follower_count.toLocaleString()} followers
        </p>
      </div>
    </button>
  )
}

function NewThisWeekCard({ item }: { item: NewThisWeekItem }) {
  const setActiveView = useAppStore((s) => s.setActiveView)
  return (
    <button
      onClick={() => {
        window.location.hash = `#/media?term=${encodeURIComponent(item.title)}`
        setActiveView("images")
      }}
      className="group shrink-0 text-left"
    >
      <div className="relative h-40 w-40 overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] transition-colors group-hover:border-white/15">
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-white/10">
            🖼
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6">
          <p className="truncate text-[11px] font-medium text-white/90">{item.title}</p>
          <p className="mt-0.5 text-[10px] text-white/60">
            {new Date(item.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
        </div>
      </div>
    </button>
  )
}

export function ExplorePage() {
  const trendingQuery = useQuery({
    queryKey: ["discovery", "trending"],
    queryFn: fetchTrendingMedia,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const creatorsQuery = useQuery({
    queryKey: ["discovery", "popular-creators"],
    queryFn: fetchPopularCreators,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const newThisWeekQuery = useQuery({
    queryKey: ["discovery", "new-this-week"],
    queryFn: fetchNewThisWeek,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  return (
    <div className="mx-auto max-w-[1680px]">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Explore</h1>
        <p className="mt-1 text-sm text-text-muted">Discover trending media, popular creators, and new arrivals.</p>
      </div>

      <HorizontalRail title="Trending" isLoading={trendingQuery.isLoading}>
        {(trendingQuery.data ?? []).map((item) => (
          <TrendingCard key={item.id} item={item} />
        ))}
      </HorizontalRail>

      <HorizontalRail title="Popular Creators" isLoading={creatorsQuery.isLoading}>
        {(creatorsQuery.data ?? []).map((creator) => (
          <CreatorCard key={creator.id} creator={creator} />
        ))}
      </HorizontalRail>

      <HorizontalRail title="New This Week" isLoading={newThisWeekQuery.isLoading}>
        {(newThisWeekQuery.data ?? []).map((item) => (
          <NewThisWeekCard key={item.id} item={item} />
        ))}
      </HorizontalRail>
    </div>
  )
}
