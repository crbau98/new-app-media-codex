import { useState, useEffect, lazy, Suspense } from "react"
import { useIsFetching } from "@tanstack/react-query"
import { useAppStore } from "../store"
import { cn } from "@/lib/cn"
import { UniversalSearchBar } from "./UniversalSearchBar"
import { NotificationBell } from "./NotificationBell"

const ShortcutModal = lazy(() => import("./ShortcutModal").then((m) => ({ default: m.ShortcutModal })))

const VIEW_LABELS: Record<string, string> = {
  images: "Media",
  performers: "Creators",
  settings: "Settings",
  search: "Search",
  explore: "Explore",
}

export function TopBar() {
  const isFetching = useIsFetching()
  const activeView = useAppStore((s) => s.activeView)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const mobileNavOpen = useAppStore((s) => s.mobileNavOpen)
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen)

  const leftOffset = collapsed ? "lg:left-[72px]" : "lg:left-[240px]"
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [topBarEnhancementsReady, setTopBarEnhancementsReady] = useState(false)

  useEffect(() => {
    function openFromShortcut() {
      setShortcutsOpen(true)
    }
    window.addEventListener("open-shortcuts-overlay", openFromShortcut as EventListener)
    return () => window.removeEventListener("open-shortcuts-overlay", openFromShortcut as EventListener)
  }, [])

  useEffect(() => {
    let cancelled = false

    const enableEnhancements = () => {
      if (!cancelled) setTopBarEnhancementsReady(true)
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

  return (
    <>
      {isFetching > 0 && (
        <div className="fixed inset-x-0 top-0 z-[55] h-0.5 overflow-hidden" aria-hidden="true">
          <div className="topbar-loading-bar h-full" />
        </div>
      )}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-20 px-3 pt-3 transition-[left] duration-200 sm:px-5 lg:px-6",
          leftOffset,
        )}
      >
        <div className="topbar-shell mx-auto flex max-w-[1680px] items-center gap-4 rounded-[20px] px-4 py-2.5 sm:gap-5 sm:px-5">
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-text-primary md:hidden"
            aria-label="Open navigation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>
          </button>

          <h2 className="hero-title min-w-0 shrink-0 text-[17px] font-semibold tracking-[-0.035em] text-text-primary sm:text-[19px]">
            <span className="text-gradient-brand">{VIEW_LABELS[activeView] ?? activeView}</span>
          </h2>

          <UniversalSearchBar />

          <div className="flex-1" />

          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              onClick={toggleTheme}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary sm:flex"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              )}
            </button>

            {topBarEnhancementsReady && <NotificationBell />}
          </div>
        </div>
      </header>
      {(topBarEnhancementsReady || shortcutsOpen) && (
        <Suspense fallback={null}>
          <ShortcutModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
