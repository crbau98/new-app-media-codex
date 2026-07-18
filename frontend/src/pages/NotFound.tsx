import { Link } from 'react-router'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="empty-state-panel mt-16">
      <Compass size={16} strokeWidth={1.75} className="text-ink-3" aria-hidden="true" />
      <h1 className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-ink">404 — reel not found</h1>
      <p className="max-w-md text-[13px] leading-5 text-ink-2">
        This page is not in the archive. Head back to the library.
      </p>
      <Link to="/media" className="btn-primary mt-1">
        Back to the library
      </Link>
    </div>
  )
}
