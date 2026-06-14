import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '@/store'
import {
  Moon,
  Sun,
  Monitor,
  Heart,
  Star,
  ExternalLink,
  Github,
  Mail,
  FileText,
  Shield,
  ChevronDown,
  ChevronUp,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ───────────────────────────────────────────────
   Reusable UI Components
   ────────────────────────────────────────────── */

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-surface)]',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-[var(--text-primary)] shadow-sm transition-transform duration-200',
          checked && 'translate-x-5'
        )}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />
    </button>
  )
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T; icon?: React.ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex items-center bg-[var(--bg-surface)] rounded-md p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'relative px-3 py-1.5 text-[13px] font-medium rounded-sm transition-colors duration-150 flex items-center gap-1.5',
            value === opt.value
              ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          {opt.icon && <span className="w-3.5 h-3.5">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function RadioGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T; icon?: React.ReactNode }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-4">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span
            className={cn(
              'w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors duration-150',
              value === opt.value
                ? 'border-[var(--accent)]'
                : 'border-[var(--border-medium)]'
            )}
          >
            {value === opt.value && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  duration: 0.15,
                  ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
                }}
                className="w-2 h-2 rounded-full bg-[var(--accent)]"
              />
            )}
          </span>
          {opt.icon && <span className="w-4 h-4">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function Dropdown<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const selected = options.find((o) => o.value === value)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] rounded-md text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors min-w-[120px] justify-between"
      >
        {selected?.label}
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-md shadow-lg z-50 min-w-[160px] overflow-hidden"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'w-full text-left px-3 py-2 text-[13px] transition-colors',
                  value === opt.value
                    ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]'
                )}
              >
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SettingRow({
  label,
  description,
  children,
  disabled = false,
}: {
  label: string
  description?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-3',
        disabled && 'opacity-50'
      )}
    >
      <div className="flex-1 min-w-0">
        <h4 className="text-[14px] font-semibold text-[var(--text-primary)]">{label}</h4>
        {description && (
          <p className="text-[13px] text-[var(--text-secondary)] mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SectionCard({
  eyebrow,
  title,
  description,
  children,
  delay = 0,
}: {
  eyebrow: string
  title: string
  description?: string
  children: React.ReactNode
  delay?: number
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="bg-[var(--bg-elevated)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-6"
    >
      <div className="mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent)]">
          {eyebrow}
        </span>
        <h2 className="text-[18px] font-semibold text-[var(--text-primary)] mt-1">{title}</h2>
        {description && (
          <p className="text-[13px] text-[var(--text-secondary)] mt-1">{description}</p>
        )}
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">{children}</div>
    </motion.section>
  )
}

/* ───────────────────────────────────────────────
   Color swatches
   ────────────────────────────────────────────── */

const ACCENT_COLORS: { name: string; value: string; key: string }[] = [
  { name: 'Rose', value: '#e879a9', key: 'rose' },
  { name: 'Purple', value: '#a78bfa', key: 'purple' },
  { name: 'Teal', value: '#2dd4bf', key: 'teal' },
  { name: 'Amber', value: '#fbbf24', key: 'amber' },
  { name: 'Blue', value: '#60a5fa', key: 'blue' },
  { name: 'Green', value: '#34d399', key: 'green' },
]

/* ───────────────────────────────────────────────
   Modal
   ────────────────────────────────────────────── */

function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'destructive',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  confirmVariant?: 'destructive' | 'accent'
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'var(--bg-overlay)' }}
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{
              duration: 0.2,
              ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
            }}
            className="bg-[var(--bg-elevated)] rounded-[var(--radius-lg)] max-w-[400px] w-full p-6 border border-[var(--border-subtle)] shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[18px] font-semibold text-[var(--text-primary)]">{title}</h3>
            <p className="text-[14px] text-[var(--text-secondary)] mt-2">{description}</p>
            <div className="flex items-center justify-end gap-3 mt-6">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className={cn(
                  'px-4 py-2 text-[13px] font-medium rounded-md text-white transition-colors',
                  confirmVariant === 'destructive'
                    ? 'bg-[var(--error)] hover:bg-red-400'
                    : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────────────────────────────────────────────
   Main Settings Page
   ────────────────────────────────────────────── */

export function SettingsPage() {
  const store = useAppStore()
  const addToast = useAppStore((s) => s.addToast)

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [clearRecentModalOpen, setClearRecentModalOpen] = useState(false)
  const [clearSearchModalOpen, setClearSearchModalOpen] = useState(false)
  const [shortcutsExpanded, setShortcutsExpanded] = useState(false)

  const handleClearRecent = useCallback(() => {
    useAppStore.setState({ recentlyViewed: [] })
    addToast({ type: 'success', title: 'Recently viewed cleared' })
    setClearRecentModalOpen(false)
  }, [addToast])

  const handleClearSearch = useCallback(() => {
    useAppStore.setState({ filters: { ...useAppStore.getState().filters, search: '' } })
    addToast({ type: 'success', title: 'Search history cleared' })
    setClearSearchModalOpen(false)
  }, [addToast])

  const handleExportData = useCallback(() => {
    const data = {
      mediaCount: 68,
      creatorsCount: 12,
      favorites: Object.entries(store.likeCache)
        .filter(([, v]) => v)
        .map(([k]) => k),
      recentlyViewed: store.recentlyViewed,
      exportDate: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'media-codex-export.json'
    a.click()
    URL.revokeObjectURL(url)
    addToast({ type: 'success', title: 'Data exported successfully' })
  }, [store.likeCache, store.recentlyViewed, addToast])

  const handleDeleteAccount = useCallback(() => {
    addToast({ type: 'error', title: 'Account deletion requested', message: 'This would trigger a real deletion in production.' })
    setDeleteModalOpen(false)
  }, [addToast])

  const timeOptions = Array.from({ length: 24 }, (_, i) => {
    const h = i.toString().padStart(2, '0')
    return { label: `${h}:00`, value: `${h}:00` }
  })

  return (
    <div className="min-h-[100dvh] pb-20">
      <div className="max-w-[720px] mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.3,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
        >
          <h1 className="text-[clamp(24px,3vw,36px)] font-bold text-[var(--text-primary)] tracking-tight">
            Settings
          </h1>
          <p className="text-[14px] text-[var(--text-secondary)] mt-1">
            Manage your app preferences and account
          </p>
        </motion.div>

        {/* ── Section 1: Appearance ── */}
        <SectionCard eyebrow="Look & Feel" title="Appearance" description="Customize how Media Codex looks" delay={0.08}>
          <SettingRow label="Theme" description="Choose your preferred color scheme">
            <RadioGroup
              options={[
                { label: 'Dark', value: 'dark', icon: <Moon size={14} /> },
                { label: 'Light', value: 'light', icon: <Sun size={14} /> },
                { label: 'Auto', value: 'auto', icon: <Monitor size={14} /> },
              ]}
              value={store.theme}
              onChange={(v) => {
                if (v === 'auto') {
                  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
                  store.setTheme(prefersDark ? 'dark' : 'light')
                } else {
                  store.setTheme(v)
                }
              }}
            />
          </SettingRow>

          <SettingRow label="Accent Color" description="Pick a color that matches your style">
            <div className="flex items-center gap-2">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => store.setAccentColor(c.key as typeof store.accentColor)}
                  aria-label={`Select ${c.name} accent`}
                  className={cn(
                    'w-7 h-7 rounded-full transition-all duration-150 flex items-center justify-center',
                    store.accentColor === c.key
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-elevated)] scale-110'
                      : 'hover:scale-105'
                  )}
                  style={{ backgroundColor: c.value }}
                >
                  {store.accentColor === c.key && (
                    <Check size={14} className="text-white" strokeWidth={3} />
                  )}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow label="Grid Density" description="Control how compact the media grid appears">
            <SegmentedControl
              options={[
                { label: 'Compact', value: 'compact' },
                { label: 'Normal', value: 'normal' },
                { label: 'Spacious', value: 'spacious' },
              ]}
              value={store.gridDensity}
              onChange={(v) => store.setGridDensity(v)}
            />
          </SettingRow>

          <SettingRow label="Font Size" description="Adjust the base text size throughout the app">
            <SegmentedControl
              options={[
                { label: 'Small', value: 'small' },
                { label: 'Default', value: 'default' },
                { label: 'Large', value: 'large' },
              ]}
              value={store.fontSize}
              onChange={(v) => store.setFontSize(v)}
            />
          </SettingRow>

          <SettingRow label="Reduce Motion" description="Disable animations and transitions system-wide">
            <ToggleSwitch checked={store.reduceMotion} onChange={(v) => store.setReduceMotion(v)} />
          </SettingRow>

          {/* Preview card */}
          <div className="pt-3">
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-surface)] p-4 border border-[var(--border-subtle)]">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-[var(--radius-md)] flex items-center justify-center"
                  style={{ backgroundColor: ACCENT_COLORS.find((c) => c.key === store.accentColor)?.value }}
                >
                  <Star size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">Theme Preview</p>
                  <p className="text-[12px] text-[var(--text-tertiary)]">
                    {store.theme === 'dark' ? 'Dark' : store.theme === 'light' ? 'Light' : 'Auto'} mode &middot;{' '}
                    {ACCENT_COLORS.find((c) => c.key === store.accentColor)?.name} accent &middot;{' '}
                    {store.gridDensity} grid
                  </p>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* ── Section 2: Playback ── */}
        <SectionCard eyebrow="Media" title="Playback" description="Control how videos and media behave" delay={0.16}>
          <SettingRow label="Autoplay Videos" description="Start playing videos automatically when opened">
            <ToggleSwitch checked={store.autoplayVideos} onChange={(v) => store.setAutoplayVideos(v)} />
          </SettingRow>

          <SettingRow label="Default Video Quality" description="Preferred resolution for video playback">
            <Dropdown
              options={[
                { label: 'Auto', value: 'auto' },
                { label: '720p', value: '720p' },
                { label: '1080p', value: '1080p' },
                { label: '4K', value: '4K' },
              ]}
              value={store.defaultQuality}
              onChange={(v) => store.setDefaultQuality(v)}
            />
          </SettingRow>

          <SettingRow label="Mute on Start" description="Videos load with sound disabled by default">
            <ToggleSwitch checked={store.muteOnStart} onChange={(v) => store.setMuteOnStart(v)} />
          </SettingRow>

          <SettingRow label="Picture-in-Picture" description="Allow floating video player while browsing">
            <ToggleSwitch checked={store.pictureInPicture} onChange={(v) => store.setPictureInPicture(v)} />
          </SettingRow>

          <SettingRow label="Preferred Player" description="How media opens when you click an item">
            <SegmentedControl
              options={[
                { label: 'Inline', value: 'inline' },
                { label: 'Lightbox', value: 'lightbox' },
                { label: 'External', value: 'external' },
              ]}
              value={store.preferredPlayer}
              onChange={(v) => store.setPreferredPlayer(v)}
            />
          </SettingRow>
        </SectionCard>

        {/* ── Section 3: Notifications ── */}
        <SectionCard eyebrow="Alerts" title="Notifications" description="Choose what you want to be notified about" delay={0.24}>
          <SettingRow label="Enable Notifications" description="Master switch for all push notifications">
            <ToggleSwitch checked={store.notificationsEnabled} onChange={(v) => store.setNotificationsEnabled(v)} />
          </SettingRow>

          <SettingRow label="New Media from Followed Creators" description="Get alerted when creators you follow add content">
            <ToggleSwitch
              checked={store.notifyCreatorUpdates}
              onChange={(v) => store.setNotifyCreatorUpdates(v)}
              disabled={!store.notificationsEnabled}
            />
          </SettingRow>

          <SettingRow label="Comments and Replies" description="Notifications for interactions on your activity">
            <ToggleSwitch
              checked={store.notifyNewMedia}
              onChange={(v) => store.setNotifyNewMedia(v)}
              disabled={!store.notificationsEnabled}
            />
          </SettingRow>

          <SettingRow label="Trending Alerts" description="Notify when items start trending in the community">
            <ToggleSwitch
              checked={store.notifyTrending}
              onChange={(v) => store.setNotifyTrending(v)}
              disabled={!store.notificationsEnabled}
            />
          </SettingRow>

          <SettingRow label="Crawl Completed" description="Alert when background media crawling finishes">
            <ToggleSwitch
              checked={store.notifyCrawlCompleted}
              onChange={(v) => store.setNotifyCrawlCompleted(v)}
              disabled={!store.notificationsEnabled}
            />
          </SettingRow>

          <SettingRow label="Quiet Hours" description="Pause notifications during these hours">
            <div className="flex items-center gap-2">
              <Dropdown options={timeOptions} value={store.quietHoursStart} onChange={(v) => store.setQuietHoursStart(v)} />
              <span className="text-[var(--text-tertiary)]">–</span>
              <Dropdown options={timeOptions} value={store.quietHoursEnd} onChange={(v) => store.setQuietHoursEnd(v)} />
            </div>
          </SettingRow>
        </SectionCard>

        {/* ── Section 4: Privacy ── */}
        <SectionCard eyebrow="Security" title="Privacy & Data" description="Manage your data and visibility" delay={0.32}>
          <SettingRow label="Private Profile" description="Hide your profile and activity from other users">
            <ToggleSwitch checked={store.privateProfile} onChange={(v) => store.setPrivateProfile(v)} />
          </SettingRow>

          <SettingRow label="Hide Activity Status" description="Don&apos;t show when you&apos;re online or active">
            <ToggleSwitch checked={store.hideActivityStatus} onChange={(v) => store.setHideActivityStatus(v)} />
          </SettingRow>

          <SettingRow label="Clear Recently Viewed" description="Remove all items from your recently viewed history">
            <button
              onClick={() => setClearRecentModalOpen(true)}
              className="px-3 py-1.5 text-[13px] font-medium text-[var(--error)] hover:bg-[var(--error)]/10 rounded-md transition-colors"
            >
              Clear
            </button>
          </SettingRow>

          <SettingRow label="Clear Search History" description="Delete all saved search queries">
            <button
              onClick={() => setClearSearchModalOpen(true)}
              className="px-3 py-1.5 text-[13px] font-medium text-[var(--error)] hover:bg-[var(--error)]/10 rounded-md transition-colors"
            >
              Clear
            </button>
          </SettingRow>

          <SettingRow label="Export Your Data" description="Download a JSON file with your library metadata">
            <button
              onClick={handleExportData}
              className="px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-md transition-colors border border-[var(--border-subtle)]"
            >
              Export
            </button>
          </SettingRow>

          <SettingRow label="Delete Account" description="Permanently remove your account and all data. This cannot be undone.">
            <button
              onClick={() => setDeleteModalOpen(true)}
              className="px-3 py-1.5 text-[13px] font-medium text-white bg-[var(--error)] hover:bg-red-400 rounded-md transition-colors"
            >
              Delete Account
            </button>
          </SettingRow>
        </SectionCard>

        {/* ── Section 5: Keyboard Shortcuts ── */}
        <SectionCard eyebrow="Input" title="Keyboard Shortcuts" description="Speed up your workflow with hotkeys" delay={0.4}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 py-3">
            {[
              { keys: ['?'], action: 'Show shortcuts' },
              { keys: ['/'], action: 'Search' },
              { keys: ['J'], action: 'Next item' },
              { keys: ['K'], action: 'Previous item' },
              { keys: ['L'], action: 'Like' },
              { keys: ['F'], action: 'Favorite' },
              { keys: ['S'], action: 'Share' },
              { keys: ['Esc'], action: 'Close modal / drawer' },
              { keys: ['Space'], action: 'Play / Pause' },
              { keys: ['M'], action: 'Mute' },
              { keys: ['↑', '↓'], action: 'Scroll up / down' },
            ].map((shortcut) => (
              <div key={shortcut.action} className="flex items-center gap-3">
                <div className="flex items-center gap-1 shrink-0">
                  {shortcut.keys.map((k, i) => (
                    <span key={`${k}-${i}`} className="kbd">
                      {k}
                    </span>
                  ))}
                </div>
                <span className="text-[13px] text-[var(--text-secondary)]">{shortcut.action}</span>
              </div>
            ))}
          </div>

          {/* Expandable full list */}
          <div className="pt-2">
            <button
              onClick={() => setShortcutsExpanded(!shortcutsExpanded)}
              className="flex items-center gap-1 text-[13px] font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
            >
              {shortcutsExpanded ? 'Hide all shortcuts' : 'View all shortcuts'}
              {shortcutsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <AnimatePresence>
              {shortcutsExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-3">
                    {[
                      { keys: ['⌘', 'K'], action: 'Open command palette' },
                      { keys: ['⌘', '/'], action: 'Show keyboard shortcuts' },
                      { keys: ['Shift', 'Click'], action: 'Bulk select items' },
                      { keys: ['←', '→'], action: 'Seek -5s / +5s (video)' },
                      { keys: ['F'], action: 'Toggle fullscreen' },
                      { keys: ['R'], action: 'Refresh feed' },
                      { keys: ['G'], action: 'Go to grid view' },
                      { keys: ['T'], action: 'Toggle theme' },
                    ].map((shortcut) => (
                      <div key={shortcut.action} className="flex items-center gap-3">
                        <div className="flex items-center gap-1 shrink-0">
                          {shortcut.keys.map((k, i) => (
                            <span key={`${k}-${i}`} className="kbd">
                              {k}
                            </span>
                          ))}
                        </div>
                        <span className="text-[13px] text-[var(--text-secondary)]">{shortcut.action}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </SectionCard>

        {/* ── Section 6: About ── */}
        <SectionCard eyebrow="Info" title="About" description="App information and links" delay={0.48}>
          <div className="flex items-center gap-4 py-4">
            <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--accent-dim)] flex items-center justify-center">
              <svg viewBox="0 0 32 32" fill="none" className="w-7 h-7 text-[var(--accent)]">
                <rect width="32" height="32" rx="8" fill="currentColor" fillOpacity="0.1" />
                <path
                  d="M10 8C10 6.89543 10.8954 6 12 6H16C19.3137 6 22 8.68629 22 12V12C22 15.3137 19.3137 18 16 18H12"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M10 24C10 25.1046 10.8954 26 12 26H16C19.3137 26 22 23.3137 22 20V20C22 16.6863 19.3137 14 16 14H12"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <circle cx="16" cy="16" r="3" fill="currentColor" />
              </svg>
            </div>
            <div>
              <p className="text-[16px] font-semibold text-[var(--text-primary)]">Media Codex</p>
              <p className="text-[13px] text-[var(--text-tertiary)]">Version 2.0 &middot; Build 2026.04.24</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 py-3">
            {[
              { label: 'Terms', href: '#', icon: <FileText size={13} /> },
              { label: 'Privacy', href: '#', icon: <Shield size={13} /> },
              { label: 'Contact', href: '#', icon: <Mail size={13} /> },
              { label: 'GitHub', href: 'https://github.com', icon: <Github size={13} /> },
            ].map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.href.startsWith('http') ? '_blank' : undefined}
                rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-md transition-colors border border-[var(--border-subtle)]"
              >
                {link.icon}
                {link.label}
                {link.href.startsWith('http') && <ExternalLink size={11} />}
              </a>
            ))}
          </div>

          <div className="flex items-center justify-between py-3">
            <button
              onClick={() => addToast({ type: 'info', title: 'You are on the latest version' })}
              className="px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] rounded-md transition-colors border border-[var(--border-subtle)]"
            >
              Check for Updates
            </button>
            <p className="text-[12px] text-[var(--text-muted)]">
              Made with <Heart size={12} className="inline text-[var(--accent)]" /> for the community
            </p>
          </div>
        </SectionCard>

        {/* Save indicator */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-[12px] text-[var(--text-muted)] pb-4"
        >
          Changes saved automatically
        </motion.p>
      </div>

      {/* Confirmation modals */}
      <ConfirmModal
        open={deleteModalOpen}
        title="Delete Account"
        description="Are you sure you want to permanently delete your account? All your data, favorites, and history will be removed. This action cannot be undone."
        confirmLabel="Delete Account"
        confirmVariant="destructive"
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteModalOpen(false)}
      />
      <ConfirmModal
        open={clearRecentModalOpen}
        title="Clear Recently Viewed"
        description="This will remove all items from your recently viewed history. You cannot undo this."
        confirmLabel="Clear"
        confirmVariant="destructive"
        onConfirm={handleClearRecent}
        onCancel={() => setClearRecentModalOpen(false)}
      />
      <ConfirmModal
        open={clearSearchModalOpen}
        title="Clear Search History"
        description="This will delete all saved search queries from your history."
        confirmLabel="Clear"
        confirmVariant="destructive"
        onConfirm={handleClearSearch}
        onCancel={() => setClearSearchModalOpen(false)}
      />
    </div>
  )
}
