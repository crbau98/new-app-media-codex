import { lazy, Suspense, useState, useEffect, useCallback, useDeferredValue, useMemo, startTransition } from "react"
import type { ReactElement } from "react"
import { AppShell } from "./components/AppShell"
import { useAppStore, type ActiveView } from "./store"
import { useCommandPalette } from "./hooks"
import { CrawlNotifier } from "./components/CrawlNotifier"
import { loadViewModule, prefetchViewModule } from "./lib/view-loader"

// ── Constants ────────────────────────────────────────────────────────
const PREFETCH_IDLE_TIMEOUT = 1500
const PREFETCH_FALLBACK_DELAY = 300
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isOnboardingComplete() {
  try { return localStorage.getItem("onboarding_complete") === "true" } catch { return false }
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
function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 animate-pulse">
      <div className="h-8 w-48 bg-white/5 rounded-lg" />
      <div className="h-64 w-full bg-white/5 rounded-xl" />
      <div className="h-32 w-full bg-white/5 rounded-xl" />
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
  const deferredActiveView = useDeferredValue(activeView)
  const isTransitioning = activeView !== deferredActiveView

  useCommandPalette()

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
        <div className="view-enter">
          <Suspense fallback={<PageSkeleton />}>
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
    </>
  )
}

export default App
