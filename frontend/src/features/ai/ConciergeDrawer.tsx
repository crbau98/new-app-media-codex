import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Cloud, RotateCcw, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useAppStore } from '@/store'
import type { MediaItem } from '@/lib/types'
import { addToCollection, createCollection, loadCollections, persistCollections } from '@/lib/collections'
import { cn } from '@/lib/utils'
import { MediaMiniCard } from './MediaMini'
import { MOODS, detectUnsafeIntent, parseNaturalQuery, type MoodId } from './core/library'
import { answerLocally, MOOD_PROMPTS, SUGGESTED_PROMPTS, type ReplyAction } from './concierge/local'
import { buildCatalog, ConciergeHttpError, fetchAiAvailability, streamConcierge } from './concierge/stream'
import { clearHistory, loadHistory, loadPrefs, newId, saveHistory, savePrefs, type ChatMessage } from './concierge/history'
import { getAnnouncedCurrentMedia, requestOpenMedia } from './events'
import { useAffinity, useLibrary } from './hooks/useLibrary'
import { summarizeTaste } from './taste/engine'
import { recordSearchTerm } from './taste/storage'
import './ai.css'

interface Props {
  open: boolean
  onClose: () => void
  /** Prompt to send as soon as the drawer is ready (from `codex:open-concierge`). */
  pendingPrompt: { text: string; nonce: number } | null
}

function navigateTo(route: string) {
  // Works with or without a router context: react-router's browser history listens for popstate.
  window.history.pushState(null, '', route)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const FOCUSABLE = 'button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])'

export default function ConciergeDrawer({ open, onClose, pendingPrompt }: Props) {
  const { lites, byId, isLoading } = useLibrary(open)
  const { affinity, profile, followed, mode } = useAffinity()
  const recentlyViewed = useAppStore((s) => s.recentlyViewed)

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory())
  const [draft, setDraft] = useState('')
  const [cloud, setCloud] = useState<{ available: boolean; model: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [shareTaste, setShareTaste] = useState(() => loadPrefs().shareTasteTags)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastPromptRef = useRef<string>('')
  const handledNonce = useRef<number>(-1)

  const ready = !isLoading || lites.length > 0

  useEffect(() => { saveHistory(messages) }, [messages])
  useEffect(() => { if (open) void fetchAiAvailability().then(setCloud) }, [open])

  /* focus management + focus trap + Escape */
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
      if (event.key !== 'Tab') return
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes?.length) return
      const first = nodes[0], last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (!panelRef.current?.contains(active)) { event.preventDefault(); first.focus(); return }
      if (event.shiftKey && active === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', onKey, true); previous?.focus?.() }
  }, [open, onClose])

  /* stop any in-flight request when the drawer unmounts */
  useEffect(() => () => abortRef.current?.abort(), [])

  /* keep the latest message in view unless the user scrolled up */
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const patchAssistant = useCallback((id: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)))
  }, [])

  const sendRef = useRef<(prompt: string) => void>(() => {})

  const runAction = useCallback((action: ReplyAction) => {
    if (action.kind === 'navigate') { onClose(); navigateTo(action.route) }
    else if (action.kind === 'open-media') { if (!requestOpenMedia(action.id)) navigateTo(`/search?q=${encodeURIComponent(byId.get(action.id)?.title ?? '')}`) }
    else if (action.kind === 'prompt') sendRef.current(action.prompt)
    else if (action.kind === 'save-collection') {
      const collection = action.ids.reduce((c, id) => addToCollection(c, id), createCollection(action.name))
      persistCollections([collection, ...loadCollections()])
      useAppStore.getState().addToast({ type: 'success', title: `Saved “${collection.name}”`, message: `${action.ids.length} items added to your collections.` })
    }
  }, [byId, onClose])

  const openItem = useCallback((id: string) => {
    if (!requestOpenMedia(id)) navigateTo(`/search?q=${encodeURIComponent(byId.get(id)?.title ?? '')}`)
  }, [byId])

  /** On-device reply (also the fallback whenever the cloud path is unavailable). */
  const replyLocally = useCallback((prompt: string, assistantId: string, note?: string) => {
    const anchor = getAnnouncedCurrentMedia() ?? recentlyViewed[0] ?? null
    const lastIds = [...messages].reverse().find((m) => m.role === 'assistant' && m.ids?.length)?.ids
    const reply = answerLocally(prompt, {
      items: lites, currentId: anchor, lastIds, taste: profile, affinity, followed, mode, seed: Date.now(),
    })
    patchAssistant(assistantId, {
      text: reply.text, ids: reply.ids, reasons: reply.reasons, actions: reply.actions, chips: reply.chips,
      refused: reply.refused, totalSeconds: reply.totalSeconds, status: 'done', mode: 'device', note, error: undefined,
    })
  }, [lites, profile, affinity, followed, mode, recentlyViewed, messages, patchAssistant])

  const send = useCallback(async (raw: string) => {
    const prompt = raw.trim().slice(0, 1500)
    if (!prompt || busy) return
    lastPromptRef.current = prompt
    stickRef.current = true
    const assistantId = newId()
    const history = messages.filter((m) => m.status !== 'error').slice(-8)
    setMessages((prev) => [...prev, { id: newId(), role: 'user', text: prompt }, { id: assistantId, role: 'assistant', text: '', status: 'streaming' }])
    setDraft('')
    recordSearchTerm(prompt)

    // Guardrail: refuse before any network call.
    const verdict = detectUnsafeIntent(prompt)
    if (verdict.blocked) {
      patchAssistant(assistantId, { text: verdict.message ?? 'I can’t help with that.', refused: true, status: 'done', mode: 'device' })
      return
    }

    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const availability = cloud ?? await fetchAiAvailability()
      if (!availability.available || !lites.length) {
        await new Promise((resolve) => window.setTimeout(resolve, 260))
        if (!controller.signal.aborted) replyLocally(prompt, assistantId)
        return
      }
      const anchor = getAnnouncedCurrentMedia() ?? recentlyViewed[0] ?? null
      const tasteTags = shareTaste && profile ? summarizeTaste(profile).topTags.slice(0, 5).map((t) => t.tag) : undefined
      const body = {
        messages: [...history.filter((m) => m.text).map((m) => ({ role: m.role, content: m.text.slice(0, 1500) })), { role: 'user' as const, content: prompt }],
        catalog: buildCatalog(lites, { prompt, anchorIds: [anchor] }),
        context: { currentId: anchor, tasteTags },
      }
      let text = ''
      let ids: string[] = []
      let reasons: Record<string, string> = {}
      let collectionName: string | undefined
      let totalSeconds: number | undefined
      let toolNote = ''
      let failed: string | null = null
      let refusedMsg: string | null = null
      for await (const event of streamConcierge(body, controller.signal)) {
        if (event.t === 'text') { text += event.d; patchAssistant(assistantId, { text, mode: 'cloud' }) }
        else if (event.t === 'tool') {
          if (event.out.ids.length) { ids = event.out.ids; reasons = { ...reasons, ...event.out.reasons } }
          toolNote = event.out.note || toolNote
          collectionName = event.out.name ?? collectionName
          totalSeconds = event.out.totalSeconds ?? totalSeconds
          patchAssistant(assistantId, { ids, reasons, mode: 'cloud' })
        } else if (event.t === 'refusal') refusedMsg = event.d
        else if (event.t === 'error') failed = event.d
      }
      if (refusedMsg) { patchAssistant(assistantId, { text: refusedMsg, refused: true, status: 'done', mode: 'device' }); return }
      const actions: ReplyAction[] = collectionName && ids.length ? [{ kind: 'save-collection', label: 'Save as collection', name: collectionName, ids }] : []
      if (failed && !text && !ids.length) { replyLocally(prompt, assistantId, 'AI is unavailable right now — answered on-device.'); return }
      patchAssistant(assistantId, {
        text: text || toolNote || (ids.length ? 'Here is what I found.' : 'I could not find anything for that.'),
        ids, reasons, actions, totalSeconds, chips: parseNaturalQuery(prompt).notes.slice(0, 5),
        status: failed ? 'error' : 'done', error: failed ?? undefined, mode: 'cloud',
      })
    } catch (error) {
      if (controller.signal.aborted) {
        patchAssistant(assistantId, (m) => ({ status: 'done', note: 'Stopped.', text: m.text }))
      } else if (error instanceof ConciergeHttpError && error.status === 429) {
        patchAssistant(assistantId, { status: 'error', error: error.message, text: '' })
      } else {
        replyLocally(prompt, assistantId, 'AI is unavailable right now — answered on-device.')
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [busy, messages, cloud, lites, recentlyViewed, shareTaste, profile, patchAssistant, replyLocally])

  useEffect(() => { sendRef.current = (prompt: string) => { void send(prompt) } }, [send])

  // Pending prompt from `codex:open-concierge` — sent once the library is ready.
  useEffect(() => {
    if (!open || !pendingPrompt || handledNonce.current === pendingPrompt.nonce) return
    if (pendingPrompt.text && !ready) return
    handledNonce.current = pendingPrompt.nonce
    if (pendingPrompt.text) void send(pendingPrompt.text)
  }, [open, pendingPrompt, ready, send])

  const stop = () => abortRef.current?.abort()
  const retry = () => {
    const prompt = lastPromptRef.current
    if (!prompt) return
    setMessages((prev) => {
      const copy = [...prev]
      while (copy.length && copy[copy.length - 1].role === 'assistant') copy.pop()
      if (copy.length && copy[copy.length - 1].role === 'user') copy.pop()
      return copy
    })
    window.setTimeout(() => void send(prompt), 0)
  }
  const clear = () => { abortRef.current?.abort(); setMessages([]); clearHistory() }
  const toggleShare = () => { const next = !shareTaste; setShareTaste(next); savePrefs({ shareTasteTags: next }) }

  const isEmpty = messages.length === 0
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const cloudMode = cloud?.available === true
  const modeLabel = cloud === null ? 'Checking…' : cloudMode ? 'AI · public metadata' : 'On-device'
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    return h < 5 ? 'Still up?' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.'
  }, [])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ai-scope fixed inset-0 z-[190] flex items-end justify-end md:p-6"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-scrim md:bg-transparent" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={panelRef}
            role="dialog" aria-modal="true" aria-label="AI concierge"
            data-busy={busy}
            initial={{ y: 48, opacity: 0.6 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 48, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="ai-panel relative flex h-[min(88dvh,760px)] w-full flex-col overflow-hidden rounded-t-2xl md:h-[min(720px,calc(100dvh-48px))] md:w-[430px] md:rounded-2xl"
          >
            {/* header */}
            <header className="flex items-center gap-3 border-b ai-hairline px-4 pb-3 pt-3">
              <span className="ai-orb grid h-8 w-8 shrink-0 place-items-center rounded-full" aria-hidden="true"><Sparkles size={14} strokeWidth={1.8} className="text-white drop-shadow" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold leading-tight text-ink">Concierge</h2>
                <p className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  {cloudMode ? <Cloud size={10} strokeWidth={1.8} aria-hidden="true" /> : <ShieldCheck size={10} strokeWidth={1.8} aria-hidden="true" />}
                  <span data-testid="concierge-mode">{modeLabel}</span>
                </p>
              </div>
              {!isEmpty && <button type="button" onClick={clear} className="grid h-9 w-9 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Clear conversation" title="Clear conversation"><Trash2 size={15} strokeWidth={1.7} /></button>}
              <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink" aria-label="Close concierge"><X size={16} strokeWidth={1.7} /></button>
            </header>

            {/* transcript */}
            <div
              ref={scrollRef} role="log" aria-live="polite" aria-label="Conversation"
              onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}
              className="hide-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4"
            >
              {isEmpty && (
                <div className="pt-2">
                  <p className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{greeting}</p>
                  <p className="mt-1 max-w-[30ch] text-[13.5px] leading-5 text-ink-2">Tell me a mood, a length or a creator — I’ll search your library, plan tonight and explain every pick.</p>
                  <p className="eyebrow mt-6">Tonight’s vibe</p>
                  <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Tonight’s vibe">
                    {MOODS.map((m) => (
                      <button key={m.id} type="button" onClick={() => void send(MOOD_PROMPTS[m.id as MoodId])} className="ai-chip-button" title={m.blurb}>{m.label}</button>
                    ))}
                  </div>
                  <p className="eyebrow mt-6">Try asking</p>
                  <div className="mt-2 flex flex-col items-start gap-2">
                    {SUGGESTED_PROMPTS.map((s) => (
                      <button key={s.label} type="button" onClick={() => void send(s.prompt)} className="ai-chip-button text-left">{s.label}</button>
                    ))}
                  </div>
                  <p className="mt-7 flex items-start gap-2 text-[11.5px] leading-4 text-ink-3">
                    <ShieldCheck size={13} strokeWidth={1.7} className="mt-px shrink-0" aria-hidden="true" />
                    {cloudMode
                      ? 'Only public titles, tags, creator handles and counts are shared with the AI. Never images. Your taste profile stays on this device.'
                      : 'Running fully on this device — nothing is sent anywhere. Your taste profile never leaves your browser.'}
                  </p>
                </div>
              )}

              {messages.map((m) => (
                <Message
                  key={m.id} message={m} byId={byId} onOpen={openItem} onAction={runAction}
                  onRetry={m.status === 'error' && m.id === lastAssistant?.id ? retry : undefined}
                />
              ))}
              {!ready && busy && <p className="text-[12px] text-ink-3">Loading your library…</p>}
            </div>

            {/* composer */}
            <div className="ai-safe-bottom border-t ai-hairline px-3 pt-2.5">
              {cloudMode && (
                <label className="mb-2 flex cursor-pointer items-center gap-2 px-1 text-[11.5px] text-ink-3">
                  <input type="checkbox" checked={shareTaste} onChange={toggleShare} className="h-3.5 w-3.5 accent-heat" />
                  Share my top 5 taste tags with the AI (off by default)
                </label>
              )}
              <form
                className="flex items-end gap-2 rounded-xl border border-line-strong bg-sunken/60 py-1.5 pl-3 pr-1.5 focus-within:border-[rgb(var(--ai-gold)/0.6)]"
                onSubmit={(e) => { e.preventDefault(); void send(draft) }}
              >
                <textarea
                  ref={inputRef} value={draft} rows={1} maxLength={1500}
                  onChange={(e) => { setDraft(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 112)}px` }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft) } }}
                  placeholder="Ask for a mood, length, creator…" aria-label="Message the concierge" enterKeyHint="send"
                  className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-base leading-5 text-ink outline-none placeholder:text-ink-3 md:text-[14px]"
                />
                {busy ? (
                  <button type="button" onClick={stop} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-strong text-ink hover:bg-sunken" aria-label="Stop generating"><Square size={12} strokeWidth={2} fill="currentColor" /></button>
                ) : (
                  <button type="submit" disabled={!draft.trim()} className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full transition-opacity', draft.trim() ? 'bg-ink text-canvas' : 'bg-sunken text-ink-3 opacity-70')} aria-label="Send"><ArrowUp size={16} strokeWidth={2.2} /></button>
                )}
              </form>
              <p className="mt-1.5 px-1 pb-1 text-center font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">Adults only · public metadata · no identifying people</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Message({ message, byId, onOpen, onAction, onRetry }: {
  message: ChatMessage
  byId: Map<string, MediaItem>
  onOpen: (id: string) => void
  onAction: (a: ReplyAction) => void
  onRetry?: () => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[86%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border ai-hairline bg-sunken/70 px-3.5 py-2 text-[13.5px] leading-5 text-ink">{message.text}</p>
      </div>
    )
  }
  const streaming = message.status === 'streaming'
  const cards = (message.ids ?? []).map((id) => byId.get(id)).filter((x): x is MediaItem => Boolean(x))
  return (
    <div className="space-y-2.5" data-testid="assistant-message">
      {streaming && !message.text && !cards.length && (
        <div className="space-y-2" aria-label="Thinking">
          <div className="ai-skeleton h-3 w-[78%] rounded" /><div className="ai-skeleton h-3 w-[54%] rounded" />
          <div className="flex gap-3 pt-1">{[0, 1, 2].map((i) => <div key={i} className="ai-skeleton aspect-[3/4] w-[110px] shrink-0 rounded-md" />)}</div>
        </div>
      )}
      {message.refused ? (
        <div className="flex gap-2.5 rounded-lg border ai-hairline bg-sunken/50 p-3" role="status">
          <ShieldCheck size={16} strokeWidth={1.6} className="ai-gold-text mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[13px] leading-5 text-ink-2">{message.text}</p>
        </div>
      ) : message.text ? (
        <p className={cn('whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-ink', streaming && 'ai-caret')}>{message.text}</p>
      ) : null}

      {message.chips && message.chips.length > 0 && !streaming && (
        <div className="flex flex-wrap gap-1.5" aria-label="How your request was understood">
          {message.chips.map((chip) => <span key={chip} className="ai-chip">{chip}</span>)}
        </div>
      )}

      {cards.length > 0 && (
        <div className="hide-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1" role="list" aria-label="Results">
          {cards.map((item) => (
            <div role="listitem" key={item.id}><MediaMiniCard item={item} reason={message.reasons?.[item.id]} onSelect={() => onOpen(item.id)} /></div>
          ))}
        </div>
      )}

      {message.actions && message.actions.length > 0 && !streaming && (
        <div className="flex flex-wrap gap-2">
          {message.actions.map((action, i) => (
            <button key={`${action.kind}-${i}`} type="button" onClick={() => onAction(action)} className="ai-chip-button">{action.label}</button>
          ))}
        </div>
      )}

      {message.status === 'error' && (
        <div className="flex items-center gap-3 rounded-lg border border-error/40 bg-error/10 px-3 py-2" role="alert">
          <p className="min-w-0 flex-1 text-[12.5px] leading-4 text-ink-2">{message.error ?? 'Something went wrong.'}</p>
          {onRetry && <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-sunken"><RotateCcw size={12} strokeWidth={1.8} aria-hidden="true" />Retry</button>}
        </div>
      )}
      {(message.note || (message.mode === 'device' && !message.refused && message.status === 'done')) && (
        <p className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-3">{message.note ?? 'Answered on-device'}</p>
      )}
    </div>
  )
}
