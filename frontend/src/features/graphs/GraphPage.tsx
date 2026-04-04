import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { cn } from '@/lib/cn'
import { CompoundGraph } from './CompoundGraph'
import type { CompoundGraphHandle } from './CompoundGraph'
import { useGraphData } from '@/hooks/useGraphData'
import type { GraphNode } from '@/hooks/useGraphData'
import { useAppStore } from '@/store'

const NODE_TYPES = ['compound', 'mechanism', 'theme'] as const
type NodeType = typeof NODE_TYPES[number]

const TYPE_STYLES: Record<NodeType, { active: string; inactive: string; dot: string }> = {
  compound:  { active: 'border-teal/60 bg-teal/10 text-teal', inactive: 'border-border text-text-muted', dot: 'bg-teal' },
  mechanism: { active: 'border-purple/60 bg-purple/10 text-purple', inactive: 'border-border text-text-muted', dot: 'bg-purple' },
  theme:     { active: 'border-green/60 bg-green/10 text-green', inactive: 'border-border text-text-muted', dot: 'bg-green' },
}

function useGraphStats() {
  const { data } = useGraphData()
  if (!data) return { compounds: 0, mechanisms: 0, connections: 0 }
  const compounds = data.nodes.filter((n) => n.type === 'compound').length
  const mechanisms = data.nodes.filter((n) => n.type === 'mechanism').length
  const connections = data.links.length
  return { compounds, mechanisms, connections }
}

function exportSVG() {
  const svg = document.querySelector('#compound-graph-svg') as SVGSVGElement
  if (!svg) return
  const serializer = new XMLSerializer()
  const svgStr = serializer.serializeToString(svg)
  const blob = new Blob([svgStr], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `compound-graph-${Date.now()}.svg`
  a.click()
  URL.revokeObjectURL(url)
}

export function GraphPage() {
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [hiddenTypes, setHiddenTypes] = useState<Set<NodeType>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [showPhysics, setShowPhysics] = useState(false)
  const [repulsion, setRepulsion] = useState(-300)
  const [linkDistance, setLinkDistance] = useState(80)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mobileOverride, setMobileOverride] = useState(false)
  const stats = useGraphStats()
  const graphRef = useRef<CompoundGraphHandle>(null)
  const { data: graphData, isLoading } = useGraphData()

  // Compute connected nodes for the selected node
  const connectedNodes = useMemo<GraphNode[]>(() => {
    if (!selected || !graphData) return []
    const neighbors = new Set<string>()
    for (const link of graphData.links) {
      if (String(link.source) === selected.id) neighbors.add(String(link.target))
      else if (String(link.target) === selected.id) neighbors.add(String(link.source))
    }
    return graphData.nodes.filter((n) => neighbors.has(n.id))
  }, [selected, graphData])

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelected(node)
  }, [])

  const handleViewInItems = useCallback(() => {
    if (!selected) return
    const { resetFilters, setFilter, setActiveView } = useAppStore.getState()
    resetFilters()
    if (selected.type === 'compound') setFilter('compound', selected.label)
    else if (selected.type === 'mechanism') setFilter('mechanism', selected.label)
    else if (selected.type === 'theme') setFilter('theme', selected.label)
    setActiveView('items')
  }, [selected])

  // Escape key to dismiss panel or exit fullscreen
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (selected) setSelected(null)
        else if (isFullscreen) setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, isFullscreen])

  function toggleType(type: NodeType) {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  if (!isLoading && (!graphData?.nodes || graphData.nodes.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center px-8">
        <div className="text-5xl mb-4 opacity-30">🕸️</div>
        <h3 className="text-base font-semibold text-text-primary mb-2">No graph data yet</h3>
        <p className="text-sm text-text-muted max-w-xs leading-relaxed">
          Items tagged with compounds or mechanisms will appear here as a network graph.
          Run a crawl to start gathering data.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mobile advisory */}
      {!mobileOverride && (
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center sm:hidden">
          <p className="text-sm text-text-secondary leading-relaxed max-w-xs">
            Graph visualization works best on larger screens. Rotate your device or use a desktop browser for the best experience.
          </p>
          <button
            onClick={() => setMobileOverride(true)}
            className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-medium text-text-primary"
          >
            Show anyway
          </button>
        </div>
      )}

      {/* Main graph content — hidden on mobile unless overridden */}
      <div className={cn(!mobileOverride && 'hidden sm:block')}>
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold text-text-primary">Compound / Mechanism Graph</h1>
        <div className="flex gap-2 text-xs">
          {NODE_TYPES.map((t) => {
            const hidden = hiddenTypes.has(t)
            const s = TYPE_STYLES[t]
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-mono transition-all',
                  hidden ? s.inactive : s.active,
                )}
                title={hidden ? `Show ${t}s` : `Hide ${t}s`}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', hidden ? 'bg-border' : s.dot)} />
                {t}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex flex-col items-end gap-0.5">
          <p className="text-xs text-text-muted font-mono">scroll to zoom · drag to pan</p>
          <p className="text-xs text-text-muted font-mono">Click a node to filter items by that compound, mechanism, or theme</p>
        </div>
      </div>

      {/* Stat pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="bg-bg-elevated border border-border rounded-full px-3 py-1 text-sm font-mono text-text-muted">
          {stats.compounds} Compounds
        </span>
        <span className="bg-bg-elevated border border-border rounded-full px-3 py-1 text-sm font-mono text-text-muted">
          {stats.mechanisms} Mechanisms
        </span>
        <span className="bg-bg-elevated border border-border rounded-full px-3 py-1 text-sm font-mono text-text-muted">
          {stats.connections} Connections
        </span>
      </div>

      {/* Search input */}
      <div className="relative max-w-xs">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-xs pointer-events-none">
          ⌕
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search nodes…"
          className="w-full bg-bg-elevated border border-border rounded-lg pl-7 pr-3 py-1.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-xs"
            title="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {/* Graph container — relative so overlays can be positioned inside */}
      <div className={cn('relative', isFullscreen && 'fixed inset-0 z-50 bg-bg-primary')}>
        <CompoundGraph
          ref={graphRef}
          onNodeClick={handleNodeClick}
          hiddenTypes={hiddenTypes}
          searchQuery={searchQuery}
          repulsion={repulsion}
          linkDistance={linkDistance}
        />

        {/* Export button — top-right overlay */}
        <div className="absolute top-3 right-3 flex gap-1.5 z-10">
          <button
            onClick={exportSVG}
            className="h-8 px-2 rounded-lg bg-bg-elevated/80 backdrop-blur-md border border-border/60 text-text-muted hover:text-text-primary hover:border-accent/40 flex items-center justify-center text-xs font-mono transition-colors"
            title="Export SVG"
          >
            SVG
          </button>
        </div>

        {/* Physics toggle button — bottom-left, above control bar */}
        <button
          onClick={() => setShowPhysics((p) => !p)}
          className="absolute bottom-16 left-4 z-10 h-7 px-2.5 rounded-lg bg-bg-elevated/80 backdrop-blur-md border border-border/60 text-text-muted hover:text-text-primary hover:border-accent/40 text-xs font-mono transition-colors"
          title="Toggle physics controls"
        >
          Physics
        </button>

        {/* Physics panel */}
        {showPhysics && (
          <div className="absolute bottom-24 left-3 z-10 bg-bg-elevated/90 backdrop-blur-md border border-border/60 rounded-xl p-3 w-48 space-y-3 shadow-lg">
            <p className="text-xs font-mono text-text-muted uppercase tracking-wide">Physics</p>

            {/* Repulsion slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs font-mono text-text-secondary">Repulsion</label>
                <span className="text-xs font-mono text-text-muted">{repulsion}</span>
              </div>
              <input
                type="range"
                min={-800}
                max={-50}
                step={10}
                value={repulsion}
                onChange={(e) => setRepulsion(Number(e.target.value))}
                className="w-full accent-accent h-1.5 cursor-pointer"
              />
            </div>

            {/* Link distance slider */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs font-mono text-text-secondary">Link distance</label>
                <span className="text-xs font-mono text-text-muted">{linkDistance}px</span>
              </div>
              <input
                type="range"
                min={30}
                max={200}
                step={5}
                value={linkDistance}
                onChange={(e) => setLinkDistance(Number(e.target.value))}
                className="w-full accent-accent h-1.5 cursor-pointer"
              />
            </div>

            {/* Reset physics */}
            <button
              onClick={() => { setRepulsion(-300); setLinkDistance(80) }}
              className="w-full text-xs font-mono text-text-muted hover:text-text-primary border border-border rounded-lg py-1 transition-colors"
            >
              Reset defaults
            </button>
          </div>
        )}

        {/* Bottom control bar */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-bg-elevated/80 backdrop-blur-md border border-border/60 rounded-xl px-2 py-1.5 shadow-lg">
          <button
            onClick={() => graphRef.current?.zoomOut()}
            className="w-7 h-7 rounded-lg hover:bg-bg-surface text-text-primary flex items-center justify-center text-sm font-mono transition-colors"
            title="Zoom out"
          >
            -
          </button>
          <button
            onClick={() => graphRef.current?.zoomIn()}
            className="w-7 h-7 rounded-lg hover:bg-bg-surface text-text-primary flex items-center justify-center text-sm font-mono transition-colors"
            title="Zoom in"
          >
            +
          </button>
          <div className="w-px h-5 bg-border/60 mx-0.5" />
          <button
            onClick={() => graphRef.current?.fitToView()}
            className="h-7 px-2 rounded-lg hover:bg-bg-surface text-text-muted hover:text-text-primary flex items-center justify-center text-xs font-mono transition-colors"
            title="Fit to view"
          >
            Fit
          </button>
          <button
            onClick={() => graphRef.current?.resetZoom()}
            className="h-7 px-2 rounded-lg hover:bg-bg-surface text-text-muted hover:text-text-primary flex items-center justify-center text-xs font-mono transition-colors"
            title="Reset zoom"
          >
            1:1
          </button>
          <div className="w-px h-5 bg-border/60 mx-0.5" />
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            className="h-7 px-2 rounded-lg hover:bg-bg-surface text-text-muted hover:text-text-primary flex items-center justify-center text-xs font-mono transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? 'Exit' : 'Full'}
          </button>
        </div>

        {/* Node info panel — slides in from right */}
        <div
          className={cn(
            'absolute top-0 right-0 h-full w-72 z-20 transition-transform duration-300 ease-in-out',
            selected ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          {selected && (
            <div className="h-full bg-bg-elevated/90 backdrop-blur-md border-l border-border/60 p-4 flex flex-col overflow-y-auto shadow-xl">
              {/* Close button */}
              <button
                onClick={() => setSelected(null)}
                className="absolute top-3 right-3 w-6 h-6 rounded-md hover:bg-bg-surface text-text-muted hover:text-text-primary flex items-center justify-center text-sm transition-colors"
                title="Close (Esc)"
              >
                x
              </button>

              {/* Node name */}
              <h2 className="text-base font-bold text-text-primary font-mono pr-6 break-words">
                {selected.label}
              </h2>

              {/* Type badge */}
              <span
                className={cn(
                  'inline-flex items-center gap-1 w-fit mt-2 px-2 py-0.5 rounded-full text-xs font-mono uppercase tracking-wide',
                  selected.type === 'compound' && 'bg-teal/15 text-teal',
                  selected.type === 'mechanism' && 'bg-purple/15 text-purple',
                  selected.type === 'theme' && 'bg-green/15 text-green',
                )}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    selected.type === 'compound' && 'bg-teal',
                    selected.type === 'mechanism' && 'bg-purple',
                    selected.type === 'theme' && 'bg-green',
                  )}
                />
                {selected.type}
              </span>

              {/* Connection count */}
              <p className="text-xs text-text-muted font-mono mt-3">
                {connectedNodes.length} connection{connectedNodes.length !== 1 ? 's' : ''}
              </p>

              {/* Connected nodes list */}
              {connectedNodes.length > 0 && (
                <div className="mt-3 space-y-1 flex-1 min-h-0">
                  <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1.5">Connected to</p>
                  <div className="space-y-0.5 overflow-y-auto max-h-64">
                    {connectedNodes.map((cn_) => (
                      <button
                        key={cn_.id}
                        onClick={() => {
                          setSelected(cn_)
                          graphRef.current?.centerOnNode(cn_.id)
                        }}
                        className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-surface transition-colors group"
                      >
                        <span
                          className={cn(
                            'w-2 h-2 rounded-full flex-shrink-0',
                            cn_.type === 'compound' && 'bg-teal',
                            cn_.type === 'mechanism' && 'bg-purple',
                            cn_.type === 'theme' && 'bg-green',
                          )}
                        />
                        <span className="text-xs font-mono text-text-secondary group-hover:text-text-primary truncate">
                          {cn_.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* View in Items button */}
              <button
                onClick={handleViewInItems}
                className="mt-4 w-full py-2 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 text-xs font-mono font-medium transition-colors"
              >
                View in Items
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

export default GraphPage
