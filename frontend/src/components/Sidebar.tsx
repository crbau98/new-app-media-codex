import { useState, useEffect, useRef, startTransition, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/cn"
import { useAppStore, type ActiveView } from "../store"
import { useAppShellSummary } from "@/hooks/useAppShellSummary"
import { api } from "../lib/api"
import { prefetchViewModule } from "@/lib/view-loader"

interface NavItem {
  id: ActiveView
  label: string
  icon: ReactNode
  hint?: string
}

const MEDIA_ITEMS: NavItem[] = [
  {
    id: "images",
    label: "Media",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>,
  },
  {
    id: "performers",
    label: "Creators",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
]

const SETTINGS_ITEMS: NavItem[] = [
  {
    id: "settings",
    label: "Settings",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>,
  },
]

function NavGroup({
  label,
  items,
  activeView,
  setActiveView,
  collapsed,
  counts,
  newCounts,
  warnings,
  queueActive,
  closeMobile,
}: {
  label: string
  items: NavItem[]
  activeView: ActiveView
  setActiveView: (v: ActiveView) => void
  collapsed: boolean
  counts?: Partial<Record<string, number>>
  newCounts?: Partial<Record<string, number>>
  warnings?: Partial<Record<string, number>>
  queueActive?: Partial<Record<string, boolean>>
  closeMobile: () => void
}) {
  return (
    <div className="mb-5">
      {!collapsed && <p className="eyebrow px-3 pb-2">{label}</p>}
      <ul className={cn("space-y-1", collapsed ? "px-1" : "px-2")}>
        {items.map((item) => {
          const isActive = activeView === item.id
          const count = counts?.[item.id]
          const newCount = newCounts?.[item.id]
          const warning = warnings?.[item.id]
          const hasNew = newCount != null && newCount > 0
          return (
            <li key={item.id}>
              <button
                onClick={() => {
                  startTransition(() => {
                    setActiveView(item.id)
                  })
                  closeMobile()
                }}
                onMouseEnter={() => prefetchViewModule(item.id)}
                onFocus={() => prefetchViewModule(item.id)}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-[background-color,color,box-shadow,transform] duration-150",
                  collapsed ? "justify-center px-2" : "",
                  isActive
                    ? "bg-white/[0.07] text-text-primary"
                    : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary"
                )}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-accent"
                    style={{ boxShadow: "0 0 14px var(--color-accent-glow)" }}
                  />
                )}
                <span className="relative shrink-0 text-current transition-transform duration-200 group-hover:scale-105">
                  {item.icon}
                  {collapsed && hasNew && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-[var(--bg-base)]" />
                  )}
                  {collapsed && !hasNew && warning != null && warning > 0 && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-[var(--bg-base)]" />
                  )}
                  {collapsed && !hasNew && queueActive?.[item.id] && !(warning != null && warning > 0) && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-accent ring-2 ring-[var(--bg-base)]" />
                  )}
                </span>
                {!collapsed && (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
                )}
                {!collapsed && hasNew && (
                  <span className="rounded-full border border-accent/30 bg-accent/15 px-2 py-0.5 text-[10px] font-mono text-accent tabular-nums" title="New since last visit">
                    +{newCount! >= 1000 ? `${(newCount! / 1000).toFixed(1)}k` : newCount}
                  </span>
                )}
                {!collapsed && !hasNew && warning != null && warning > 0 && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono text-amber-400 tabular-nums" title="Due for check">
                    {warning}
                  </span>
                )}
                {!collapsed && !hasNew && warning == null && count != null && count > 0 && (
                  <span className="rounded-full border border-white/8 bg-white/5 px-2 py-1 text-[10px] font-mono text-text-secondary tabular-nums">
                    {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
                  </span>
                )}
                {!collapsed && queueActive?.[item.id] && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CrawlFooter({ collapsed, ready }: { collapsed: boolean; ready: boolean }) {
  const crawlRunning = useAppStore((s) => s.crawlRunning)
  const screenshotRunning = useAppStore((s) => s.screenshotRunning)
  const setScreenshotRunning = useAppStore((s) => s.setScreenshotRunning)
  const addToast = useAppStore((s) => s.addToast)
  const { data: footerSummary } = useAppShellSummary(ready)

  // Full capture progress (term, counts)
  const [captureProgress, setCaptureProgress] = useState<{
    current_term?: string
    terms_done?: number
    terms_total?: number
    items_found?: number
  } | null>(null)

  const screenshotRunningRef = useRef(screenshotRunning)
  useEffect(() => { screenshotRunningRef.current = screenshotRunning }, [screenshotRunning])
  const optimisticCaptureRef = useRef(false)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function poll() {
      try {
        const s = await api.screenshotStatus()
        if (!cancelled) {
          const running = Boolean(s?.running)
          if (running || !optimisticCaptureRef.current) setScreenshotRunning(running)
          if (running && s.terms_total) {
            setCaptureProgress({
              current_term: s.current_term,
              terms_done: s.terms_done,
              terms_total: s.terms_total,
              items_found: s.items_found,
            })
          } else {
            setCaptureProgress(null)
          }
          if (!running) {
            optimisticCaptureRef.current = false
          }
        }
      } catch {
        // ignore
      }
      if (!cancelled && (screenshotRunningRef.current || optimisticCaptureRef.current)) {
        timer = setTimeout(poll, screenshotRunningRef.current ? 2_000 : 4_000)
      }
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [ready, screenshotRunning, setScreenshotRunning])

  const lastRun = footerSummary?.last_run
  const lastRunAgo = lastRun?.finished_at
    ? (() => {
        const diff = Date.now() - new Date(lastRun.finished_at).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 60) return `${mins}m ago`
        return `${Math.floor(mins / 60)}h ago`
      })()
    : null

  async function handleRun() {
    if (crawlRunning) return
    try {
      await api.triggerCrawl()
    } catch {
      addToast("Failed to start crawl", "error")
    }
  }

  async function handleCapture() {
    if (screenshotRunning) return
    optimisticCaptureRef.current = true
    setScreenshotRunning(true)
    try {
      const result = await api.triggerCapture()
      addToast(
        result.status === "already_running" ? "Capture already in progress" : "Capture started",
        "success"
      )
    } catch {
      optimisticCaptureRef.current = false
      setScreenshotRunning(false)
      addToast("Failed to start screenshot capture", "error")
    }
    setTimeout(() => {
      optimisticCaptureRef.current = false
    }, 2_000)
  }

  if (collapsed) {
    return (
      <div className="space-y-1.5 border-t border-white/[0.06] px-2 py-3">
        <button
          onClick={handleRun}
          disabled={crawlRunning}
          className="flex h-8 w-full items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          title="Crawl"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button
          onClick={handleCapture}
          disabled={screenshotRunning}
          className="flex h-8 w-full items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
          title="Capture"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
      </div>
    )
  }

  return (
    <div className="border-t border-white/[0.06] px-3 py-3">
      {screenshotRunning && captureProgress && (
        <div className="mb-2.5 rounded-lg bg-white/[0.03] px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-muted">
            <span>Capturing</span>
            <span className="font-mono text-teal">{captureProgress.terms_done ?? 0}/{captureProgress.terms_total ?? '?'}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-teal transition-[width] duration-500"
              style={{
                width: captureProgress.terms_total
                  ? `${Math.round(((captureProgress.terms_done ?? 0) / captureProgress.terms_total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleRun}
          disabled={crawlRunning}
          className="rounded-lg bg-white/[0.05] px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-white/[0.08] hover:text-text-primary disabled:opacity-50"
        >
          {crawlRunning ? "Running..." : "Crawl"}
        </button>
        <button
          onClick={handleCapture}
          disabled={screenshotRunning}
          className="rounded-lg bg-teal/10 px-3 py-2 text-xs font-medium text-teal transition-colors hover:bg-teal/15 disabled:opacity-50"
        >
          {screenshotRunning ? "Capturing..." : "Capture"}
        </button>
      </div>
    </div>
  )
}


export function Sidebar() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed)
  const mobileNavOpen = useAppStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen)
  const [sidebarEnhancementsReady, setSidebarEnhancementsReady] = useState(false)
  const { data: sidebarSummary } = useAppShellSummary(sidebarEnhancementsReady)
  const { data: perfStats } = useQuery({
    queryKey: ["performer-stats"],
    queryFn: () => api.performerStats(),
    enabled: sidebarEnhancementsReady,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
  const { data: captureQueueData } = useQuery({
    queryKey: ["capture-queue"],
    queryFn: () => api.getCaptureQueue(),
    enabled: sidebarEnhancementsReady,
    refetchInterval: (query) => {
      const queue = query.state.data?.queue ?? []
      return queue.some((e) => e.status === "queued" || e.status === "running") ? 5_000 : 60_000
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const captureQueueActive = (captureQueueData?.queue ?? []).some(
    (e) => e.status === "queued" || e.status === "running"
  )
  // Use media-stats for accurate screenshot count (app-shell-summary returns 0 for image_count)
  const { data: mediaStats } = useQuery({
    queryKey: ["sidebar-media-stats"],
    queryFn: () => api.mediaStats(),
    enabled: sidebarEnhancementsReady,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  const counts: Partial<Record<string, number>> = {
    images: mediaStats?.total ?? sidebarSummary?.stats?.totals?.image_count,
    performers: perfStats?.total,
  }

  const currentImageCount = mediaStats?.total ?? sidebarSummary?.stats?.totals?.image_count ?? 0
  const [lastSeenImageCount, setLastSeenImageCount] = useState<number | null>(null)
  const newImageCount =
    lastSeenImageCount != null && currentImageCount > lastSeenImageCount
      ? currentImageCount - lastSeenImageCount
      : 0

  // When user visits images view, mark all as seen
  useEffect(() => {
    if (activeView === "images" && currentImageCount > 0) {
      setLastSeenImageCount(currentImageCount)
    }
  }, [activeView, currentImageCount])

  useEffect(() => {
    let cancelled = false

    const enableEnhancements = () => {
      if (!cancelled) setSidebarEnhancementsReady(true)
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(enableEnhancements, { timeout: 1200 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(idleId)
      }
    }

    const timeoutId = setTimeout(enableEnhancements, 400)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [])

  function toggleCollapse() {
    const next = !collapsed
    setSidebarCollapsed(next)
  }

  function closeMobile() {
    setMobileNavOpen(false)
  }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-30 hidden bg-[#02060c]/65 backdrop-blur-[2px] transition-opacity",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={closeMobile}
        aria-hidden="true"
      />
      <aside
        style={{ transitionProperty: "width", transitionDuration: "200ms", transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)" }}
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-white/[0.06] bg-bg-base/92 backdrop-blur-md md:flex",
          collapsed ? "md:w-[72px]" : "md:w-[240px]"
        )}
        aria-label="Main navigation"
      >
        <div className={cn("border-b border-white/8", collapsed ? "px-3 py-4" : "px-5 py-5")}>
          <div className={cn("panel-surface rounded-[24px] p-4", collapsed ? "items-center" : "")}>
            <div className={cn("flex items-start gap-3", collapsed ? "justify-center" : "justify-between")}>
              <div className={cn("min-w-0", collapsed && "hidden")}>
                <p className="eyebrow mb-2">Streaming Workspace</p>
                <h1 className="hero-title hero-gradient text-xl leading-none">Creator Library</h1>
                <p className="mt-2 text-sm text-text-secondary">
                  Stream across the web, keep creator matches trustworthy, and move between library and roster without friction.
                </p>
              </div>
              <div className={cn("rounded-2xl border border-white/10 bg-white/6 p-3 text-accent glow-accent", collapsed && "mx-auto")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.4 4.8L20 10l-4 4 .9 6-4.9-2.6L7 20l.9-6-4-4 5.6-2.2L12 3Z"/></svg>
              </div>
              {!collapsed && (
                <span className="text-sm font-semibold text-text-primary">Fast Capture</span>
              )}
            </div>
            <button
              onClick={toggleCollapse}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn("hidden h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary md:flex", collapsed && "md:hidden")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {collapsed ? <path d="M9 18l6-6-6-6"/> : <path d="M15 18l-6-6 6-6"/>}
              </svg>
            </button>
          </div>
          <div className={cn("mt-3 flex items-center gap-2", collapsed ? "justify-center" : "justify-between")}>
            {!collapsed && <p className="text-xs text-text-muted">Workspace</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleCollapse}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="panel-muted hidden h-10 w-10 items-center justify-center rounded-xl text-text-secondary transition-colors hover:text-text-primary lg:flex"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {collapsed ? <path d="M9 18l6-6-6-6"/> : <path d="M15 18l-6-6 6-6"/>}
                </svg>
              </button>
              <button
                onClick={closeMobile}
                className="panel-muted flex h-10 w-10 items-center justify-center rounded-xl text-text-secondary transition-colors hover:text-text-primary lg:hidden"
                title="Close navigation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
          </div>
        </div>

        <nav className="hide-scrollbar flex-1 overflow-y-auto px-2 py-4" aria-label="Views">
          <NavGroup label="Library" items={MEDIA_ITEMS} activeView={activeView} setActiveView={setActiveView} collapsed={collapsed} counts={counts} newCounts={{ images: newImageCount > 0 ? newImageCount : undefined }} warnings={{ performers: perfStats?.stale_count }} queueActive={{ performers: captureQueueActive }} closeMobile={closeMobile} />
          <NavGroup label="System" items={SETTINGS_ITEMS} activeView={activeView} setActiveView={setActiveView} collapsed={collapsed} closeMobile={closeMobile} />
        </nav>

        <CrawlFooter collapsed={collapsed} ready={sidebarEnhancementsReady} />
      </aside>
    </>
  )
}
