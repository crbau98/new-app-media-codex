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
    <div className="adult-gate" role="dialog" aria-modal="true" aria-labelledby="adult-gate-title">
      <div className="adult-gate-grid" aria-hidden="true" />
      <div className="adult-gate-panel">
        <div className="gate-orbit" aria-hidden="true">
          <span /><span />
          <div><ShieldCheck size={27} /></div>
        </div>
        <p className="signal-kicker">Private discovery observatory</p>
        <h1 id="adult-gate-title">A space for adults.</h1>
        <p className="adult-gate-copy">Media Codex may display explicit content. Continue only if you are at least 18 and legally permitted to view adult material where you live.</p>
        <button autoFocus onClick={confirm} className="adult-gate-confirm">I’m 18 or older</button>
        <p className="adult-gate-note"><ShieldCheck size={12} /> Confirmation stays privately on this device</p>
      </div>
    </div>
  )
}
