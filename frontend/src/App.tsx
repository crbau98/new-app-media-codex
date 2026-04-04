import { Suspense, lazy, useDeferredValue, useEffect, useState } from 'react'
import { useConnectivity } from './hooks/useConnectivity'
import { useDashboard } from './hooks/useDashboard'
import Spinner from './components/Spinner'

/* ââ Lazy view map ââââââââââââââââââââââââââââââââââââââââââââââââ */
const VIEW_MAP = {
  Dashboard: lazy(() => import('./views/Dashboard')),
  Search:    lazy(() => import('./views/Search')),
  Activity:  lazy(() => import('./views/Activity')),
  Recommend: lazy(() => import('./views/Recommend')),
  Settings:  lazy(() => import('./views/Settings')),
} as const

type ViewKey = keyof typeof VIEW_MAP

/* ââ Skeleton shown while lazy chunks load ââââââââââââââââââââââââ */
function PageSkeleton() {
  return (
    <div
      className="flex items-center justify-center h-[60vh]"
      style={{ contain: 'layout paint' }}
    >
      <Spinner />
    </div>
  )
}

/* ââ Prefetch helper ââââââââââââââââââââââââââââââââââââââââââââââ */
function prefetchViewModule(key: ViewKey) {
  const loaders: Record<ViewKey, () => Promise<any>> = {
    Dashboard: () => import('./views/Dashboard'),
    Search:    () => import('./views/Search'),
    Activity:  () => import('./views/Activity'),
    Recommend: () => import('./views/Recommend'),
    Settings:  () => import('./views/Settings'),
  }
  loaders[key]?.()
}

/* ââ App ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */
export default function App() {
  const [currentView, setCurrentView] = useState<ViewKey>('Dashboard')
  const deferredView = useDeferredValue(currentView)
  const online = useConnectivity()
  const { data, isLoading } = useDashboard()

  /* Prefetch adjacent views on idle */
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = (window as any).requestIdleCallback(() => {
        const keys = Object.keys(VIEW_MAP) as ViewKey[]
        keys.forEach((k) => { if (k !== currentView) prefetchViewModule(k) })
      })
      return () => (window as any).cancelIdleCallback(id)
    }
  }, [currentView])

  const ActiveView = VIEW_MAP[deferredView]

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ââ Top bar âââââââââââââââââââââââââââââââââââââââââââââ */}
      <header className="sticky top-0 z-30 backdrop-blur bg-gray-950/80 border-b border-gray-800/50 px-4 py-2 flex items-center gap-4">
        <h1 className="text-lg font-semibold tracking-tight truncate">
          Codex Research Radar
        </h1>
        {!online && (
          <span className="ml-auto text-xs text-amber-400 animate-pulse">
            offline
          </span>
        )}
      </header>

      {/* ââ Nav âââââââââââââââââââââââââââââââââââââââââââââââââ */}
      <nav className="flex gap-1 px-4 py-2 overflow-x-auto border-b border-gray-800/30">
        {(Object.keys(VIEW_MAP) as ViewKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setCurrentView(key)}
            onPointerEnter={() => prefetchViewModule(key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              currentView === key
                ? 'bg-accent/20 text-accent'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            {key}
          </button>
        ))}
      </nav>

      {/* ââ Content âââââââââââââââââââââââââââââââââââââââââââââ */}
      <main className="p-4" style={{ contain: 'layout style' }}>
        <Suspense fallback={<PageSkeleton />}>
          <ActiveView data={data} isLoading={isLoading} />
        </Suspense>
      </main>
    </div>
  )
}
