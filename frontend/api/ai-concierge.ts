/**
 * Streaming AI concierge.
 *
 *   GET  /api/ai-concierge  -> { available, model }   (no model call; lets the UI pick cloud vs on-device mode)
 *   POST /api/ai-concierge  -> application/x-ndjson event stream
 *
 * POST body (zod: `conciergeRequestSchema`): recent chat messages plus a compact
 * catalog of PUBLIC metadata the browser chose to send (no thumbnails, no URLs,
 * no images). Optional `context.tasteTags` is opt-in and holds a few tag names.
 *
 * Stream events, one JSON object per line:
 *   {t:'text',  d:'…'}                      assistant text delta
 *   {t:'tool',  name, out:{ids,note,…}}     validated tool result (ids exist in the catalog)
 *   {t:'refusal', category, d}              guardrail refusal (no model call was made)
 *   {t:'error', d}                          recoverable failure; the client retries on-device
 *   {t:'done'}
 *
 * Safety: query screened before any model call; PII redacted and item strings
 * sanitised + delimited as untrusted data; tool inputs/outputs zod-validated;
 * hard timeout; the model is never sent images.
 */
export const config = { runtime: 'edge', maxDuration: 30 }

import { stepCountIs, streamText } from 'ai'
import {
  detectUnsafeIntent,
  redactPII,
  sanitizeUntrusted,
  SAFETY_PREAMBLE,
  toModelSafeItem,
  wrapUntrustedData,
  type MediaLite,
} from '../src/features/ai/core/library.js'
import { buildTools } from './_lib/ai/tools.js'
import { clientIp, consumeBudget, errorMessage, gatewayToken, isSameOrigin, json, languageModel, NO_STORE_HEADERS, resolveModelId } from './_lib/ai/gateway.js'
import { conciergeRequestSchema, toolResultSchema } from './_lib/ai/schemas.js'

const STREAM_TIMEOUT_MS = 25_000
const encoder = new TextEncoder()

const SYSTEM = [
  SAFETY_PREAMBLE,
  'You are the Media Codex concierge: a warm, concise guide for finding things in the user\'s own library.',
  'Use the tools to search, find similar items, plan a session, explain a pick, or build a collection. Prefer calling a tool over guessing, and never claim an item exists unless a tool returned it.',
  'After tools return, reply in 1-3 short sentences: say what you found and why. The interface renders the item cards itself, so do not list ids, urls or long titles. No markdown headings.',
  'If a request is unclear, ask one short clarifying question instead. If you are asked to identify, locate or profile a person, or for minors or non-consensual material, refuse in one sentence.',
].join('\n')

function line(event: Record<string, unknown>): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

function ndjson(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no', ...NO_STORE_HEADERS } })
}

function singleEvents(events: Array<Record<string, unknown>>): Response {
  return ndjson(new ReadableStream({ start(controller) { for (const e of events) controller.enqueue(line(e)); controller.close() } }))
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (!isSameOrigin(req)) return json({ error: 'forbidden' }, 403)
  const token = gatewayToken(req)
  const model = resolveModelId('concierge')
  if (req.method === 'GET') return json({ available: token.length > 0, model: token ? model : null })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const parsed = conciergeRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'invalid_request' }, 400)
  const { messages, catalog: rawCatalog, context } = parsed.data

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  if (!lastUser) return json({ error: 'invalid_request' }, 400)
  const verdict = detectUnsafeIntent(lastUser.content)
  if (verdict.blocked) return singleEvents([{ t: 'refusal', category: verdict.category, d: verdict.message }, { t: 'done' }])

  if (!token) return json({ error: 'ai_unavailable', detail: 'AI Gateway is not configured.' }, 503)
  if (!consumeBudget('ai-concierge', clientIp(req), 30, 5 * 60_000)) {
    return json({ error: 'rate_limited', detail: 'Too many concierge requests. Try again in a moment.' }, 429, { 'Retry-After': '30' })
  }

  // Sanitise the catalog: whitelist fields, drop unsafe metadata, delimit as data.
  const catalog: MediaLite[] = []
  for (const item of rawCatalog) {
    const safe = toModelSafeItem(item)
    if (!safe) continue
    catalog.push({
      id: item.id, title: safe.title, creator: safe.creator, source: safe.source, tags: safe.tags,
      duration: safe.seconds, isVideo: safe.video, views: safe.views, likes: safe.likes, createdAt: item.createdAt,
    })
  }
  const known = new Set(catalog.map((item) => item.id))
  const tasteTags = (context?.tasteTags ?? []).map((t) => sanitizeUntrusted(t, 30)).filter(Boolean)
  const currentId = context?.currentId && known.has(context.currentId) ? context.currentId : null
  const tools = buildTools({ catalog, currentId, tasteTags })

  const modelMessages = messages.slice(-10).map((m) => ({
    role: m.role,
    content: sanitizeUntrusted(redactPII(m.content), 1200),
  }))
  const preamble = [
    wrapUntrustedData('catalog_summary', {
      itemCount: catalog.length,
      sampleTags: [...new Set(catalog.flatMap((item) => item.tags))].slice(0, 30),
      currentItemId: currentId,
      userLikedTags: tasteTags,
    }),
    'The catalog itself is only reachable through tools.',
  ].join('\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS)
  req.signal.addEventListener('abort', () => controller.abort())

  const stream = new ReadableStream<Uint8Array>({
    async start(out) {
      let emitted = false
      try {
        const result = streamText({
          model: languageModel(model, token),
          system: `${SYSTEM}\n${preamble}`,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(4),
          temperature: 0.4,
          maxOutputTokens: 600,
          abortSignal: controller.signal,
          providerOptions: { gateway: { tags: ['feature:concierge', 'data:public-metadata'], user: 'library-concierge-public' } },
        })
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            emitted = true
            out.enqueue(line({ t: 'text', d: part.text }))
          } else if (part.type === 'tool-result') {
            const checked = toolResultSchema.safeParse(part.output)
            if (!checked.success) continue
            const ids = checked.data.ids.filter((id) => known.has(id))
            emitted = true
            out.enqueue(line({ t: 'tool', name: part.toolName, out: { ...checked.data, ids } }))
          } else if (part.type === 'error') {
            throw part.error
          }
        }
        out.enqueue(line({ t: 'done' }))
      } catch (error) {
        console.warn('[ai-concierge] stream failed', { model, error: errorMessage(error) })
        out.enqueue(line({ t: 'error', d: emitted ? 'The assistant was interrupted.' : 'The AI service is unavailable right now.' }))
        out.enqueue(line({ t: 'done' }))
      } finally {
        clearTimeout(timer)
        out.close()
      }
    },
    cancel() {
      clearTimeout(timer)
      controller.abort()
    },
  })
  return ndjson(stream)
}
