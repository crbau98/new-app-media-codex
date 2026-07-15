import { lazy, Suspense, useState } from 'react'
import { Navigate, Routes, Route, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import Layout from './components/Layout'
import ToastContainer from './components/Toast'
import CommandPalette from './components/CommandPalette'
import AmbientGlow from './components/AmbientGlow'
import AdultGate, { hasAdultConfirmation } from './components/AdultGate'

const HomePage = lazy(() => import('./pages/Home'))
const ExplorePage = lazy(() => import('./pages/Explore'))
const CreatorsPage = lazy(() => import('./pages/Creators'))
const SearchPage = lazy(() => import('./pages/Search'))
const SettingsPage = lazy(() => import('./pages/Settings').then((module) => ({ default: module.SettingsPage })))

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
    >
      {children}
    </motion.div>
  )
}

export default function App() {
  const location = useLocation()
  const [adultConfirmed, setAdultConfirmed] = useState(hasAdultConfirmation)

  if (!adultConfirmed) return <AdultGate onConfirm={() => setAdultConfirmed(true)} />

  return (
    <>
      <AmbientGlow />
      <Layout>
        <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-sm text-[var(--text-secondary)]">Loading workspace…</div>}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route
              path="/media"
              element={
                <PageWrapper>
                  <HomePage />
                </PageWrapper>
              }
            />
            <Route
              path="/explore"
              element={
                <PageWrapper>
                  <ExplorePage />
                </PageWrapper>
              }
            />
            <Route
              path="/creators"
              element={
                <PageWrapper>
                  <CreatorsPage />
                </PageWrapper>
              }
            />
            <Route
              path="/search"
              element={
                <PageWrapper>
                  <SearchPage />
                </PageWrapper>
              }
            />
            <Route
              path="/settings"
              element={
                <PageWrapper>
                  <SettingsPage />
                </PageWrapper>
              }
            />
            <Route
              path="/"
              element={<Navigate to="/media" replace />}
            />
            <Route path="*" element={<Navigate to="/media" replace />} />
          </Routes>
        </AnimatePresence>
        </Suspense>
      </Layout>
      <ToastContainer />
      <CommandPalette />
    </>
  )
}
