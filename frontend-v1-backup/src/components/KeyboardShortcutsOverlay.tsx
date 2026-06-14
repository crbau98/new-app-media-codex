import { useEffect } from "react"

interface ShortcutEntry {
  key: string | string[]
  action: string
}

interface ShortcutGroup {
  label: string
  shortcuts: ShortcutEntry[]
}

const GROUPS: ShortcutGroup[] = [
  {
    label: "Global",
    shortcuts: [
      { key: ["⌘", "K"], action: "Command palette" },
      { key: "?", action: "Keyboard shortcuts" },
      { key: ["1", "–", "6"], action: "Switch views" },
      { key: "Esc", action: "Close modal / back" },
    ],
  },
  {
    label: "Media Gallery",
    shortcuts: [
      { key: "/", action: "Focus search" },
      { key: "S", action: "Toggle slideshow" },
      { key: "T", action: "TikTok feed" },
      { key: "M", action: "Batch select mode" },
      { key: "A", action: "Select / deselect all" },
    ],
  },
  {
    label: "Lightbox",
    shortcuts: [
      { key: ["←", "→"], action: "Navigate images" },
      { key: "F", action: "Toggle fullscreen" },
      { key: "I", action: "Toggle info panel" },
      { key: "D", action: "Download" },
      { key: "C", action: "Copy URL" },
      { key: "P", action: "Picture-in-picture (video)" },
      { key: ["[", "]"], action: "Speed down / up (video)" },
    ],
  },
  {
    label: "Creators",
    shortcuts: [
      { key: "/", action: "Focus search" },
      { key: "T", action: "Toggle table / grid view" },
      { key: ["j", "↓"], action: "Focus next" },
      { key: ["k", "↑"], action: "Focus previous" },
      { key: "Enter", action: "Open creator profile" },
      { key: "F", action: "Toggle favorite (focused)" },
      { key: "C", action: "Queue capture (focused)" },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 rounded border border-white/15 bg-white/[0.07] px-1.5 font-mono text-[11px] text-white/80">
      {children}
    </kbd>
  )
}

export function KeyboardShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-label="Keyboard shortcuts"
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0a1628] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/8">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/60">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-white">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/8 hover:text-white/70"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-2 gap-0 p-5">
          {GROUPS.map((group) => (
            <div key={group.label} className="px-2 pb-4">
              <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">{group.label}</p>
              <div className="space-y-1.5">
                {group.shortcuts.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-white/50">{s.action}</span>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {Array.isArray(s.key)
                        ? s.key.map((k, ki) =>
                            k === "–" || k === "/" ? (
                              <span key={ki} className="text-[10px] text-white/25 mx-0.5">{k}</span>
                            ) : (
                              <Kbd key={ki}>{k}</Kbd>
                            )
                          )
                        : <Kbd>{s.key}</Kbd>
                      }
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-white/5 px-5 py-3">
          <p className="text-[10px] text-white/25 text-center">Press <Kbd>?</Kbd> or <Kbd>Esc</Kbd> to close</p>
        </div>
      </div>
    </div>
  )
}
