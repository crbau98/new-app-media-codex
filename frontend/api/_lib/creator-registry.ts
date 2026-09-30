/**
 * Curated creator registry: display names / aliases -> known public platform handles.
 *
 * HOW TO ADD A CREATOR
 *   1. Append an object to `CREATOR_REGISTRY` below.
 *   2. `canonicalName` is the public stage name; `aliases` are other spellings people type.
 *   3. Only fill `handles` with handles supplied by the product owner or verified against
 *      the provider. NEVER guess a handle for a real person. An entry with empty `handles`
 *      is still useful: its names drive live handle-variant resolution.
 *   4. Handles are provider usernames (Redgifs: lowercase, [a-z0-9_.-]).
 *
 * Public performer/creator stage names only. No real-world identity data, contacts or
 * locations belong here.
 */
export type CreatorRegistryEntry = {
  canonicalName: string
  aliases: string[]
  handles: { redgifs?: string[]; peertube?: string[]; x?: string[]; bluesky?: string[]; mastodon?: string[] }
  notes?: string
}

export const CREATOR_REGISTRY: CreatorRegistryEntry[] = [
  {
    canonicalName: 'Christian Hogue',
    aliases: ['christian hogue', 'hogue', 'hogues dirty laundry'],
    handles: { redgifs: ['hoguesdirtylaundry'] },
    notes: 'Redgifs handle supplied by the product owner.',
  },
  {
    canonicalName: 'Michael Yerger',
    aliases: ['michael yerger', 'yerger'],
    handles: {},
    notes: 'Handles resolved live from name variants; none seeded.',
  },
  {
    canonicalName: 'Jakipz',
    aliases: ['jakipz'],
    handles: {},
    notes: 'Handles resolved live from name variants; none seeded.',
  },
]

/** Lowercase, strip diacritics, drop everything except letters/digits. */
export function normalizeKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function keysFor(entry: CreatorRegistryEntry): string[] {
  const handles = Object.values(entry.handles).flat().filter((h): h is string => Boolean(h))
  return [entry.canonicalName, ...entry.aliases, ...handles].map(normalizeKey).filter(Boolean)
}

/** Entries whose canonical name, alias or handle equals the query after normalisation. */
export function findRegistryEntries(
  query: string,
  registry: CreatorRegistryEntry[] = CREATOR_REGISTRY,
): CreatorRegistryEntry[] {
  const key = normalizeKey(query)
  if (key.length < 2) return []
  return registry.filter((entry) => keysFor(entry).includes(key))
}

export function registryRedgifsHandles(entries: CreatorRegistryEntry[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of entries) {
    for (const handle of entry.handles.redgifs || []) {
      const key = handle.toLowerCase()
      if (!seen.has(key)) { seen.add(key); out.push(key) }
    }
  }
  return out
}
