import { useState } from 'react'
import { Badge } from '@/components/Badge'
import type { ImageRecord } from '@/lib/api'
import { resolvePublicUrl } from '@/lib/backendOrigin'

function isVideoSrc(src: string) {
  return /\.(mp4|webm|mov)$/i.test(src)
}

export function ImageCard({ img, onClick }: { img: ImageRecord; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const src = resolvePublicUrl(img.local_url || img.thumb_url || img.image_url)
  const isVideo = src ? isVideoSrc(src) : false

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      aria-label={`Open ${img.title || 'image'} in lightbox`}
      className="relative break-inside-avoid mb-2 overflow-hidden rounded-2xl cursor-pointer group border border-white/[0.06] hover:border-white/[0.15] transition-all duration-200"
    >
      {src && !loaded && <div className="bg-white/[0.03] h-40 shimmer" aria-hidden="true" />}

      {/* Video badge */}
      {isVideo && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 backdrop-blur-sm">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span className="text-[10px] font-medium text-white">Video</span>
        </div>
      )}

      {/* Download button */}
      <a
        href={resolvePublicUrl(img.local_url || img.image_url)}
        download
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 p-1.5 rounded-lg bg-black/50 hover:bg-black/70 text-white backdrop-blur-sm"
        aria-label="Download"
        target="_blank"
        rel="noreferrer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </a>

      {src ? (
        <img
          src={src}
          alt={img.title || ''}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          className={`w-full object-cover transition-all duration-300 group-hover:scale-[1.03] ${loaded ? 'opacity-100' : 'opacity-0'}`}
          loading="lazy"
          decoding="async"
          fetchPriority="low"
        />
      ) : (
        <div className="bg-white/[0.03] h-40 flex items-center justify-center text-white/20">
          {isVideo ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          )}
        </div>
      )}

      {/* Hover overlay */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-3 flex flex-col justify-end"
        aria-hidden="true"
      >
        {img.title && <p className="text-[11px] font-medium text-white line-clamp-1 mb-1">{img.title}</p>}
        <div className="flex gap-1">
          <Badge variant="muted">{img.source_type}</Badge>
          {img.theme && <Badge variant="teal" mono>{img.theme}</Badge>}
        </div>
      </div>
    </div>
  )
}
