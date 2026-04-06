import { useEffect, useRef } from 'react'
import type { ImageRecord } from '@/lib/api'

export function Lightbox({
  img,
  onClose,
  onPrev,
  onNext,
}: {
  img: ImageRecord
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const onPrevRef = useRef(onPrev)
  const onNextRef = useRef(onNext)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => { onPrevRef.current = onPrev }, [onPrev])
  useEffect(() => { onNextRef.current = onNext }, [onNext])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      if (e.key === 'ArrowLeft') onPrevRef.current?.()
      if (e.key === 'ArrowRight') onNextRef.current?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const src = img.local_url || img.image_url

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image lightbox: ${img.title || 'image'}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 outline-none"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <a
          href={img.local_url || img.image_url}
          download
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="Download image"
          target="_blank"
          rel="noreferrer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
        <button
          aria-label="Close lightbox"
          className="text-white/70 hover:text-white text-2xl p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors leading-none"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {onPrev && (
        <button
          aria-label="Previous image"
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-2xl px-2"
          onClick={(e) => { e.stopPropagation(); onPrev() }}
        >
          ‹
        </button>
      )}
      {onNext && (
        <button
          aria-label="Next image"
          className="absolute right-14 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-2xl px-2"
          onClick={(e) => { e.stopPropagation(); onNext() }}
        >
          ›
        </button>
      )}
      <img
        src={src}
        alt={img.title || ''}
        decoding="async"
        fetchPriority="high"
        className="max-h-[85vh] max-w-full rounded-xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center text-white/80 text-sm max-w-lg px-4" onClick={(e) => e.stopPropagation()}>
        <p>{img.title}</p>
        <p className="text-xs text-white/50 font-mono mt-1">{img.source_type} · {img.theme}</p>
      </div>
    </div>
  )
}
