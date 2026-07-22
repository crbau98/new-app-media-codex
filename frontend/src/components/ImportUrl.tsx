import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Link2, Loader2, Rss, ShieldCheck } from 'lucide-react'
import MediaImage from '@/components/MediaImage'

type ImportFeedItem = {
  id: string
  title: string
  url: string
  publishedAt?: string
  mediaUrl?: string
  thumbnail?: string
  kind: 'video' | 'image' | 'link'
}

type ImportResponse = {
  mode: 'feed' | 'outbound'
  source: string
  attribution: string
  termsUrl: string
  feed?: { feedUrl: string; title: string; items: ImportFeedItem[] }
  url?: string
  usableInApp?: boolean
  reason?: string
  error?: string
}

/**
 * URL import lane: the user pastes a link they want to bring in. Explicit
 * feeds (RSS/Atom/JSON Feed) parse inline with attribution; everything else is
 * classified outbound — no crawling, no scraping, no paywall workarounds.
 */
export default function ImportUrl() {
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResponse | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const runImport = useCallback(async () => {
    const value = draft.trim()
    if (!value || loading) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/import-url', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: value }),
      })
      const data = (await response.json()) as ImportResponse
      if (!response.ok) throw new Error(data.error || `http_${response.status}`)
      setResult(data)
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return
      setResult(null)
      const message = cause instanceof Error ? cause.message : ''
      setError(
        message.includes('private_host') || message.includes('unsupported_protocol')
          ? 'That URL is not allowed. Public http(s) links only.'
          : 'The link could not be read. Check the URL and try again.'
      )
    } finally {
      setLoading(false)
    }
  }, [draft, loading])

  const feedItems = result?.mode === 'feed' ? (result.feed?.items ?? []) : []

  return (
    <section aria-label="Import a link" className="rounded-md border border-line p-4 content-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow flex items-center gap-1.5">
          <Link2 size={12} strokeWidth={1.75} aria-hidden="true" /> Import a link
        </h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">Feeds parse inline · everything else links out</span>
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-ink-2">
        Paste a public RSS/Atom/JSON feed to browse it here with attribution. Other links are
        classified and open on their source — nothing is crawled or rehosted.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void runImport()
          }}
          placeholder="https://example.org/feed.xml"
          aria-label="URL to import"
          inputMode="url"
          className="h-10 w-full max-w-md rounded-md border border-line bg-transparent px-3 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
        />
        <button onClick={() => void runImport()} disabled={loading || !draft.trim()} className="btn-secondary min-h-10 px-4">
          {loading ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden="true" /> : null}
          {loading ? 'Reading' : 'Import'}
        </button>
      </div>

      {error && <p className="mt-3 text-[13px] text-heat">{error}</p>}

      {result?.mode === 'outbound' && result.url && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-sunken/40 p-3">
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink-2">
            <span className="font-medium text-ink">Opens on its source.</span> {result.reason}
          </p>
          <a href={result.url} target="_blank" rel="noreferrer" className="btn-primary min-h-9 shrink-0 px-3 text-xs">
            Open link <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      )}

      {result?.mode === 'feed' && (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2">
            <Rss size={12} strokeWidth={1.75} aria-hidden="true" />
            {result.feed?.title || 'Feed'} · {feedItems.length} items
          </p>
          {feedItems.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-3">The feed parsed but contained no media items.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {feedItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  {item.thumbnail || item.mediaUrl ? (
                    <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-sunken">
                      <MediaImage
                        sources={[item.thumbnail, item.mediaUrl]}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover"
                        skeletonClassName="absolute inset-0"
                      />
                    </span>
                  ) : (
                    <span className="grid h-14 w-20 shrink-0 place-items-center rounded-sm bg-sunken font-mono text-[9px] uppercase text-ink-3">
                      {item.kind}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{item.title}</span>
                    <span className="mono-meta mt-0.5 block uppercase">{item.kind}{item.publishedAt ? ` · ${item.publishedAt.slice(0, 10)}` : ''}</span>
                  </span>
                  <a href={item.url} target="_blank" rel="noreferrer" className="btn-secondary min-h-9 shrink-0 px-3 text-xs">
                    View on source <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] leading-4 text-ink-3">
          <ShieldCheck size={12} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
          {result.attribution} ·
          {result.termsUrl !== 'about:blank' ? (
            <a href={result.termsUrl} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
              Source terms
            </a>
          ) : (
            <span>Source terms</span>
          )}
        </p>
      )}
    </section>
  )
}
