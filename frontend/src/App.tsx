import { lazy, Suspense, useState, useEffect, useCallback, useDeferredValue, useMemo, startTransition } from "react"
import type { ReactElement } from "react"
import { AppShell } from "./components/AppShell"
import { useAppStore, type ActiveView } from "./store"
import { useCommandPalette } from "./hooks"
import { CrawlNotifier } from "./components/CrawlNotifier"
import { loadViewModule, prefetchViewModule } from "./lib/view-loader"
import { cn } from "@/lib/cn"

// ── Constants ────────────────────────────────────────────────────────
const PREFETCH_IDLE_TIMEOUT = 1500
const PREFETCH_FALLBACK_DELAY = 300
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isOnboardingComplete() {
  return true
}

// ── Lazy-loaded views ────────────────────────────────────────────────
const MediaPage = lazy(() =>
  loadViewModule("images").then(m => ({
    default: (m as typeof import("./features/images/MediaPage")).MediaPage,
  }))
)

const SettingsPage = lazy(() =>
  loadViewModule("settings").then(m => ({
    default: (m as typeof import("./features/settings/SettingsPage")).SettingsPage,
  }))
)

const PerformersPage = lazy(() => loadViewModule("performers"))

const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then(m => ({ default: m.CommandPalette }))
)

const KeyboardShortcutsOverlay = lazy(() =>
  import("./components/KeyboardShortcutsOverlay").then(m => ({ default: m.KeyboardShortcutsOverlay }))
)

const Onboarding = lazy(() =>
  import("./components/Onboarding").then(m => ({ default: m.Onboarding }))
)

// ── Related-view map (static – hoisted out of component) ─────────────
const RELATED_VIEWS: Record<ActiveView, ActiveView[]> = {
  overview: ["images", "performers"],
  items: ["images", "performers"],
  images: ["performers", "overview"],
  hypotheses: ["images", "performers"],
  graph: ["images", "performers"],
  performers: ["images", "overview"],
  settings: ["overview"],
}

// ── Loading skeleton ─────────────────────────────────────────────────
function PageSkeleton({ activeView }: { activeView: ActiveView }) {
  if (activeView === "performers") {
    return (
      <div className="flex flex-col gap-5 p-6">
        <div className="skeleton-surface rounded-[28px] p-5">
          <div className="mb-4 h-3 w-24 rounded-full skeleton-line" />
          <div className="h-9 w-44 rounded-2xl skeleton-line" />
          <div className="mt-3 h-4 w-72 max-w-full rounded-full skeleton-line" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton-surface rounded-[24px] p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="h-14 w-14 rounded-full skeleton-line" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-28 rounded-full skeleton-line" />
                  <div className="h-3 w-20 rounded-full skeleton-line" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="h-16 rounded-2xl skeleton-line" />
                <div className="h-16 rounded-2xl skeleton-line" />
                <div className="h-16 rounded-2xl skeleton-line" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="skeleton-surface rounded-[30px] p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="h-8 w-44 rounded-2xl skeleton-line" />
          <div className="h-7 w-28 rounded-full skeleton-line" />
          <div className="h-7 w-24 rounded-full skeleton-line" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-20 rounded-[20px] skeleton-line" />
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="skeleton-grid-tile aspect-square rounded-[22px]" />
        ))}
      </div>
    </div>
  )
}

// ── Transition indicator ─────────────────────────────────────────────
function TransitionIndicator({ isTransitioning }: { isTransitioning: boolean }) {
  if (!isTransitioning) return null
  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: '2px', zIndex: 9999,
        background: 'var(--color-accent, #7cc6ff)',
        animation: 'pulse 1s ease-in-out infinite',
      }}
    />
  )
}

// ── App ──────────────────────────────────────────────────────────────
function App() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const deferredActiveView = useDeferredValue(activeView)
  const isTransitioning = activeView !== deferredActiveView

  useCommandPalette()

  useEffect(() => {
    const titles: Record<string, string> = {
      images: 'Media — Codex',
      performers: 'Creators — Codex',
      settings: 'Settings — Codex',
      overview: 'Overview — Codex',
    }
    document.title = titles[deferredActiveView] ?? 'Codex'
  }, [deferredActiveView])

  const [showShortcuts, setShowShortcuts] = useState(false)
  const closeShortcuts = useCallback(() => {
    startTransition(() => setShowShortcuts(false))
  }, [])

  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingComplete())
  const closeOnboarding = useCallback(() => {
    startTransition(() => setShowOnboarding(false))
  }, [])

  // ── Keyboard shortcut: "?" toggles shortcuts overlay ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (INPUT_TAGS.has(tag)) return
      if ((e.target as HTMLElement)?.isContentEditable) return
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        startTransition(() => setShowShortcuts((v) => !v))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ── Prefetch related views during idle time ──
  useEffect(() => {
    const preload = () => {
      for (const view of RELATED_VIEWS[deferredActiveView] ?? []) {
        prefetchViewModule(view)
      }
    }
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: PREFETCH_IDLE_TIMEOUT })
      return () => window.cancelIdleCallback(idleId)
    }
    const timeoutId = setTimeout(preload, PREFETCH_FALLBACK_DELAY)
    return () => clearTimeout(timeoutId)
  }, [deferredActiveView])

  // ── Memoize the current view element ──
  const currentView = useMemo<ReactElement>(() => {
    switch (deferredActiveView) {
      case 'performers': return <PerformersPage />
      case 'settings': return <SettingsPage />
      default: return <MediaPage />
    }
  }, [deferredActiveView])

  return (
    <>
      <CrawlNotifier />
      <TransitionIndicator isTransitioning={isTransitioning} />
      <AppShell>
        <div className="min-h-full">
          <Suspense fallback={<PageSkeleton activeView={deferredActiveView} />}>
            {currentView}
          </Suspense>
        </div>
        <Suspense fallback={null}>
          <CommandPalette />
          {showShortcuts && <KeyboardShortcutsOverlay onClose={closeShortcuts} />}
        </Suspense>
      </AppShell>
      <Suspense fallback={null}>
        {showOnboarding && <Onboarding onComplete={closeOnboarding} />}
      </Suspense>
      {/* Mobile bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-white/10 bg-[#0d1118]/95 backdrop-blur-md py-2 sm:hidden">
        {([
          { view: 'images' as ActiveView, label: 'Media', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 9 5 3-5 3V9z"/></svg> },
          { view: 'performers' as ActiveView, label: 'Creators', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg> },
          { view: 'settings' as ActiveView, label: 'Settings', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg> },
        ] as const).map(({ view, label, icon }) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={cn(
              "flex flex-col items-center gap-1 px-4 py-1 rounded-xl transition-colors",
              activeView === view ? "text-accent" : "text-white/40 hover:text-white/70"
            )}
          >
            {icon}
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}

export default App
