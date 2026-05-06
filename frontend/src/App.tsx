import { Routes, Route, useLocation } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import Layout from './components/Layout'
import HomePage from './pages/Home'
import ExplorePage from './pages/Explore'
import ToastContainer from './components/Toast'
import CommandPalette from './components/CommandPalette'
import AmbientGlow from './components/AmbientGlow'
import CreatorsPage from './pages/Creators'
import SearchPage from './pages/Search'
import { SettingsPage } from './pages/Settings'
import { AnalyticsPage } from './pages/Analytics'

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

  return (
    <>
      <AmbientGlow />
      <Layout>
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
              path="/analytics"
              element={
                <PageWrapper>
                  <AnalyticsPage />
                </PageWrapper>
              }
            />
            <Route
              path="/"
              element={
                <PageWrapper>
                  <HomePage />
                </PageWrapper>
              }
            />
          </Routes>
        </AnimatePresence>
      </Layout>
      <ToastContainer />
      <CommandPalette />
    </>
  )
}
