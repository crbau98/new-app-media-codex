import { useState, useEffect, useRef, useCallback } from "react"
import { fetchSettings, updateSettings } from "../lib/api"
import { cn } from "@/lib/cn"

type SaveStatus = "saved" | "saving" | "unsaved"

interface ScratchpadProps {
  open: boolean
  onClose: () => void
}

export function Scratchpad({ open, onClose }: ScratchpadProps) {
  const [content, setContent] = useState("")
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const [loaded, setLoaded] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load content on first open
  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    ;(async () => {
      try {
        const settings = await fetchSettings()
        if (!cancelled && typeof settings.scratchpad_content === "string") {
          setContent(settings.scratchpad_content)
        }
      } catch {
        // ignore load errors
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [open, loaded])

  // Focus textarea when opened
  useEffect(() => {
    if (open && loaded) {
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }, [open, loaded])

  // Auto-save with 2s debounce
  const save = useCallback(async (text: string) => {
    setSaveStatus("saving")
    try {
      await updateSettings({ scratchpad_content: text })
      setSaveStatus("saved")
    } catch {
      setSaveStatus("unsaved")
    }
  }, [])

  function handleChange(newContent: string) {
    setContent(newContent)
    setSaveStatus("unsaved")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(newContent), 2000)
  }

  // Force save on Ctrl+S
  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault()
      if (debounceRef.current) clearTimeout(debounceRef.current)
      save(content)
    }
  }

  // Escape closes panel
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // Flush pending save on close
  useEffect(() => {
    if (!open && debounceRef.current) {
      clearTimeout(debounceRef.current)
      if (saveStatus === "unsaved") {
        save(content)
      }
    }
  }, [open, content, save, saveStatus])

  // Clear all with confirmation
  function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    setContent("")
    setConfirmClear(false)
    setSaveStatus("unsaved")
    if (debounceRef.current) clearTimeout(debounceRef.current)
    save("")
  }

  const charCount = content.length

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[350px] max-w-[90vw] flex-col border-l border-white/8 bg-[#0a1520]/95 backdrop-blur-2xl transition-transform duration-300 ease-out glass",
          open ? "translate-x-0" : "translate-x-full"
        )}
        role="dialog"
        aria-label="Research Notes"
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg border border-white/10 bg-white/6 p-1.5 text-accent">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Research Notes</h3>
              <p className="text-[10px] text-text-muted">Quick scratchpad</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/8 hover:text-text-primary"
            aria-label="Close scratchpad"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Textarea */}
        <div className="flex-1 overflow-hidden p-3">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your research notes here...&#10;&#10;Supports plain text and markdown."
            className="h-full w-full resize-none rounded-xl border border-white/8 bg-black/20 p-3 font-mono text-sm text-text-primary placeholder:text-text-muted/50 focus:border-accent/40 focus:outline-none transition-colors"
            spellCheck
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/8 px-4 py-2.5">
          <div className="flex items-center gap-3">
            {/* Save status */}
            <span
              className={cn(
                "flex items-center gap-1.5 text-[11px] font-medium",
                saveStatus === "saved" && "text-green",
                saveStatus === "saving" && "text-amber-300",
                saveStatus === "unsaved" && "text-text-muted"
              )}
            >
              {saveStatus === "saved" && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
              {saveStatus === "saving" && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              )}
              {saveStatus === "saved" ? "Saved" : saveStatus === "saving" ? "Saving..." : "Unsaved changes"}
            </span>

            {/* Character count */}
            <span className="text-[10px] font-mono text-text-muted tabular-nums">
              {charCount.toLocaleString()} chars
            </span>
          </div>

          {/* Clear all */}
          <button
            onClick={handleClear}
            disabled={content.length === 0}
            className={cn(
              "rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
              confirmClear
                ? "bg-red/20 text-red border border-red/30"
                : "text-text-muted hover:text-red hover:bg-red/10 disabled:opacity-30 disabled:cursor-not-allowed"
            )}
          >
            {confirmClear ? "Confirm clear?" : "Clear all"}
          </button>
        </div>
      </div>
    </>
  )
}
