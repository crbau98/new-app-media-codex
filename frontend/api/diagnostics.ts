export const config = { runtime: 'edge' }

const NO_STORE = {
  'Cache-Control': 'private, no-store',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
}

type IncomingSample = {
  name?: string
  value?: number
  at?: number
  path?: string
  meta?: Record<string, string | number | boolean>
}

function cleanSamples(input: IncomingSample[]) {
  return input
    .filter((sample) => typeof sample.name === 'string' && typeof sample.value === 'number' && Number.isFinite(sample.value))
    .slice(0, 40)
    .map((sample) => ({
      name: sample.name as string,
      value: Math.round(sample.value as number),
      at: typeof sample.at === 'number' ? sample.at : Date.now(),
      path: typeof sample.path === 'string' ? sample.path.slice(0, 120) : '/',
      meta: sample.meta && typeof sample.meta === 'object' ? sample.meta : undefined,
    }))
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: NO_STORE })
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: NO_STORE })

  const body = await req.json().catch(() => null) as { samples?: IncomingSample[] } | null
  const samples = cleanSamples(Array.isArray(body?.samples) ? body.samples : [])
  if (samples.length) {
    // Vercel edge logs are the transport for now; this stays intentionally small
    // so diagnostics can never become a media-blocking request.
    console.info('[media-codex:vitals]', JSON.stringify({ samples }))
  }
  return new Response(null, { status: 204, headers: NO_STORE })
}
