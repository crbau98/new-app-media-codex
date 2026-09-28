import { useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  History,
  Keyboard,
  Monitor,
  Moon,
  Play,
  RotateCcw,
  Sparkles,
  Sun,
  Trash2,
  Type,
  Zap,
} from 'lucide-react'
import { useAppStore, type FontSize, type GridDensity, type Theme, type VideoQuality } from '@/store'
import type { DiscoveryMode } from '@/lib/discovery'
import { clearPrivateMediaData } from '@/lib/collections'
import { getSessionVitals } from '@/lib/vitals'
import { Segmented } from '@/components/discovery/Controls'
import { useHoverPreviewPref } from '@/components/discovery/prefs'
import { exportTasteProfile, importTasteProfile, isTasteLearningEnabled, resetTasteProfile, setTasteLearningEnabled } from '@/features/ai/taste/storage'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

function Section({
  icon: Icon,
  title,
  description,
  children,
  badge,
}: {
  icon: typeof Sun
  title: string
  description?: string
  children: ReactNode
  badge?: string
}) {
  return (
    <section className="d-set" aria-label={title}>
      <header className="d-set-head">
        <span className="d-set-icon" aria-hidden="true">
          <Icon size={17} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 className="d-set-title">
            {title}
            {badge && <span className="d-placeholder-tag">{badge}</span>}
          </h2>
          {description && <p className="d-set-desc">{description}</p>}
        </div>
      </header>
      <div>{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="d-set-row">
      <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
        <p className="d-set-label">{label}</p>
        {hint && <p className="d-set-hint">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span className="d-switch-wrap">
      <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="d-switch" />
    </span>
  )
}

function OptionChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: typeof Sun }[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div className="d-chips" style={{ flexWrap: 'wrap' }} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn('chip', value === option.value && 'chip-active')}
            aria-pressed={value === option.value}
          >
            {Icon && <Icon size={12} strokeWidth={1.75} aria-hidden="true" />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Big preview tiles: picking one applies it live, so the page itself is the preview. */
function ChoiceCards<T extends string>({
  value,
  onChange,
  ariaLabel,
  options,
}: {
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  options: { value: T; label: string; preview: ReactNode; icon?: ReactNode }[]
}) {
  return (
    <div className="d-choices" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" className="d-choice" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.preview}
          <span>
            {option.icon}
            {option.label}
          </span>
        </button>
      ))}
    </div>
  )
}

function MiniGrid({ columns, rows }: { columns: number; rows: number }) {
  return (
    <span className="d-mini d-mini-grid" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
      {Array.from({ length: columns * rows }).map((_, index) => (
        <i key={index} />
      ))}
    </span>
  )
}

export default function Settings() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const gridDensity = useAppStore((s) => s.gridDensity)
  const setGridDensity = useAppStore((s) => s.setGridDensity)
  const fontSize = useAppStore((s) => s.fontSize)
  const setFontSize = useAppStore((s) => s.setFontSize)
  const reduceMotion = useAppStore((s) => s.reduceMotion)
  const setReduceMotion = useAppStore((s) => s.setReduceMotion)
  const discoveryMode = useAppStore((s) => s.discoveryMode)
  const setDiscoveryMode = useAppStore((s) => s.setDiscoveryMode)
  const resetDiscoveryProfile = useAppStore((s) => s.resetDiscoveryProfile)
  const [tasteLearning, setTasteLearning] = useState(() => isTasteLearningEnabled())
  const tagPreferences = useAppStore((s) => s.tagPreferences)
  const creatorPreferences = useAppStore((s) => s.creatorPreferences)
  const hiddenMedia = useAppStore((s) => s.hiddenMedia)
  const autoplayVideos = useAppStore((s) => s.autoplayVideos)
  const setAutoplayVideos = useAppStore((s) => s.setAutoplayVideos)
  const defaultQuality = useAppStore((s) => s.defaultQuality)
  const setDefaultQuality = useAppStore((s) => s.setDefaultQuality)
  const muteOnStart = useAppStore((s) => s.muteOnStart)
  const setMuteOnStart = useAppStore((s) => s.setMuteOnStart)
  const pictureInPicture = useAppStore((s) => s.pictureInPicture)
  const setPictureInPicture = useAppStore((s) => s.setPictureInPicture)
  const recentlyViewed = useAppStore((s) => s.recentlyViewed)
  const likeCache = useAppStore((s) => s.likeCache)
  const followCache = useAppStore((s) => s.followCache)
  const creatorWatchlist = useAppStore((s) => s.creatorWatchlist)
  const setSearchQuery = useAppStore((s) => s.setSearchQuery)
  const wipeLocalData = useAppStore((s) => s.wipeLocalData)
  const addToast = useAppStore((s) => s.addToast)
  const [hoverPreview, setHoverPreview] = useHoverPreviewPref()

  const queryClient = useQueryClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Snapshot on mount: Settings is a lazy route, so each visit re-reads the session.
  const [sessionVitals] = useState(() => getSessionVitals())

  const stats = useMemo(
    () => ({
      viewed: recentlyViewed.length,
      likes: Object.values(likeCache).filter(Boolean).length,
      follows: Object.values(followCache).filter(Boolean).length,
      radar: creatorWatchlist.length,
    }),
    [creatorWatchlist, followCache, likeCache, recentlyViewed]
  )

  const feedback = useMemo(
    () => ({
      tags: Object.keys(tagPreferences).length,
      creators: Object.keys(creatorPreferences).length,
      hidden: hiddenMedia.length,
    }),
    [creatorPreferences, hiddenMedia, tagPreferences]
  )

  const clearRecentlyViewed = () => {
    useAppStore.setState({ recentlyViewed: [] })
    addToast({ type: 'success', title: 'Recently viewed cleared' })
  }

  const clearSearchHistory = () => {
    setSearchQuery('')
    addToast({ type: 'success', title: 'Search history cleared' })
  }

  const clearRecommendations = () => {
    clearPrivateMediaData()
    addToast({ type: 'success', title: 'Recommendations & watch progress cleared', message: 'Collections and resume points were removed from this device.' })
  }

  const exportData = () => {
    const state = useAppStore.getState()
    const payload = {
      exportedAt: new Date().toISOString(),
      preferences: {
        theme: state.theme,
        gridDensity: state.gridDensity,
        fontSize: state.fontSize,
        reduceMotion: state.reduceMotion,
        discoveryMode: state.discoveryMode,
        autoplayVideos: state.autoplayVideos,
        defaultQuality: state.defaultQuality,
        muteOnStart: state.muteOnStart,
        pictureInPicture: state.pictureInPicture,
      },
      activity: {
        recentlyViewed: state.recentlyViewed,
        likeCache: state.likeCache,
        followCache: state.followCache,
        creatorWatchlist: state.creatorWatchlist,
        tagPreferences: state.tagPreferences,
        creatorPreferences: state.creatorPreferences,
        hiddenMedia: state.hiddenMedia,
      },
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `media-codex-export-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    addToast({ type: 'success', title: 'Export downloaded', message: 'Everything the app stores about you, as JSON.' })
  }

  const deleteAccount = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    wipeLocalData()
    queryClient.clear()
    window.location.replace('/')
  }

  return (
    <div className="animate-page-enter d-page mx-auto w-full" style={{ maxWidth: 780 }}>
      <div className="d-hero">
        <div className="d-hero-row">
          <div className="min-w-0">
            <p className="d-eyebrow">Settings</p>
            <h1 className="d-page-title">Make it yours</h1>
            <p className="d-hero-desc">Everything here is stored locally on this device. Nothing is synced anywhere.</p>
          </div>
          <div className="d-motion-demo" data-off={reduceMotion} aria-hidden="true">
            <span />
          </div>
        </div>
      </div>

      {/* Appearance */}
      <Section icon={Sun} title="Appearance" description="Changes apply instantly — this page is the live preview.">
        <Row label="Theme" hint="Auto follows your system setting.">
          <ChoiceCards<Theme>
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark', icon: <Moon size={12} strokeWidth={1.75} aria-hidden="true" />, preview: <span className="d-mini d-mini-dark" aria-hidden="true"><i /><i /><i /></span> },
              { value: 'light', label: 'Light', icon: <Sun size={12} strokeWidth={1.75} aria-hidden="true" />, preview: <span className="d-mini d-mini-light" aria-hidden="true"><i /><i /><i /></span> },
              { value: 'auto', label: 'Auto', icon: <Monitor size={12} strokeWidth={1.75} aria-hidden="true" />, preview: <span className="d-mini d-mini-auto" aria-hidden="true"><i /><i /><i /></span> },
            ]}
          />
        </Row>
        <Row label="Grid density" hint="Applies to every media grid in the app.">
          <ChoiceCards<GridDensity>
            ariaLabel="Grid density"
            value={gridDensity}
            onChange={setGridDensity}
            options={[
              { value: 'compact', label: 'Compact', preview: <MiniGrid columns={5} rows={3} /> },
              { value: 'normal', label: 'Comfortable', preview: <MiniGrid columns={3} rows={2} /> },
              { value: 'spacious', label: 'Large', preview: <MiniGrid columns={2} rows={1} /> },
            ]}
          />
        </Row>
        <Row label="Font size">
          <OptionChips<FontSize>
            ariaLabel="Font size"
            value={fontSize}
            onChange={setFontSize}
            options={[
              { value: 'small', label: 'Small', icon: Type },
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Large' },
            ]}
          />
        </Row>
        <Row label="Reduce motion" hint="Turns off 3D tilt, parallax and hover previews' motion; keeps essential fades.">
          <Toggle checked={reduceMotion} onChange={setReduceMotion} label="Reduce motion" />
        </Row>
        <Row label="Hover previews" hint="Desktop only: muted looping preview after hovering a video. Off on touch and Data Saver.">
          <Toggle checked={hoverPreview} onChange={setHoverPreview} label="Hover previews" />
        </Row>
      </Section>

      {/* Discovery */}
      <Section icon={Zap} title="Discovery" description="Your recommendation profile is computed on this device from your follows, likes, and views.">
        <Row label="Discovery balance" hint="How adventurous your For You mix should be.">
          <Segmented<DiscoveryMode>
            ariaLabel="Discovery balance"
            value={discoveryMode}
            onChange={setDiscoveryMode}
            options={[
              { value: 'familiar', label: 'Familiar' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'adventurous', label: 'Adventurous' },
            ]}
          />
        </Row>
      </Section>

      {/* Personalization — INTEGRATION POINT
          The AI stream will export taste-profile reset/export helpers; wire them into the two
          rows below. Until then this section only uses existing store data and is otherwise inert. */}
      <Section
        icon={Fingerprint}
        title="Personalization"
        description={`Learned locally: ${feedback.tags} tags · ${feedback.creators} creators · ${feedback.hidden} hidden items.`}
      >
        <Row label="Clear feedback history" hint="Forgets what you liked, disliked or hid, and resets the discovery balance. Recommendations start fresh.">
          <button
            onClick={() => {
              resetDiscoveryProfile()
              addToast({ type: 'success', title: 'Recommendations reset', message: 'Your mix starts fresh.' })
            }}
            className="btn-secondary"
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /> Reset
          </button>
        </Row>
        <Row label="Learn from my activity" hint="Builds an on-device taste profile from likes, watch time and skips. Never leaves this device.">
          <Toggle checked={tasteLearning} onChange={(value) => { setTasteLearningEnabled(value); setTasteLearning(value) }} label="Learn from my activity" />
        </Row>
        <Row label="Taste profile" hint="Export a JSON backup, import one, or wipe the profile plus AI search and concierge history.">
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                const blob = new Blob([exportTasteProfile()], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'media-codex-taste.json'
                a.click()
                window.setTimeout(() => URL.revokeObjectURL(url), 1500)
              }}
            >
              <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" /> Export
            </button>
            <label className="btn-secondary cursor-pointer">
              Import
              <input
                type="file"
                accept="application/json"
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  const ok = importTasteProfile(await file.text())
                  addToast({ type: ok ? 'success' : 'error', title: ok ? 'Taste profile imported' : 'Not a valid taste profile' })
                }}
              />
            </label>
            <button
              className="btn-secondary"
              onClick={() => {
                resetTasteProfile()
                addToast({ type: 'success', title: 'Taste profile erased' })
              }}
            >
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /> Erase
            </button>
          </div>
        </Row>
      </Section>

      {/* Playback */}
      <Section icon={Play} title="Playback">
        <Row label="Autoplay videos" hint="Start playing when a detail sheet opens.">
          <Toggle checked={autoplayVideos} onChange={setAutoplayVideos} label="Autoplay videos" />
        </Row>
        <Row label="Default quality" hint="Preferred stream candidate when the source offers several.">
          <OptionChips<VideoQuality>
            ariaLabel="Default quality"
            value={defaultQuality}
            onChange={setDefaultQuality}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' },
            ]}
          />
        </Row>
        <Row label="Start muted">
          <Toggle checked={muteOnStart} onChange={setMuteOnStart} label="Start muted" />
        </Row>
        <Row label="Picture-in-picture">
          <Toggle checked={pictureInPicture} onChange={setPictureInPicture} label="Picture-in-picture" />
        </Row>
      </Section>

      {/* Privacy & data */}
      <Section
        icon={Eye}
        title="Privacy & data"
        description={`On this device: ${stats.viewed} viewed · ${stats.likes} liked · ${stats.follows} followed · ${stats.radar} on radar.`}
      >
        <Row label="Clear recently viewed" hint={`${stats.viewed} entries stored locally.`}>
          <button onClick={clearRecentlyViewed} className="btn-secondary">
            <History size={14} strokeWidth={1.75} aria-hidden="true" /> Clear
          </button>
        </Row>
        <Row label="Clear search history" hint="Removes the persisted search query from this device.">
          <button onClick={clearSearchHistory} className="btn-secondary">
            <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" /> Clear
          </button>
        </Row>
        <Row label="Clear recommendations & progress" hint="Removes collections, watch positions, and recommendation signals from this device.">
          <button onClick={clearRecommendations} className="btn-secondary">
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /> Clear
          </button>
        </Row>
        <Row label="Export my data" hint="Downloads every locally stored preference and activity record as JSON.">
          <button onClick={exportData} className="btn-secondary">
            <Download size={14} strokeWidth={1.75} aria-hidden="true" /> Export
          </button>
        </Row>
        <Row label="Delete account" hint="Wipes all local data — preferences, follows, likes, history — and reloads the app.">
          <button onClick={deleteAccount} className={confirmingDelete ? 'btn-heat' : 'btn-secondary'}>
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            {confirmingDelete ? 'Confirm wipe' : 'Delete account'}
          </button>
        </Row>
      </Section>

      {/* Session performance — local readout of this device's own metrics */}
      <Section
        icon={Zap}
        title="Session performance"
        description="This device's own Web Vitals for the current session. Anonymous samples go to diagnostics; nothing identifies you."
      >
        <div className="d-vitals">
          {([
            ['LCP', sessionVitals.LCP !== undefined ? `${(sessionVitals.LCP / 1000).toFixed(2)}s` : '—', 'Largest paint'],
            ['INP', sessionVitals.INP !== undefined ? `${sessionVitals.INP}ms` : '—', 'Interaction latency'],
            ['CLS', sessionVitals.CLS !== undefined ? (sessionVitals.CLS / 1000).toFixed(3) : '—', 'Layout shift'],
          ] as const).map(([label, value, hint]) => (
            <div key={label}>
              <p>{label}</p>
              <p>{value}</p>
              <p>{hint}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Keyboard shortcuts — exactly what is implemented */}
      <Section icon={Keyboard} title="Keyboard shortcuts">
        <div className="grid grid-cols-1 gap-x-8 px-5 py-2 sm:grid-cols-2">
          {[
            ['⌘K', 'Command palette'],
            ['/', 'Focus search'],
            ['T', 'Toggle theme'],
            ['← ↑ → ↓', 'Move between cards in a grid'],
            ['Home / End', 'Jump to first / last card in a row'],
            ['← / →  or  K / J', 'Previous / next item (detail sheet)'],
            ['F', 'Follow creator (detail sheet)'],
            ['S', 'Save item (detail sheet)'],
            ['Esc', 'Close sheet / palette / menu'],
          ].map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-0">
              <span className="text-[13px] text-ink-2">{action}</span>
              <kbd className="kbd shrink-0">{keys}</kbd>
            </div>
          ))}
        </div>
      </Section>

      {/* About */}
      <Section icon={Monitor} title="About">
        <div className="space-y-3 px-5 py-4">
          <p className="text-[13px] leading-5 text-ink-2">
            Media Codex is an after-hours cinema archive: an 18+ media discovery client that indexes
            public, source-attributed content and links back to the origin for every item. It hosts
            no media and stores your preferences only on this device.
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            Web client · Vite + React · Edge API on Vercel
          </p>
          <a
            href="https://github.com/crbau98/new-app-media-codex"
            target="_blank"
            rel="noreferrer"
            className="d-link"
          >
            Source on GitHub
          </a>
        </div>
      </Section>
    </div>
  )
}
