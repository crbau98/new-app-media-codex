/**
 * SSRF-aware helpers for the edge runtime.
 *
 * The edge cannot resolve DNS, so hostname-to-private-IP rebinding cannot be
 * detected here; literal/numeric IPs, internal suffixes, ports, credentials and
 * every redirect hop are validated. The Python backend adds connect-time IP
 * validation for anything it fetches.
 */

const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home.arpa', '.corp']
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata'])
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443'])
export const USER_AGENT = 'Mozilla/5.0 (compatible; MediaCodexIngest/1.0)'

function parseIpv4Part(part: string): number | null {
  if (/^0x[0-9a-f]+$/i.test(part)) return parseInt(part, 16)
  if (/^0[0-7]+$/.test(part)) return parseInt(part, 8)
  if (/^\d+$/.test(part)) return parseInt(part, 10)
  return null
}

/** Legacy inet_aton forms: 2130706433, 0x7f.1, 0177.0.0.1 */
export function parseNumericHost(host: string): number[] | null {
  if (!/^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}$/i.test(host)) return null
  const nums = host.split('.').map(parseIpv4Part)
  if (nums.some((n) => n === null || !Number.isFinite(n))) return null
  const parts = nums as number[]
  let value = 0
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (parts[i] > 255) return null
    value += parts[i] * 256 ** (3 - i)
  }
  const last = parts[parts.length - 1]
  if (last >= 256 ** (4 - (parts.length - 1))) return null
  value += last
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
}

export function isPrivateIpv4(o: number[]): boolean {
  const [a, b] = o
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19)) || a >= 224
}

export function isPrivateHost(hostnameRaw: string): boolean {
  const host = hostnameRaw.toLowerCase().replace(/\.$/, '')
  if (!host) return true
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true
  if (host.startsWith('[') || host.includes(':')) {
    const v6 = host.replace(/^\[|\]$/g, '')
    if (v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true
    const mapped = v6.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateHost(mapped[1])
    if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(v6) || /^64:ff9b:/.test(v6) || /^2002:/.test(v6)) return true
    return false
  }
  const numeric = parseNumericHost(host)
  if (numeric) return isPrivateIpv4(numeric)
  if (/^[0-9.x]+$/i.test(host)) return true // unparsable numeric-looking host
  return false
}

export function assertPublicHttpUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new Error('invalid_url')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported_protocol')
  if (url.username || url.password) throw new Error('credentials_not_allowed')
  if (isPrivateHost(url.hostname)) throw new Error('private_host_blocked')
  if (!ALLOWED_PORTS.has(url.port)) throw new Error('port_not_allowed')
  return url
}

export type SafeFetchResult = {
  url: string
  status: number
  headers: Headers
  body: Uint8Array
  truncated: boolean
  contentLength?: number
}

export async function safeFetch(
  rawUrl: string,
  opts: { method?: string; maxBytes?: number; timeoutMs?: number; rangeBytes?: number; headers?: Record<string, string>; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const { method = 'GET', maxBytes = 512 * 1024, timeoutMs = 7000, rangeBytes, maxRedirects = 5 } = opts
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let current = assertPublicHttpUrl(rawUrl).toString()
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*', ...(opts.headers || {}) }
      if (rangeBytes) headers.Range = `bytes=0-${rangeBytes - 1}`
      let response: Response
      try {
        response = await fetch(current, { method, headers, redirect: 'manual', signal: controller.signal })
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw new Error('timeout')
        throw new Error('connect_failed')
      }
      const location = response.headers.get('location')
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        current = assertPublicHttpUrl(new URL(location, current).toString()).toString()
        continue
      }
      const chunks: Uint8Array[] = []
      let total = 0
      let truncated = false
      if (method !== 'HEAD' && response.body) {
        const reader = response.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          total += value.byteLength
          if (total > maxBytes) {
            truncated = true
            await reader.cancel().catch(() => undefined)
            break
          }
        }
      }
      const body = new Uint8Array(Math.min(total, maxBytes))
      let offset = 0
      for (const chunk of chunks) {
        const slice = chunk.subarray(0, Math.max(0, Math.min(chunk.byteLength, body.byteLength - offset)))
        body.set(slice, offset)
        offset += slice.byteLength
      }
      const range = response.headers.get('content-range')
      const declared = response.headers.get('content-length')
      const totalFromRange = range && /\/(\d+)$/.test(range) ? Number(range.split('/').pop()) : undefined
      return {
        url: current,
        status: response.status,
        headers: response.headers,
        body,
        truncated,
        contentLength: totalFromRange ?? (declared && /^\d+$/.test(declared) ? Number(declared) : undefined),
      }
    }
    throw new Error('too_many_redirects')
  } finally {
    clearTimeout(timer)
  }
}
