interface SourceDonutProps {
  sourceMix?: Array<{ source_type: string; count: number }>
  onSliceClick?: (sourceType: string) => void
}

export function SourceDonut({ sourceMix = [], onSliceClick }: SourceDonutProps) {
  return (
    <div className="rounded-xl bg-white/5 p-4 text-center text-sm text-white/40">
      {sourceMix.length > 0 ? (
        <button
          type="button"
          onClick={() => onSliceClick?.(sourceMix[0]!.source_type)}
          className="text-inherit"
        >
          Source distribution chart
        </button>
      ) : (
        "Source distribution chart"
      )}
    </div>
  )
}

export function TopCompoundsChart() {
  return (
    <div className="rounded-xl bg-white/5 p-4 text-center text-sm text-white/40">
      Top compounds chart
    </div>
  )
}

export function TopMechanismsChart() {
  return (
    <div className="rounded-xl bg-white/5 p-4 text-center text-sm text-white/40">
      Top mechanisms chart
    </div>
  )
}

export function ScoreHistogramChart() {
  return (
    <div className="rounded-xl bg-white/5 p-4 text-center text-sm text-white/40">
      Score histogram chart
    </div>
  )
}
