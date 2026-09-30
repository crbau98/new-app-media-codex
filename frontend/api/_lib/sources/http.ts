/**
 * Small shared helpers for creator-search connectors: SSRF-safe host handling,
 * per-request timeout linked to a caller AbortSignal, bounded parallelism.
 */
import { assertPublicHttpUrl } from '../net-safe.js'

export const SEARCH_TIMEOUT_MS = 4000

/** Normalize a bare host (no scheme/path) and reject private/internal targets. */
export function safeHost(instance: string): string | null {
  const host = instance.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '')
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return null
  try {
    return assertPublicHttpUrl(`https://${host}/`).hostname
  } catch {
    return null
  }
}

/** GET JSON with a hard timeout; null on any failure (never throws). */
export async function getJson(url: string, opts: { signal?: AbortSignal; timeoutMs?: number; accept?: string } = {}): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? SEARCH_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: opts.accept || 'application/json', 'User-Agent': 'MediaCodexCreatorSearch/1.0 (+public-metadata-only)' },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results in input order. */
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}
