import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router'
import { MotionConfig } from 'framer-motion'
import Layout from '@/components/Layout'
import CommandPalette from '@/components/CommandPalette'
import Toast from '@/components/Toast'
import AdultGate from '@/components/AdultGate'
import AppErrorBoundary from '@/components/AppErrorBoundary'
import Home from '@/pages/Home'
import Explore from '@/pages/Explore'
import Search from '@/pages/Search'
import Creators from '@/pages/Creators'
import Settings from '@/pages/Settings'
import NotFound from '@/pages/NotFound'
import { useAppStore } from '@/store'

const routeTitles: Record<string, string> = {
  '/media': 'Library',
  '/explore': 'For You',
  '/search': 'Search',
  '/creators': 'Creators',
  '/settings': 'Settings',
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
  return (
    <Layout>
      <RouteTitle />
      <AppErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/media" replace />} />
          <Route path="/media" element={<Home />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/search" element={<Search />} />
          <Route path="/creators" element={<Creators />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AppErrorBoundary>
    </Layout>
  )
}

export default function App() {
  const reduceMotion = useAppStore((s) => s.reduceMotion)

  return (
    <AdultGate>
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
        <BrowserRouter>
          <AppShell />
          <CommandPalette />
          <Toast />
        </BrowserRouter>
      </MotionConfig>
    </AdultGate>
  )
}
