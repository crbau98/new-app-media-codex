import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Pause, Play, Radio, ScanSearch, Sparkles } from 'lucide-react'
import type { LiveDiscoveryPayload } from '@/lib/api'
import type { Creator, MediaItem } from '@/lib/mockData'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

interface ImmersiveHeroProps {
  items: MediaItem[]
  creators: Creator[]
  discovery?: LiveDiscoveryPayload
  onWatch: (item: MediaItem) => void
  onExploreCreators: () => void
}

function usePerformanceMode(reduceMotion: boolean) {
  const [mode, setMode] = useState<'full' | 'lite'>('lite')

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      const constrained = Boolean(connection?.saveData)
        || (navigator.hardwareConcurrency || 8) <= 4
        || window.innerWidth < 768
        || reduceMotion
      setMode(reduced.matches || constrained ? 'lite' : 'full')
    }
    update()
    reduced.addEventListener('change', update)
    window.addEventListener('resize', update, { passive: true })
    return () => {
      reduced.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [reduceMotion])

  return mode
}

export default function ImmersiveHero({ items, creators, discovery, onWatch, onExploreCreators }: ImmersiveHeroProps) {
  const featured = useMemo(() => items.slice(0, 4), [items])
  const nodes = useMemo(() => creators.slice(0, 5), [creators])
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(true)
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState === 'visible')
  const sceneRef = useRef<HTMLElement>(null)
  const frameRef = useRef(0)
  const reduceMotion = useAppStore((state) => state.reduceMotion)
  const mode = usePerformanceMode(reduceMotion)
  const current = featured[index] || featured[0]

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.12 })
    observer.observe(scene)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    if (index >= featured.length) setIndex(0)
  }, [featured.length, index])

  useEffect(() => {
    if (paused || !visible || !documentVisible || mode === 'lite' || featured.length < 2) return
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % featured.length), 7000)
    return () => window.clearInterval(timer)
  }, [documentVisible, featured.length, mode, paused, visible])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (mode === 'lite' || event.pointerType === 'touch') return
    cancelAnimationFrame(frameRef.current)
    const element = event.currentTarget
    frameRef.current = requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2
      element.style.setProperty('--scene-rx', `${(-y * 2.4).toFixed(2)}deg`)
      element.style.setProperty('--scene-ry', `${(x * 3.5).toFixed(2)}deg`)
      element.style.setProperty('--scene-x', `${(x * 8).toFixed(1)}px`)
      element.style.setProperty('--scene-y', `${(y * 6).toFixed(1)}px`)
    })
  }, [mode])

  const resetPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(frameRef.current)
    event.currentTarget.style.setProperty('--scene-rx', '0deg')
    event.currentTarget.style.setProperty('--scene-ry', '0deg')
    event.currentTarget.style.setProperty('--scene-x', '0px')
    event.currentTarget.style.setProperty('--scene-y', '0px')
  }, [])

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  if (!current) {
    return (
      <section className="immersive-hero immersive-hero-empty" aria-busy="true">
        <div>
          <p className="signal-kicker"><Radio size={13} /> Establishing live signal</p>
          <h1>Building your creator constellation.</h1>
          <p>Public, source-attributed media will appear here as soon as the discovery network responds.</p>
        </div>
      </section>
    )
  }

  const connected = discovery
    ? discovery.counts.sourcesConnected ?? discovery.sources.filter((source) => source.state === 'connected').length
    : 1
  const suggested = discovery?.aiDiscovery.suggestedCreators || creators.filter((creator) => creator.isSimilar).length
  const aiActive = discovery?.aiDiscovery.state === 'model'

  return (
    <section
      ref={sceneRef}
      className={cn('immersive-hero', mode === 'lite' && 'immersive-hero-lite')}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetPointer}
      aria-labelledby="discovery-hero-title"
    >
      <div className="immersive-backdrop" aria-hidden="true">
        <div className="immersive-backdrop-shade" />
        <div className="immersive-grid" />
      </div>

      <div className="immersive-copy">
        <div className="signal-kicker"><span className="signal-pulse" /> Live discovery intelligence</div>
        <h1 id="discovery-hero-title">Find the signal.<br /><span>Follow the creator.</span></h1>
        <p className="immersive-lede">A living map of public creator media, ranked by transparent signals and shaped by your private taste profile.</p>

        <div className="immersive-actions">
          <button className="immersive-primary" onClick={() => onWatch(current)}>
            <Play size={16} fill="currentColor" /> Enter the feature
          </button>
          <button className="immersive-secondary" onClick={onExploreCreators}>
            Explore creators <ArrowUpRight size={16} />
          </button>
        </div>

        <div className="signal-metrics" aria-label="Live discovery status">
          <div><strong>{items.length}</strong><span>live signals</span></div>
          <div><strong>{connected}</strong><span>sources online</span></div>
          <div><strong>{suggested}</strong><span>AI matches</span></div>
          <div><strong>{aiActive ? 'Model' : 'Local'}</strong><span>ranking mode</span></div>
        </div>
      </div>

      <div className="immersive-stage" aria-hidden="true">
        <div className="signal-orbit signal-orbit-outer" />
        <div className="signal-orbit signal-orbit-inner" />
        <div className="signal-core">
          <div className="signal-core-surface" />
          <span><Sparkles size={12} /> {current.curationScore || 0} signal</span>
        </div>
        {nodes.map((creator, nodeIndex) => (
          <div key={creator.id} className={`signal-node signal-node-${nodeIndex + 1}`}>
            <img src={creator.avatar} alt="" loading="lazy" decoding="async" />
            <span>{creator.name}</span>
          </div>
        ))}
        <div className="signal-scanline" />
      </div>

      <div className="immersive-footer">
        <div className="immersive-feature-meta">
          <span>{String(index + 1).padStart(2, '0')} / {String(featured.length).padStart(2, '0')}</span>
          <div>
            <strong>{current.creator}</strong>
            <small>{current.source} · {current.isVideo ? current.duration || 'Video' : 'Photo'}</small>
          </div>
        </div>
        <div className="immersive-pagination" role="group" aria-label="Featured media">
          {featured.map((item, itemIndex) => (
            <button
              key={item.id}
              className={cn(itemIndex === index && 'is-active')}
              onClick={() => setIndex(itemIndex)}
              aria-label={`Show feature ${itemIndex + 1}: ${item.title}`}
              aria-pressed={itemIndex === index}
            />
          ))}
        </div>
        <button className="immersive-pause" onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Resume feature rotation' : 'Pause feature rotation'}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
        <div className="immersive-freshness"><ScanSearch size={14} /> Updated {discovery?.updatedAt ? new Date(discovery.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'live'}</div>
      </div>
    </section>
  )
}
