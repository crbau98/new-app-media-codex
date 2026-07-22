/**
 * Source-agnostic quality gates used by the live edge aggregator.
 *
 * These helpers only inspect publisher-provided text metadata. They do not
 * inspect people, faces, bodies, or infer identity or other sensitive traits.
 */

type PeerTubeMetadata = {
  name?: string
  description?: string
  tags?: string[]
  accountName?: string
  channelName?: string
}

type RankedSourceItem = {
  source: string
  curationScore: number
}

const MALE_SCOPE_MARKERS = new Set([
  'gay', 'male', 'man', 'men', 'mlm', 'boy', 'boys', 'guy', 'guys', 'twink',
  'hunk', 'jock', 'daddy', 'bear',
])

const EXPLICIT_ADULT_MARKERS = new Set([
  'adult', 'nsfw', 'porn', 'porno', 'xxx', 'anal', 'bareback', 'blowjob',
  'cock', 'dick', 'dildo', 'nude', 'naked', 'hardcore', 'masturbation',
  'masturbating', 'orgasm', 'oral', 'penetration', 'cum', 'semen',
])

const OFF_SCOPE_MARKERS = new Set([
  'female', 'woman', 'women', 'girl', 'girls', 'lesbian', 'straight', 'pussy',
  'vagina', 'wife', 'girlfriend', 'milf', 'femdom',
])

const UNSAFE_OR_LOW_SIGNAL_PHRASES = [
  'end my life', 'kill myself', 'self harm', 'self-harm', 'suicide',
  'sex offender', 'unregistered offender',
]

function metadataTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9/]+/).filter(Boolean))
}

/**
 * A general federated index can contain podcasts, memes, and unrelated videos
 * that happen to use an identity term. Require both male-scope and explicit
 * adult publisher metadata before a PeerTube item enters the default archive.
 */
export function isScopedAdultPeerTubeMetadata(metadata: PeerTubeMetadata): boolean {
  const text = [
    metadata.name || '',
    metadata.description || '',
    ...(metadata.tags || []),
    metadata.accountName || '',
    metadata.channelName || '',
  ].join(' ').toLowerCase()
  if (UNSAFE_OR_LOW_SIGNAL_PHRASES.some((phrase) => text.includes(phrase))) return false
  const tokens = metadataTokens(text)
  if ([...OFF_SCOPE_MARKERS].some((marker) => tokens.has(marker))) return false
  const inScope = [...MALE_SCOPE_MARKERS].some((marker) => tokens.has(marker))
  const explicitlyAdult = [...EXPLICIT_ADULT_MARKERS].some((marker) => tokens.has(marker))
  return inScope && explicitlyAdult
}

/**
 * Preserve ranked quality while preventing one source from monopolizing a
 * result page. A weak secondary source is never promoted over much stronger
 * items merely to satisfy a diversity quota.
 */
export function selectQualityDiverse<T extends RankedSourceItem>(items: T[], count: number): T[] {
  if (count <= 0 || !items.length) return []
  const primarySource = items[0].source
  const primaryScore = items[0].curationScore || 0
  const secondaryQualityFloor = Math.max(25, primaryScore - 45)
  const perSourceSoftCap = Math.max(6, Math.ceil(count * 0.8))
  const selected: T[] = []
  const deferred: T[] = []
  const perSource = new Map<string, number>()

  for (const item of items) {
    const sourceCount = perSource.get(item.source) || 0
    const weakAlternative = item.source !== primarySource && item.curationScore < secondaryQualityFloor
    if (weakAlternative || sourceCount >= perSourceSoftCap) {
      deferred.push(item)
      continue
    }
    selected.push(item)
    perSource.set(item.source, sourceCount + 1)
    if (selected.length >= count) return selected
  }

  // Deferred items retain the original ranked order. This relaxes the soft
  // cap when stronger alternatives do not exist without manufacturing gaps.
  for (const item of deferred) {
    selected.push(item)
    if (selected.length >= count) break
  }
  return selected
}
