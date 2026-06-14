import { memo, useEffect, useRef } from "react"
import { api } from "@/lib/api"

interface ViewCounterProps {
  screenshotId?: number
  performerId?: number
  count?: number
  className?: string
}

const viewedSet = new Set<string>()

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`
  return `${n} view${n !== 1 ? "s" : ""}`
}

export const ViewCounter = memo(function ViewCounter({
  screenshotId,
  performerId,
  count = 0,
  className,
}: ViewCounterProps) {
  const recordedRef = useRef(false)

  useEffect(() => {
    if (recordedRef.current) return
    const key = screenshotId ? `shot-${screenshotId}` : performerId ? `perf-${performerId}` : null
    if (!key) return
    if (viewedSet.has(key)) return

    const timer = setTimeout(() => {
      if (screenshotId) {
        api.recordView(screenshotId, "screenshot").catch(() => {})
      } else if (performerId) {
        api.recordView(performerId, "performer").catch(() => {})
      }
      viewedSet.add(key)
      recordedRef.current = true
    }, 1500)

    return () => clearTimeout(timer)
  }, [screenshotId, performerId])

  if (count <= 0) return null

  return (
    <span className={className}>{formatViews(count)}</span>
  )
})
