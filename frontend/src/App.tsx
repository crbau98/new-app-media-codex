import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import Layout from '@/components/Layout'
import Toast from '@/components/Toast'
import AdultGate from '@/components/AdultGate'
import AppErrorBoundary from '@/components/AppErrorBoundary'
import Home from '@/pages/Home'
import { useAppStore } from '@/store'
import { useMotionOk } from '@/hooks/useMotionOk'
import { routeVariants } from '@/design-system/motion'

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
    <div className="space-y-6 p-1" aria-hidden="true">
      <div className="shimmer h-8 w-1/3 rounded-lg" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="shimmer aspect-[2/3] rounded-xl" style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
    </div>
  )
}

/**
 * Scroll management for the animated route swap: new pages start at the top
 * once the outgoing page has left; back/forward restores the saved offset
 * (retrying briefly while lazy content mounts). Same-path query changes keep
 * their position.
 */
function ScrollManager({ delayMs }: { delayMs: number }) {
  const location = useLocation()
  const navType = useNavigationType()
  const positions = useRef(new Map<string, number>())
  const lastPath = useRef(location.pathname)

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    const onScroll = () => positions.current.set(location.key, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [location.key])

  useEffect(() => {
    const pathChanged = lastPath.current !== location.pathname
    lastPath.current = location.pathname
    if (navType === 'POP') {
      const target = positions.current.get(location.key) ?? 0
      let tries = 0
      let timer = 0
      const attempt = () => {
        window.scrollTo(0, target)
        tries += 1
        if (tries < 12 && Math.abs(window.scrollY - target) > 4) timer = window.setTimeout(attempt, 60)
      }
      timer = window.setTimeout(attempt, delayMs)
      return () => window.clearTimeout(timer)
    }
    if (!pathChanged) return
    const timer = window.setTimeout(() => window.scrollTo(0, 0), delayMs)
    return () => window.clearTimeout(timer)
  }, [location.key, location.pathname, navType, delayMs])

  return null
}

function AnimatedRoutes() {
  const location = useLocation()
  const motionOk = useMotionOk()
  const pageRef = useRef<HTMLDivElement>(null)

  const routes = (
    <Suspense fallback={<RouteSkeleton />}>
      <Routes location={location}>
        <Route path="/" element={<Navigate to="/media" replace />} />
        <Route path="/media" element={<Home />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/search" element={<Search />} />
        <Route path="/creators" element={<Creators />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )

  return (
    <>
      <ScrollManager delayMs={motionOk ? 170 : 0} />
      {motionOk ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            ref={pageRef}
            variants={routeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            // A lingering filter/transform would become the containing block for
            // fixed-position dialogs inside pages — clear both once settled.
            onAnimationComplete={(definition) => {
              if (definition === 'animate' && pageRef.current) {
                pageRef.current.style.filter = ''
                pageRef.current.style.transform = ''
              }
            }}
          >
            {routes}
          </motion.div>
        </AnimatePresence>
      ) : (
        routes
      )}
    </>
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
        <AnimatedRoutes />
      </AppErrorBoundary>
      {/* integration: <ConciergeLauncher/> */}
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
