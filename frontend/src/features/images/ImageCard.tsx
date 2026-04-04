import { useState } from 'react'
import { Badge } from '@/components/Badge'
import type { ImageRecord } from '@/lib/api'

export function ImageCard({ img, onClick }: { img: ImageRecord; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const src = img.local_url || img.thumb_url || img.image_url

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      aria-label={`Open ${img.title || 'image'} in lightbox`}
      className="relative break-inside-avoid mb-3 rounded-xl overflow-hidden cursor-pointer group border border-border hover:border-accent/40 transition-all"
    >
      {!loaded && <div className="bg-bg-subtle h-40 animate-pulse" aria-hidden="true" />}
      <a
        href={img.local_url || img.image_url}
        download
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white"
        aria-label="Download image"
        target="_blank"
        rel="noreferrer"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </a>
      <img
        src={src}
        alt={img.title || ''}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
      />
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end"
        aria-hidden="true"
      >
        <p className="text-xs text-white line-clamp-2 mb-1">{img.title}</p>
        <div className="flex gap-1">
          <Badge variant="muted">{img.source_type}</Badge>
          {img.theme && <Badge variant="teal" mono>{img.theme}</Badge>}
        </div>
      </div>
    </div>
  )
}
