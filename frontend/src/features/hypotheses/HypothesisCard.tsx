import { useState, useEffect, useRef } from 'react'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { useUpdateHypothesis } from '@/hooks/useHypotheses'
import { useAppStore } from '@/store'
import { cn } from '@/lib/cn'
import type { Hypothesis } from '@/lib/api'

const STATUS_VARIANT: Record<string, 'default' | 'amber' | 'green' | 'red'> = {
  new: 'default', reviewing: 'amber', promoted: 'green', dismissed: 'red',
}

const PINNED_KEY = 'pinned_hypotheses'

function getPinnedIds(): number[] {
  try {
    return JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]')
  } catch {
    return []
  }
}

function setPinnedIds(ids: number[]): void {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids))
}

function computeConfidence(text: string): number {
  const lower = text.toLowerCase()

  const highWords = ['strongly', 'clearly', 'evidence shows', 'confirmed', 'demonstrated']
  const medWords = ['suggests', 'indicates', 'appears', 'likely']
  const lowWords = ['unclear', 'uncertain', 'possibly', 'might']

  let score = 50 // baseline

  for (const w of highWords) {
    const matches = lower.split(w).length - 1
    score += matches * 2
  }
  for (const w of medWords) {
    const matches = lower.split(w).length - 1
    score += matches * 1
  }
  for (const w of lowWords) {
    const matches = lower.split(w).length - 1
    score -= matches * 1
  }

  return Math.max(0, Math.min(100, score))
}

function confidenceColor(score: number): string {
  if (score > 70) return 'bg-[var(--color-green)]'
  if (score >= 40) return 'bg-[var(--color-amber)]'
  return 'bg-[var(--color-red)]'
}

// ── Inline markdown renderer ─────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-text-primary font-semibold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="font-mono text-xs bg-bg-elevated px-1 py-0.5 rounded text-[var(--color-teal)]">
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n')
  return lines.map((line, i) => {
    if (line.startsWith('### ')) {
      return <h3 key={i} className="text-sm font-semibold text-text-primary mt-3 mb-1">{line.slice(4)}</h3>
    }
    if (line.startsWith('## ')) {
      return <h2 key={i} className="text-base font-semibold text-text-primary mt-4 mb-1">{line.slice(3)}</h2>
    }
    if (line.startsWith('# ')) {
      return <h1 key={i} className="text-lg font-semibold text-text-primary mt-4 mb-1">{line.slice(2)}</h1>
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <li key={i} className="ml-4 text-sm text-text-secondary leading-relaxed list-disc">
          {renderInline(line.slice(2))}
        </li>
      )
    }
    if (/^\d+\.\s/.test(line)) {
      return (
        <li key={i} className="ml-4 text-sm text-text-secondary leading-relaxed list-decimal">
          {renderInline(line.replace(/^\d+\.\s/, ''))}
        </li>
      )
    }
    if (line.trim() === '') return <br key={i} />
    return (
      <p key={i} className="text-sm text-text-secondary leading-relaxed">
        {renderInline(line)}
      </p>
    )
  })
}

// ────────────────────────────────────────────────────────────────────────────

export function HypothesisCard({ h }: { h: Hypothesis }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState(h.user_note ?? '')
  const [noteSaved, setNoteSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pinned, setPinned] = useState(() => getPinnedIds().includes(h.id))
  const [expanded, setExpanded] = useState(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const update = useUpdateHypothesis()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)

  useEffect(() => {
    setNote(h.user_note ?? '')
  }, [h.id, h.user_note])

  // Auto-save note with 800ms debounce
  function handleNoteChange(value: string) {
    setNote(value)
    clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      update.mutate({ id: h.id, patch: { user_note: value } }, {
        onSuccess: () => {
          setNoteSaved(true)
          setTimeout(() => setNoteSaved(false), 1500)
        },
      })
    }, 800)
  }

  const confidence = computeConfidence((h.body ?? '') + ' ' + (h.rationale ?? ''))

  // Content to render: prefer body, fall back to rationale
  const bodyText = h.body || h.rationale || ''
  const bodyIsLong = (bodyText.length) > 280

  function viewSourceItems() {
    resetFilters()
    if (h.theme) setFilter('theme', h.theme)
    setFilter('sort', 'score')
    setActiveView('items')
  }

  function exportMarkdown() {
    const md = [
      `## ${h.title}`,
      `**Confidence:** ${confidence}%`,
      '',
      h.body || h.rationale || '',
      '',
      h.evidence ? `**Evidence:** ${h.evidence}` : null,
      `**Generated:** ${h.created_at ? new Date(h.created_at).toLocaleDateString() : 'unknown'}`,
    ]
      .filter((line) => line !== null)
      .join('\n')

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function togglePin() {
    const ids = getPinnedIds()
    let next: number[]
    if (ids.includes(h.id)) {
      next = ids.filter((id) => id !== h.id)
    } else {
      next = [...ids, h.id]
    }
    setPinnedIds(next)
    setPinned(next.includes(h.id))
    // Dispatch storage event so HypothesesPage can react
    window.dispatchEvent(new Event('storage'))
  }

  return (
    <Card className="space-y-3">
      {/* Header: title + status badges + pin indicator */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {h.theme && (
              <span className="text-[10px] font-mono text-accent/70 bg-accent/8 border border-accent/20 rounded px-1.5 py-0.5 uppercase tracking-wider">
                {h.theme}
              </span>
            )}
            {h.created_at && (
              <span className="text-[10px] font-mono text-text-muted">
                {new Date(h.created_at).toLocaleDateString()}
              </span>
            )}
            {pinned && (
              <span className="text-[10px] bg-accent/20 text-accent rounded-full px-1.5 py-0.5">pinned</span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-text-primary leading-snug">{h.title}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant={STATUS_VARIANT[h.review_status] ?? 'default'}>{h.review_status}</Badge>
          {h.is_saved && <Badge variant="green">saved</Badge>}
        </div>
      </div>

      {/* Confidence bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Confidence</span>
          <span className="text-xs font-mono text-text-muted">{confidence}%</span>
        </div>
        <div className="h-1 w-full bg-bg-subtle rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor(confidence)}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* Body / Rationale rendered as markdown */}
      {bodyText && (
        <>
          <div
            className={cn(
              "overflow-hidden transition-[max-height] duration-300 ease-in-out",
              expanded || !bodyIsLong ? "max-h-[2000px]" : "max-h-20"
            )}
          >
            <div className="prose-custom space-y-1">
              {renderMarkdown(bodyText)}
            </div>
          </div>
          {bodyIsLong && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v) }}
              className="mt-2 text-xs text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
              aria-expanded={expanded}
            >
              {expanded ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                  Show less
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                  Show more
                </>
              )}
            </button>
          )}
        </>
      )}

      {/* Evidence (optional) */}
      {h.evidence && (
        <p className="text-xs text-text-muted border-l-2 border-border pl-3 italic">{h.evidence}</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <Button size="sm" variant="secondary"
          onClick={() => update.mutate({ id: h.id, patch: { is_saved: !h.is_saved } })}>
          {h.is_saved ? '★ Saved' : '☆ Save'}
        </Button>
        {h.review_status === 'new' && (
          <Button size="sm" variant="secondary"
            onClick={() => update.mutate({ id: h.id, patch: { review_status: 'reviewing' } })}>
            Review
          </Button>
        )}
        {h.review_status !== 'promoted' && (
          <Button size="sm" variant="secondary"
            onClick={() => update.mutate({ id: h.id, patch: { review_status: 'promoted' } })}>
            Promote
          </Button>
        )}
        {h.review_status !== 'dismissed' && (
          <Button size="sm" variant="ghost"
            onClick={() => update.mutate({ id: h.id, patch: { review_status: 'dismissed' } })}>
            Dismiss
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setNoteOpen(o => !o)}
          className={cn(note ? 'text-amber hover:text-amber' : '')}
        >
          {note ? '✎ Note' : 'Note'}
        </Button>
        {/* Pin button */}
        <Button
          size="sm"
          variant="ghost"
          onClick={togglePin}
          aria-label={pinned ? 'Unpin hypothesis' : 'Pin hypothesis'}
          className={pinned ? 'text-accent' : 'text-text-muted hover:text-accent'}
        >
          📌
        </Button>
        {/* Export button */}
        <Button
          size="sm"
          variant="ghost"
          onClick={exportMarkdown}
          aria-label="Export hypothesis as markdown"
          className="text-text-muted hover:text-accent"
        >
          {copied ? 'Copied!' : '↓ Export'}
        </Button>
        <Button size="sm" variant="ghost" onClick={viewSourceItems} className="ml-auto text-text-muted hover:text-accent">
          View source items →
        </Button>
      </div>

      {/* Note editor */}
      {noteOpen && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-end gap-2">
            {noteSaved && <span className="text-[10px] text-green font-mono">saved</span>}
            <span className="text-[10px] text-text-muted font-mono tabular-nums">{note.length}/2000</span>
          </div>
          <textarea
            value={note}
            onChange={(e) => handleNoteChange(e.target.value.slice(0, 2000))}
            rows={3}
            autoFocus
            aria-label="User note"
            placeholder="Add research notes…"
            className="w-full bg-bg-subtle border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent/40 font-mono leading-relaxed transition-colors"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); setNoteOpen(false) }
            }}
          />
          <p className="text-[10px] text-text-muted">Auto-saves · Esc to close</p>
        </div>
      )}
    </Card>
  )
}

// Export helper so HypothesesPage can read pinned IDs
export { getPinnedIds }
