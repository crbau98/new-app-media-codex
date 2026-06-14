import { useEffect, useRef, useState, useId, useCallback, useImperativeHandle, forwardRef } from 'react'
import { drag } from 'd3-drag'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { scaleSqrt } from 'd3-scale'
import { select, type Selection } from 'd3-selection'
import { zoom as createZoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import { useGraphData, type GraphNode, type GraphLink } from '@/hooks/useGraphData'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/cn'

type SimNode = GraphNode & SimulationNodeDatum
type SimLink = GraphLink & SimulationLinkDatum<SimNode>

export type { GraphNode }

interface TooltipState {
  visible: boolean
  x: number
  y: number
  node: GraphNode | null
}

interface CompoundGraphProps {
  onNodeClick?: (node: GraphNode) => void
  hiddenTypes?: Set<string>
  searchQuery?: string
  repulsion?: number
  linkDistance?: number
}

export interface CompoundGraphHandle {
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  fitToView: () => void
  centerOnNode: (nodeId: string) => void
}

export interface CompoundGraphStats {
  compounds: number
  mechanisms: number
  connections: number
}

export const CompoundGraph = forwardRef<CompoundGraphHandle, CompoundGraphProps>(function CompoundGraph(
  {
    onNodeClick,
    hiddenTypes = new Set(),
    searchQuery = '',
    repulsion = -300,
    linkDistance = 80,
  },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const linksSelRef = useRef<Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null>(null)
  const currentZoomRef = useRef<number>(1)
  const { data, isLoading } = useGraphData()
  const onNodeClickRef = useRef(onNodeClick)
  useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])

  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, node: null })

  // Stable ref for tooltip setter so D3 handlers don't stale-close
  const setTooltipRef = useRef(setTooltip)
  useEffect(() => { setTooltipRef.current = setTooltip }, [])

  // Unique gradient id prefix to avoid SVG id collisions in the page
  const gradId = useId().replace(/:/g, '_')

  const nodeGroupRef = useRef<Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null)
  const nodesDataRef = useRef<SimNode[]>([])

  // Build degree map from links so we can scale by degree
  const degreeMap = useRef<Map<string, number>>(new Map())

  // Zoom callbacks (stable — no deps on re-rendered closures)
  const zoomIn = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 1.4)
  }, [])
  const zoomOut = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(250).call(zoomRef.current.scaleBy, 0.7)
  }, [])
  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return
    select(svgRef.current).transition().duration(300).call(zoomRef.current.transform, zoomIdentity)
  }, [])

  const fitToView = useCallback(() => {
    if (!svgRef.current || !zoomRef.current || nodesDataRef.current.length === 0) return
    const nodes = nodesDataRef.current
    const xs = nodes.map((n) => n.x ?? 0)
    const ys = nodes.map((n) => n.y ?? 0)
    const minX = Math.min(...xs) - 40
    const maxX = Math.max(...xs) + 40
    const minY = Math.min(...ys) - 40
    const maxY = Math.max(...ys) + 40
    const rect = svgRef.current.getBoundingClientRect()
    const w = rect.width || 800
    const h = rect.height || 600
    const scale = Math.min(w / (maxX - minX), h / (maxY - minY), 2) * 0.9
    const tx = w / 2 - (minX + maxX) / 2 * scale
    const ty = h / 2 - (minY + maxY) / 2 * scale
    select(svgRef.current)
      .transition()
      .duration(400)
      .call(zoomRef.current.transform, zoomIdentity.translate(tx, ty).scale(scale))
  }, [])

  const centerOnNode = useCallback((nodeId: string) => {
    if (!svgRef.current || !zoomRef.current) return
    const node = nodesDataRef.current.find((n) => n.id === nodeId)
    if (!node || node.x == null || node.y == null) return
    const rect = svgRef.current.getBoundingClientRect()
    const w = rect.width || 800
    const h = rect.height || 600
    const scale = 1.5
    const tx = w / 2 - node.x * scale
    const ty = h / 2 - node.y * scale
    select(svgRef.current)
      .transition()
      .duration(400)
      .call(zoomRef.current.transform, zoomIdentity.translate(tx, ty).scale(scale))
  }, [])

  // Expose imperative handle to parent via ref
  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, resetZoom, fitToView, centerOnNode }), [zoomIn, zoomOut, resetZoom, fitToView, centerOnNode])

  useEffect(() => {
    if (!data || !svgRef.current) return
    const svgEl = svgRef.current
    const svg = select(svgEl)
    svg.selectAll('*').remove()

    const rect = svgEl.getBoundingClientRect()
    const w = rect.width || 800
    const h = rect.height || 600

    // Filter by hidden types
    const nodes: SimNode[] = data.nodes
      .filter((n) => !hiddenTypes.has(n.type))
      .map((n) => ({ ...n }))
    const nodeIds = new Set(nodes.map((n) => n.id))
    const links: SimLink[] = data.links
      .filter((l) => nodeIds.has(String(l.source)) && nodeIds.has(String(l.target)))
      .map((l) => ({ ...l }))

    // Compute degree for each node
    const deg = new Map<string, number>()
    nodes.forEach((n) => deg.set(n.id, 0))
    links.forEach((l) => {
      const s = String(l.source)
      const t = String(l.target)
      deg.set(s, (deg.get(s) ?? 0) + 1)
      deg.set(t, (deg.get(t) ?? 0) + 1)
    })
    degreeMap.current = deg
    nodesDataRef.current = nodes

    const maxDegree = Math.max(1, ...deg.values())
    const rScale = scaleSqrt().domain([1, maxDegree]).range([6, 20])
    const nodeRadius = (d: SimNode) => rScale(Math.max(1, deg.get(d.id) ?? 1))

    // --- SVG defs: radial gradients + link gradient ---
    const defs = svg.append('defs')

    // Compound radial gradient
    const compGrad = defs
      .append('radialGradient')
      .attr('id', `${gradId}_compound`)
      .attr('cx', '35%')
      .attr('cy', '35%')
      .attr('r', '65%')
    compGrad.append('stop').attr('offset', '0%').attr('stop-color', '#5eead4')   // lighter teal
    compGrad.append('stop').attr('offset', '100%').attr('stop-color', '#0d9488')  // darker teal

    // Mechanism radial gradient
    const mechGrad = defs
      .append('radialGradient')
      .attr('id', `${gradId}_mechanism`)
      .attr('cx', '35%')
      .attr('cy', '35%')
      .attr('r', '65%')
    mechGrad.append('stop').attr('offset', '0%').attr('stop-color', '#d8b4fe')   // lighter purple
    mechGrad.append('stop').attr('offset', '100%').attr('stop-color', '#7e22ce')  // darker purple

    // Theme radial gradient (fallback)
    const themeGrad = defs
      .append('radialGradient')
      .attr('id', `${gradId}_theme`)
      .attr('cx', '35%')
      .attr('cy', '35%')
      .attr('r', '65%')
    themeGrad.append('stop').attr('offset', '0%').attr('stop-color', '#86efac')
    themeGrad.append('stop').attr('offset', '100%').attr('stop-color', '#15803d')

    // Single linear gradient for links (teal -> purple)
    const linkGrad = defs
      .append('linearGradient')
      .attr('id', `${gradId}_link`)
      .attr('gradientUnits', 'userSpaceOnUse')
    linkGrad.append('stop').attr('offset', '0%').attr('stop-color', '#14b8a6').attr('stop-opacity', 0.7)
    linkGrad.append('stop').attr('offset', '100%').attr('stop-color', '#a855f7').attr('stop-opacity', 0.7)

    // --- Zoom container ---
    const container = svg.append('g').attr('class', 'zoom-container')

    const zoom = createZoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform)
        currentZoomRef.current = event.transform.k

        // Show labels when zoomed in enough
        const showAll = event.transform.k >= 1.8
        container.selectAll<SVGTextElement, SimNode>('text.node-label')
          .attr('opacity', (_d) => showAll ? 1 : 0)
      })
    svg.call(zoom)
    zoomRef.current = zoom

    // --- Simulation ---
    const sim = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(linkDistance))
      .force('charge', forceManyBody().strength(repulsion))
      .force('center', forceCenter(w / 2, h / 2))
      .force('collision', forceCollide((d: SimNode) => nodeRadius(d) + 4))

    simRef.current = sim

    // --- Links ---
    const link = container
      .append('g')
      .attr('class', 'links')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', `url(#${gradId}_link)`)
      .attr('stroke-width', (d) => Math.sqrt(d.weight) * 1.2)
      .attr('stroke-opacity', 0.55)

    linksSelRef.current = link

    // --- Node groups ---
    const nodeGroup = container
      .append('g')
      .attr('class', 'nodes')

    const node = nodeGroup
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => {
        onNodeClickRef.current?.(d)
      })
      .call(
        drag<SVGGElement, SimNode>()
          .on('start', (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) sim.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    nodeGroupRef.current = node as unknown as Selection<SVGGElement, SimNode, SVGGElement, unknown>

    // Circles with gradient fill
    node.append('circle')
      .attr('class', 'node-circle')
      .attr('r', nodeRadius)
      .attr('fill', (d) => `url(#${gradId}_${d.type})`)
      .attr('stroke', '#0a0e13')
      .attr('stroke-width', 1.5)

    // Labels (hidden by default, shown on hover or zoom)
    node.append('text')
      .attr('class', 'node-label')
      .text((d) => d.label.length > 20 ? d.label.slice(0, 20) + '...' : d.label)
      .attr('dy', (d) => nodeRadius(d) + 12)
      .attr('dx', 0)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('font-family', 'monospace')
      .attr('fill', '#4e6582')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)  // hidden by default

    // Hover events for tooltip and label reveal
    node
      .on('mouseenter', (event: MouseEvent, d: SimNode) => {
        // Show label on this node
        select(event.currentTarget as SVGGElement)
          .select('text.node-label')
          .attr('opacity', 1)

        // Highlight ring
        select(event.currentTarget as SVGGElement)
          .select('circle.node-circle')
          .attr('stroke', '#3b82f6')
          .attr('stroke-width', 2.5)

        const degree = degreeMap.current.get(d.id) ?? 0
        setTooltipRef.current({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          node: { id: d.id, label: d.label, type: d.type, weight: degree },
        })
      })
      .on('mousemove', (event: MouseEvent) => {
        setTooltipRef.current((prev) => ({
          ...prev,
          x: event.clientX,
          y: event.clientY,
        }))
      })
      .on('mouseleave', (event: MouseEvent, _d: SimNode) => {
        const showAll = currentZoomRef.current >= 1.8
        select(event.currentTarget as SVGGElement)
          .select('text.node-label')
          .attr('opacity', showAll ? 1 : 0)

        // Restore stroke (may be overridden by search highlight)
        select(event.currentTarget as SVGGElement)
          .select('circle.node-circle')
          .attr('stroke', '#0a0e13')
          .attr('stroke-width', 1.5)

        setTooltipRef.current({ visible: false, x: 0, y: 0, node: null })
      })

    // Tick
    sim.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0)
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
    })

    return () => { sim.stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hiddenTypes, gradId])

  // Reheat simulation when physics props change (without full re-render)
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    sim.force('charge', forceManyBody().strength(repulsion))
    const linkForce = sim.force<ForceLink<SimNode, SimLink>>('link')
    if (linkForce) linkForce.distance(linkDistance)
    sim.alpha(0.3).restart()
  }, [repulsion, linkDistance])

  // Reactive search highlight — no re-simulation
  useEffect(() => {
    if (!svgRef.current) return
    const container = select(svgRef.current).select<SVGGElement>('g.zoom-container')
    const nodeGroups = container.selectAll<SVGGElement, SimNode>('g.nodes > g')

    if (!searchQuery.trim()) {
      // Restore all
      nodeGroups.each(function () {
        select(this).select('circle.node-circle')
          .attr('stroke', '#0a0e13')
          .attr('stroke-width', 1.5)
        select(this).attr('opacity', 1)
      })
      return
    }

    const q = searchQuery.toLowerCase()
    nodeGroups.each(function (d) {
      const matches = d.label.toLowerCase().includes(q)
      if (matches) {
        select(this).select('circle.node-circle')
          .attr('stroke', '#3b82f6')
          .attr('stroke-width', 2)
        select(this).attr('opacity', 1)
      } else {
        select(this).select('circle.node-circle')
          .attr('stroke', '#0a0e13')
          .attr('stroke-width', 1.5)
        select(this).attr('opacity', 0.2)
      }
    })
  }, [searchQuery])

  if (isLoading) return <div className="flex justify-center py-20"><Spinner size={32} /></div>

  if (!data || data.nodes.length === 0) {
    return <div className="flex justify-center py-20"><p className="text-xs text-text-muted font-mono">No graph data yet</p></div>
  }

  return (
    <div className="relative">
      <svg
        id="compound-graph-svg"
        ref={svgRef}
        aria-label="Force-directed graph of compounds and mechanisms"
        role="img"
        className="w-full h-[600px] bg-bg-surface border border-border rounded-xl"
      />

      {/* Floating legend — top-left glass card */}
      <div className="absolute top-4 left-4 bg-bg-elevated/80 backdrop-blur-md rounded-xl p-3 border border-border/60 text-xs space-y-1.5 pointer-events-none shadow-lg">
        <p className="text-text-muted font-mono uppercase tracking-wider mb-1" style={{ fontSize: 9 }}>Legend</p>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-teal" />
          <span className="text-text-muted font-mono">Compound</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-purple" />
          <span className="text-text-muted font-mono">Mechanism</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-green" />
          <span className="text-text-muted font-mono">Theme</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-px flex-shrink-0 bg-text-muted/50" />
          <span className="text-text-muted font-mono">Connection</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip.visible && tooltip.node && (
        <div
          className="fixed z-50 pointer-events-none bg-bg-elevated border border-border text-text-primary rounded-lg shadow-2xl px-3 py-2 text-sm"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <p className="font-semibold font-mono text-text-primary truncate max-w-[180px]">
            {tooltip.node.label}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded font-mono uppercase tracking-wide',
                tooltip.node.type === 'compound' && 'bg-teal/15 text-teal',
                tooltip.node.type === 'mechanism' && 'bg-purple/15 text-purple',
                tooltip.node.type === 'theme' && 'bg-green/15 text-green',
              )}
            >
              {tooltip.node.type}
            </span>
            <span className="text-xs text-text-muted font-mono">
              {tooltip.node.weight} connection{tooltip.node.weight !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs text-text-muted mt-1.5 font-mono">Click to filter</p>
        </div>
      )}
    </div>
  )
})
