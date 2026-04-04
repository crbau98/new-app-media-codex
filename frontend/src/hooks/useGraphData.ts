import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface GraphNode {
  id: string
  label: string
  type: 'compound' | 'mechanism' | 'theme'
  weight: number
}

export interface GraphLink {
  source: string
  target: string
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

export function useGraphData() {
  return useQuery({
    queryKey: ['graph-data'],
    queryFn: () => api.browseItems({ limit: 500 }).then(buildGraph),
    staleTime: 300_000,
  })
}

// Null byte won't appear in compound/mechanism names — safe separator
const LINK_SEP = '\x00'

function buildGraph(itemsPage: { items: { compounds: string[]; mechanisms: string[]; theme: string }[] }): GraphData {
  const nodes = new Map<string, GraphNode>()
  const linkMap = new Map<string, number>()

  const ensureNode = (id: string, type: GraphNode['type']) => {
    if (!nodes.has(id)) nodes.set(id, { id, label: id, type, weight: 0 })
    nodes.get(id)!.weight++
  }

  for (const item of itemsPage.items ?? []) {
    const cs = item.compounds ?? []
    const ms = item.mechanisms ?? []
    const theme = item.theme
    cs.forEach((c) => ensureNode(c, 'compound'))
    ms.forEach((m) => ensureNode(m, 'mechanism'))
    if (theme) ensureNode(theme, 'theme')
    cs.forEach((c) =>
      ms.forEach((m) => {
        const key = `${c}${LINK_SEP}${m}`
        linkMap.set(key, (linkMap.get(key) ?? 0) + 1)
      })
    )
  }

  const links = [...linkMap.entries()]
    .filter(([, w]) => w > 0)
    .map(([key, weight]) => {
      const sep = key.indexOf(LINK_SEP)
      return { source: key.slice(0, sep), target: key.slice(sep + 1), weight }
    })

  return { nodes: [...nodes.values()], links }
}
