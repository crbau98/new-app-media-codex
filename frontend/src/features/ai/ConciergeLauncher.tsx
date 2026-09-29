import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { OPEN_CONCIERGE_EVENT } from './events'
import './ai.css'

// The drawer (chat UI, stream client, on-device brain) is a separate chunk that
// is only fetched when the launcher is first used.
const ConciergeDrawer = lazy(() => import('./ConciergeDrawer'))
const preloadDrawer = () => { void import('./ConciergeDrawer') }

/**
 * Self-contained AI concierge: renders its own floating launcher AND (lazily)
 * the drawer. Mount ONCE anywhere inside the app's QueryClientProvider, e.g.
 *
 *   const ConciergeLauncher = lazy(() => import('@/features/ai/ConciergeLauncher'))
 *   ...
 *   <Suspense fallback={null}><ConciergeLauncher /></Suspense>
 *
 * It listens for `codex:open-concierge` (detail: { prompt?: string }) and opens
 * media through `codex:open-media` — see features/ai/events.ts for the contract.
 */
export default function ConciergeLauncher() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pending, setPending] = useState<{ text: string; nonce: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const nonce = useRef(0)

  const openWith = useCallback((prompt?: string) => {
    setMounted(true)
    setOpen(true)
    nonce.current += 1
    setPending({ text: (prompt ?? '').trim(), nonce: nonce.current })
  }, [])

  useEffect(() => {
    const onOpen = (event: Event) => openWith((event as CustomEvent<{ prompt?: string }>).detail?.prompt)
    window.addEventListener(OPEN_CONCIERGE_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CONCIERGE_EVENT, onOpen)
  }, [openWith])

  const close = useCallback(() => {
    setOpen(false)
    window.setTimeout(() => buttonRef.current?.focus(), 0)
  }, [])

  return (
    <div className="ai-scope">
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => openWith()}
          onPointerEnter={preloadDrawer}
          onFocus={preloadDrawer}
          aria-label="Open AI concierge"
          data-testid="concierge-launcher"
          className="group fixed right-4 z-[140] flex h-12 items-center gap-2 rounded-full border border-[rgb(var(--ai-gold)/0.35)] bg-elevated/95 py-0 pl-1.5 pr-1.5 text-ink shadow-overlay backdrop-blur transition-transform active:scale-95 md:right-6 md:pr-4 tap-highlight-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
        >
          <span className="ai-orb grid h-9 w-9 place-items-center rounded-full"><Sparkles size={16} strokeWidth={1.8} className="text-white drop-shadow" aria-hidden="true" /></span>
          <span className="hidden text-[13px] font-medium md:inline">Concierge</span>
        </button>
      )}
      {mounted && (
        <Suspense fallback={null}>
          <ConciergeDrawer open={open} onClose={close} pendingPrompt={pending} />
        </Suspense>
      )}
    </div>
  )
}
