/** Recent command-bar queries, kept only in this browser (cleared by resetTasteProfile()). */

import { redactPII } from './core/library.ts'

export const RECENT_KEY = 'media-codex-ai-recent-v1'
const MAX_RECENT = 8

export function loadRecentQueries(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

export function pushRecentQuery(query: string): string[] {
  const clean = redactPII(query).replace(/\s+/g, ' ').trim().slice(0, 120)
  if (clean.length < 3) return loadRecentQueries()
  const next = [clean, ...loadRecentQueries().filter((q) => q.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT)
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  return next
}

export function clearRecentQueries() {
  try { window.localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
}
