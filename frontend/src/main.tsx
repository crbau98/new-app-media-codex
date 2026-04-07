import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { useAppStore, getViewFromHash } from './store'
import type { ApiError } from './lib/api'

// ââ Constants ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const STORAGE_KEYS = {
  THEME: 'theme',
  ACCENT: 'accent-color',
  ACCENT_SECONDARY: 'accent-color-secondary',
} as const

const QUERY_DEFAULTS = {
  STALE_TIME: 60_000,         // 1 minute
  GC_TIME: 10 * 60_000,      // 10 minutes
  MAX_RETRIES: 2,
  MAX_RETRIES_503: 5,        // more retries for 503 (Render cold start)
  BASE_RETRY_DELAY: 750,     // ms
  BASE_RETRY_DELAY_503: 2_000, // longer base delay for 503
  MAX_RETRY_DELAY: 10_000,   // ms
  MAX_RETRY_DELAY_503: 30_000, // allow longer waits for cold starts
} as const

// ââ Safe localStorage ââââââââââââââââââââââââââââââââââââââââââââââââ
function safeLocalStorageGet(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

// ââ Theme & accent restoration (runs before React renders) âââââââââââ
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

// ââ Hash sync (back/forward navigation) ââââââââââââââââââââââââââââââ
window.addEventListener('hashchange', () => {
  const view = getViewFromHash()
  if (useAppStore.getState().activeView !== view) {
    useAppStore.setState({ activeView: view })
  }
})

// ââ Retry logic ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

/** Check if error is a 503 Service Unavailable (Render cold start) */
function is503(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as ApiError).status === 503
}

/** Exponential backoff with jitter; longer delays for 503 cold starts */
function retryDelay(attempt: number, error: unknown): number {
  const baseDelay = is503(error) ? QUERY_DEFAULTS.BASE_RETRY_DELAY_503 : QUERY_DEFAULTS.BASE_RETRY_DELAY
  const maxDelay = is503(error) ? QUERY_DEFAULTS.MAX_RETRY_DELAY_503 : QUERY_DEFAULTS.MAX_RETRY_DELAY
  const base = Math.min(baseDelay * 2 ** attempt, maxDelay)
  const jitter = base * 0.2 * Math.random()
  return base + jitter
}

// ââ Error Boundary âââââââââââââââââââââââââââââââââââââââââââââââââââ
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

// ââ Query Client âââââââââââââââââââââââââââââââââââââââââââââââââââââ
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_DEFAULTS.STALE_TIME,
      gcTime: QUERY_DEFAULTS.GC_TIME,
      retry: (failureCount, error) => {
        if (!isRetryableQueryError(error)) return false
        const maxRetries = is503(error) ? QUERY_DEFAULTS.MAX_RETRIES_503 : QUERY_DEFAULTS.MAX_RETRIES
        return failureCount < maxRetries
      },
      retryDelay,
      refetchOnWindowFocus: false,
      placeholderData: (prev: unknown) => prev, // show stale data while retrying
      refetchOnReconnect: 'always',
      refetchOnMount: false,
      refetchIntervalInBackground: false,
    },
  },
})

// ââ Render ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
