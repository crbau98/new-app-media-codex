import { type ReactNode, useState, useEffect, useCallback, useRef, startTransition, lazy, Suspense } from "react"
import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"
import { BottomTabBar } from "./BottomTabBar"
import { ToastContainer } from "./Toast"
import { useAppStore } from "../store"
import { useScrollRestoration } from "../hooks/useScrollRestoration"
import { useConnectivity } from "../hooks/useConnectivity"

const FloatingActionButton = lazy(() => import("./FloatingActionButton").then((m) => ({ default: m.FloatingActionButton })))
const InstallPrompt = lazy(() => import("./InstallPrompt").then((m) => ({ default: m.InstallPrompt })))
const ScrollToTop = lazy(() => import("./ScrollToTop").then((m) => ({ default: m.ScrollToTop })))
const OfflineBanner = lazy(() => import("./OfflineBanner").then((m) => ({ default: m.OfflineBanner })))
const Scratchpad = lazy(() => import("./Scratchpad").then((m) => ({ default: m.Scratchpad })))

function ConnectivityGate() {
  useConnectivity()
  return null
}

function ScrollProgressBar() {
  const [progress, setProgress] = useState(0)
  const [hasOverflow, setHasOverflow] = useState(false)
  const progressRef = useRef(0)
  const hasOverflowRef = useRef(false)

  useEffect(() => {
    let frame = 0
    function update() {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight
      const nextHasOverflow = scrollHeight > 0
      const nextProgress = nextHasOverflow ? Math.min((window.scrollY / scrollHeight) * 100, 100) : 0

      if (hasOverflowRef.current !== nextHasOverflow) {
        hasOverflowRef.current = nextHasOverflow
        setHasOverflow(nextHasOverflow)
      }
      if (progressRef.current !== nextProgress) {
        progressRef.current = nextProgress
        setProgress(nextProgress)
      }
    }
    function scheduleUpdate() {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }
    update()
    window.addEventListener("scroll", scheduleUpdate, { passive: true })
    window.addEventListener("resize", scheduleUpdate, { passive: true })
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", scheduleUpdate)
      window.removeEventListener("resize", scheduleUpdate)
    }
  }, [])

  if (!hasOverflow) return null

  return (
    <div className="fixed inset-x-0 top-0 z-50 h-[2px]" aria-hidden="true">
      <div
        className="h-full transition-[width] duration-100 ease-out"
        style={{
          width: `${progress}%`,
          background: "var(--color-accent)",
          opacity: 0.85,
        }}
      />
    </div>
  )
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const activeView = useAppStore((s) => s.activeView)
  const mainRef = useScrollRestoration(activeView)

  const [scratchpadOpen, setScratchpadOpen] = useState(false)
  const [shellEnhancementsReady, setShellEnhancementsReady] = useState(false)
  const closeScratchpad = useCallback(() => setScratchpadOpen(false), [])

  // Listen for toggle event from TopBar button
  useEffect(() => {
    function onToggle() {
      startTransition(() => {
        setScratchpadOpen((prev) => !prev)
      })
    }
    window.addEventListener("toggle-scratchpad", onToggle)
    return () => window.removeEventListener("toggle-scratchpad", onToggle)
  }, [])

  useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const enableEnhancements = () => {
      if (!cancelled) setShellEnhancementsReady(true)
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(enableEnhancements, { timeout: 1200 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(idleId)
      }
    }

    timeoutId = setTimeout(enableEnhancements, 400)
    return () => {
      cancelled = true
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [])

  const desktopSidebarOffset = collapsed ? "md:pl-[88px]" : "md:pl-[284px]"

  return (
    <div className="shell-bg min-h-screen bg-bg-base text-text-primary">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-bg-elevated focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-text-primary focus:shadow-lg focus:outline-2 focus:outline-accent"
      >
        Skip to main content
      </a>
      <ScrollProgressBar />
      {shellEnhancementsReady && <ConnectivityGate />}
      {shellEnhancementsReady && (
        <Suspense fallback={null}>
          <OfflineBanner />
          <InstallPrompt />
        </Suspense>
      )}
      <Sidebar />
      <div className={`min-h-screen transition-[padding] duration-200 ${desktopSidebarOffset}`}>
        <TopBar />
        <main
          id="main-content"
          ref={mainRef}
          className="min-h-screen overflow-x-hidden px-4 pb-20 pt-[72px] sm:px-6 md:pb-8 lg:px-8 lg:pt-[68px]"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="view-container min-h-full">
            {children}
          </div>
        </main>
      </div>
      <BottomTabBar />
      {shellEnhancementsReady && (
        <Suspense fallback={null}>
          <FloatingActionButton />
          <ScrollToTop />
        </Suspense>
      )}
      <ToastContainer />
      {(shellEnhancementsReady || scratchpadOpen) && (
        <Suspense fallback={null}>
          <Scratchpad open={scratchpadOpen} onClose={closeScratchpad} />
        </Suspense>
      )}
    </div>
  )
}
