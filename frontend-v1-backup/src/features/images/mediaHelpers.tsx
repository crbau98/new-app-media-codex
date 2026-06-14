import { useState, useEffect } from "react"
import type { Screenshot } from "@/lib/api"
import { cn } from "@/lib/cn"
import { Spinner } from "@/components/Spinner"

export const MEDIA_NAVIGATION_EVENT = "codex:media-navigation"

export function readTermFromHash(): string | null {
  const hash = window.location.hash
  const qIdx = hash.indexOf("?")
  if (qIdx === -1) return null
  return new URLSearchParams(hash.slice(qIdx + 1)).get("term") || null
}

export function readShotFromHash(): number | null {
  const hash = window.location.hash
  const qIdx = hash.indexOf("?")
  if (qIdx === -1) return null
  const raw = new URLSearchParams(hash.slice(qIdx + 1)).get("shot")
  if (!raw) return null
  const id = parseInt(raw, 10)
  return isNaN(id) ? null : id
}

export function writeTermToHash(term: string | null) {
  const basePath = window.location.hash.split("?")[0] || "#/media"
  if (term) window.location.hash = `${basePath}?term=${encodeURIComponent(term)}`
  else window.location.hash = basePath
}

export type SortOrder = "newest" | "oldest" | "az" | "rating" | "random"
export type TabFilter = "all" | "ddg" | "redgifs" | "tube" | "favorites" | "videos" | "images" | "creators" | "rated"
export type ViewMode = "grid" | "list" | "timeline" | "feed" | "mosaic"

export type SearchSuggestion =
  | { type: "term"; value: string; meta?: string }
  | { type: "tag"; value: string; meta?: string }
  | { type: "creator"; value: string; meta?: string }

export function isVideo(src: string) {
  return /\.(mp4|webm|mov)/i.test(src)
}

export function isGif(src: string) {
  return /\.gif$/i.test(src)
}

export function isNewShot(shot: Screenshot): boolean {
  const captured = shot.captured_at ? new Date(shot.captured_at).getTime() : 0
  return Date.now() - captured < 24 * 60 * 60 * 1000
}

export function sourceLabel(s: string) {
  if (s === "ddg") return "DDG"
  if (s === "redgifs") return "Redgifs"
  if (s === "x") return "X"
  if (s === "ytdlp") return "Tube"
  if (s === "telegram") return "Telegram"
  return s
}

export function parseUserTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : []
  } catch { return [] }
}

export function parseAiTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    const result: string[] = []
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const v of Object.values(parsed)) {
        if (typeof v === "string") result.push(v)
        else if (Array.isArray(v)) {
          for (const x of v) { if (typeof x === "string") result.push(x) }
        }
      }
    } else if (Array.isArray(parsed)) {
      for (const x of parsed) { if (typeof x === "string") result.push(x) }
    }
    return result
  } catch { return [] }
}

export function getTimelineGroup(dateStr: string | undefined): string {
  if (!dateStr) return "Older"
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)
  const monthAgo = new Date(today)
  monthAgo.setMonth(monthAgo.getMonth() - 1)

  if (d >= today) return "Today"
  if (d >= yesterday) return "Yesterday"
  if (d >= weekAgo) return "This Week"
  if (d >= monthAgo) return "This Month"
  return "Older"
}

export const GRID_CLASSES: Record<string, string> = {
  compact: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-px",
  normal: "grid-cols-3 gap-px sm:gap-0.5",
  spacious: "grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-2",
}

export const GRID_COLS: Record<string, number> = {
  compact: 3,
  normal: 3,
  spacious: 2,
}

export function useResponsiveColCount(density: string): number {
  const [colCount, setColCount] = useState(() => {
    if (typeof window === "undefined") return GRID_COLS[density]
    const w = window.innerWidth
    if (density === "compact") return w >= 1024 ? 6 : w >= 768 ? 5 : w >= 640 ? 4 : 3
    if (density === "normal") return 3
    return w >= 768 ? 3 : w >= 640 ? 2 : 2
  })
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    function update() {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        const w = window.innerWidth
        if (density === "compact") setColCount(w >= 1024 ? 6 : w >= 768 ? 5 : w >= 640 ? 4 : 3)
        else if (density === "normal") setColCount(3)
        else setColCount(w >= 768 ? 3 : w >= 640 ? 2 : 2)
      }, 150)
    }
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("resize", update)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [density])
  return colCount
}

export const GRID_ROW_SIZE_ESTIMATE: Record<string, number> = {
  compact: 120,
  normal: 128,
  spacious: 200,
}

export const MOSAIC_BATCH_SIZE = 24

export function getInitialMosaicVisibleCount() {
  if (typeof window === "undefined") return MOSAIC_BATCH_SIZE
  const width = window.innerWidth
  const height = window.innerHeight
  const columns = width >= 1400 ? 5 : width >= 1025 ? 4 : width >= 641 ? 3 : 2
  const estimatedRows = Math.max(3, Math.ceil(height / 220) + 2)
  return Math.max(MOSAIC_BATCH_SIZE, columns * estimatedRows * 2)
}

export function estimateGridSectionHeight(itemCount: number, colCount: number, density: string) {
  const rows = Math.max(1, Math.ceil(itemCount / Math.max(colCount, 1)))
  return 56 + rows * GRID_ROW_SIZE_ESTIMATE[density]
}

export function MediaUnavailableTile({
  title,
  detail,
  statusLabel = "Media unavailable",
  className,
}: {
  title: string
  detail: string
  statusLabel?: string
  className?: string
}) {
  return (
    <div className={cn("flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-3 text-center", className)}>
      <div className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-amber-200">
        {statusLabel}
      </div>
      <div className="max-w-full space-y-1">
        <p className="text-xs font-medium text-white/80">{title}</p>
        <p className="truncate text-[10px] text-amber-100/70" title={detail}>{detail}</p>
      </div>
    </div>
  )
}

export function InlineLoadingFallback({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center justify-center rounded-2xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-slate-400", className)}>
      <Spinner />
      <span className="ml-2">{label}</span>
    </div>
  )
}
