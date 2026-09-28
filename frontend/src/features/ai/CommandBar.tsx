import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, Clock, Compass, ListChecks, MessageCircle, MonitorPlay, Moon, Search, Settings,
  ShieldCheck, Shuffle, Sparkles, ThumbsDown, ThumbsUp, UserRound, Users, X,
} from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { MediaMiniRow } from './MediaMini'
import {
  describeQuery, emptyQuery, formatMinutes, parseNaturalQuery, planSession, runQuery, similarItems,
  type AiQuery, type RankedItem,
} from './core/library'
import { CURRENT_MEDIA_EVENT, getAnnouncedCurrentMedia, requestOpenConcierge, requestOpenMedia } from './events'
import { useAffinity, useLibrary } from './hooks/useLibrary'
import { refineQueryRemote, semanticRerank, type RefineResult } from './query/remote'
import { clearRecentQueries, loadRecentQueries, pushRecentQuery } from './recent'
import { fetchAiAvailability } from './concierge/stream'
import { toSignalItem, toLite } from './adapters'
import { recordSearchTerm, recordTasteSignal } from './taste/storage'
import './ai.css'

type Icon = typeof Search

interface Row {
  id: string
  group: string
  label: string
  hint?: string
  icon?: Icon
  item?: MediaItem
  reason?: string
  run: () => void
}

const MAX_MEDIA_ROWS = 6

interface Props { open: boolean; onClose: () => void }

export default function CommandBar({ open, onClose }: Props) {
  const navigate = useNavigate()
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const recentlyViewed = useAppStore((s) => s.recentlyViewed)
  const { performers, lites, byId, vocab, isLoading } = useLibrary(open)
  const { affinity } = useAffinity()

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const [cloud, setCloud] = useState<boolean | null>(null)
  const [refined, setRefined] = useState<{ for: string; result: RefineResult } | null>(null)
  const [refining, setRefining] = useState(false)
  const [semantic, setSemantic] = useState<{ for: string; ids: string[] } | null>(null)
  const [announced, setAnnounced] = useState<string | null>(() => getAnnouncedCurrentMedia())
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const listId = useId()

  /* reset + focus management when opening */
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setRefined(null)
      setSemantic(null)
      setRecent(loadRecentQueries())
    }
  }
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40)
    void fetchAiAvailability().then((state) => setCloud(state.available))
    const onCurrent = (event: Event) => setAnnounced((event as CustomEvent<{ id?: string | null }>).detail?.id ?? null)
    window.addEventListener(CURRENT_MEDIA_EVENT, onCurrent)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(CURRENT_MEDIA_EVENT, onCurrent)
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  const [focusNonce, setFocusNonce] = useState(0)
  useEffect(() => { if (focusNonce) inputRef.current?.focus() }, [focusNonce])
  const fillQuery = useCallback((text: string) => {
    setQuery(text)
    setActiveIndex(0)
    setFocusNonce((n) => n + 1)
  }, [])

  const trimmed = query.trim()
  const parsed = useMemo(() => (trimmed ? parseNaturalQuery(trimmed, { vocab }) : emptyQuery()), [trimmed, vocab])
  const effective: AiQuery = refined && refined.for === trimmed && refined.result.query ? refined.result.query : parsed
  const aiUnderstood = Boolean(refined && refined.for === trimmed && refined.result.state === 'model')
  const refusal = parsed.refused ?? null
  const anchorId = announced ?? recentlyViewed[0] ?? null

  /* optional LLM refinement (debounced, only when a gateway is configured) */
  useEffect(() => {
    if (!open || cloud !== true || !trimmed || refusal || trimmed.length < 10 || trimmed.split(/\s+/).length < 3) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRefining(true)
      void refineQueryRemote(parsed, { tags: [...vocab.tags], creators: [...vocab.creators.values()], sources: [...vocab.sources.values()] }, controller.signal)
        .then((result) => { if (result && !controller.signal.aborted) setRefined({ for: trimmed, result }) })
        .finally(() => { if (!controller.signal.aborted) setRefining(false) })
    }, 650)
    return () => { window.clearTimeout(timer); controller.abort(); setRefining(false) }
  }, [open, cloud, trimmed, parsed, refusal, vocab])

  /* deterministic results (instant) */
  const plan = useMemo(() => {
    if (effective.intent !== 'plan' || !lites.length) return null
    return planSession(lites, { moods: effective.moods, minutes: effective.budgetMinutes ?? 45, affinity, q: { ...effective, sort: 'relevance' } })
  }, [effective, lites, affinity])

  const local = useMemo<{ ranked: RankedItem[]; total: number; relaxed: string[] }>(() => {
    if (!trimmed || refusal || !lites.length) return { ranked: [], total: 0, relaxed: [] }
    if (effective.intent === 'similar') {
      const target = effective.similarTo && effective.similarTo !== 'current' ? effective.similarTo : anchorId
      const ranked = target ? similarItems(lites, target, 12) : []
      return { ranked, total: ranked.length, relaxed: [] }
    }
    if (effective.intent === 'plan') return { ranked: plan?.items ?? [], total: plan?.items.length ?? 0, relaxed: [] }
    if (effective.intent === 'navigate' || effective.intent === 'explain') return { ranked: [], total: 0, relaxed: [] }
    const out = runQuery(lites, effective, { limit: 24, affinity, seed: 7 })
    return { ranked: out.results, total: out.total, relaxed: out.relaxed }
  }, [trimmed, refusal, lites, effective, anchorId, plan, affinity])

  /* optional semantic re-rank (embedding model, only when configured) */
  useEffect(() => {
    if (!open || cloud !== true || !trimmed || refusal || local.ranked.length < 3 || !(effective.text || effective.tags.length)) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void semanticRerank(trimmed, local.ranked, controller.signal).then((next) => {
        if (next && !controller.signal.aborted) setSemantic({ for: trimmed, ids: next.map((r) => r.item.id) })
      })
    }, 500)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, cloud, trimmed, refusal, local.ranked, effective])

  const ranked = useMemo(() => {
    if (!semantic || semantic.for !== trimmed) return local.ranked
    const order = new Map(semantic.ids.map((id, i) => [id, i]))
    return [...local.ranked].sort((a, b) => (order.get(a.item.id) ?? 999) - (order.get(b.item.id) ?? 999))
  }, [local.ranked, semantic, trimmed])

  /* actions */
  const close = onClose
  const go = useCallback((path: string) => { navigate(path); close() }, [navigate, close])
  const remember = useCallback(() => {
    if (!trimmed) return
    setRecent(pushRecentQuery(trimmed))
    recordSearchTerm(trimmed)
  }, [trimmed])

  const openMedia = useCallback((item: MediaItem) => {
    remember()
    close()
    if (!requestOpenMedia(item.id)) {
      // No host handler: fall back to a search so the action is never a dead end.
      setSearchQuery(item.title)
      navigate(`/search?q=${encodeURIComponent(item.title)}`)
    }
  }, [remember, close, navigate, setSearchQuery])

  const surprise = useCallback(() => {
    if (!lites.length) return
    const pool = trimmed && !refusal ? { ...effective, intent: 'search' as const } : emptyQuery()
    const out = runQuery(lites, { ...pool, sort: 'random' }, { limit: 1, affinity, seed: Date.now() })
    const pick = out.results[0]?.item
    const media = pick ? byId.get(pick.id) : undefined
    if (media) openMedia(media)
  }, [lites, trimmed, refusal, effective, affinity, byId, openMedia])

  const feedback = useCallback((item: MediaItem, signal: 'more' | 'less') => {
    useAppStore.getState().recordDiscoveryFeedback({ id: item.id, creator: item.creator, tags: item.tags }, signal)
    recordTasteSignal(signal, toSignalItem(toLite(item)))
    useAppStore.getState().addToast({ type: 'info', title: signal === 'more' ? 'Noted — more like this' : 'Noted — less like this', message: 'Stays on this device.' })
  }, [])

  const askConcierge = useCallback((prompt?: string) => {
    remember()
    close()
    requestOpenConcierge(prompt ?? (trimmed || undefined))
  }, [remember, close, trimmed])

  /* rows */
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    const nav = (id: string, label: string, icon: Icon, path: string): Row => ({ id, group: 'Navigate', label, icon, run: () => go(path) })
    const navRows = [
      nav('nav-media', 'Go to Library', MonitorPlay, '/media'),
      nav('nav-explore', 'Go to For You', Compass, '/explore'),
      nav('nav-creators', 'Go to Creators', Users, '/creators'),
      nav('nav-search', 'Go to Search', Search, '/search'),
      nav('nav-settings', 'Go to Settings', Settings, '/settings'),
    ]
    const actionRows: Row[] = [
      { id: 'act-random', group: 'Actions', label: 'Play something random', hint: 'Taste-aware', icon: Shuffle, run: surprise },
      { id: 'act-concierge', group: 'Actions', label: 'Open the AI concierge', icon: MessageCircle, run: () => askConcierge('') },
      { id: 'act-theme', group: 'Actions', label: 'Toggle theme', hint: 'T', icon: Moon, run: () => { useAppStore.getState().toggleTheme(); close() } },
    ]

    if (!trimmed) {
      const suggestions: string[] = ['surprise me', "plan tonight's watchlist for 45 minutes"]
      const topTag = [...vocab.tags].find((t) => !['hd', 'studio'].includes(t))
      if (topTag) suggestions.push(`chill ${topTag} videos under 10 minutes`)
      const topCreator = [...vocab.creators.values()][0]
      if (topCreator) suggestions.push(`newest from @${topCreator.replace(/\s+/g, '')}`)
      if (anchorId) suggestions.unshift('more like this')
      suggestions.slice(0, 5).forEach((text, i) => out.push({ id: `sg-${i}`, group: 'Try asking', label: text, icon: Sparkles, run: () => fillQuery(text) }))
      recent.slice(0, 4).forEach((text, i) => out.push({ id: `rc-${i}`, group: 'Recent', label: text, icon: Clock, run: () => fillQuery(text) }))
      return [...out, ...actionRows, ...navRows]
    }

    if (refusal) return out

    const needle = trimmed.toLowerCase()
    if (effective.intent === 'navigate' && effective.navigate) {
      out.push({ id: 'primary-nav', group: 'Best match', label: `Go to ${effective.notes[0] ?? 'page'}`, icon: ArrowRight, run: () => { remember(); go(effective.navigate as string) } })
    } else if (effective.intent === 'surprise') {
      out.push({ id: 'primary-surprise', group: 'Best match', label: 'Surprise me', hint: 'Random pick', icon: Shuffle, run: () => { remember(); surprise() } })
    } else if (effective.intent === 'plan' || effective.intent === 'collection' || effective.intent === 'explain') {
      const label = effective.intent === 'plan' ? "Plan tonight's watchlist" : effective.intent === 'collection' ? 'Build a smart collection' : 'Explain my recommendations'
      out.push({ id: 'primary-ask', group: 'Best match', label, hint: 'Concierge', icon: ListChecks, run: () => askConcierge() })
    }

    const groupName = effective.intent === 'plan' && plan ? `Tonight · ${formatMinutes(plan.totalSeconds)}` : effective.intent === 'similar' ? 'More like this' : 'Results'
    ranked.slice(0, effective.intent === 'plan' ? 8 : MAX_MEDIA_ROWS).forEach((entry) => {
      const item = byId.get(entry.item.id)
      if (item) out.push({ id: `m-${item.id}`, group: groupName, label: item.title, item, reason: entry.reasons[0], run: () => openMedia(item) })
    })
    if (local.total > MAX_MEDIA_ROWS && effective.intent === 'search') {
      out.push({ id: 'see-all', group: groupName, label: `See all ${local.total} results in Search`, hint: '⌘↵', icon: ArrowRight, run: () => { remember(); setSearchQuery(trimmed); go(`/search?q=${encodeURIComponent(trimmed)}`) } })
    }

    const creatorNeedles = [...effective.creators, needle]
    performers
      .filter((c) => creatorNeedles.some((n) => n.length >= 2 && (c.name.toLowerCase().includes(n) || (c.username ?? '').toLowerCase().includes(n))))
      .slice(0, 3)
      .forEach((c) => out.push({ id: `c-${c.id}`, group: 'Creators', label: `@${c.username || c.name}`, hint: c.platform || 'creator', icon: UserRound, run: () => { remember(); setSearchQuery(c.name); go(`/search?q=${encodeURIComponent(c.name)}`) } }))

    ;[...navRows, ...actionRows].filter((r) => r.label.toLowerCase().includes(needle)).forEach((r) => out.push(r))
    if (effective.intent !== 'plan' && effective.intent !== 'collection' && effective.intent !== 'explain') {
      out.push({ id: 'ask-concierge', group: 'Ask', label: `Ask the concierge: “${trimmed.slice(0, 48)}${trimmed.length > 48 ? '…' : ''}”`, icon: MessageCircle, run: () => askConcierge() })
    }
    return out
  }, [trimmed, refusal, effective, ranked, plan, byId, performers, vocab, recent, anchorId, local.total, fillQuery, go, close, surprise, askConcierge, openMedia, remember, setSearchQuery])

  const activeRow = rows[Math.min(activeIndex, Math.max(0, rows.length - 1))]

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, rows])

  /* keyboard */
  const onInputKeyDown = (event: React.KeyboardEvent) => {
    const count = rows.length
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => (count ? (i + 1) % count : 0)) }
    else if (event.key === 'ArrowUp' && !event.altKey) { event.preventDefault(); setActiveIndex((i) => (count ? (i - 1 + count) % count : 0)) }
    else if (event.key === 'Enter') {
      event.preventDefault()
      if (event.metaKey || event.ctrlKey) { if (trimmed) { remember(); setSearchQuery(trimmed); go(`/search?q=${encodeURIComponent(trimmed)}`) } }
      else if (event.shiftKey && trimmed) askConcierge()
      else activeRow?.run()
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && activeRow?.item) {
      event.preventDefault()
      feedback(activeRow.item, event.key === 'ArrowUp' ? 'more' : 'less')
    } else if (event.key === 'Tab' && !event.shiftKey && activeRow && !trimmed && activeRow.group !== 'Navigate' && activeRow.group !== 'Actions') {
      event.preventDefault(); activeRow.run()
    }
  }

  const onDialogKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    if (!focusable?.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const chips = trimmed && !refusal ? describeQuery(effective) : []
  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ row: Row; index: number }>>()
    rows.forEach((row, index) => { const list = map.get(row.group) ?? []; list.push({ row, index }); map.set(row.group, list) })
    return [...map.entries()]
  }, [rows])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ai-scope fixed inset-0 z-[400] flex items-start justify-center bg-scrim px-3 pt-[max(12px,env(safe-area-inset-top))] backdrop-blur-sm sm:px-4 md:pt-[11vh]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog" aria-modal="true" aria-label="AI command bar"
            data-busy={refining || isLoading}
            onKeyDown={onDialogKeyDown}
            initial={{ opacity: 0, y: -10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.99 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="ai-panel flex max-h-[calc(100dvh-24px)] w-full max-w-[680px] flex-col overflow-hidden rounded-xl"
          >
            {/* input */}
            <div className="flex items-center gap-3 border-b ai-hairline px-4 py-3">
              <Sparkles size={17} strokeWidth={1.6} className="ai-gold-text shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
                onKeyDown={onInputKeyDown}
                role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
                aria-activedescendant={activeRow ? `${listId}-${activeRow.id}` : undefined}
                aria-label="Ask or search: for example chill solo videos under 5 minutes"
                placeholder="Ask anything — “chill solo videos under 5 min”"
                autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go"
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3 md:text-[15px]"
              />
              <span className={cn('hidden shrink-0 items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] sm:inline-flex', aiUnderstood ? 'ai-gold-text' : 'text-ink-3')} title={aiUnderstood ? 'Refined with AI using public metadata only' : cloud ? 'Parsed on-device; AI can refine longer requests' : 'Parsed on-device'}>
                {refining ? 'Refining…' : aiUnderstood ? 'AI-refined' : 'On-device'}
              </span>
              {query && (
                <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} className="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Clear">
                  <X size={14} strokeWidth={1.75} />
                </button>
              )}
              <button type="button" onClick={close} className="grid h-8 w-8 shrink-0 place-items-center rounded text-ink-3 hover:bg-sunken hover:text-ink md:hidden" aria-label="Close command bar">
                <span className="font-mono text-[10px]">esc</span>
              </button>
            </div>

            {/* interpretation chips */}
            {chips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b ai-hairline px-4 py-2" aria-label="How your request was understood">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">Understood</span>
                {chips.slice(0, 8).map((chip) => <span key={chip} className="ai-chip">{chip}</span>)}
                {local.relaxed[0] && <span className="text-[11px] text-ink-3">· {local.relaxed[0]}</span>}
                {aiUnderstood && refined?.result.summary && <span className="basis-full text-[11.5px] text-ink-2">{refined.result.summary}</span>}
              </div>
            )}

            {/* list */}
            <div ref={listRef} id={listId} role="listbox" aria-label="Results and commands" className="hide-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
              {refusal && (
                <div className="mx-4 my-3 flex gap-3 rounded-lg border ai-hairline bg-sunken/50 p-4" role="status">
                  <ShieldCheck size={18} strokeWidth={1.6} className="ai-gold-text mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[13.5px] font-medium text-ink">I can’t help with that</p>
                    <p className="mt-1 text-[12.5px] leading-5 text-ink-2">{refusal.message}</p>
                  </div>
                </div>
              )}

              {!refusal && trimmed && isLoading && !lites.length && (
                <div className="space-y-2 px-4 py-2" aria-label="Loading library">
                  {[0, 1, 2].map((i) => <div key={i} className="ai-skeleton h-12 rounded-md" />)}
                </div>
              )}

              {!refusal && trimmed && effective.intent === 'similar' && !anchorId && (
                <p className="px-4 py-3 text-[12.5px] text-ink-2">Open a video first (or ask about a specific one) and I’ll find more like it.</p>
              )}
              {!refusal && trimmed && !isLoading && lites.length > 0 && local.ranked.length === 0 && !['navigate', 'surprise', 'explain', 'collection'].includes(effective.intent) && effective.intent !== 'similar' && (
                <p className="px-4 py-3 text-[12.5px] text-ink-2">No matches in your loaded library. Press <kbd className="kbd">↵</kbd> on “Ask the concierge”, or try fewer filters.</p>
              )}

              {grouped.map(([group, entries]) => (
                <div key={group} role="group" aria-label={group} className="mb-1">
                  <div className="flex items-center justify-between px-4 py-1.5">
                    <span className="eyebrow">{group}</span>
                    {group === 'Recent' && <button type="button" onClick={() => { clearRecentQueries(); setRecent([]) }} className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3 hover:text-ink">Clear</button>}
                  </div>
                  {entries.map(({ row, index }) => {
                    const active = index === activeIndex
                    const optionId = `${listId}-${row.id}`
                    if (row.item) {
                      return (
                        <div key={row.id} data-active={active} className="group/row relative">
                          <MediaMiniRow id={optionId} item={row.item} reason={row.reason} active={active} onSelect={row.run} onHover={() => setActiveIndex(index)} />
                          <div className={cn('absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 md:flex', active ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100')}>
                            <button type="button" tabIndex={-1} onClick={() => feedback(row.item as MediaItem, 'more')} className="grid h-7 w-7 place-items-center rounded-full border border-line text-ink-3 hover:border-[rgb(var(--ai-gold)/0.5)] hover:text-ink" aria-label={`More like ${row.item.title}`} title="More like this (Alt+↑)"><ThumbsUp size={12} strokeWidth={1.75} /></button>
                            <button type="button" tabIndex={-1} onClick={() => feedback(row.item as MediaItem, 'less')} className="grid h-7 w-7 place-items-center rounded-full border border-line text-ink-3 hover:border-[rgb(var(--ai-gold)/0.5)] hover:text-ink" aria-label={`Less like ${row.item.title}`} title="Less like this (Alt+↓)"><ThumbsDown size={12} strokeWidth={1.75} /></button>
                          </div>
                        </div>
                      )
                    }
                    const Icon = row.icon ?? Search
                    return (
                      <button
                        key={row.id} id={optionId} role="option" aria-selected={active} data-active={active} type="button"
                        onClick={row.run} onMouseEnter={() => setActiveIndex(index)}
                        className={cn('relative flex min-h-11 w-full items-center gap-3 px-4 text-left transition-colors tap-highlight-none', active ? 'ai-row-active' : 'hover:bg-sunken/60')}
                      >
                        <Icon size={15} strokeWidth={1.6} className={cn('shrink-0', active ? 'ai-gold-text' : 'text-ink-3')} aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{row.label}</span>
                        {row.hint && <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">{row.hint}</span>}
                        {active && <ArrowRight size={13} strokeWidth={1.75} className="ai-gold-text shrink-0" aria-hidden="true" />}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* footer */}
            <div className="ai-safe-bottom hidden items-center gap-4 border-t ai-hairline px-4 py-2 md:flex">
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3"><kbd className="kbd">↵</kbd> select</span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3"><kbd className="kbd">⌘↵</kbd> search page</span>
              <span className="flex items-center gap-1 font-mono text-[10px] text-ink-3"><kbd className="kbd">⇧↵</kbd> concierge</span>
              <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-3"><kbd className="kbd">esc</kbd> close</span>
            </div>
            <p className="ai-safe-bottom border-t ai-hairline px-4 pt-2 text-center font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3 md:hidden">Public metadata only · stays on device</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
