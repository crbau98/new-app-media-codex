import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import '@/styles/discovery.css'

export default function NotFound() {
  return (
    <div className="d-state mx-auto mt-12 max-w-xl animate-page-enter" role="status">
      <span className="d-state-halo" aria-hidden="true">
        <Compass size={24} strokeWidth={1.5} />
      </span>
      <p className="d-eyebrow">Error 404</p>
      <h1 className="d-state-title">Reel not found</h1>
      <p className="d-state-desc">This page is not in the archive. Head back to the library.</p>
      <div className="d-state-actions">
        <Link to="/media" className="btn-primary">
          Back to the library
        </Link>
        <Link to="/search" className="btn-secondary">
          Search instead
        </Link>
      </div>
    </div>
  )
}
