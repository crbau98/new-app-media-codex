import { useEffect, useRef } from "react"
import { useAppStore } from "../store"

export function useCommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)

  // Use a ref so the keydown handlers always see the latest open value
  // without needing to re-register on every change.
  const openRef = useRef(open)
  useEffect(() => { openRef.current = open }, [open])

  // ⌘K / Ctrl+K — toggle command palette
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(!openRef.current)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [setOpen])

  // ? — open shortcuts overlay signal via a custom event
  // The ShortcutsOverlay is mounted inside CommandPalette; we use a custom
  // DOM event to communicate from this hook to that component without extra
  // store state.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== "?") return
      // Ignore when focus is on a text-entry element
      const tag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase()
      if (tag === "input" || tag === "textarea" || tag === "select") return
      // Ignore with any modifier keys held (except shift, which is needed for ?)
      if (e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      // Fire a custom event that CommandPalette listens for
      window.dispatchEvent(new CustomEvent("open-shortcuts-overlay"))
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
}
