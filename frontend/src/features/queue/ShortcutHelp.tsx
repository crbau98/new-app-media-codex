import { Fragment, useEffect, useRef, type KeyboardEvent } from 'react'
import { Keyboard, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { shortcutsByGroup, type ShortcutEntry } from './shortcuts'
import '@/styles/queue.css'

interface ShortcutHelpProps {
  inside: boolean
  onClose: () => void
}

function Keys({ entry }: { entry: ShortcutEntry }) {
  const combos = [entry.keys, ...(entry.alt ?? [])]
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
      {combos.map((combo, comboIndex) => (
        <Fragment key={combo.join('+')}>
          {comboIndex > 0 && <span className="font-mono text-[10px] text-ink-3">or</span>}
          <span className="inline-flex items-center gap-1">
            {combo.map((key, keyIndex) => (
              <Fragment key={`${key}-${keyIndex}`}>
                {keyIndex > 0 && <span className="font-mono text-[10px] text-ink-3">+</span>}
                <kbd className="q-key">{key}</kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  )
}

/** `?` — every player, queue and moments shortcut in one place. */
export default function ShortcutHelp({ inside, onClose }: ShortcutHelpProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const timer = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 40)
    return () => {
      window.clearTimeout(timer)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === '?') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      // Single control inside: keep focus on it.
      event.preventDefault()
      closeRef.current?.focus()
    }
  }

  return (
    <div
      ref={rootRef}
      className={cn('z-[270] grid place-items-center p-3 sm:p-6', inside ? 'absolute inset-0' : 'fixed inset-0')}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      data-testid="shortcut-help"
      onKeyDown={onKeyDown}
    >
      <button type="button" className="q-scrim absolute inset-0 h-full w-full cursor-default bg-scrim" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <div className="q-help relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-elevated shadow-overlay">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gold-dim text-gold-ink ring-1 ring-gold-line">
            <Keyboard size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">Keyboard shortcuts</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">Player · queue · moments</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-full text-ink-2 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-heat/70"
            aria-label="Close keyboard shortcuts"
          >
            <X size={17} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-2">
          <div className="gap-x-10 sm:columns-2">
            {shortcutsByGroup().map(({ group, entries }) => (
              <section key={group} className="mt-4 break-inside-avoid" aria-label={group}>
                <h3 className="eyebrow">{group}</h3>
                <dl className="mt-1">
                  {entries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-4 border-b border-white/[0.05] py-2">
                      <dt className="text-[13px] text-ink-2">{entry.label}</dt>
                      <dd>
                        <Keys entry={entry} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <p className="mt-5 text-[12px] leading-5 text-ink-3">
            On a touch screen: double-tap the sides to skip 10 s, touch and hold to watch at 2×, and use the bookmark button to save a moment.
          </p>
        </div>
      </div>
    </div>
  )
}
