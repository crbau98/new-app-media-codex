import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { useAppStore, getViewFromHash } from './store'
import type { ApiError } from './lib/api'

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

// Restore saved theme on startup
const savedTheme = safeLocalStorageGet('theme') || 'dark'
document.documentElement.dataset.theme = savedTheme

// Restore saved accent colors on startup â batched to minimize reflows
const savedAccent = safeLocalStorageGet("accent-color")
const savedAccentSecondary = safeLocalStorageGet("accent-color-secondary")
if (savedAccent || savedAccentSecondary) {
  const root = document.documentElement
  if (savedAccent) {
    root.style.setProperty("--color-accent", savedAccent)
    root.style.setProperty("--color-accent-glow", savedAccent + "50")
  }
  if (savedAccentSecondary) {
    root.style.setProperty("--color-accent-secondary", savedAccentSecondary)
  }
}

// Sync hash changes (back/forward navigation) into the store
window.addEventListener('hashchange', () => {
  const view = getViewFromHash()
  if (useAppStore.getState().activeView !== view) {
    useAppStore.setState({ activeView: view })
  }
})

function isRetryableQueryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as ApiError & { name?: string; message?: string }
  if (candidate.name === "AbortError") return false
  if (candidate.retryable != null) return candidate.retryable
  if (typeof candidate.status === "number") {
    return candidate.status === 408 || candidate.status === 429 || candidate.status >= 500
  }
  const message = String(candidate.message ?? "")
  return /Failed to fetch|NetworkError|timed out/i.test(message)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,           // 5 min â most data is slow-changing
      gcTime: 15 * 60_000,
      retry: (failureCount, error) => isRetryableQueryError(error) && failureCount < 2,
      retryDelay: (attempt) => Math.min(750 * 2 ** attempt, 10_000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      refetchOnMount: false,
      refetchIntervalInBackground: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { useAppStore, getViewFromHash } from './store'
import type { ApiError } from './lib/api'

function safeLocalStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

// Restore saved theme on startup
const savedTheme = safeLocalStorageGet('theme') || 'dark'
document.documentElement.dataset.theme = savedTheme

// Restore saved accent color on startup
const savedAccent = safeLocalStorageGet("accent-color")
if (savedAccent) {
  document.documentElement.style.setProperty("--color-accent", savedAccent)
  document.documentElement.style.setProperty("--color-accent-glow", savedAccent + "50")
}
const savedAccentSecondary = safeLocalStorageGet("accent-color-secondary")
if (savedAccentSecondary) {
  document.documentElement.style.setProperty("--color-accent-secondary", savedAccentSecondary)
}

// Sync hash changes (back/forward navigation) into the store
window.addEventListener('hashchange', () => {
  const view = getViewFromHash()
  if (useAppStore.getState().activeView !== view) {
    useAppStore.setState({ activeView: view })
  }
})

function isRetryableQueryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as ApiError & { name?: string; message?: string }
  if (candidate.name === "AbortError") return false
  if (candidate.retryable != null) return candidate.retryable
  if (typeof candidate.status === "number") {
    return candidate.status === 408 || candidate.status === 429 || candidate.status >= 500
  }
  const message = String(candidate.message ?? "")
  return /Failed to fetch|NetworkError|timed out/i.test(message)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000,
      gcTime: 15 * 60_000,
      retry: (failureCount, error) => isRetryableQueryError(error) && failureCount < 2,
      retryDelay: (attempt) => Math.min(750 * 2 ** attempt, 10_000),
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      refetchOnMount: false,
      refetchIntervalInBackground: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
