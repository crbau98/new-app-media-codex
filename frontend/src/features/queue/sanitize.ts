/** Defensive coercion helpers for data read back from localStorage or an imported file. */

export function cleanString(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  let out = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    out += code < 32 || code === 127 ? ' ' : ch
  }
  out = out.trim()
  return out.length > max ? out.slice(0, max).trimEnd() : out
}

/** http(s) or root-relative URLs only — never javascript:, data:, blob: or protocol-relative. */
export function cleanUrl(value: unknown, max = 900): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (!v || v.length > max) return undefined
  if (/^https?:\/\//i.test(v)) return v
  if (v.startsWith('/') && !v.startsWith('//')) return v
  return undefined
}

export function cleanNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(max, Math.max(min, value))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stableId(prefix: string, now = Date.now(), rng: () => number = Math.random): string {
  return `${prefix}-${now.toString(36)}-${Math.floor(rng() * 36 ** 4).toString(36).padStart(4, '0')}`
}
