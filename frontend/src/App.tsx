import { lazy, Suspense, useState, useEffect, useCallback, useDeferredValue, startTransition } from "react"
import type { ReactElement } from "react"
import { AppShell } from "./components/AppShell"
import { useAppStore, type ActiveView } from "./store"
import { useCommandPalette } from "./hooks"
import { CrawlNotifier } from "./components/CrawlNotifier"
import { loadViewModule, prefetchViewModule } from "./lib/view-loader"

function isOnboardingComplete() {
  return localStorage.getItem("onboarding_complete") === "true"
}

const MediaPage = lazy(() => loadViewModule("images").then(m => ({ default: (m as typeof import("./features/images/MediaPage")).MediaPage })))
const SettingsPage = lazy(() => loadViewModule("settings").then(m => ({ default: (m as typeof import("./features/settings/SettingsPage")).SettingsPage })))
const PerformersPage = lazy(() => loadViewModule("performers"))
const CommandPalette = lazy(() => import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })))
const KeyboardShortcutsOverlay = lazy(() => import("./components/KeyboardShortcutsOverlay").then((m) => ({ default: m.KeyboardShortcutsOverlay })))
const Onboarding = lazy(() => import("./components/Onboarding").then((m) => ({ default: m.Onboarding })))

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 animate-pulse">
      <div className="h-8 w-48 bg-white/5 rounded-lg" />
      <div className="h-64 w-full bg-white/5 rounded-xl" />
      <div className="h-32 w-full bg-white/5 rounded-xl" />
    </div>
  )
}

const VIEW_MAP: Record<ActiveView, ReactElement> = {
  overview: <MediaPage />,
  items: <MediaPage />,
  images: <MediaPage />,
  hypotheses: <MediaPage />,
  graph: <MediaPage />,
  performers: <PerformersPage />,
  settings: <SettingsPage />,
}

function App() {
  const activeView = useAppStore((s) => s.activeView)
  const deferredActiveView = useDeferredValue(activeView)
  useCommandPalette()

  const [showShortcuts, setShowShortcuts] = useState(false)
  const closeShortcuts = useCallback(() => {
    startTransition(() => {
      setShowShortcuts(false)
    })
  }, [])
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboardingComplete())
  const closeOnboarding = useCallback(() => {
    startTransition(() => {
      setShowOnboarding(false)
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if ((e.target as HTMLElement)?.isContentEditable) return
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        startTransition(() => {
          setShowShortcuts((v) => !v)
        })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    const relatedViews: Record<ActiveView, ActiveView[]> = {
      overview: ["images", "performers"],
      items: ["images", "performers"],
      images: ["performers", "overview"],
      hypotheses: ["images", "performers"],
      graph: ["images", "performers"],
      performers: ["images", "overview"],
      settings: ["overview"],
    }

    const preload = () => {
      for (const view of relatedViews[deferredActiveView] ?? []) {
        prefetchViewModule(view)
      }
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1500 })
      return () => window.cancelIdleCallback(idleId)
    }

    const timeoutId = setTimeout(preload, 300)
    return () => clearTimeout(timeoutId)
  }, [deferredActiveView])

  return (
    <>
      <CrawlNotifier />
      <AppShell>
        <div className="view-enter">
          <Suspense fallback={<PageSkeleton />}>
            {VIEW_MAP[deferredActiveView] ?? <MediaPage />}
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
