import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, FileUp, Link2, Loader2, RefreshCw, Rss, ShieldCheck, X } from 'lucide-react'
import MediaImage from '@/components/MediaImage'
import { apiUrl, getPublicOrigin } from '@/lib/backendOrigin'

/* ── types ─────────────────────────────────────────────── */

type Candidate = { url: string; kind: 'video' | 'image' | 'hls' | 'dash'; height?: number; width?: number }
type Classification = {
  finalUrl: string
  canonicalUrl: string
  kind: 'video' | 'image' | 'gallery' | 'page' | 'feed' | 'unsupported'
  title?: string
  source: string
  siteName?: string
  thumbnailUrl?: string
  durationSeconds?: number
  width?: number
  height?: number
  candidates: Candidate[]
  protected: boolean
  playable: boolean
  warnings: string[]
}
type FeedItem = { id: string; title: string; url: string; publishedAt?: string; mediaUrl?: string; thumbnail?: string; kind: 'video' | 'image' | 'link' }
type PreviewResponse = {
  mode: 'media' | 'feed' | 'outbound'
  attribution: string
  classification?: Classification
  feed?: { feedUrl: string; title: string; items: FeedItem[] }
  url?: string
  reason?: string
  error?: string
}
type Job = { id: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; stage?: string | null; progress: number; terminal: boolean; error?: { code: string; message: string } | null; result?: { duplicate?: boolean; title?: string } | null }

type Entry = {
  key: string
  url: string
  status: 'classifying' | 'ready' | 'error' | 'queued' | 'importing' | 'done' | 'failed'
  preview?: PreviewResponse
  error?: string
  job?: Job
  duplicate?: boolean
}

/* ── helpers ───────────────────────────────────────────── */

const TOKEN_KEY = 'mc.admin-token'
const ERROR_TEXT: Record<string, string> = {
  private_host_blocked: 'That address is private or internal. Public http(s) links only.',
  unsupported_protocol: 'Only http(s) links are supported.',
  credentials_not_allowed: 'Links with embedded credentials are not allowed.',
  port_not_allowed: 'That port is not allowed.',
  invalid_url: 'That does not look like a valid link.',
  not_found: 'The page or file was not found (404).',
  auth_required: 'That link needs a login, so it cannot be imported.',
  timeout: 'The site took too long to respond. Try again.',
  connect_failed: 'Could not reach that site. Check the link and try again.',
  http_error: 'The site returned an error. Try again later.',
  protected_content: 'That stream is protected (DRM or login) and cannot be imported.',
  no_media_found: 'No importable image or video was found at that link.',
  is_feed: 'That link is a feed. Pick individual items from it.',
  not_a_video: 'The link did not serve a video file.',
  extension_mismatch: 'The file contents do not match its extension.',
  unsupported_type: 'Only images and videos can be uploaded.',
  file_too_large: 'That file is larger than the upload limit.',
  heic_unsupported: 'HEIC photos are not supported on this server; export as JPEG.',
}

function readToken(): string {
  try { return window.localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}
function saveToken(value: string) {
  try { if (value) window.localStorage.setItem(TOKEN_KEY, value); else window.localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}
const friendly = (code?: string, fallback = 'Something went wrong. Try again.') => (code && ERROR_TEXT[code]) || fallback

function duration(seconds?: number): string {
  if (!seconds || seconds <= 0) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`
}

function parseUrls(text: string): string[] {
  const found = text.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s))
  return [...new Set(found)].slice(0, 25)
}

type JsonBody = { error?: string | { code?: string }; detail?: { code?: string } } & Record<string, unknown>

async function readJson(response: Response): Promise<JsonBody> {
  try { return (await response.json()) as JsonBody } catch { return {} }
}
function errorCode(body: JsonBody, status: number): string {
  const err = body.error
  return (typeof err === 'object' && err?.code) || body.detail?.code || (typeof err === 'string' ? err : '') || `http_${status}`
}

/** Universal importer: paste links or drop files, preview what each one is, then add to the library. */
export default function ImportUrl() {
  const [draft, setDraft] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [token, setToken] = useState(readToken)
  const [needToken, setNeedToken] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const aborts = useRef(new Set<AbortController>())
  const timers = useRef(new Map<string, number>())

  useEffect(() => {
    const controllers = aborts.current
    const pollers = timers.current
    return () => {
      controllers.forEach((c) => c.abort())
      pollers.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const patch = useCallback((key: string, next: Partial<Entry>) => {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...next } : e)))
  }, [])

  const classify = useCallback(async (key: string, url: string) => {
    const controller = new AbortController()
    aborts.current.add(controller)
    patch(key, { status: 'classifying', error: undefined })
    try {
      const response = await fetch('/api/import-url', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      })
      const body = await readJson(response)
      if (!response.ok) throw new Error(errorCode(body, response.status))
      patch(key, { status: 'ready', preview: body as PreviewResponse })
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return
      patch(key, { status: 'error', error: friendly((cause as Error).message, 'The link could not be read. Check it and try again.') })
    } finally {
      aborts.current.delete(controller)
    }
  }, [patch])

  const addUrls = useCallback((urls: string[]) => {
    if (!urls.length) return
    setNotice(null)
    setEntries((list) => {
      const have = new Set(list.map((e) => e.url))
      const fresh = urls.filter((u) => !have.has(u)).map((u): Entry => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url: u, status: 'classifying' }))
      queueMicrotask(() => fresh.forEach((e) => void classify(e.key, e.url)))
      return [...list, ...fresh]
    })
  }, [classify])

  const submitDraft = () => {
    const urls = parseUrls(draft)
    if (!urls.length) { setNotice('Paste one or more http(s) links (one per line).'); return }
    addUrls(urls)
    setDraft('')
  }

  const authHeaders = useCallback((): Record<string, string> => (token ? { 'X-Admin-Token': token } : {}), [token])

  const poll = useCallback((key: string, jobId: string) => {
    const tick = async () => {
      try {
        const response = await fetch(apiUrl(`/api/v1/ingest/jobs/${jobId}?events=false`), { headers: authHeaders() })
        const job = (await readJson(response)) as unknown as Job
        if (!response.ok) throw new Error('poll_failed')
        const status: Entry['status'] = job.state === 'succeeded' ? 'done' : job.state === 'failed' || job.state === 'cancelled' ? 'failed' : 'importing'
        patch(key, { job, status, duplicate: Boolean(job.result?.duplicate), error: job.error ? friendly(job.error.code, job.error.message) : undefined })
        if (!job.terminal) timers.current.set(key, window.setTimeout(tick, 1500))
      } catch {
        timers.current.set(key, window.setTimeout(tick, 4000))
      }
    }
    void tick()
  }, [authHeaders, patch])

  const enqueue = useCallback(async (targets: Entry[], urlFor: (e: Entry) => string) => {
    if (!targets.length) return
    targets.forEach((e) => patch(e.key, { status: 'queued', error: undefined }))
    try {
      const response = await fetch(apiUrl('/api/v1/ingest/jobs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ urls: targets.map(urlFor) }),
      })
      const body = await readJson(response)
      if (response.status === 401 || response.status === 503) {
        setNeedToken(true)
        targets.forEach((e) => patch(e.key, { status: 'ready' }))
        setNotice('Adding to the library needs the admin token.')
        return
      }
      if (!response.ok) throw new Error(errorCode(body, response.status))
      const results = (body.results || []) as Array<{ url: string; job?: Job; rejected?: { code: string } }>
      targets.forEach((e) => {
        const r = results.find((x) => x.url === urlFor(e))
        if (r?.job) { patch(e.key, { job: r.job, status: 'queued' }); poll(e.key, r.job.id) }
        else patch(e.key, { status: 'failed', error: friendly(r?.rejected?.code) })
      })
    } catch (cause) {
      targets.forEach((e) => patch(e.key, { status: 'failed', error: friendly((cause as Error).message, 'Could not reach the library service. Try again.') }))
    }
  }, [authHeaders, patch, poll])

  const importable = useMemo(() => entries.filter((e) => e.status === 'ready' && e.preview?.mode === 'media'), [entries])

  const cancel = async (entry: Entry) => {
    if (!entry.job) return
    await fetch(apiUrl(`/api/v1/ingest/jobs/${entry.job.id}/cancel`), { method: 'POST', headers: authHeaders() }).catch(() => undefined)
  }

  const uploadFiles = (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length) return
    const form = new FormData()
    list.slice(0, 24).forEach((f) => form.append('files', f))
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${getPublicOrigin()}/api/v1/ingest/upload`)
    if (token) xhr.setRequestHeader('X-Admin-Token', token)
    setUploadPct(0)
    setNotice(null)
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) setUploadPct(Math.round((ev.loaded / ev.total) * 100)) }
    xhr.onerror = () => { setUploadPct(null); setNotice('Upload failed. Check your connection and try again.') }
    xhr.onload = () => {
      setUploadPct(null)
      let body: JsonBody = {}
      try { body = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status === 401 || xhr.status === 503) { setNeedToken(true); setNotice('Uploading needs the admin token.'); return }
      const jobs = (body.jobs || []) as Job[]
      const rejected = (body.rejected || []) as Array<{ filename?: string; code?: string }>
      const dupes = (body.duplicates || []) as Array<{ filename?: string }>
      const rows: Entry[] = [
        ...jobs.map((j, i): Entry => ({ key: `up-${j.id}`, url: list[i]?.name || 'Upload', status: 'queued', job: j })),
        ...rejected.map((r, i): Entry => ({ key: `rej-${Date.now()}-${i}`, url: r.filename || 'File', status: 'failed', error: friendly(r.code) })),
        ...dupes.map((d, i): Entry => ({ key: `dup-${Date.now()}-${i}`, url: d.filename || 'File', status: 'done', duplicate: true })),
      ]
      setEntries((prev) => [...prev, ...rows])
      jobs.forEach((j) => poll(`up-${j.id}`, j.id))
    }
    xhr.send(form)
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files?.length) { uploadFiles(event.dataTransfer.files); return }
    const dropped = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
    addUrls(parseUrls(dropped))
  }

  return (
    <section
      aria-label="Import media"
      className={`rounded-md border p-4 content-auto transition-colors ${dragging ? 'border-line-strong bg-elevated' : 'border-line'}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="eyebrow flex items-center gap-1.5"><Link2 size={12} strokeWidth={1.75} aria-hidden="true" /> Import media</h2>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">Links, feeds, photos, video</span>
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-ink-2">
        Paste links (one per line) or drop files anywhere here. Each link is identified first, so you see exactly what will be added.
        Only what a link publicly serves is imported; protected streams are never touched.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text')
            const urls = parseUrls(pasted)
            if (urls.length > 1) { e.preventDefault(); addUrls(urls) }
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDraft() } }}
          placeholder="https://example.com/video-or-page"
          aria-label="Links to import"
          rows={2}
          inputMode="url"
          className="min-h-11 w-full flex-1 resize-y rounded-md border border-line bg-transparent px-3 py-2 text-base text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
        />
        <div className="flex gap-2">
          <button type="button" onClick={submitDraft} disabled={!draft.trim()} className="btn-secondary min-h-11 px-4">Check link</button>
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary min-h-11 px-4" aria-label="Upload photos or videos">
            <FileUp size={14} strokeWidth={1.75} aria-hidden="true" /> Files
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="sr-only" tabIndex={-1}
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      {uploadPct !== null && (
        <div className="mt-3" role="progressbar" aria-label="Upload progress" aria-valuenow={uploadPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full bg-heat transition-all" style={{ width: `${uploadPct}%` }} /></div>
          <p className="mono-meta mt-1">Uploading {uploadPct}%</p>
        </div>
      )}

      {notice && <p role="status" className="mt-3 text-[13px] text-heat">{notice}</p>}

      {needToken && (
        <label className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          Admin token
          <input type="password" value={token} autoComplete="off"
            onChange={(e) => { setToken(e.target.value); saveToken(e.target.value) }}
            className="min-h-11 w-full max-w-xs rounded-md border border-line bg-transparent px-3 text-base text-ink outline-none focus:border-line-strong" />
        </label>
      )}

      {entries.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="mono-meta uppercase">{entries.length} item{entries.length === 1 ? '' : 's'}</p>
            <div className="flex gap-2">
              {importable.length > 0 && (
                <button type="button" className="btn-primary min-h-11 px-4 text-xs" onClick={() => void enqueue(importable, (e) => e.url)}>
                  Add {importable.length} to library
                </button>
              )}
              <button type="button" className="btn-secondary min-h-11 px-4 text-xs" onClick={() => { setEntries([]); timers.current.forEach((t) => window.clearTimeout(t)) }}>Clear</button>
            </div>
          </div>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {entries.map((entry) => (
              <EntryRow key={entry.key} entry={entry}
                onRetry={() => (entry.status === 'failed' && entry.job ? void enqueue([entry], (x) => x.url) : void classify(entry.key, entry.url))}
                onImport={() => void enqueue([entry], (x) => x.url)}
                onImportUrl={(u) => void enqueue([entry], () => u)}
                onCancel={() => void cancel(entry)}
                onRemove={() => setEntries((l) => l.filter((x) => x.key !== entry.key))} />
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] leading-4 text-ink-3">
        <ShieldCheck size={12} strokeWidth={1.75} className="shrink-0" aria-hidden="true" />
        Uploaded photos are re-encoded with all location and camera metadata removed. Adults only, rights-cleared content.
      </p>
    </section>
  )
}

/* ── row ───────────────────────────────────────────────── */

function EntryRow({ entry, onRetry, onImport, onImportUrl, onCancel, onRemove }: {
  entry: Entry
  onRetry: () => void
  onImport: () => void
  onImportUrl: (url: string) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const cls = entry.preview?.classification
  const feed = entry.preview?.mode === 'feed' ? entry.preview.feed : undefined
  const busy = entry.status === 'classifying' || entry.status === 'queued' || entry.status === 'importing'
  const pct = entry.job?.progress ?? 0
  const meta = [cls?.kind, cls?.height ? `${cls.height}p` : '', duration(cls?.durationSeconds), cls?.siteName || cls?.source].filter(Boolean).join(' · ')

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-sm bg-sunken">
          {cls?.thumbnailUrl ? (
            <MediaImage sources={[cls.thumbnailUrl]} alt="" className="absolute inset-0 h-full w-full object-cover" skeletonClassName="absolute inset-0" />
          ) : (
            <span className="grid h-full w-full place-items-center font-mono text-[9px] uppercase text-ink-3">
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : feed ? <Rss size={14} aria-hidden="true" /> : cls?.kind || 'file'}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">{cls?.title || feed?.title || entry.job?.result?.title || entry.url}</span>
          <span className="mono-meta mt-0.5 block truncate uppercase">
            {entry.status === 'classifying' ? 'Identifying…' : entry.status === 'queued' ? 'Queued' : entry.status === 'importing' ? `${entry.job?.stage || 'Working'} · ${pct}%` : entry.status === 'done' ? (entry.duplicate ? 'Already in your library' : 'Added to library') : meta}
          </span>
          {entry.error && <span role="alert" className="mt-1 flex items-start gap-1 text-[12px] leading-4 text-heat"><AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{entry.error}</span>}
          {cls?.warnings?.includes('needs_transcode_for_browser') && entry.status === 'ready' && <span className="mt-1 block text-[11px] text-ink-3">This format may be converted for playback.</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {entry.status === 'ready' && entry.preview?.mode === 'media' && <button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={onImport}>Add</button>}
          {entry.preview?.mode === 'outbound' && entry.preview.url && (
            <a href={entry.preview.url} target="_blank" rel="noreferrer" className="btn-secondary inline-flex min-h-11 items-center px-3 text-xs">Open <ExternalLink size={12} aria-hidden="true" className="ml-1" /></a>
          )}
          {(entry.status === 'error' || entry.status === 'failed') && <button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={onRetry} aria-label="Retry"><RefreshCw size={14} aria-hidden="true" /></button>}
          {entry.status === 'done' && <CheckCircle2 size={18} className="text-ink-2" aria-label="Done" />}
          {busy && entry.job && <button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={onCancel}>Cancel</button>}
          {!busy && <button type="button" className="grid min-h-11 min-w-11 place-items-center text-ink-3 hover:text-ink" onClick={onRemove} aria-label="Remove"><X size={14} aria-hidden="true" /></button>}
        </span>
      </div>
      {entry.status === 'importing' && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-heat transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {feed && (
        <ul className="mt-3 space-y-2 pl-2">
          {feed.items.filter((i) => i.mediaUrl || i.url).slice(0, 12).map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink-2">{item.title}</span>
              <span className="mono-meta uppercase">{item.kind}</span>
              {item.kind !== 'link' && item.mediaUrl && <button type="button" className="btn-secondary min-h-11 px-3 text-xs" onClick={() => onImportUrl(item.mediaUrl as string)}>Add</button>}
              <a href={item.url} target="_blank" rel="noreferrer" className="grid min-h-11 min-w-11 place-items-center text-ink-3 hover:text-ink" aria-label={`View ${item.title} on source`}><ExternalLink size={14} aria-hidden="true" /></a>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
