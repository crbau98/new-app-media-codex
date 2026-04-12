import { type ReactNode, useState, useEffect, lazy, Suspense } from "react"
import { Sidebar } from "./Sidebar"
import { TopBar } from "./TopBar"
import { BottomTabBar } from "./BottomTabBar"
import { ToastContainer } from "./Toast"
import { useAppStore } from "../store"
import { useScrollRestoration } from "../hooks/useScrollRestoration"
import { useConnectivity } from "../hooks/useConnectivity"

const InstallPrompt = lazy(() => import("./InstallPrompt").then((m) => ({ default: m.InstallPrompt })))
const ScrollToTop = lazy(() => import("./ScrollToTop").then((m) => ({ default: m.ScrollToTop })))
const OfflineBanner = lazy(() => import("./OfflineBanner").then((m) => ({ default: m.OfflineBanner })))

function ConnectivityGate() {
  useConnectivity()
  return null
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const activeView = useAppStore((s) => s.activeView)
  const mainRef = useScrollRestoration(activeView)

  const [shellEnhancementsReady, setShellEnhancementsReady] = useState(false)

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

  const desktopSidebarOffset = collapsed ? "md:pl-[72px]" : "md:pl-[240px]"

  return (
    <div className="shell-bg min-h-screen bg-bg-base text-text-primary">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-bg-elevated focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-text-primary focus:shadow-lg focus:outline-2 focus:outline-accent"
      >
        Skip to main content
      </a>
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
          className="min-h-screen overflow-x-hidden px-4 pb-20 pt-[3.75rem] sm:px-6 md:pb-6 lg:px-8"
          style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="min-h-full">
            {children}
          </div>
        </main>
      </div>
      <BottomTabBar />
      {shellEnhancementsReady && (
        <Suspense fallback={null}>
          <ScrollToTop />
        </Suspense>
      )}
      <ToastContainer />
    </div>
  )
}
