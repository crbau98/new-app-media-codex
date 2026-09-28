import { useEffect, useRef } from 'react'

interface HoverPreviewVideoProps {
  src: string
  ready: boolean
  onReady: () => void
  onFail: () => void
}

/**
 * Muted, looping inline preview. It owns the teardown contract: on unmount
 * (mouse leave, scroll, another card claiming the slot) the element is
 * paused and its source detached so the decoder and network are released.
 */
export default function HoverPreviewVideo({ src, ready, onReady, onFail }: HoverPreviewVideoProps) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    video.muted = true
    video.play().catch(onFail)
    return () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [src, onFail])

  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      disablePictureInPicture
      className="d-preview"
      data-ready={ready ? 'true' : 'false'}
      onPlaying={onReady}
      onError={onFail}
    />
  )
}
