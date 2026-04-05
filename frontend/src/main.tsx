import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { useAppStore, getViewFromHash } from './store'
import type { ApiError } from './lib/api'

// ── Constants ────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  THEME: 'theme',
  ACCENT: 'accent-color',
  ACCENT_SECONDARY: 'accent-color-secondary',
} as const

const QUERY_DEFAULTS = {
  STALE_TIME: 60_000,         // 1 minute
  GC_TIME: 10 * 60_000,      // 10 minutes
  MAX_RETRIES: 2,
  BASE_RETRY_DELAY: 750,     // ms
  MAX_RETRY_DELAY: 10_000,   // ms
} as const

// ── Safe localStorage ────────────────────────────────────────────────
function safeLocalStorageGet(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

// ── Theme & accent restoration (runs before React renders) ───────────
const savedTheme = safeLocalStorageGet(STORAGE_KEYS.THEME) || 'dark'
document.documentElement.dataset.theme = savedTheme

const savedAccent = safeLocalStorageGet(STORAGE_KEYS.ACCENT)
if (savedAccent) {
  document.documentElement.style.setProperty('--color-accent', savedAccent)
  document.documentElement.style.setProperty('--color-accent-glow', savedAccent + '50')
}
const savedAccentSecondary = safeLocalStorageGet(STORAGE_KEYS.ACCENT_SECONDARY)
if (savedAccentSecondary) {
  document.documentElement.style.setProperty('--color-accent-secondary', savedAccentSecondary)
}

// ── Hash sync (back/forward navigation) ──────────────────────────────
window.addEventListener('hashchange', () => {
  const view = getViewFromHash()
  if (useAppStore.getState().activeView !== view) {
    useAppStore.setState({ activeView: view })
  }
})

// ── Retry logic ──────────────────────────────────────────────────────
const NON_RETRYABLE_ERRORS = new Set(['AbortError', 'CancelledError'])
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
const RETRYABLE_MESSAGE_RE = /Failed to fetch|NetworkError|timed out|ECONNRESET/i

function isRetryableQueryError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as ApiError & { name?: string; message?: string }

  if (candidate.name && NON_RETRYABLE_ERRORS.has(candidate.name)) return false
  if (candidate.retryable != null) return candidate.retryable
  if (typeof candidate.status === 'number') return RETRYABLE_STATUS_CODES.has(candidate.status)

  return RETRYABLE_MESSAGE_RE.test(String(candidate.message ?? ''))
}

/** Exponential backoff with jitter to prevent thundering herd */
function retryDelay(attempt: number): number {
  const base = Math.min(QUERY_DEFAULTS.BASE_RETRY_DELAY * 2 ** attempt, QUERY_DEFAULTS.MAX_RETRY_DELAY)
  const jitter = base * 0.2 * Math.random()
  return base + jitter
}

// ── Error Boundary ───────────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#ccc', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#ff6b6b' }}>Something went wrong</h2>
          <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', borderRadius: '8px', border: '1px solid #555', background: '#1a1e2e', color: '#ccc', cursor: 'pointer' }}
          >
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Query Client ─────────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_DEFAULTS.STALE_TIME,
      gcTime: QUERY_DEFAULTS.GC_TIME,
      retry: (failureCount, error) =>
        isRetryableQueryError(error) && failureCount < QUERY_DEFAULTS.MAX_RETRIES,
      retryDelay,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      refetchOnMount: false,
      refetchIntervalInBackground: false,
    },
  },
})

// ── Render ────────────────────────────────────────────────────────────
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>
)
