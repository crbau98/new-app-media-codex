import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAppStore } from "@/store"
import { api, type ResearchItem } from "@/lib/api"
import { Badge } from "@/components/Badge"
import { Button } from "@/components/Button"
import { cn } from "@/lib/cn"
import { Spinner } from "@/components/Spinner"
import { TagChip } from "@/components/TagChip"
import { TagInput } from "@/components/TagInput"

type DrawerTab = 'summary' | 'preview'

// ── Reading time estimate ─────────────────────────────────────────────────────

function estimateReadingTime(item: ResearchItem): string {
  const text = `${item.title || ""} ${item.summary || ""} ${item.content || ""}`
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const minutes = Math.max(1, Math.round(wordCount / 200))
  return `~${minutes} min read`
}

// ── CollapsibleSection ────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left group"
        aria-expanded={open}
        aria-controls={id}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            "shrink-0 text-text-muted transition-transform duration-200",
            open ? "rotate-90" : "rotate-0"
          )}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="text-[11px] font-mono text-text-muted uppercase tracking-wider group-hover:text-text-secondary transition-colors">
          {title}
        </span>
      </button>
      {open && (
        <div id={id} className="mt-1.5">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Copy helpers ──────────────────────────────────────────────────────────────

function formatAPA(item: ResearchItem): string {
  const author = item.author || "Unknown Author"
  const year = item.published_at ? item.published_at.slice(0, 4) : "n.d."
  const title = item.title || "Untitled"
  const domain = item.domain || ""
  const url = item.url || ""
  return `${author} (${year}). ${title}. ${domain}. Retrieved from ${url}`
}

function formatMarkdown(item: ResearchItem): string {
  const title = item.title || "Untitled"
  const url = item.url || ""
  const author = item.author || "Unknown"
  const date = item.published_at ? item.published_at.slice(0, 10) : "n.d."
  const summary = item.summary || ""
  const compounds = item.compounds.join(", ") || "—"
  const mechanisms = item.mechanisms.join(", ") || "—"
  return [
    `## [${title}](${url})`,
    "",
    `**Author:** ${author} | **Published:** ${date}`,
    "",
    `> ${summary}`,
    "",
    `**Compounds:** ${compounds} | **Mechanisms:** ${mechanisms}`,
  ].join("\n")
}

// ── Key phrase extraction ─────────────────────────────────────────────────────

function extractKeyPhrases(item: ResearchItem): string[] {
  const text = `${item.title || ""} ${item.summary || ""}`

  // Collect known terms from compounds/mechanisms
  const knownTerms = new Set<string>([...item.compounds, ...item.mechanisms])

  // Extract capitalized multi-word sequences (2-3 words)
  const phraseRegex = /\b([A-Z][a-z]+ (?:[A-Z][a-z]+ )?[A-Za-z]+)\b/g
  const raw: string[] = []
  let m: RegExpExecArray | null
  while ((m = phraseRegex.exec(text)) !== null) {
    raw.push(m[1].trim())
  }

  // Include known terms that appear in text (case-insensitive)
  const textLower = text.toLowerCase()
  knownTerms.forEach((term) => {
    if (textLower.includes(term.toLowerCase())) {
      raw.push(term)
    }
  })

  // Deduplicate (case-insensitive), count frequency
  const freq = new Map<string, number>()
  const canonical = new Map<string, string>()
  raw.forEach((phrase) => {
    const key = phrase.toLowerCase()
    freq.set(key, (freq.get(key) ?? 0) + 1)
    if (!canonical.has(key)) canonical.set(key, phrase)
  })

  // Sort: known terms first, then by frequency, then by length
  const sorted = Array.from(freq.entries())
    .sort(([aKey, aCount], [bKey, bCount]) => {
      const aIsKnown = knownTerms.has(canonical.get(aKey) ?? "")
      const bIsKnown = knownTerms.has(canonical.get(bKey) ?? "")
      if (aIsKnown !== bIsKnown) return aIsKnown ? -1 : 1
      if (bCount !== aCount) return bCount - aCount
      return bKey.length - aKey.length
    })
    .map(([key]) => canonical.get(key)!)
    .filter(Boolean)

  return sorted.slice(0, 8)
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({
  label,
  getText,
  icon,
}: {
  label: string
  getText: () => string
  icon: React.ReactNode
}) {
  const [feedback, setFeedback] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  function handleCopy() {
    navigator.clipboard.writeText(getText()).then(() => {
      setFeedback(true)
      setTimeout(() => setFeedback(false), 1500)
      addToast("Copied to clipboard", "success")
    })
  }

  return (
    <button
      onClick={handleCopy}
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border border-border bg-bg-elevated text-text-muted hover:text-text-primary hover:border-accent/40 transition-colors"
    >
      {icon}
      {feedback ? "Copied!" : label}
    </button>
  )
}

// ── ActionBar ─────────────────────────────────────────────────────────────────

function ActionBar({ item }: { item: ResearchItem }) {
  const qc = useQueryClient()
  const addToast = useAppStore((s) => s.addToast)

  async function toggle(patch: Parameters<typeof api.updateItem>[1]) {
    await api.updateItem(item.id, patch)
    qc.invalidateQueries({ queryKey: ["items"] })
    qc.invalidateQueries({ queryKey: ["item", item.id] })
    const key = Object.keys(patch)[0]
    if (key === "is_saved") {
      addToast(patch.is_saved ? "Saved to library" : "Removed from library", "info")
    } else {
      addToast(`Marked ${patch.review_status}`, "info")
    }
  }

  const isQueued = !!item.queued_at

  async function toggleQueue() {
    const patch = isQueued
      ? { queued_at: null }
      : { queued_at: new Date().toISOString() }
    await api.updateItem(item.id, patch)
    qc.invalidateQueries({ queryKey: ["items"] })
    qc.invalidateQueries({ queryKey: ["item", item.id] })
    qc.invalidateQueries({ queryKey: ["queue-count"] })
    addToast(isQueued ? "Removed from queue" : "Added to reading queue", "info")
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant={item.is_saved ? "primary" : "secondary"} onClick={() => toggle({ is_saved: !item.is_saved })}>
        {item.is_saved ? "★ Saved" : "☆ Save"}
      </Button>
      <Button size="sm" variant={isQueued ? "primary" : "secondary"} onClick={toggleQueue}>
        <span className="inline-flex items-center gap-1">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {isQueued ? "Queued" : "Read Later"}
        </span>
      </Button>
      <Button size="sm" variant="secondary" onClick={() => toggle({ review_status: "shortlisted" })}>
        Shortlist
      </Button>
      <Button size="sm" variant="secondary" onClick={() => toggle({ review_status: "archived" })}>
        Archive
      </Button>
    </div>
  )
}

// ── NoteEditor ────────────────────────────────────────────────────────────────

const MAX_NOTE_CHARS = 2000

function NoteEditor({ item }: { item: ResearchItem }) {
  const qc = useQueryClient()
  const [note, setNote] = useState(item.user_note ?? "")
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset when item changes
  useEffect(() => {
    setNote(item.user_note ?? "")
  }, [item.id, item.user_note])

  // Auto-expand textarea height
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [note])

  function onChange(value: string) {
    if (value.length > MAX_NOTE_CHARS) return
    setNote(value)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      await api.updateItem(item.id, { user_note: value })
      qc.invalidateQueries({ queryKey: ["item", item.id] })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }, 800)
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-1 gap-2">
        {saved && <span className="text-[10px] text-green font-mono">saved</span>}
        <span className="text-[10px] text-text-muted font-mono tabular-nums">
          {note.length}/{MAX_NOTE_CHARS}
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Add research notes…"
        rows={3}
        className="w-full bg-bg-subtle rounded-lg px-3 py-3 text-xs text-text-secondary placeholder:text-text-muted resize-none overflow-hidden border border-border focus:outline-none focus:border-accent/40 font-mono leading-relaxed transition-colors"
        style={{ minHeight: "5rem" }}
      />
    </div>
  )
}

// ── FaviconPill ───────────────────────────────────────────────────────────────

function FaviconPill({ item }: { item: ResearchItem }) {
  const [imgOk, setImgOk] = useState(true)
  const domain = item.domain || ""
  const faviconSrc = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16`

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-bg-elevated hover:border-accent/40 hover:bg-bg-subtle transition-colors text-xs text-text-secondary hover:text-text-primary"
      title={item.url}
    >
      {imgOk ? (
        <img
          src={faviconSrc}
          alt=""
          width={14}
          height={14}
          className="rounded-sm shrink-0"
          onError={() => setImgOk(false)}
        />
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      )}
      <span className="font-mono truncate max-w-[200px]">{domain || "Open link"}</span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted">
        <path d="M7 7h10v10"/><path d="M7 17 17 7"/>
      </svg>
    </a>
  )
}

// ── SeeAlsoPanel ──────────────────────────────────────────────────────────────

function SeeAlsoPanel({ item }: { item: ResearchItem }) {
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)

  const compound = item.compounds[0]
  const mechanism = item.mechanisms[0]
  const filterKey = compound ? "compound" : mechanism ? "mechanism" : null
  const filterVal = compound ?? mechanism

  const { data } = useQuery({
    queryKey: ["see-also", filterKey, filterVal, item.id],
    queryFn: () =>
      api.browseItems({
        [filterKey === "compound" ? "compound" : "mechanism"]: filterVal!,
        limit: 5,
        sort: "score",
      }),
    enabled: filterKey != null,
    staleTime: 60_000,
  })

  const related = (data?.items ?? []).filter((i) => i.id !== item.id).slice(0, 3)
  if (related.length === 0) return null

  return (
    <div className="border-t border-border pt-3">
      <CollapsibleSection title="See Also" defaultOpen={false}>
        <div className="space-y-2">
          {related.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedItemId(r.id)}
              className="w-full text-left p-2 rounded-lg bg-bg-elevated hover:bg-bg-subtle border border-border hover:border-accent/30 transition-all group"
            >
              <p className="text-xs font-medium text-text-primary group-hover:text-accent transition-colors line-clamp-2 leading-snug">{r.title}</p>
              <p className="text-[10px] text-text-muted font-mono mt-0.5">
                {r.source_type} · {r.score > 0 ? `◆ ${r.score.toFixed(1)}` : r.first_seen_at?.slice(0, 10)}
              </p>
            </button>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}

// ── KeyPhrasesSection ─────────────────────────────────────────────────────────

function KeyPhrasesSection({ item }: { item: ResearchItem }) {
  const phrases = extractKeyPhrases(item)
  if (phrases.length === 0) return null

  return (
    <CollapsibleSection title="Key Phrases" defaultOpen>
      <div className="flex flex-wrap gap-1.5">
        {phrases.map((phrase) => (
          <span
            key={phrase}
            className="bg-bg-subtle border border-border rounded-full px-2 py-0.5 text-xs text-text-secondary"
          >
            {phrase}
          </span>
        ))}
      </div>
    </CollapsibleSection>
  )
}

// ── HighlightedSummary ────────────────────────────────────────────────────────

function HighlightedSummary({ text, terms }: { text: string; terms: string[] }) {
  if (!text) return null
  if (!terms.length) return <>{text}</>

  // Build regex matching any term (longest first to avoid partial matches)
  const sorted = [...terms].sort((a, b) => b.length - a.length)
  const escaped = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) => {
        const isMatch = terms.some((t) => t.toLowerCase() === part.toLowerCase())
        return isMatch ? (
          <mark key={i} className="bg-accent/15 text-accent rounded-sm not-italic px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      })}
    </>
  )
}

// ── NativeContentPreview ──────────────────────────────────────────────────────

function NativeContentPreview({ item }: { item: ResearchItem }) {
  const allTerms = [...item.compounds, ...item.mechanisms]
  return (
    <div className="space-y-4">
      {item.image_url && (
        <img
          src={item.image_url}
          alt=""
          className="w-full rounded-lg object-cover max-h-48 bg-bg-elevated"
          loading="lazy"
        />
      )}
      {item.summary && (
        <div className="rounded-lg bg-bg-subtle border border-border p-4">
          <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-2">Summary</p>
          <p className="text-sm text-text-secondary leading-relaxed">
            <HighlightedSummary text={item.summary} terms={allTerms} />
          </p>
        </div>
      )}
      {item.content && (
        <div>
          <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1.5">Full Content</p>
          <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
            <HighlightedSummary text={item.content} terms={allTerms} />
          </p>
        </div>
      )}
      {!item.summary && !item.content && (
        <p className="text-sm text-text-muted text-center py-6">No content available.</p>
      )}
    </div>
  )
}

// ── OEmbedPreview ─────────────────────────────────────────────────────────────

const OEMBED_SOURCES = new Set(['x', 'twitter', 'reddit'])

function OEmbedPreview({ item }: { item: ResearchItem }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [safeHtml, setSafeHtml] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['oembed', item.id],
    queryFn: () => api.itemOembed(item.id),
    staleTime: 300_000,
  })

  const rawHtml = data?.html ?? ''

  // Sanitize with DOMPurify before rendering — prevents XSS from oEmbed HTML
  useEffect(() => {
    if (!rawHtml) { setSafeHtml(''); return }
    import('dompurify').then(({ default: DOMPurify }) => {
      const clean = DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: ['blockquote'],
        ADD_ATTR: ['class', 'data-theme', 'data-lang'],
        FORCE_BODY: true,
      })
      setSafeHtml(clean)
    })
  }, [rawHtml])

  // Rehydrate Twitter/X widget script so blockquotes are rendered as embeds
  useEffect(() => {
    if (!safeHtml || !containerRef.current) return
    const src = item.source_type?.toLowerCase()
    if (src !== 'x' && src !== 'twitter') return
    const existing = document.getElementById('twitter-wjs')
    if (existing) existing.remove()
    const script = document.createElement('script')
    script.id = 'twitter-wjs'
    script.src = 'https://platform.twitter.com/widgets.js'
    script.async = true
    document.body.appendChild(script)
  }, [safeHtml, item.source_type])

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>
  if (data?.error || !safeHtml) {
    return <NativeContentPreview item={item} />
  }

  // safeHtml has been processed through DOMPurify.sanitize — safe to render
  const sanitizedProps = { __html: safeHtml }
  return (
    <div
      ref={containerRef}
      className="oembed-container [&_blockquote]:max-w-full [&_iframe]:max-w-full [&_iframe]:rounded-lg"
      dangerouslySetInnerHTML={sanitizedProps}
    />
  )
}

// ── RelatedItems ──────────────────────────────────────────────────────────────

function RelatedItems({ item }: { item: ResearchItem }) {
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const { data } = useQuery({
    queryKey: ['relatedItems', item.id, item.theme],
    queryFn: async () => {
      if (!item.theme) return { items: [] }
      const params: Record<string, string | number> = { limit: 7, offset: 0, theme: item.theme }
      const r = await api.browseItems(params)
      return { items: r.items.filter((i: ResearchItem) => i.id !== item.id).slice(0, 6) }
    },
    enabled: !!item.theme,
    staleTime: 60_000,
  })
  const related = data?.items ?? []
  if (!related.length) return null

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-text-muted mb-3">
        Related · {item.theme}
      </h4>
      <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
        {related.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedItemId(r.id)}
            className="flex-shrink-0 w-52 text-left rounded-lg border border-border bg-bg-subtle p-3 hover:border-accent/40 transition-colors"
          >
            <p className="text-xs font-medium text-text-primary line-clamp-2 mb-1.5">{r.title}</p>
            <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
              <span>{r.source_type}</span>
              {r.score > 0 && <><span>·</span><span>score {r.score.toFixed ? r.score.toFixed(1) : r.score}</span></>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── ItemDrawer ────────────────────────────────────────────────────────────────

interface ItemDrawerProps {
  itemIds?: number[]
  currentIndex?: number
}

export function ItemDrawer({ itemIds = [], currentIndex = -1 }: ItemDrawerProps = {}) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('summary')
  const [drawerWidth, setDrawerWidth] = useState<number>(480)
  const isResizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    resizeStartX.current = e.clientX
    resizeStartWidth.current = drawerWidth
    function onMouseMove(ev: MouseEvent) {
      if (!isResizing.current) return
      const delta = resizeStartX.current - ev.clientX
      const newWidth = Math.min(720, Math.max(340, resizeStartWidth.current + delta))
      setDrawerWidth(newWidth)
    }
    function onMouseUp() {
      isResizing.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [drawerWidth])

  const selectedItemId = useAppStore((s) => s.selectedItemId)
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId)
  const resetFilters = useAppStore((s) => s.resetFilters)
  const setFilter = useAppStore((s) => s.setFilter)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()

  function goFilter(type: "compound" | "mechanism", value: string) {
    setSelectedItemId(null)
    resetFilters()
    setFilter(type, value)
    setActiveView("items")
  }

  const { data: item, isLoading } = useQuery({
    queryKey: ["item", selectedItemId],
    queryFn: () => api.item(selectedItemId!),
    enabled: selectedItemId != null,
    staleTime: 30_000,
  })

  const isOpen = selectedItemId != null

  // Close on Escape; prev/next with arrow keys when open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedItemId(null)
      } else if (e.key === "ArrowLeft" && isOpen && currentIndex > 0) {
        setSelectedItemId(itemIds[currentIndex - 1])
      } else if (e.key === "ArrowRight" && isOpen && currentIndex >= 0 && currentIndex < itemIds.length - 1) {
        setSelectedItemId(itemIds[currentIndex + 1])
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [setSelectedItemId, isOpen, currentIndex, itemIds])

  // Reset tab to summary when item changes
  useEffect(() => {
    setActiveTab('summary')
  }, [selectedItemId])

  // Auto-advance new → reviewing when drawer opens
  useEffect(() => {
    if (item && item.review_status === "new") {
      api.updateItem(item.id, { review_status: "reviewing" }).then(() => {
        qc.invalidateQueries({ queryKey: ["items"] })
        qc.invalidateQueries({ queryKey: ["item", item.id] })
      })
    }
  }, [item, qc])

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/10 lg:hidden"
          onClick={() => setSelectedItemId(null)}
          aria-hidden
        />
      )}

      {/* Drawer panel */}
      <aside
        className={cn(
          "fixed top-12 right-0 bottom-0 z-40 flex flex-col",
          "bg-bg-surface border-l border-border",
          "transition-transform duration-300",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
        style={{
          width: drawerWidth + 'px',
          transitionTimingFunction: isOpen
            ? "cubic-bezier(0.16, 1, 0.3, 1)"
            : "cubic-bezier(0.4, 0, 1, 1)",
        }}
        aria-label="Item details"
        aria-hidden={!isOpen}
      >
        <div onMouseDown={onResizeMouseDown} className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10" aria-hidden />
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <span className="text-xs font-mono text-text-muted uppercase tracking-wider">Detail</span>
          <div className="flex items-center gap-2">
            {item && (
              <>
                {/* Copy APA citation */}
                <CopyButton
                  label="APA"
                  getText={() => formatAPA(item)}
                  icon={
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                      <polyline points="10 9 9 9 8 9"/>
                    </svg>
                  }
                />
                {/* Copy Markdown */}
                <CopyButton
                  label="MD"
                  getText={() => formatMarkdown(item)}
                  icon={
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <path d="M7 15V9l2 2 2-2v6"/><path d="M15 11h2"/>
                      <path d="M17 13v2h-2"/>
                    </svg>
                  }
                />
                {/* Copy URL */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(item.url).then(() => {
                      addToast("Copied to clipboard", "success")
                    })
                  }}
                  title="Copy URL"
                  className="text-text-muted hover:text-text-primary transition-colors"
                  aria-label="Copy URL"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                  </svg>
                </button>
              </>
            )}
            {itemIds.length > 1 && (
              <>
                <button
                  onClick={() => currentIndex > 0 && setSelectedItemId(itemIds[currentIndex - 1])}
                  disabled={currentIndex <= 0}
                  className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed px-1 text-lg leading-none"
                  aria-label="Previous item"
                >
                  ‹
                </button>
                <span className="text-[10px] text-text-muted font-mono tabular-nums">
                  {currentIndex >= 0 ? `${currentIndex + 1}/${itemIds.length}` : `—/${itemIds.length}`}
                </span>
                <button
                  onClick={() => currentIndex < itemIds.length - 1 && setSelectedItemId(itemIds[currentIndex + 1])}
                  disabled={currentIndex >= itemIds.length - 1}
                  className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed px-1 text-lg leading-none"
                  aria-label="Next item"
                >
                  ›
                </button>
              </>
            )}
            <button
              onClick={() => setSelectedItemId(null)}
              className="text-text-muted hover:text-text-primary transition-colors"
              aria-label="Close detail panel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Tab bar — only shown when item is loaded */}
        {item && (
          <div className="flex items-center gap-1 px-5 py-1.5 border-b border-border shrink-0 bg-bg-surface">
            {(['summary', 'preview'] as DrawerTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-3 py-1 rounded-md text-xs font-mono transition-colors capitalize',
                  activeTab === tab
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-muted hover:text-text-primary'
                )}
                aria-current={activeTab === tab ? 'page' : undefined}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading && <div className="flex justify-center pt-8"><Spinner /></div>}
          {item && (
            <>
              {/* Always-visible title + meta */}
              <div>
                <h2 className="text-text-primary font-semibold text-base leading-snug">{item.title}</h2>
                <p className="text-[10px] text-text-muted font-mono mt-1">{estimateReadingTime(item)}</p>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Badge variant="default">{item.source_type}</Badge>
                <Badge variant="default">{item.theme}</Badge>
                <Badge variant={item.review_status === "shortlisted" ? "teal" : "default"}>{item.review_status}</Badge>
                {item.score > 0 && <Badge variant="amber">score {item.score.toFixed(1)}</Badge>}
              </div>

              <ActionBar item={item} />

              {/* Tags */}
              <TagInput itemId={item.id} />

              {/* Favicon + domain pill */}
              <div className="flex items-center gap-2 flex-wrap">
                <FaviconPill item={item} />
              </div>

              {/* ── Summary tab ────────────────────────────────────────────── */}
              {activeTab === 'summary' && (
                <div className="space-y-4">
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt=""
                      className="w-full rounded-lg object-cover max-h-44 bg-bg-elevated"
                      loading="lazy"
                    />
                  )}

                  {item.summary && (
                    <div>
                      <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Summary</p>
                      <p className="text-sm text-text-secondary leading-relaxed">
                        <HighlightedSummary
                          text={item.summary}
                          terms={[...item.compounds, ...item.mechanisms]}
                        />
                      </p>
                    </div>
                  )}

                  {/* Key Phrases */}
                  <KeyPhrasesSection item={item} />

                  {/* Compounds */}
                  {item.compounds.length > 0 && (
                    <div>
                      <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Compounds</p>
                      <div className="flex flex-wrap gap-1.5">
                        {item.compounds.map((c: string) => (
                          <TagChip
                            key={c}
                            label={c}
                            variant="compound"
                            size="md"
                            onClick={(e) => { e.stopPropagation(); goFilter("compound", c) }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Mechanisms */}
                  {item.mechanisms.length > 0 && (
                    <div>
                      <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Mechanisms</p>
                      <div className="flex flex-wrap gap-1.5">
                        {item.mechanisms.map((m: string) => (
                          <TagChip
                            key={m}
                            label={m}
                            variant="mechanism"
                            size="md"
                            onClick={(e) => { e.stopPropagation(); goFilter("mechanism", m) }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {item.content && (
                    <div>
                      <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider mb-1">Content</p>
                      <p className="text-xs text-text-muted leading-relaxed whitespace-pre-wrap line-clamp-[20]">{item.content}</p>
                    </div>
                  )}

                  <div className="text-[10px] text-text-muted font-mono space-y-0.5 pt-2 border-t border-border">
                    {item.author && <p>Author: {item.author}</p>}
                    {item.published_at && <p>Published: {item.published_at.slice(0, 10)}</p>}
                    <p>Domain: {item.domain}</p>
                  </div>

                  <CollapsibleSection title="Notes" defaultOpen>
                    <NoteEditor item={item} />
                  </CollapsibleSection>
                  <SeeAlsoPanel item={item} />
                  <RelatedItems item={item} />
                </div>
              )}

              {/* ── Preview tab ─────────────────────────────────────────────── */}
              {activeTab === 'preview' && (
                <div className="space-y-4">
                  {OEMBED_SOURCES.has((item.source_type ?? '').toLowerCase()) ? (
                    <OEmbedPreview item={item} />
                  ) : (
                    <NativeContentPreview item={item} />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Quick actions bar */}
        {isOpen && item && (
          <div className="shrink-0 border-t border-border bg-bg-surface px-4 py-2 space-y-1.5">
            <div className="flex items-center gap-2">
              {/* Save/unsave */}
              <button
                onClick={async () => {
                  await api.updateItem(item.id, { is_saved: !item.is_saved })
                  qc.invalidateQueries({ queryKey: ["items"] })
                  qc.invalidateQueries({ queryKey: ["item", item.id] })
                  addToast(item.is_saved ? "Removed from library" : "Saved to library", "info")
                }}
                title={item.is_saved ? "Unsave" : "Save"}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                  item.is_saved
                    ? "bg-accent/15 text-accent hover:bg-accent/25"
                    : "bg-bg-elevated text-text-secondary hover:text-text-primary border border-border hover:border-accent/40"
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill={item.is_saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                {item.is_saved ? "Saved" : "Save"}
              </button>

              {/* Mark as reviewed */}
              <button
                onClick={async () => {
                  const next = item.review_status === "shortlisted" ? "reviewing" : "shortlisted"
                  await api.updateItem(item.id, { review_status: next })
                  qc.invalidateQueries({ queryKey: ["items"] })
                  qc.invalidateQueries({ queryKey: ["item", item.id] })
                  addToast(`Marked ${next}`, "info")
                }}
                title={item.review_status === "shortlisted" ? "Remove from shortlist" : "Shortlist this item"}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                  item.review_status === "shortlisted"
                    ? "bg-green/15 text-green hover:bg-green/25"
                    : "bg-bg-elevated text-text-secondary hover:text-text-primary border border-border hover:border-accent/40"
                )}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {item.review_status === "shortlisted" ? "Shortlisted" : "Shortlist"}
              </button>

              {/* Open in new tab */}
              <button
                onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                title="Open in new tab"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-bg-elevated text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Open
              </button>

              {/* Share / copy URL */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(item.url).then(() => {
                    addToast("Link copied", "success")
                  })
                }}
                title="Copy link"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-bg-elevated text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                Share
              </button>
            </div>

            {/* Keyboard hints */}
            <div className="flex items-center justify-center gap-4">
              <span className="text-[10px] text-text-muted font-mono flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded border border-border bg-bg-elevated text-[9px]">←</kbd>
                <kbd className="px-1 py-0.5 rounded border border-border bg-bg-elevated text-[9px]">→</kbd>
                navigate
              </span>
              <span className="text-[10px] text-text-muted font-mono flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded border border-border bg-bg-elevated text-[9px]">esc</kbd>
                close
              </span>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}
