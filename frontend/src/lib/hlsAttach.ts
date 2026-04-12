import Hls from "hls.js"

/** True when the URL points at an HLS playlist (including proxied URLs that encode `.m3u8`). */
export function isHlsUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /m3u8/i.test(url)
}

export type AttachMediaOptions = {
  /** Call `video.play()` once the stream is ready (HLS manifest parsed or metadata loaded). */
  tryAutoplay?: boolean
}

/**
 * Attach progressive or HLS media to a &lt;video&gt; element. For `.m3u8` in Chrome/Firefox/Edge,
 * uses hls.js; Safari uses native HLS. Returns a cleanup to run before unmount or when `src` changes.
 */
export function attachMediaSource(video: HTMLVideoElement, src: string, options?: AttachMediaOptions): () => void {
  const tryAutoplay = options?.tryAutoplay ?? false
  video.removeAttribute("src")

  const tryPlay = () => {
    if (!tryAutoplay) return
    void video.play().catch(() => {})
  }

  if (!isHlsUrl(src)) {
    video.src = src
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta)
      tryPlay()
    }
    video.addEventListener("loadedmetadata", onMeta)
    return () => {
      video.removeEventListener("loadedmetadata", onMeta)
      video.removeAttribute("src")
      video.load()
    }
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src
    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta)
      tryPlay()
    }
    video.addEventListener("loadedmetadata", onMeta)
    return () => {
      video.removeEventListener("loadedmetadata", onMeta)
      video.removeAttribute("src")
      video.load()
    }
  }

  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false })
    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, tryPlay)
    return () => {
      hls.destroy()
      video.removeAttribute("src")
      video.load()
    }
  }

  video.src = src
  const onMeta = () => {
    video.removeEventListener("loadedmetadata", onMeta)
    tryPlay()
  }
  video.addEventListener("loadedmetadata", onMeta)
  return () => {
    video.removeEventListener("loadedmetadata", onMeta)
    video.removeAttribute("src")
    video.load()
  }
}
