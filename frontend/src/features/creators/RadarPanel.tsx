import { useRef, useState } from 'react'
import { ListPlus, Plus, Radar, Trash2, X } from 'lucide-react'
import { resolveCreators } from '@/lib/api'
import { useAppStore } from '@/store'
import { RADAR_CAP, addToRadar, parseBulkList, type ParsedCreatorInput } from './creatorLogic'

const BATCH = 3
const MIN_CONFIDENCE = 0.5

interface BulkSummary {
  resolved: { input: string; handle: string }[]
  unresolved: string[]
  skippedFull: string[]
  alreadyOnRadar: number
}

interface RadarPanelProps {
  onRunScan: () => void
  scanning: boolean
}

/** Radar watchlist: n/40 counter, single + bulk add (resolved through the resolver), remove / clear all. */
export default function RadarPanel({ onRunScan, scanning }: RadarPanelProps) {
  const watchlist = useAppStore((s) => s.creatorWatchlist)
  const addCreatorToWatchlist = useAppStore((s) => s.addCreatorToWatchlist)
  const removeCreatorFromWatchlist = useAppStore((s) => s.removeCreatorFromWatchlist)
  const addToast = useAppStore((s) => s.addToast)

  const [draft, setDraft] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<BulkSummary | null>(null)
  const cancelRef = useRef(false)

  const full = watchlist.length >= RADAR_CAP
  const running = progress !== null

  const addOne = () => {
    const value = draft.trim()
    if (!value) return
    if (full) {
      addToast({ type: 'error', title: 'Radar is full', message: `The radar holds up to ${RADAR_CAP} handles.` })
      return
    }
    addCreatorToWatchlist(value)
    setDraft('')
  }

  const runBulk = async () => {
    const items = parseBulkList(bulkText)
    if (!items.length || running) return
    cancelRef.current = false
    setSummary(null)
    setProgress({ done: 0, total: items.length })
    const resolved: BulkSummary['resolved'] = []
    const unresolved: string[] = []
    const lookup = async (item: ParsedCreatorInput) => {
      try {
        const result = await resolveCreators(item.query, 3)
        const top = result.candidates[0]
        if (top && top.confidence >= MIN_CONFIDENCE) resolved.push({ input: item.query, handle: top.handle })
        else unresolved.push(item.query)
      } catch {
        unresolved.push(item.query)
      }
    }
    for (let start = 0; start < items.length; start += BATCH) {
      if (cancelRef.current) break
      await Promise.all(items.slice(start, start + BATCH).map(lookup))
      setProgress({ done: Math.min(items.length, start + BATCH), total: items.length })
    }
    const before = useAppStore.getState().creatorWatchlist
    const { added, skippedFull } = addToRadar(before, resolved.map((entry) => entry.handle))
    for (const handle of added) addCreatorToWatchlist(handle)
    const alreadyOnRadar = resolved.length - added.length - skippedFull.length
    setSummary({ resolved, unresolved, skippedFull, alreadyOnRadar })
    setProgress(null)
    setBulkText('')
    addToast({
      type: unresolved.length ? 'info' : 'success',
      title: `${resolved.length} matched · ${added.length} added to your radar`,
      message: unresolved.length ? `${unresolved.length} could not be matched to a public profile.` : undefined,
    })
  }

  const addUnresolvedAsTyped = () => {
    if (!summary) return
    const { added } = addToRadar(useAppStore.getState().creatorWatchlist, summary.unresolved)
    for (const handle of added) addCreatorToWatchlist(handle)
    setSummary({ ...summary, unresolved: summary.unresolved.filter((name) => !added.includes(name)) })
  }

  const clearAll = () => {
    if (!window.confirm(`Remove all ${watchlist.length} handles from your radar?`)) return
    for (const handle of [...watchlist]) removeCreatorFromWatchlist(handle)
  }

  const bulkCount = parseBulkList(bulkText).length

  if (watchlist.length === 0 && !bulkOpen) {
    return (
      <section className="d-state" style={{ alignItems: 'center' }} data-testid="radar-panel">
        <span className="d-state-halo" aria-hidden="true">
          <Radar size={22} strokeWidth={1.5} />
        </span>
        <h2 className="d-state-title">Your radar is empty</h2>
        <p className="d-state-desc">
          Add up to {RADAR_CAP} creator handles or names and the radar will scan active public sources for matching
          posts — with evidence for every match. Nothing is pre-seeded: this list is yours alone.
        </p>
        <div className="flex w-full max-w-sm items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && addOne()}
            placeholder="Add a handle to scan for"
            aria-label="Creator handle to add to the radar"
            className="d-input"
            style={{ paddingLeft: 18, paddingRight: 18 }}
          />
          <button onClick={addOne} className="btn-secondary min-h-11" aria-label="Add handle">
            <Plus size={14} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => setBulkOpen(true)} className="btn-secondary min-h-11">
            <ListPlus size={14} strokeWidth={1.75} aria-hidden="true" /> Bulk add a list
          </button>
          <button onClick={onRunScan} disabled={scanning} className="btn-primary min-h-11">
            Run a starter scan
          </button>
        </div>
        <p className="font-mono text-[10px] text-ink-3">Without watchlist entries the scan returns the general public feed.</p>
      </section>
    )
  }

  return (
    <section className="d-panel" data-testid="radar-panel" aria-label="Radar watchlist">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="d-eyebrow">
          <Radar size={12} strokeWidth={1.75} aria-hidden="true" />
          Radar watchlist · <span data-testid="radar-count">{watchlist.length}/{RADAR_CAP}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && addOne()}
            placeholder={full ? 'Radar is full' : 'Add handle'}
            disabled={full}
            aria-label="Creator handle to add to the radar"
            className="d-input"
            style={{ width: 160, paddingLeft: 16, paddingRight: 16 }}
          />
          <button onClick={addOne} disabled={full} className="btn-secondary min-h-11" aria-label="Add handle">
            <Plus size={14} strokeWidth={1.75} />
          </button>
          <button onClick={() => setBulkOpen((open) => !open)} className="btn-secondary min-h-11" aria-expanded={bulkOpen}>
            <ListPlus size={14} strokeWidth={1.75} aria-hidden="true" /> Bulk add
          </button>
        </div>
      </div>

      {bulkOpen && (
        <div className="mt-4 rounded-2xl border border-line p-3">
          <label htmlFor="radar-bulk" className="mono-meta block">
            Paste names or handles — one per line or comma separated. Each is matched to a public profile first.
          </label>
          <textarea
            id="radar-bulk"
            value={bulkText}
            onChange={(event) => setBulkText(event.target.value)}
            rows={4}
            disabled={running}
            placeholder={'Christian Hogue, Michael Yerger\n@jakipz'}
            className="d-input mt-2"
            style={{ height: 'auto', padding: 12, borderRadius: 16, resize: 'vertical' }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => void runBulk()} disabled={running || bulkCount === 0} className="btn-heat min-h-11">
              {running ? 'Matching…' : `Match & add${bulkCount ? ` ${bulkCount}` : ''}`}
            </button>
            {running && (
              <button onClick={() => { cancelRef.current = true }} className="btn-secondary min-h-11">
                Stop
              </button>
            )}
            {running && progress && (
              <p role="status" className="mono-meta" data-testid="bulk-progress">
                Matched {progress.done} of {progress.total}
              </p>
            )}
          </div>
          {progress && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
              <div className="h-full bg-heat transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {summary && (
        <div role="status" className="mt-4 rounded-2xl border border-line p-3" data-testid="bulk-summary">
          <p className="text-[13px] text-ink">
            {summary.resolved.length} resolved · {summary.unresolved.length} unresolved
            {summary.skippedFull.length > 0 ? ` · ${summary.skippedFull.length} didn't fit (radar full)` : ''}
            {summary.alreadyOnRadar > 0 ? ` · ${summary.alreadyOnRadar} already on radar` : ''}
          </p>
          {summary.resolved.length > 0 && (
            <p className="mono-meta mt-1 break-words">
              Matched: {summary.resolved.map((entry) => `@${entry.handle}`).join(', ')}
            </p>
          )}
          {summary.unresolved.length > 0 && (
            <>
              <p className="mono-meta mt-1 break-words">No public match: {summary.unresolved.join(', ')}</p>
              <button onClick={addUnresolvedAsTyped} disabled={full} className="btn-secondary mt-2 min-h-11">
                Add unresolved as typed
              </button>
            </>
          )}
          <button onClick={() => setSummary(null)} className="btn-secondary ml-2 mt-2 min-h-11">
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {watchlist.map((handle) => (
          <span key={handle} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-sunken/50 pl-4 pr-1 font-mono text-[11px] text-ink">
            {handle}
            <button
              onClick={() => removeCreatorFromWatchlist(handle)}
              className="grid h-9 w-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
              aria-label={`Remove ${handle} from the radar`}
            >
              <X size={12} strokeWidth={1.75} />
            </button>
          </span>
        ))}
      </div>
      {watchlist.length > 1 && (
        <button onClick={clearAll} className="mt-3 inline-flex min-h-11 items-center gap-1.5 font-mono text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">
          <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" /> Clear all
        </button>
      )}
    </section>
  )
}
