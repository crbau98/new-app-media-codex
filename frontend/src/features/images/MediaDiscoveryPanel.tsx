import type { DiscoveredCreator, Performer } from "@/lib/api"

interface MediaDiscoveryPanelProps {
  discoverySeedLabel?: string
  mediaCreatorId?: number | null
  mediaCreatorName?: string | null
  term?: string | null
  activeTagFilter?: string | null
  similarCreators?: Performer[]
  onSelectSimilarCreator?: (id: number, username: string) => void
  onCaptureSimilarCreator?: (creator: Performer) => void | Promise<void>
  discoveryQuery?: string
  onDiscoveryQueryChange?: (value: string) => void
  discoveryPrompt?: string
  discoveryPlatform?: string
  onDiscoveryPlatformChange?: (value: string) => void
  onRunDiscovery?: () => void | Promise<void>
  discoverPending?: boolean
  discoveryCandidatesLength?: number
  onImportAllSuggestedCreators?: () => void | Promise<void>
  importPending?: boolean
  discoveryOverview?: unknown
  orderedDiscoveryResults?: DiscoveredCreator[]
  isImportedUsername?: (username: string) => boolean
  onImportSuggestedCreator?: (creator: DiscoveredCreator) => void | Promise<void>
}

export function MediaDiscoveryPanel({
  discoverySeedLabel,
  mediaCreatorName,
  term,
  similarCreators = [],
  discoveryCandidatesLength = 0,
}: MediaDiscoveryPanelProps) {
  return (
    <div className="rounded-xl bg-white/5 p-4 text-center text-sm text-white/40">
      Discovery panel
      {(discoverySeedLabel || mediaCreatorName || term) && (
        <div className="mt-2 text-xs text-white/30">
          {[discoverySeedLabel, mediaCreatorName, term].filter(Boolean).join(" · ")}
        </div>
      )}
      {(similarCreators.length > 0 || discoveryCandidatesLength > 0) && (
        <div className="mt-1 text-xs text-white/25">
          {similarCreators.length} similar creators · {discoveryCandidatesLength} suggestions
        </div>
      )}
    </div>
  )
}
