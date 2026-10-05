/**
 * Structural sharing for discovery payloads.
 *
 * TanStack's default `replaceEqualDeep` walks the whole payload on every
 * refetch (hundreds of KB: 96 items plus creators that each carry up to 12
 * item copies). This replacement is O(items): it keeps the previous object for
 * every item/creator whose visible signature is unchanged, so memoised cards
 * (`React.memo(MediaCard)`) skip re-rendering on the 2-minute poll, and it
 * keeps the previous array identity when nothing in it changed.
 */

type Row = Record<string, unknown>

function s(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

export function itemSignature(item: Row): string {
  const tags = Array.isArray(item.tags) ? item.tags.length + ':' + (item.tags as unknown[]).slice(0, 3).join(',') : ''
  return [
    item.id, item.title, item.thumbnail, item.mediaUrl, item.views, item.likes, item.curationScore,
    item.isTrending, item.isNew, item.isLiked, item.duration, item.creator, item.createdAt, item.aspect, tags,
  ].map(s).join('|')
}

export function creatorSignature(creator: Row): string {
  return [
    creator.id, creator.name, creator.avatar, creator.followers, creator.mediaCount, creator.viewCount, creator.similarityScore,
    creator.isWatched, creator.isSimilar, creator.aiSuggested, creator.curationScore, creator.lastSeenAt,
  ].map(s).join('|')
}

/** Reuse previous elements (by position-independent id) whose signature is unchanged. */
export function reuseList<T extends Row>(previous: readonly T[] | undefined, next: readonly T[], idOf: (row: T) => string, signature: (row: T) => string): readonly T[] {
  if (!previous || !previous.length) return next
  const byId = new Map<string, { row: T; sig: string }>()
  for (const row of previous) byId.set(idOf(row), { row, sig: signature(row) })
  let identical = previous.length === next.length
  const merged = next.map((row, index) => {
    const old = byId.get(idOf(row))
    if (old && old.sig === signature(row)) {
      if (previous[index] !== old.row) identical = false
      return old.row
    }
    identical = false
    return row
  })
  return identical ? previous : merged
}

interface PayloadLike extends Row {
  items?: Row[]
  performers?: Row[]
}

/** `structuralSharing` implementation for `['live-discovery', ...]` queries. */
export function shareDiscovery(oldData: unknown, newData: unknown): unknown {
  if (!newData || typeof newData !== 'object') return newData
  const next = newData as PayloadLike
  const prev = oldData && typeof oldData === 'object' ? (oldData as PayloadLike) : undefined
  if (!prev) return newData
  const items = Array.isArray(next.items)
    ? reuseList(Array.isArray(prev.items) ? prev.items : undefined, next.items, (row) => s(row.id), itemSignature)
    : next.items
  const performers = Array.isArray(next.performers)
    ? reuseList(Array.isArray(prev.performers) ? prev.performers : undefined, next.performers, (row) => s(row.id), creatorSignature)
    : next.performers
  if (items === next.items && performers === next.performers) return newData
  return { ...next, items, performers }
}
