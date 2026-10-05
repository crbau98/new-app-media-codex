import { memo, useCallback, useId, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Bookmark, Download, ExternalLink, Library, PencilLine, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import type { Creator } from '@/lib/types'
import { relativeTime } from '@/lib/discovery'
import { useAppStore } from '@/store'
import SectionHeader from '@/components/discovery/SectionHeader'
import { cn } from '@/lib/utils'
import {
  OUTBOUND_REL,
  PLATFORMS,
  PLATFORM_KIND_LABEL,
  displayHandle,
  parseProfileList,
  platformById,
  platformKind,
  safeOutboundUrl,
  type PlatformId,
  type PlatformKind,
} from './platforms'
import type { PlatformLink } from './platformLinks'
import {
  IMPORT_MAX_CHARS,
  SAVED_LINKS_CAP,
  SAVED_NOTE_MAX,
  filterSavedLinks,
  parseSavedLinksImport,
  savedCatalogHandle,
  savedToCreator,
  serializeSavedLinks,
  type SavedLink,
} from './savedLinks'
import { clearSaved, importSavedLinks, removeSaved, saveProfiles, updateSavedNote, useSavedLinks } from './useSavedLinks'
import { PaywallNote, PlatformMark, SubscribeButton } from './PlatformLinks'
import './platforms.css'

const PAGE = 12

const GROUPS: { kind: PlatformKind; label: string }[] = [
  { kind: 'subscription', label: 'Subscription (link only)' },
  { kind: 'public-link', label: 'Public profiles' },
  { kind: 'link-in-bio', label: 'Link in bio' },
  { kind: 'playable', label: 'Public catalog' },
]

interface Summary {
  tone: 'ok' | 'warn' | 'error'
  headline: string
  details: string[]
}

function toPlatformLink(link: SavedLink): PlatformLink {
  const def = platformById(link.platform)
  return {
    key: link.id,
    platform: link.platform,
    label: def?.label ?? safeHost(link.url),
    handle: link.handle,
    display: displayHandle(link.platform, link.handle),
    url: link.url,
    kind: platformKind(link.platform),
    verified: false,
    source: 'profile',
    inferred: false,
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'website'
  }
}

interface CardProps {
  link: SavedLink
  onOpenCatalog: (creator: Creator) => void
  onRemoved: (link: SavedLink) => void
}

const SavedProfileCard = memo(function SavedProfileCard({ link, onOpenCatalog, onRemoved }: CardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(link.note)
  const platformLink = useMemo(() => toPlatformLink(link), [link])
  const def = platformById(link.platform)
  const kind = platformLink.kind
  const href = safeOutboundUrl(link.url)
  const catalogHandle = savedCatalogHandle(link)
  const noteId = useId()

  const saveNote = (event: FormEvent) => {
    event.preventDefault()
    updateSavedNote(link.id, draft)
    setEditing(false)
  }

  return (
    <article
      className="pf-saved"
      style={def ? { ['--pf' as string]: def.accent } : undefined}
      data-testid="saved-card"
      data-platform={link.platform}
      aria-label={`${platformLink.display} on ${platformLink.label}`}
    >
      <div className="pf-saved-head">
        <PlatformMark platform={link.platform} className="pf-mark-lg" />
        <div className="min-w-0 flex-1">
          <h3 className="pf-saved-name">{platformLink.display}</h3>
          <p className="pf-saved-sub">{platformLink.label} · {PLATFORM_KIND_LABEL[kind]}</p>
        </div>
      </div>

      {editing ? (
        <form onSubmit={saveNote} className="grid gap-2">
          <label htmlFor={noteId} className="sr-only">Note for {platformLink.display}</label>
          <input
            id={noteId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={SAVED_NOTE_MAX}
            placeholder="A private note (optional)"
            className="pf-note-input"
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-secondary min-h-11">Save note</button>
            <button type="button" className="pf-text-btn" onClick={() => { setDraft(link.note); setEditing(false) }}>Cancel</button>
          </div>
        </form>
      ) : (
        link.note && <p className="pf-saved-note" data-testid="saved-note">{link.note}</p>
      )}

      <div className="grid gap-2">
        {kind === 'subscription' ? (
          <>
            <SubscribeButton link={platformLink} />
            <PaywallNote />
          </>
        ) : (
          href && (
            <a href={href} target="_blank" rel={OUTBOUND_REL} className="btn-secondary min-h-11 justify-center" data-testid="saved-open">
              Open on {platformLink.label}
              <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
              <span className="sr-only"> (opens their page in a new tab)</span>
            </a>
          )
        )}
        {catalogHandle && (
          <button type="button" className="btn-heat min-h-11 justify-center" onClick={() => onOpenCatalog(savedToCreator(link))} data-testid="saved-open-catalog">
            <Library size={14} strokeWidth={1.75} aria-hidden="true" /> Open catalog
          </button>
        )}
      </div>

      <div className="pf-saved-foot">
        <span className="font-mono text-[10.5px] text-ink-3">Saved {relativeTime(link.addedAt)}</span>
        <span className="flex flex-wrap items-center">
          {!editing && (
            <button type="button" className="pf-text-btn" onClick={() => { setDraft(link.note); setEditing(true) }}>
              <PencilLine size={13} strokeWidth={1.75} aria-hidden="true" /> {link.note ? 'Edit note' : 'Add note'}
              <span className="sr-only"> for {platformLink.display}</span>
            </button>
          )}
          <button
            type="button"
            className="pf-text-btn"
            data-danger="true"
            onClick={() => { removeSaved(link.id); onRemoved(link) }}
            aria-label={`Remove ${platformLink.display} on ${platformLink.label} from saved profiles`}
          >
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" /> Remove
          </button>
        </span>
      </div>
    </article>
  )
})

interface SavedProfilesProps {
  platformFilter: string | null
  platformLabel: string | null
  onClearPlatform: () => void
  onOpenCatalog: (creator: Creator) => void
}

/** "Your saved profiles": link-only creator cards for profile links the user already knows. */
export default function SavedProfiles({ platformFilter, platformLabel, onClearPlatform, onOpenCatalog }: SavedProfilesProps) {
  const { links, storageOk } = useSavedLinks()
  const addToast = useAppStore((state) => state.addToast)
  const formId = useId()
  const [formOpen, setFormOpen] = useState(false)
  const [text, setText] = useState('')
  const [hint, setHint] = useState<PlatformId | ''>('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [shown, setShown] = useState({ signature: '', count: PAGE })
  const [needle, setNeedle] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const showForm = formOpen || links.length === 0
  const filtered = useMemo(() => filterSavedLinks(links, platformFilter, needle), [links, platformFilter, needle])
  const preview = useMemo(() => (text.trim() ? parseProfileList(text, hint || null, SAVED_LINKS_CAP) : null), [text, hint])
  // Reset to the first page whenever the filter changes (derived, so no effect is needed).
  const signature = `${platformFilter}|${needle}`
  const visible = shown.signature === signature ? shown.count : PAGE

  const openForm = () => {
    setFormOpen(true)
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseProfileList(text, hint || null, SAVED_LINKS_CAP)
    if (parsed.profiles.length === 0 && parsed.errorCount === 0) return
    const result = saveProfiles(parsed.profiles)
    const duplicates = result.duplicates + parsed.duplicates
    const parts = [
      `${result.added.length} saved`,
      duplicates ? `${duplicates} already saved` : null,
      result.skippedFull ? `${result.skippedFull} not saved (the list holds ${SAVED_LINKS_CAP})` : null,
      parsed.errorCount ? `${parsed.errorCount} couldn't be read` : null,
    ].filter(Boolean)
    setSummary({
      tone: result.skippedFull || parsed.errorCount ? 'warn' : 'ok',
      headline: parts.join(' · '),
      details: [
        ...parsed.errors.slice(0, 5).map((error) => `${error.input} — ${error.message}`),
        ...(parsed.truncated ? [`Only the first ${SAVED_LINKS_CAP} entries of that paste were read.`] : []),
      ],
    })
    // Keep only the lines that failed so they can be fixed and retried.
    setText(parsed.errors.map((error) => error.input).join('\n'))
    // The form stays open while some lines still need fixing; otherwise it tucks away behind "Add links".
    setFormOpen(parsed.errorCount > 0)
    if (result.added.length) {
      addToast({ type: 'success', title: `Saved ${result.added.length} profile link${result.added.length === 1 ? '' : 's'}`, message: 'Stored on this device only.' })
    }
  }

  const onRemoved = useCallback((link: SavedLink) => {
    addToast({ type: 'info', title: 'Removed from saved profiles', message: displayHandle(link.platform, link.handle) })
  }, [addToast])

  const exportJson = () => {
    const blob = new Blob([serializeSavedLinks(links)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `media-codex-saved-profiles-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    addToast({ type: 'success', title: 'Export downloaded', message: `${links.length} saved profile link${links.length === 1 ? '' : 's'} as JSON.` })
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > IMPORT_MAX_CHARS * 2) {
      setSummary({ tone: 'error', headline: 'Import failed', details: ['That file is too large to be a saved-links export.'] })
      return
    }
    let body = ''
    try {
      body = await file.text()
    } catch {
      setSummary({ tone: 'error', headline: 'Import failed', details: ["That file couldn't be read."] })
      return
    }
    const parsed = parseSavedLinksImport(body)
    if (!parsed.ok) {
      setSummary({ tone: 'error', headline: 'Import failed', details: [parsed.error] })
      addToast({ type: 'error', title: 'Import failed', message: parsed.error })
      return
    }
    const result = importSavedLinks(parsed.links)
    const parts = [
      `${result.added.length} imported`,
      result.duplicates ? `${result.duplicates} already saved` : null,
      parsed.rejected ? `${parsed.rejected} skipped (not valid profile links)` : null,
      result.skippedFull || parsed.truncated ? `some did not fit (the list holds ${SAVED_LINKS_CAP})` : null,
    ].filter(Boolean)
    setSummary({ tone: parsed.rejected || result.skippedFull ? 'warn' : 'ok', headline: parts.join(' · '), details: [] })
    addToast({ type: 'success', title: 'Import complete', message: parts.join(' · ') })
  }

  const clearAll = () => {
    clearSaved()
    setConfirmClear(false)
    setSummary(null)
    addToast({ type: 'info', title: 'Cleared your saved profiles' })
  }

  const platformOptions = useMemo(
    () => GROUPS.map((group) => ({ ...group, items: PLATFORMS.filter((def) => def.kind === group.kind && !def.federated) })).filter((group) => group.items.length),
    [],
  )

  return (
    <section aria-label="Your saved profiles" data-testid="saved-section" className="pf-section">
      <SectionHeader
        title="Your saved profiles"
        eyebrow="On this device"
        icon={<Bookmark size={12} strokeWidth={1.75} aria-hidden="true" />}
        note="Profile links you already know, kept in this browser only. Each one opens on the creator's own page — nothing is fetched from OnlyFans, Fansly or JustFor.Fans."
      >
        <span className="mono-meta" data-testid="saved-count" aria-label={`${links.length} of ${SAVED_LINKS_CAP} saved`}>{links.length}/{SAVED_LINKS_CAP}</span>
      </SectionHeader>

      <div className="pf-actions mb-3">
        {links.length > 0 && !showForm && (
          <button type="button" className="btn-secondary min-h-11" onClick={openForm} data-testid="saved-add-toggle">
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Add links
          </button>
        )}
        <button type="button" className="pf-text-btn" onClick={() => fileRef.current?.click()} data-testid="saved-import">
          <Upload size={13} strokeWidth={1.75} aria-hidden="true" /> Import JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Import saved profile links from a JSON file"
          data-testid="saved-import-input"
          onChange={(event) => void importFile(event)}
        />
        <button type="button" className="pf-text-btn" onClick={exportJson} disabled={links.length === 0} data-testid="saved-export">
          <Download size={13} strokeWidth={1.75} aria-hidden="true" /> Export JSON
        </button>
        {links.length > 0 && (confirmClear ? (
          <span className="flex flex-wrap items-center gap-1" role="group" aria-label="Confirm clearing saved profiles">
            <span className="font-mono text-[11px] text-ink-2">Remove all {links.length}?</span>
            <button type="button" className="pf-text-btn" data-danger="true" onClick={clearAll}>Yes, clear</button>
            <button type="button" className="pf-text-btn" onClick={() => setConfirmClear(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="pf-text-btn" data-danger="true" onClick={() => setConfirmClear(true)}>
            <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" /> Clear all
          </button>
        ))}
      </div>

      {!storageOk && (
        <p role="status" className="mono-meta mb-3 rounded-2xl border border-dashed border-line-strong p-3">
          This browser is blocking storage, so saved links will be lost when the tab closes. Use Export JSON to keep a copy.
        </p>
      )}

      {showForm && (
        <form onSubmit={submit} className="d-panel mb-4" aria-label="Add profile links" data-testid="saved-form">
          <label htmlFor={`${formId}-text`} className="d-eyebrow">
            <Bookmark size={12} strokeWidth={1.75} aria-hidden="true" /> Paste profile links or @handles
          </label>
          <textarea
            id={`${formId}-text`}
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            maxLength={60_000}
            className="pf-textarea mt-3"
            placeholder={'onlyfans.com/name\nhttps://fansly.com/name\njustfor.fans/name\n@name.bsky.social'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={`${formId}-hint`}
          />
          <p id={`${formId}-hint`} className="mono-meta mt-2">
            One per line or separated by commas. Works with any platform — links never leave your device.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1.5">
              <span className="mono-meta">Platform for bare @handles</span>
              <select value={hint} onChange={(event) => setHint(event.target.value as PlatformId | '')} className="pf-select" data-testid="saved-platform">
                <option value="">Auto-detect from the link</option>
                {platformOptions.map((group) => (
                  <optgroup key={group.kind} label={group.label}>
                    {group.items.map((def) => <option key={def.id} value={def.id}>{def.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-heat min-h-11" disabled={!text.trim()} data-testid="saved-submit">
              <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Save links
            </button>
          </div>
          {preview && (
            <p className="mono-meta mt-3" aria-live="polite" data-testid="saved-preview">
              {preview.profiles.length} ready to save
              {preview.errorCount ? ` · ${preview.errorCount} can't be read` : ''}
              {!hint && preview.errors.some((error) => error.reason === 'needs-platform') ? ' — pick a platform above for bare @handles' : ''}
            </p>
          )}
        </form>
      )}

      {summary && (
        <div role="status" className={cn('pf-summary mb-4', summary.tone === 'error' && 'border-dashed')} data-testid="saved-summary">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] font-medium text-ink">{summary.headline}</p>
            <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink -my-2 -mr-2" onClick={() => setSummary(null)} aria-label="Dismiss summary">
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
          {summary.details.length > 0 && (
            <ul>{summary.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
          )}
        </div>
      )}

      {platformFilter && links.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="saved-filter-note">
          <button type="button" className="chip chip-active" onClick={onClearPlatform} aria-label={`Showing ${platformLabel ?? platformFilter} only. Clear platform filter`}>
            Showing {platformLabel ?? platformFilter} only <X size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <span className="mono-meta">{filtered.length} of {links.length} saved</span>
        </div>
      )}

      {links.length > PAGE && (
        <div className="d-field mb-3" style={{ maxWidth: 420 }}>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          <input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Filter saved profiles"
            aria-label="Filter saved profiles by handle or note"
            className="d-input"
            autoComplete="off"
          />
          {needle && (
            <button type="button" onClick={() => setNeedle('')} className="d-field-clear" aria-label="Clear saved profile filter">
              <X size={14} strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}

      {links.length > 0 && filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong p-5 text-center text-[13px] text-ink-2" data-testid="saved-empty-filter">
          None of your saved profiles match{platformFilter ? ` ${platformLabel ?? platformFilter}` : ''}{needle.trim() ? ` “${needle.trim()}”` : ''}.
        </p>
      ) : filtered.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="saved-grid">
            {filtered.slice(0, visible).map((link) => (
              <SavedProfileCard key={link.id} link={link} onOpenCatalog={onOpenCatalog} onRemoved={onRemoved} />
            ))}
          </div>
          {filtered.length > visible && (
            <div className="mt-4 flex justify-center">
              <button type="button" className="btn-secondary min-h-11" onClick={() => setShown({ signature, count: visible + PAGE })}>
                Show more saved profiles · {filtered.length - visible} left
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
