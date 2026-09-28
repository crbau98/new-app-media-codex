/** Concierge conversation persistence — local only, text + item ids, never item payloads. */

import { redactPII } from '../core/library.ts'
import type { ReplyAction } from './local.ts'

export const HISTORY_KEY = 'media-codex-concierge-v1'
export const PREFS_KEY = 'media-codex-ai-prefs-v1'
const MAX_MESSAGES = 24

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  ids?: string[]
  reasons?: Record<string, string>
  actions?: ReplyAction[]
  chips?: string[]
  status?: 'streaming' | 'done' | 'error'
  error?: string
  mode?: 'cloud' | 'device'
  note?: string
  refused?: boolean
  totalSeconds?: number
}

export function newId(): string {
  try { if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID() } catch { /* fall through */ }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadHistory(): ChatMessage[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((m): m is ChatMessage => typeof m === 'object' && m !== null && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .slice(-MAX_MESSAGES)
      .map((m) => ({ ...m, status: m.status === 'streaming' ? 'done' : m.status }))
  } catch {
    return []
  }
}

export function saveHistory(messages: ChatMessage[]) {
  try {
    const slim = messages
      .filter((m) => m.status !== 'streaming')
      .slice(-MAX_MESSAGES)
      .map((m) => ({ ...m, text: redactPII(m.text).slice(0, 2000) }))
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(slim))
  } catch { /* storage unavailable */ }
}

export function clearHistory() {
  try { window.localStorage.removeItem(HISTORY_KEY) } catch { /* ignore */ }
}

export interface AiPrefs { shareTasteTags: boolean }

export function loadPrefs(): AiPrefs {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}')
    return { shareTasteTags: typeof parsed === 'object' && parsed !== null && (parsed as AiPrefs).shareTasteTags === true }
  } catch {
    return { shareTasteTags: false }
  }
}

export function savePrefs(prefs: AiPrefs) {
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
}
