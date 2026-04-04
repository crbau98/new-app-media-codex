import { useEffect, useRef } from "react"
import type { ActiveView } from "../store"

const scrollPositions = new Map<ActiveView, number>()

export function useScrollRestoration(view: ActiveView) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Restore saved position
    const saved = scrollPositions.get(view) ?? 0
    el.scrollTop = saved
    // Save on scroll
    function onScroll() { scrollPositions.set(view, el!.scrollTop) }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [view])

  return containerRef
}
