import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Globe2, Loader2, ShieldCheck } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import { cn } from '@/lib/utils'

type FederatedSource = 'peertube' | 'mastodon'

type FederatedResponse = {
  source: FederatedSource
  instance: string
  metadataOnly: boolean
  attribution: string
  termsUrl: string
  items: Array<Record<string, unknown>>
  error?: string
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function formatDuration(totalSeconds: unknown): string | null {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds)) return null
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Search the public API on a user-selected PeerTube or Mastodon instance. */
export default function FederatedSearch() {
  const [source, setSource] = useState<FederatedSource>('peertube')
  const [instance, setInstance] = useState('')
  const [term, setTerm] = useState('')
  const [includeNsfw, setIncludeNsfw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<FederatedResponse | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runSearch = useCallback(async () => {
    const cleanedInstance = instance.trim()
    const cleanedTerm = term.trim().replace(/^#/, '')
    if (!cleanedInstance || !cleanedTerm || loading) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/source-search', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          source === 'peertube'
            ? { source, instance: cleanedInstance, query: cleanedTerm, includeNsfw }
            : { source, instance: cleanedInstance, tag: cleanedTerm, limit: 20 }
        ),
      })
      const data = (await response.json()) as FederatedResponse
      if (!response.ok) throw new Error(data.error || `http_${response.status}`)
      setResult(data)
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return
      setResult(null)
      setError(
        cause instanceof Error && cause.message.includes('invalid_instance')
          ? 'That instance address is not allowed. Use a public instance hostname only.'
          : 'The instance could not be reached or returned an error. Check the hostname and try again.'
      )
    } finally {
      setLoading(false)
    }
  }, [includeNsfw, instance, loading, source, term])

  const items = result?.items ?? []

  return (
    <section aria-label="Federated source search" className="rounded-md border border-line p-4 content-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow flex items-center gap-1.5">
          <Globe2 size={12} strokeWidth={1.75} aria-hidden="true" /> Federated web · PeerTube &amp; Mastodon
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">Direct instance search</span>
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-ink-2">
        Search public PeerTube videos or a Mastodon hashtag directly on an instance you choose.
        Results stay attributed and preserve publisher details such as licenses and content warnings.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Federated source">
          {(['peertube', 'mastodon'] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setSource(value)
                setResult(null)
                setError(null)
              }}
              className={cn('chip', source === value && 'chip-active')}
              aria-pressed={source === value}
            >
              {value === 'peertube' ? 'PeerTube' : 'Mastodon'}
            </button>
          ))}
        </div>
        <input
          value={instance}
          onChange={(event) => setInstance(event.target.value)}
          placeholder={source === 'peertube' ? 'Instance e.g. videos.example.org' : 'Instance e.g. mastodon.social'}
          aria-label="Instance hostname"
          className="h-10 w-56 rounded-md border border-line bg-transparent px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
        />
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void runSearch()
          }}
          placeholder={source === 'peertube' ? 'Search videos' : 'Hashtag (without #)'}
          aria-label={source === 'peertube' ? 'PeerTube search query' : 'Mastodon hashtag'}
          className="h-10 w-48 rounded-md border border-line bg-transparent px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
        />
        {source === 'peertube' && (
          <label className="inline-flex min-h-10 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-2">
            <input
              type="checkbox"
              checked={includeNsfw}
              onChange={(event) => setIncludeNsfw(event.target.checked)}
              className="h-3.5 w-3.5 accent-heat"
            />
            Include NSFW-flagged
          </label>
        )}
        <button onClick={() => void runSearch()} disabled={loading || !instance.trim() || !term.trim()} className="btn-secondary min-h-10 px-4">
          {loading ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden="true" /> : null}
          {loading ? 'Searching' : 'Search'}
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-heat">{error}</p>}

      {result && (
        <div className="mt-4">
          {items.length === 0 ? (
            <p className="text-[13px] text-ink-3">Nothing returned for that search on {result.instance}.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {items.map((raw, index) => {
                const key = asString(raw.id) ?? String(index)
                const url = asString(raw.url)
                const title = asString(raw.title) ?? asString(raw.description) ?? 'Untitled'
                const thumb = asString(raw.thumbnail) ?? asString(raw.previewUrl) ?? asString(raw.preview)
                const byline = asString(raw.creator) ?? asString(raw.channel) ?? asString(raw.account)
                const license = asString(raw.license)
                const duration = formatDuration(raw.duration)
                const sensitive = raw.sensitive === true || raw.nsfw === true
                const spoiler = asString(raw.spoilerText)
                return (
                  <li key={key} className="flex items-center gap-3 py-3">
                    {thumb ? (
                      <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-sunken">
                        <MediaImage sources={[thumb]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" />
                      </span>
                    ) : (
                      <span className="grid h-14 w-20 shrink-0 place-items-center rounded-sm bg-sunken font-mono text-[9px] uppercase text-ink-3">
                        {asString(raw.kind) ?? 'link'}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
                      <span className="mono-meta mt-0.5 block uppercase">
                        {byline ? `${byline} · ` : ''}{result.instance}{duration ? ` · ${duration}` : ''}
                      </span>
                      {(license || sensitive || spoiler) && (
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {license && <span className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[9px] text-ink-2">{license}</span>}
                          {sensitive && <span className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[9px] text-ink-2">Source-flagged sensitive</span>}
                          {spoiler && <span className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[9px] text-ink-2">CW: {spoiler}</span>}
                        </span>
                      )}
                    </span>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="btn-secondary min-h-9 shrink-0 px-3 text-xs">
                        View on source <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] leading-4 text-ink-3">
            <ShieldCheck size={12} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
            {result.attribution} ·
            <a href={result.termsUrl} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Instance terms
            </a>
          </p>
        </div>
      )}
    </section>
  )
}
