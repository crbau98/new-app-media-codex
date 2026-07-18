import { useState } from 'react'
import GrainOverlay from './GrainOverlay'

const STORAGE_KEY = 'media-codex-adult-verified'

/**
 * 18+ age gate. Matte canvas, film grain, mono legal copy, one off-white
 * primary action and an Exit link. State persists to localStorage.
 */
export default function AdultGate({ children }: { children: React.ReactNode }) {
  const [confirmed, setConfirmed] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  const confirm = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // storage unavailable — session-only confirmation
    }
    setConfirmed(true)
  }

  if (confirmed) return <>{children}</>

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-canvas px-4">
      <GrainOverlay />
      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-2.5">
          <span className="block h-2 w-2 bg-heat" aria-hidden="true" />
          <span className="text-[15px] font-bold tracking-[-0.02em] text-ink">Codex</span>
        </div>

        <h1 className="mt-8 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">
          Adult content — 18+ only
        </h1>
        <p className="mt-4 text-sm leading-6 text-ink-2">
          This is an adult media discovery archive. By entering you confirm that you are at least 18
          years old (or the age of majority in your jurisdiction), that adult material is legal where
          you live, and that you are choosing to view it. Every item links back to its public source.
        </p>

        <button onClick={confirm} className="btn-primary mt-8 w-full min-h-11">
          I am 18 or older — enter
        </button>
        <a
          href="https://www.google.com"
          className="mt-3 block text-center font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3 underline-offset-4 hover:text-ink hover:underline"
        >
          Exit
        </a>
        <p className="mt-8 font-mono text-[10px] leading-4 text-ink-3">
          Codex does not host media. It indexes public, source-attributed content for adults.
        </p>
      </div>
    </div>
  )
}
