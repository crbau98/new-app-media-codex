import { useEffect, useRef, useState } from 'react'
import GrainOverlay from './GrainOverlay'
import AuroraBackground from './three/AuroraBackground'
import BrandMark from './chrome/BrandMark'

const STORAGE_KEY = 'media-codex-adult-verified'

/**
 * 18+ age gate. A velvet splash: live aurora behind a glass card, gold seal,
 * display-serif headline, mono legal copy, one primary action and an Exit
 * link. State persists to localStorage under the same key as always.
 */
export default function AdultGate({ children }: { children: React.ReactNode }) {
  const [confirmed, setConfirmed] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const enterRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!confirmed) enterRef.current?.focus({ preventScroll: true })
  }, [confirmed])

  const confirm = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // storage unavailable — session-only confirmation
    }
    setConfirmed(true)
  }

  if (confirmed) return <>{children}</>

  const stagger = (n: number) => ({ animationDelay: `${120 + n * 90}ms` })

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto overflow-x-hidden bg-canvas px-4 py-10 safe-pt safe-pb"
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
    >
      <AuroraBackground intensity={1.15} resolution={0.5} />
      <GrainOverlay />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_45%,transparent,rgb(var(--canvas)/0.55))]" aria-hidden="true" />

      <div className="glass-strong spectrum-border relative w-full max-w-md rounded-[28px] p-8 text-center shadow-overlay sm:p-10">
        <div className="animate-page-enter flex justify-center" style={stagger(0)}>
          <BrandMark size={44} wordmark />
        </div>

        <div className="animate-page-enter mx-auto mt-8 grid h-16 w-16 place-items-center rounded-full hairline-gold bg-gold-dim" style={stagger(1)} aria-hidden="true">
          <span className="font-display text-[22px] font-medium tracking-tight text-gold-ink">18+</span>
        </div>

        <h1 id="age-gate-title" className="animate-page-enter display-title mt-6 text-[34px] text-ink sm:text-[40px]" style={stagger(2)}>
          For <span className="spectrum-text italic">adults</span> only
        </h1>
        <p className="animate-page-enter mt-4 text-sm leading-6 text-ink-2" style={stagger(3)}>
          This is an adult media discovery archive. By entering you confirm that you are at least 18
          years old (or the age of majority in your jurisdiction), that adult material is legal where
          you live, and that you are choosing to view it. Every item links back to its public source.
        </p>

        <div className="animate-page-enter" style={stagger(4)}>
          <button ref={enterRef} onClick={confirm} className="btn-primary mt-8 w-full min-h-12 text-[14px]">
            I am 18 or older — enter
          </button>
          <a
            href="https://www.google.com"
            className="mt-4 inline-flex min-h-11 items-center justify-center px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 underline-offset-4 hover:text-ink hover:underline"
          >
            Exit
          </a>
        </div>
        <p className="animate-page-enter mt-5 font-mono text-[10px] leading-4 tracking-wide text-ink-3" style={stagger(5)}>
          Codex does not host media. It indexes public, source-attributed content for adults.
        </p>
      </div>
    </div>
  )
}
