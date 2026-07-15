import { ShieldCheck } from 'lucide-react'

const STORAGE_KEY = 'media-codex-adult-confirmed'

export function hasAdultConfirmation(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export default function AdultGate({ onConfirm }: { onConfirm: () => void }) {
  const confirm = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true')
    } catch {
      // Storage can be unavailable in private/restricted browser contexts.
    }
    onConfirm()
  }

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#07070b]/95 p-5 backdrop-blur-xl" role="dialog" aria-modal="true" aria-labelledby="adult-gate-title">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#111118] p-7 text-center shadow-2xl">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent-dim)] text-[var(--accent)]"><ShieldCheck size={26} /></div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">Private media workspace</p>
        <h1 id="adult-gate-title" className="text-2xl font-bold tracking-tight text-white">For adults only</h1>
        <p className="mt-3 text-sm leading-6 text-white/60">Media Codex may display explicit content. Continue only if you are at least 18 and legally permitted to view adult material where you live.</p>
        <button autoFocus onClick={confirm} className="mt-7 min-h-12 w-full rounded-full bg-[var(--accent)] px-5 font-semibold text-white transition hover:bg-[var(--accent-hover)]">I’m 18 or older</button>
        <p className="mt-4 text-xs text-white/35">Your confirmation stays on this device.</p>
      </div>
    </div>
  )
}
