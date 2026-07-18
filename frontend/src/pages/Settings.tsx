import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Download,
  Eye,
  EyeOff,
  History,
  Keyboard,
  LayoutGrid,
  Monitor,
  Moon,
  Play,
  RotateCcw,
  Sun,
  Trash2,
  Type,
  Zap,
} from 'lucide-react'
import { useAppStore, type FontSize, type GridDensity, type Theme, type VideoQuality } from '@/store'
import type { DiscoveryMode } from '@/lib/discovery'
import { cn } from '@/lib/utils'

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Sun
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-md border border-line">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <Icon size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
        <div>
          <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink">{title}</h2>
          {description && <p className="mt-1 text-[13px] leading-5 text-ink-2">{description}</p>}
        </div>
      </header>
      <div className="divide-y divide-line">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[56px] flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-4 text-ink-3">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 rounded-full border transition-colors',
        checked ? 'border-heat bg-heat' : 'border-line-strong bg-sunken'
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-ink transition-all',
          checked ? 'left-[calc(100%-1.25rem)] bg-canvas' : 'left-1 bg-ink-2'
        )}
        aria-hidden="true"
      />
    </button>
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
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn('chip !min-h-10 !px-3', value === option.value && 'chip-active')}
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

  const queryClient = useQueryClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const stats = useMemo(
    () => ({
      viewed: recentlyViewed.length,
      likes: Object.values(likeCache).filter(Boolean).length,
      follows: Object.values(followCache).filter(Boolean).length,
      radar: creatorWatchlist.length,
    }),
    [creatorWatchlist, followCache, likeCache, recentlyViewed]
  )

  const clearRecentlyViewed = () => {
    useAppStore.setState({ recentlyViewed: [] })
    addToast({ type: 'success', title: 'Recently viewed cleared' })
  }

  const clearSearchHistory = () => {
    setSearchQuery('')
    addToast({ type: 'success', title: 'Search history cleared' })
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
    <div className="animate-page-enter mx-auto max-w-2xl space-y-6">
      <div className="border-b border-line pb-5">
        <p className="eyebrow">Settings</p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-ink">Settings</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          Everything here is stored locally on this device. Nothing is synced anywhere.
        </p>
      </div>

      {/* Appearance */}
      <Section icon={Sun} title="Appearance">
        <Row label="Theme" hint="Auto follows your system setting.">
          <OptionChips<Theme>
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark', icon: Moon },
              { value: 'light', label: 'Light', icon: Sun },
              { value: 'auto', label: 'Auto', icon: Monitor },
            ]}
          />
        </Row>
        <Row label="Grid density" hint="Applies to every media grid in the app.">
          <OptionChips<GridDensity>
            ariaLabel="Grid density"
            value={gridDensity}
            onChange={setGridDensity}
            options={[
              { value: 'compact', label: 'Compact', icon: LayoutGrid },
              { value: 'normal', label: 'Normal' },
              { value: 'spacious', label: 'Spacious' },
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
        <Row label="Reduce motion" hint="Disables animation beyond essential fades.">
          <Toggle checked={reduceMotion} onChange={setReduceMotion} label="Reduce motion" />
        </Row>
      </Section>

      {/* Discovery */}
      <Section
        icon={Zap}
        title="Discovery"
        description="Your recommendation profile is computed on this device from your follows, likes, and views."
      >
        <Row label="Discovery balance" hint="How adventurous your For You mix should be.">
          <OptionChips<DiscoveryMode>
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
        <Row label="Reset recommendations" hint="Clears your learned tag and creator preferences.">
          <button
            onClick={() => {
              resetDiscoveryProfile()
              addToast({ type: 'success', title: 'Recommendations reset', message: 'Your mix starts fresh.' })
            }}
            className="btn-secondary min-h-10"
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" /> Reset
          </button>
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
          <button onClick={clearRecentlyViewed} className="btn-secondary min-h-10">
            <History size={14} strokeWidth={1.75} aria-hidden="true" /> Clear
          </button>
        </Row>
        <Row label="Clear search history" hint="Removes the persisted search query from this device.">
          <button onClick={clearSearchHistory} className="btn-secondary min-h-10">
            <EyeOff size={14} strokeWidth={1.75} aria-hidden="true" /> Clear
          </button>
        </Row>
        <Row label="Export my data" hint="Downloads every locally stored preference and activity record as JSON.">
          <button onClick={exportData} className="btn-secondary min-h-10">
            <Download size={14} strokeWidth={1.75} aria-hidden="true" /> Export
          </button>
        </Row>
        <Row
          label="Delete account"
          hint="Wipes all local data — preferences, follows, likes, history — and reloads the app."
        >
          <button
            onClick={deleteAccount}
            className={cn('min-h-10', confirmingDelete ? 'btn-heat' : 'btn-secondary')}
          >
            <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
            {confirmingDelete ? 'Confirm wipe' : 'Delete account'}
          </button>
        </Row>
      </Section>

      {/* Keyboard shortcuts — exactly what is implemented */}
      <Section icon={Keyboard} title="Keyboard shortcuts">
        <div className="grid grid-cols-1 gap-x-6 px-4 py-3 sm:grid-cols-2">
          {[
            ['⌘K', 'Command palette'],
            ['/', 'Focus search'],
            ['T', 'Toggle theme'],
            ['← / →  or  K / J', 'Previous / next item (detail sheet)'],
            ['F', 'Follow creator (detail sheet)'],
            ['S', 'Save item (detail sheet)'],
            ['Esc', 'Close sheet / palette / menu'],
          ].map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between gap-4 border-b border-line py-2.5 last:border-0">
              <span className="text-[13px] text-ink-2">{action}</span>
              <kbd className="kbd shrink-0">{keys}</kbd>
            </div>
          ))}
        </div>
      </Section>

      {/* About */}
      <Section icon={Monitor} title="About">
        <div className="space-y-3 px-4 py-4">
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
            className="inline-flex min-h-10 items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 underline-offset-4 hover:text-ink hover:underline"
          >
            Source on GitHub
          </a>
        </div>
      </Section>
    </div>
  )
}
