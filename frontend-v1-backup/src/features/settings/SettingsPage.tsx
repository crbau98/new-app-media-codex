import { useState, useCallback, useEffect } from "react"
import { cn } from "@/lib/cn"
import { useDashboard } from "@/hooks"
import { api, updateSettings } from "@/lib/api"
import { apiUrl } from "@/lib/backendOrigin"
import { useAppStore } from "@/store"
import { resetOnboarding } from "@/components/Onboarding"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lsGet(_key: string, defaultValue: boolean): boolean {
  return defaultValue
}

function lsSet(_key: string, _value: boolean): void {
  // settings kept in memory only
}

// ---------------------------------------------------------------------------
// Toggle switch
// ---------------------------------------------------------------------------

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  id?: string
}

function Toggle({ checked, onChange, label, id }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      id={id}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full",
        "transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        checked
          ? "bg-accent"
          : "bg-white/15"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 animate-fade-in">
      <h2 className="mb-4 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
        <span className="h-px w-8 bg-gradient-to-r from-accent to-transparent" />
        {title}
      </h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Vision AI section
// ---------------------------------------------------------------------------

function VisionAISection() {
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(apiUrl('/api/settings')).then(r => r.json()).then(data => {
      setBaseUrl(data.vision_base_url || 'https://api.openai.com/v1')
      setModel(data.vision_model || 'gpt-4o-mini')
      setApiKey(data.vision_api_key || '')
    }).catch(() => {})
  }, [])

  const presets = [
    { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { name: 'Ollama', url: 'http://localhost:11434/v1', model: 'llava' },
    { name: 'Together', url: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-Vision-Free' },
    { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.2-11b-vision-instruct:free' },
  ]

  async function handleSave() {
    await fetch(apiUrl('/api/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vision_base_url: baseUrl, vision_model: model, vision_api_key: apiKey }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputClass = "mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"

  return (
    <Section title="Vision AI Model">
      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-4">
        <p className="text-xs text-text-muted">
          Configure the AI model used for image descriptions. Use an uncensored model for NSFW content.
        </p>
        <div className="flex flex-wrap gap-2">
          {presets.map(p => (
            <button key={p.name} onClick={() => { setBaseUrl(p.url); setModel(p.model) }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium border border-border bg-bg-subtle text-text-primary hover:border-white/20 transition-colors">
              {p.name}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted">Base URL</label>
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="text-xs text-text-muted">Model</label>
            <input value={model} onChange={e => setModel(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="text-xs text-text-muted">API Key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className={inputClass} />
          </div>
          <button onClick={handleSave} className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent/80 transition-colors">
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Data Sources section
// ---------------------------------------------------------------------------

interface SourceDef {
  id: string
  label: string
  description: string
}

const SOURCES: SourceDef[] = [
  { id: "arxiv",      label: "arXiv",      description: "Pre-print scientific papers across physics, math, CS, biology, and more." },
  { id: "pubmed",     label: "PubMed",     description: "Biomedical literature from MEDLINE, life science journals, and online books." },
  { id: "biorxiv",    label: "bioRxiv",    description: "Pre-print server for biology — early research before peer review." },
  { id: "reddit",     label: "Reddit",     description: "Community discussion threads from relevant subreddits." },
  { id: "x",          label: "X (Twitter)", description: "Real-time posts from researchers and communities on X." },
  { id: "duckduckgo", label: "DuckDuckGo", description: "General web search results via DuckDuckGo." },
  { id: "lpsg",       label: "LPSG",       description: "Community forum posts from LPSG." },
]

function useLocalToggle(key: string, defaultValue = true, syncToBackend = false): [boolean, (v: boolean) => void] {
  const [val, setVal] = useState<boolean>(() => lsGet(key, defaultValue))
  const setter = useCallback((next: boolean) => {
    lsSet(key, next)
    setVal(next)
    if (syncToBackend) {
      updateSettings({ [key]: next }).catch(() => {})
    }
  }, [key, syncToBackend])
  return [val, setter]
}

function SourceCard({ source }: { source: SourceDef }) {
  const lsKey = `settings_source_${source.id}`
  const [enabled, setEnabled] = useLocalToggle(lsKey, true, true)

  return (
    <div className="bg-bg-surface border border-border rounded-xl p-5 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary">{source.label}</p>
        <p className="mt-0.5 text-xs text-text-muted leading-relaxed">{source.description}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label={`Enable ${source.label}`}
        />
      </div>
    </div>
  )
}

function DataSourcesSection() {
  return (
    <Section title="Data Sources">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {SOURCES.map((src) => (
          <SourceCard key={src.id} source={src} />
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Themes section (dynamic from API)
// ---------------------------------------------------------------------------

const THEME_COLORS = [
  "#a855f7", "#3b82f6", "#14b8a6", "#f59e0b", "#ec4899",
  "#6366f1", "#10b981", "#f43f5e", "#ef4444", "#22c55e",
]

interface ThemeDef {
  slug: string
  label: string
  color: string
}

function ThemeChip({ theme }: { theme: ThemeDef }) {
  const lsKey = `settings_theme_visibility_${theme.slug}`
  const [visible, setVisible] = useLocalToggle(lsKey, true)

  return (
    <button
      onClick={() => setVisible(!visible)}
      title={visible ? `Hide ${theme.label}` : `Show ${theme.label}`}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150",
        visible
          ? "border-transparent text-white"
          : "border-border text-text-muted bg-transparent"
      )}
      style={visible ? { backgroundColor: theme.color, boxShadow: `0 0 12px ${theme.color}55` } : undefined}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: visible ? "rgba(255,255,255,0.7)" : theme.color }}
      />
      {theme.label}
      {!visible && <span className="opacity-50 text-[10px]">hidden</span>}
    </button>
  )
}

function ThemesSection() {
  const { data: dashboard } = useDashboard()
  const themes: ThemeDef[] = ((dashboard?.themes ?? []) as { slug: string; label: string }[]).map((t, i) => ({
    ...t,
    color: THEME_COLORS[i % THEME_COLORS.length],
  }))

  return (
    <Section title="Themes">
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <p className="text-xs text-text-muted mb-4">
          Toggle which themes appear in charts and filters. Click a chip to show or hide it.
        </p>
        {themes.length === 0 ? (
          <p className="text-sm text-text-muted italic">No themes configured. Add themes in the Manage Themes section below.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {themes.map((t) => (
              <ThemeChip key={t.slug} theme={t} />
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Display section
// ---------------------------------------------------------------------------

interface DisplayPref {
  key: string
  label: string
  description: string
  defaultValue: boolean
}

const DISPLAY_PREFS: DisplayPref[] = [
  {
    key: "settings_compact_mode",
    label: "Compact mode",
    description: "Reduce padding and font sizes in item cards for denser information display.",
    defaultValue: false,
  },
  {
    key: "settings_show_reading_time",
    label: "Show reading time",
    description: "Display estimated reading time on item cards.",
    defaultValue: true,
  },
  {
    key: "settings_show_score_bars",
    label: "Show score bars",
    description: "Render relevance score bars on item cards.",
    defaultValue: true,
  },
]

function DisplayPrefRow({ pref }: { pref: DisplayPref }) {
  const [val, setVal] = useLocalToggle(pref.key, pref.defaultValue, true)

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">{pref.label}</p>
        <p className="text-xs text-text-muted mt-0.5">{pref.description}</p>
      </div>
      <div className="shrink-0">
        <Toggle checked={val} onChange={setVal} label={pref.label} />
      </div>
    </div>
  )
}

function DisplaySection() {
  return (
    <Section title="Display">
      <div className="bg-bg-surface border border-border rounded-xl px-5 divide-y divide-border">
        {DISPLAY_PREFS.map((pref) => (
          <DisplayPrefRow key={pref.key} pref={pref} />
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Data Export section
// ---------------------------------------------------------------------------

function DataExportSection() {
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch(apiUrl("/api/items?limit=1000"))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `research-items-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export failed:", err)
    } finally {
      setExporting(false)
    }
  }

  async function handleCopyApiUrl() {
    try {
      await navigator.clipboard.writeText(window.location.origin)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: no-op
    }
  }

  return (
    <Section title="Data Export">
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <p className="text-xs text-text-muted mb-5">
          Export your collected research data or copy the API base URL to integrate with other tools.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExport}
            disabled={exporting}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
              "bg-accent/10 text-accent border border-accent/30",
              "hover:bg-accent/20 hover:border-accent/60 transition-colors",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {exporting ? "Exporting…" : "Export all items as JSON"}
          </button>

          <button
            onClick={handleCopyApiUrl}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
              "border border-border text-text-primary",
              "hover:bg-white/5 hover:border-white/20 transition-colors"
            )}
          >
            {copied ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Copy API base URL
              </>
            )}
          </button>
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Theme Manager section (dynamic — reads/writes API)
// ---------------------------------------------------------------------------

function ThemeManager() {
  const { data: dashboard, refetch } = useDashboard()
  const themes = (dashboard?.themes ?? []) as { slug: string; label: string }[]
  const [newSlug, setNewSlug] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  async function handleAdd() {
    const slug = newSlug.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const label = newLabel.trim()
    if (!slug || !label) return
    setAdding(true)
    try {
      await api.createTheme(slug, label)
      await refetch()
      setNewSlug('')
      setNewLabel('')
      addToast(`Theme "${label}" added`, 'success')
    } catch {
      addToast('Failed to add theme', 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(slug: string, label: string) {
    try {
      await api.deleteTheme(slug)
      await refetch()
      addToast(`Theme "${label}" deleted`)
    } catch {
      addToast('Failed to delete theme', 'error')
    }
  }

  const inputClass = "px-3 py-2 text-sm bg-bg-subtle border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent/50 placeholder:text-text-muted"

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Research Themes</h3>
        <p className="text-xs text-text-muted">Themes categorize your research items and hypotheses.</p>
      </div>

      {themes.length > 0 ? (
        <ul className="space-y-2">
          {themes.map((t) => (
            <li key={t.slug} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-bg-subtle border border-border">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-text-primary">{t.label}</span>
                <span className="font-mono text-xs text-text-muted bg-bg-surface border border-border px-1.5 py-0.5 rounded">
                  {t.slug}
                </span>
              </div>
              <button
                onClick={() => handleDelete(t.slug, t.label)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted italic">No themes configured.</p>
      )}

      <div className="flex gap-2 items-center">
        <input
          value={newSlug}
          onChange={(e) => setNewSlug(e.target.value)}
          placeholder="slug (e.g. libido)"
          className={`${inputClass} flex-1`}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label (e.g. Libido)"
          className={`${inputClass} flex-1`}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button
          onClick={handleAdd}
          disabled={adding || !newSlug.trim() || !newLabel.trim()}
          className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {adding ? '…' : 'Add Theme'}
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Accent Color section
// ---------------------------------------------------------------------------

const ACCENT_COLORS = [
  { name: 'Ocean',   primary: '#3b82f6', secondary: '#06b6d4' },
  { name: 'Violet',  primary: '#a855f7', secondary: '#ec4899' },
  { name: 'Emerald', primary: '#10b981', secondary: '#14b8a6' },
  { name: 'Sunset',  primary: '#f59e0b', secondary: '#ef4444' },
  { name: 'Rose',    primary: '#f43f5e', secondary: '#a855f7' },
  { name: 'Indigo',  primary: '#6366f1', secondary: '#3b82f6' },
  { name: 'Mint',    primary: '#14b8a6', secondary: '#22c55e' },
  { name: 'Flame',   primary: '#ef4444', secondary: '#f97316' },
]

// AccentColorSection replaced by AccentColorInline in AppearanceSection above

// ---------------------------------------------------------------------------
// About section
// ---------------------------------------------------------------------------

function AboutSection() {
  const { data: dashboard } = useDashboard()
  const stats = dashboard?.stats as
    | { item_count: number; image_count: number; hypothesis_count: number }
    | undefined
  const [health, setHealth] = useState<"ok" | "degraded" | "error" | "loading">("loading")

  useEffect(() => {
    fetch(apiUrl("/healthz"))
      .then((r) => r.json())
      .then((d: { status: string }) =>
        setHealth(d.status === "ok" ? "ok" : "degraded")
      )
      .catch(() => setHealth("error"))
  }, [])

  const dot =
    health === "ok"
      ? "bg-green-400"
      : health === "degraded"
        ? "bg-yellow-400"
        : health === "error"
          ? "bg-red-400"
          : "bg-white/20 animate-pulse"

  return (
    <Section title="About">
      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-text-primary">
              Desire Research Radar{" "}
              <span className="font-mono text-xs text-text-muted font-normal">v1.0</span>
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              Research aggregation and analysis platform
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-subtle border border-border">
            <span className={cn("w-2 h-2 rounded-full", dot)} />
            <span className="text-xs text-text-muted capitalize">
              {health === "loading" ? "checking..." : health}
            </span>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Items", value: stats.item_count },
              { label: "Hypotheses", value: stats.hypothesis_count },
              { label: "Screenshots", value: stats.image_count },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-lg bg-bg-subtle border border-border px-4 py-3 text-center"
              >
                <p className="text-lg font-bold text-text-primary">
                  {(s.value ?? 0).toLocaleString()}
                </p>
                <p className="text-xs text-text-muted">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Appearance section (theme toggle + accent color)
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)

  return (
    <Section title="Appearance">
      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-5">
        {/* Dark / Light toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Dark mode</p>
            <p className="text-xs text-text-muted mt-0.5">
              Switch between dark and light interface themes.
            </p>
          </div>
          <Toggle
            checked={theme === "dark"}
            onChange={toggleTheme}
            label="Toggle dark mode"
          />
        </div>

        {/* Accent color picker (inline) */}
        <AccentColorInline />
      </div>
    </Section>
  )
}

function AccentColorInline() {
  const [accent, setAccent] = useState<string>(
    () => "#f59e0b"
  )

  useEffect(() => {
    document.documentElement.style.setProperty("--color-accent", accent)
    document.documentElement.style.setProperty("--color-accent-glow", accent + "50")
  }, [accent])

  function applyAccent(primary: string, secondary: string) {
    document.documentElement.style.setProperty("--color-accent", primary)
    document.documentElement.style.setProperty("--color-accent-secondary", secondary)
    document.documentElement.style.setProperty("--color-accent-glow", primary + "50")
    setAccent(primary)
    updateSettings({ accent_primary: primary, accent_secondary: secondary }).catch(() => {})
  }

  return (
    <div>
      <p className="text-sm font-medium text-text-primary mb-1">Accent color</p>
      <p className="text-xs text-text-muted mb-3">
        Choose the accent color used throughout the interface.
      </p>
      <div className="flex flex-wrap gap-3">
        {ACCENT_COLORS.map((c) => (
          <button
            key={c.primary}
            onClick={() => applyAccent(c.primary, c.secondary)}
            title={c.name}
            aria-label={`${c.name} accent`}
            className={cn(
              "relative h-9 w-9 rounded-full border-2 transition-transform duration-150 hover:scale-110 overflow-hidden",
              accent === c.primary ? "border-white scale-110 shadow-lg" : "border-transparent"
            )}
            style={{
              background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
              boxShadow: accent === c.primary ? `0 0 14px ${c.primary}80` : undefined,
            }}
          >
            {accent === c.primary && (
              <span className="absolute inset-0 flex items-center justify-center text-white text-sm">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-text-muted font-mono">{accent}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data Management section
// ---------------------------------------------------------------------------

function DataManagementSection() {
  const [clearing, setClearing] = useState(false)
  const [cleared, setCleared] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  async function handleClearCache() {
    if (clearing) return
    setClearing(true)
    try {
      const res = await fetch(apiUrl("/api/settings/cache"), { method: "DELETE" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { deleted: number }
      setCleared(data.deleted)
      addToast(`Cleared ${data.deleted} cached compounds`, "success")
      setTimeout(() => setCleared(null), 3000)
    } catch {
      addToast("Failed to clear cache", "error")
    } finally {
      setClearing(false)
    }
  }

  async function handleResetSettings() {
    setResetting(true)
    try {
      const res = await fetch(apiUrl("/api/settings/reset"), { method: "PUT" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      addToast("All settings have been reset", "success")
      setConfirmReset(false)
    } catch {
      addToast("Failed to reset settings", "error")
    } finally {
      setResetting(false)
    }
  }

  return (
    <Section title="Data Management">
      <div className="space-y-4">
        {/* Clear Cache */}
        <div className="bg-bg-surface border border-border rounded-xl p-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Clear Compound Cache</p>
            <p className="text-xs text-text-muted mt-0.5">
              Remove all cached compound lookups. Data will be re-fetched on next access.
            </p>
          </div>
          <button
            onClick={handleClearCache}
            disabled={clearing}
            className={cn(
              "shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              "border border-border text-text-primary hover:bg-white/5 hover:border-white/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {clearing
              ? "Clearing..."
              : cleared !== null
                ? `Cleared ${cleared}`
                : "Clear Cache"}
          </button>
        </div>

        {/* Danger Zone */}
        <div className="rounded-xl border-2 border-red-500/30 p-5 space-y-3">
          <p className="text-sm font-semibold text-red-400">Danger Zone</p>
          <p className="text-xs text-text-muted">
            Reset all user settings to their defaults. This cannot be undone.
          </p>
          {confirmReset ? (
            <div className="flex items-center gap-3">
              <button
                onClick={handleResetSettings}
                disabled={resetting}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {resetting ? "Resetting..." : "Yes, reset everything"}
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Reset All Settings
            </button>
          )}
        </div>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Notifications section
// ---------------------------------------------------------------------------

function NotificationSection() {
  const [enabled, setEnabled] = useState(false)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    if ('Notification' in window) {
      setEnabled(Notification.permission === 'granted')
      setDenied(Notification.permission === 'denied')
    }
  }, [])

  async function handleEnable() {
    if (!('Notification' in window)) return
    const permission = await Notification.requestPermission()
    setEnabled(permission === 'granted')
    setDenied(permission === 'denied')
  }

  return (
    <Section title="Notifications">
      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-3">
        <p className="text-xs text-text-muted">Get notified when crawls and captures complete.</p>
        {denied ? (
          <p className="text-xs text-red-400">Notifications blocked. Enable in browser settings.</p>
        ) : enabled ? (
          <p className="text-xs text-green-400">Notifications enabled</p>
        ) : (
          <button onClick={handleEnable} className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent/80 transition-colors">
            Enable Notifications
          </button>
        )}
      </div>
    </Section>
  )
}

function ManageThemesSection() {
  return (
    <Section title="Manage Themes">
      <div className="bg-bg-surface border border-border rounded-xl p-5">
        <ThemeManager />
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Storage section
// ---------------------------------------------------------------------------

interface DiskUsageDir {
  size_mb: number
  file_count: number
}

interface DiskUsageData {
  directories: Record<string, DiskUsageDir>
  disk: { total_mb: number; used_mb: number; free_mb: number } | null
}

function StorageSection() {
  const [usage, setUsage] = useState<DiskUsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [cleaning, setCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState<{ deleted: number; freed_mb: number } | null>(null)
  const [maxAgeDays, setMaxAgeDays] = useState(30)
  const addToast = useAppStore((s) => s.addToast)

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/screenshots/disk-usage"))
      if (res.ok) setUsage(await res.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsage() }, [fetchUsage])

  async function handleCleanup() {
    if (cleaning) return
    setCleaning(true)
    try {
      const res = await fetch(apiUrl(`/api/screenshots/cleanup?max_age_days=${maxAgeDays}`), { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCleanResult(data)
      addToast(`Deleted ${data.deleted} files, freed ${data.freed_mb} MB`, "success")
      fetchUsage()
      setTimeout(() => setCleanResult(null), 5000)
    } catch {
      addToast("Cleanup failed", "error")
    } finally {
      setCleaning(false)
    }
  }

  const totalMedia = usage
    ? Object.values(usage.directories).reduce((a, d) => a + d.size_mb, 0)
    : 0

  return (
    <Section title="Storage">
      <div className="bg-bg-surface border border-border rounded-xl p-5 space-y-5">
        {loading ? (
          <p className="text-sm text-text-muted animate-pulse">Loading disk usage...</p>
        ) : usage ? (
          <>
            {/* Directory breakdown */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(usage.directories).map(([name, info]) => (
                <div key={name} className="rounded-lg bg-bg-subtle border border-border px-4 py-3 text-center">
                  <p className="text-lg font-bold text-text-primary">{info.size_mb} MB</p>
                  <p className="text-xs text-text-muted capitalize">{name}</p>
                  <p className="text-[10px] text-text-muted">{(info.file_count ?? 0).toLocaleString()} files</p>
                </div>
              ))}
            </div>

            {/* Disk bar */}
            {usage.disk && (
              <div>
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Disk: {(usage.disk.used_mb ?? 0).toLocaleString()} / {(usage.disk.total_mb ?? 1).toLocaleString()} MB used</span>
                  <span>{(usage.disk.free_mb ?? 0).toLocaleString()} MB free</span>
                </div>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.min((usage.disk.used_mb / usage.disk.total_mb) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-text-muted mt-1">
                  Media storage: {totalMedia.toFixed(1)} MB
                </p>
              </div>
            )}

            {/* Cleanup controls */}
            <div className="flex items-center gap-3 pt-2 border-t border-border">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">Cleanup old screenshots</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Delete screenshot files older than the specified number of days.
                </p>
              </div>
              <label className="shrink-0 flex items-center gap-1.5 text-xs text-text-muted">
                Older than
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={maxAgeDays}
                  onChange={(e) => setMaxAgeDays(Math.max(1, Math.min(365, Number(e.target.value))))}
                  className="w-16 rounded-lg border border-border bg-bg-subtle px-2 py-1 text-sm text-text-primary text-center outline-none focus:border-accent/50"
                />
                days
              </label>
              <button
                onClick={handleCleanup}
                disabled={cleaning}
                className={cn(
                  "shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  "border border-border text-text-primary hover:bg-white/5 hover:border-white/20",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {cleaning ? "Cleaning..." : cleanResult ? `Freed ${cleanResult.freed_mb} MB` : "Run Cleanup"}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-text-muted">Could not load disk usage.</p>
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Onboarding reset
// ---------------------------------------------------------------------------

function OnboardingSection() {
  const [reset, setReset] = useState(false)

  function handleReset() {
    resetOnboarding()
    setReset(true)
    setTimeout(() => setReset(false), 2000)
  }

  return (
    <Section title="Onboarding">
      <div className="bg-bg-surface border border-border rounded-xl p-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-text-primary">Show onboarding</p>
          <p className="text-xs text-text-muted mt-0.5">
            Re-show the welcome walkthrough on your next page load.
          </p>
        </div>
        <button
          onClick={handleReset}
          className="rounded-lg px-4 py-2 text-sm font-medium border border-border bg-bg-subtle text-text-primary hover:border-white/20 transition-colors"
        >
          {reset ? "Done! Reload to see it" : "Reset onboarding"}
        </button>
      </div>
    </Section>
  )
}

export function SettingsPage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-8">
      {/* Page header */}
      <header className="relative mb-10 overflow-hidden rounded-[28px] border border-border bg-bg-surface p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.4)] sm:p-10">
        <div
          aria-hidden="true"
          className="orb-float pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full opacity-70"
          style={{
            background: "radial-gradient(circle, rgba(168,85,247,0.22), transparent 70%)",
            filter: "blur(20px)",
          }}
        />
        <div
          aria-hidden="true"
          className="orb-float pointer-events-none absolute -left-16 -bottom-16 h-64 w-64 rounded-full opacity-55"
          style={{
            background: "radial-gradient(circle, rgba(236,72,153,0.18), transparent 70%)",
            filter: "blur(24px)",
            animationDelay: "-8s",
          }}
        />
        <div className="relative">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-bg-elevated/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Preferences
          </p>
          <h1 className="hero-title text-[28px] font-semibold leading-[1.08] tracking-[-0.045em] text-text-primary sm:text-[36px]">
            <span className="text-gradient-brand">Settings</span>
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-text-secondary">
            Sources, appearance, notifications, and your data—everything stays on your terms.
          </p>
        </div>
      </header>

      <AboutSection />
      <AppearanceSection />
      <NotificationSection />
      <OnboardingSection />
      <VisionAISection />
      <DataSourcesSection />
      <ThemesSection />
      <ManageThemesSection />
      <DisplaySection />
      <DataExportSection />
      <StorageSection />
      <DataManagementSection />
    </div>
  )
}
