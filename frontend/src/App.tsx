import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router'
import Layout from '@/components/Layout'
import Toast from '@/components/Toast'
import AdultGate from '@/components/AdultGate'
import AppErrorBoundary from '@/components/AppErrorBoundary'
import Home from '@/pages/Home'
import { useAppStore } from '@/store'

const Explore = lazy(() => import('@/pages/Explore'))
const Search = lazy(() => import('@/pages/Search'))
const Creators = lazy(() => import('@/pages/Creators'))
const Settings = lazy(() => import('@/pages/Settings'))
const NotFound = lazy(() => import('@/pages/NotFound'))
const CommandPalette = lazy(() => import('@/components/CommandPalette'))

const routeTitles: Record<string, string> = {
  '/media': 'Library',
  '/explore': 'For You',
  '/search': 'Search',
  '/creators': 'Creators',
  '/settings': 'Settings',
}

function RouteSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-4">
      <div className="h-6 w-1/3 rounded bg-sunken" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] rounded-md bg-sunken" />
        ))}
      </div>
    </div>
  )
}

/** Per-route document titles. */
function RouteTitle() {
  const location = useLocation()
  useEffect(() => {
    const title = routeTitles[location.pathname]
    document.title = title ? `${title} — Media Codex` : 'Media Codex — After-hours cinema archive'
  }, [location.pathname])
  return null
}

function AppShell() {
  const commandPaletteOpen = useAppStore((s) => s.commandPaletteOpen)
  // Defer CommandPalette mount until after first paint or Cmd/Ctrl+K is pressed.
  const [paletteReady, setPaletteReady] = useState(false)
  useEffect(() => {
    const onIdle = () => setPaletteReady(true)
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(onIdle, { timeout: 2000 })
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(onIdle, 200)
    return () => clearTimeout(id)
  }, [])

  // Also mount eagerly if the palette is opened before idle fires.
  const shouldMount = paletteReady || commandPaletteOpen

  return (
    <Layout>
      <RouteTitle />
      <AppErrorBoundary>
        <Suspense fallback={<RouteSkeleton />}>
          <Routes>
            <Route path="/" element={<Navigate to="/media" replace />} />
            <Route path="/media" element={<Home />} />
            <Route path="/explore" element={<Explore />} />
            <Route path="/search" element={<Search />} />
            <Route path="/creators" element={<Creators />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
      {shouldMount && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
    </Layout>
  )
}

export default function App() {
  const reduceMotion = useAppStore((s) => s.reduceMotion)

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? 'true' : 'false'
  }, [reduceMotion])

  return (
    <AdultGate>
      <BrowserRouter>
        <AppShell />
        <Toast />
      </BrowserRouter>
    </AdultGate>
  )
}
