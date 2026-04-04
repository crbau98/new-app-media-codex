import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'

/* ââ Query client with sensible defaults ââââââââââââââââââââââââââ */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,          // data fresh for 5 min
      gcTime: 10 * 60_000,            // keep unused data 10 min
      refetchOnWindowFocus: false,
      retry(failureCount, error: any) {
        if (error?.status === 404) return false
        return failureCount < 2
      },
    },
  },
})

/* ââ Accent-color restore (batched read+write) ââââââââââââââââââââ */
const stored = localStorage.getItem('accentColor')
if (stored) {
  requestAnimationFrame(() => {
    document.documentElement.style.setProperty('--color-accent', stored)
  })
}

/* ââ Register service-worker on idle ââââââââââââââââââââââââââââââ */
if ('serviceWorker' in navigator) {
  const registerSW = () =>
    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => {/* SW optional */})

  if ('requestIdleCallback' in window) {
    ;(window as any).requestIdleCallback(registerSW)
  } else {
    window.addEventListener('load', registerSW)
  }
}

/* ââ Mount ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

/* ââ Web-Vitals (lazy, non-blocking) ââââââââââââââââââââââââââââââ */
import('web-vitals')
  .then(({ onCLS, onFID, onLCP }) => {
    onCLS(console.debug)
    onFID(console.debug)
    onLCP(console.debug)
  })
  .catch(() => {})

/* ââ HMR acceptance (dev only) ââââââââââââââââââââââââââââââââââââ */
if (import.meta.hot) {
  import.meta.hot.accept()
}
