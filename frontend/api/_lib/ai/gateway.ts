/**
 * Shared plumbing for the AI edge endpoints (ai-query, ai-concierge, ai-embed).
 * Mirrors the pattern in `../ai-similarity.ts`: models are Vercel AI Gateway
 * ids selected through env vars, calls have hard timeouts, and every endpoint
 * degrades to a deterministic fallback instead of failing.
 *
 * Env:
 *   AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN  gateway credentials (never VITE_*)
 *   AI_DISCOVERY_MODEL     base default model id (shared with creator reranking)
 *   AI_QUERY_MODEL         override for natural-language query refinement
 *   AI_CONCIERGE_MODEL     override for the streaming concierge
 *   AI_EMBEDDING_MODEL     optional embedding model id; unset = local search only
 */

import { createGateway } from 'ai'

export const DEFAULT_MODEL = 'openai/gpt-5.6-luna'

export type AiFeature = 'query' | 'concierge'

export function resolveModelId(feature: AiFeature): string {
  const specific = feature === 'query' ? process.env.AI_QUERY_MODEL : process.env.AI_CONCIERGE_MODEL
  return (specific || process.env.AI_DISCOVERY_MODEL || DEFAULT_MODEL).trim()
}

export function embeddingModelId(): string {
  return (process.env.AI_EMBEDDING_MODEL || '').trim()
}

export function gatewayToken(req: Request): string {
  return (
    process.env.AI_GATEWAY_API_KEY
    || req.headers.get('x-vercel-oidc-token')
    || process.env.VERCEL_OIDC_TOKEN
    || ''
  ).trim()
}

export function hasGatewayCredentials(req: Request): boolean {
  return gatewayToken(req).length > 0
}

/** Language model handle: explicit key/OIDC token when present, otherwise the plain id. */
export function languageModel(modelId: string, token: string) {
  return token ? createGateway({ apiKey: token })(modelId) : modelId
}

export function embeddingModel(modelId: string, token: string) {
  return createGateway(token ? { apiKey: token } : {}).embeddingModel(modelId)
}

/* ── best-effort per-client budgets (edge isolates are ephemeral) ── */

const buckets = new Map<string, { count: number; resetAt: number }>()

export function consumeBudget(name: string, key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  if (buckets.size > 4096) buckets.clear()
  const id = `${name}:${key}`
  const bucket = buckets.get(id)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}

export function clientIp(req: Request): string {
  const chain = (req.headers.get('x-forwarded-for') || '').split(',').map((v) => v.trim()).filter(Boolean)
  return chain[chain.length - 1] || req.headers.get('x-real-ip') || 'unknown'
}

export const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS, ...extra },
  })
}

/** Refuse cross-site browser calls; same-origin fetches and server-to-server calls pass. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === new URL(req.url).host
  } catch {
    return false
  }
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 180 ? `${message.slice(0, 179)}…` : message
}

/** Small TTL cache with a hard size cap. */
export class TtlCache<T> {
  private map = new Map<string, { at: number; value: T }>()
  private ttlMs: number
  private max: number
  constructor(ttlMs: number, max = 128) {
    this.ttlMs = ttlMs
    this.max = max
  }
  get(key: string): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (Date.now() - hit.at > this.ttlMs) { this.map.delete(key); return undefined }
    return hit.value
  }
  set(key: string, value: T) {
    if (this.map.size >= this.max) this.map.clear()
    this.map.set(key, { at: Date.now(), value })
  }
}
