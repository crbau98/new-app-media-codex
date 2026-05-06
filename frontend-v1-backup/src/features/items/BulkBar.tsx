import { useBulkUpdateItems } from '@/hooks/useItems'
import { Button } from '@/components/Button'
import { CollectionPicker } from '@/components/CollectionPicker'
import { useAppStore } from '@/store'
import type { ResearchItem } from '@/lib/api'

interface BulkBarProps {
  selected: Set<number>
  items: ResearchItem[]
  onClear: () => void
  onCompare?: () => void
}

export function BulkBar({ selected, items, onClear, onCompare }: BulkBarProps) {
  const bulkSave = useBulkUpdateItems()
  const bulkArchive = useBulkUpdateItems()
  const bulkShortlist = useBulkUpdateItems()
  const bulkQueue = useBulkUpdateItems()
  const addToast = useAppStore((s) => s.addToast)

  const selectedItems = items.filter((i) => selected.has(i.id))
  const allQueued = selectedItems.length > 0 && selectedItems.every((i) => !!i.queued_at)

  function handleQueue() {
    const patch = allQueued ? { queued_at: null } : { queued_at: new Date().toISOString() }
    bulkQueue.mutate(
      { item_ids: [...selected], patch },
      { onSuccess: () => { addToast(allQueued ? 'Removed from queue' : 'Added to queue'); onClear() } },
    )
  }

  function handleCopyMd() {
    const markdown = selectedItems.map((i) => {
      const compounds = i.compounds.length > 0 ? i.compounds.join(', ') : '—'
      const mechanisms = i.mechanisms.length > 0 ? i.mechanisms.join(', ') : '—'
      return [
        `## [${i.title}](${i.url})`,
        `**Source:** ${i.source_type} | **Status:** ${i.review_status} | **Score:** ${i.score.toFixed(1)}  `,
        `**Theme:** ${i.theme}`,
        '',
        `> ${i.summary ?? ''}`,
        '',
        `**Compounds:** ${compounds}`,
        `**Mechanisms:** ${mechanisms}`,
        '',
        '---',
      ].join('\n')
    }).join('\n\n')
    navigator.clipboard.writeText(markdown)
    addToast('Copied MD')
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-accent/10 border border-accent/30 rounded-xl text-sm">
      <span className="text-accent font-medium">{selected.size} selected</span>

      <Button
        variant="secondary"
        size="sm"
        loading={bulkSave.isPending}
        onClick={() => bulkSave.mutate({ item_ids: [...selected], patch: { is_saved: true } }, { onSuccess: onClear })}
      >
        Save
      </Button>

      <Button
        variant="secondary"
        size="sm"
        loading={bulkArchive.isPending}
        onClick={() => bulkArchive.mutate({ item_ids: [...selected], patch: { review_status: 'archived' } }, { onSuccess: onClear })}
      >
        Archive
      </Button>

      <Button
        variant="secondary"
        size="sm"
        loading={bulkShortlist.isPending}
        onClick={() => bulkShortlist.mutate({ item_ids: [...selected], patch: { review_status: 'shortlisted' } }, { onSuccess: onClear })}
      >
        Shortlist
      </Button>

      <Button
        variant="secondary"
        size="sm"
        loading={bulkQueue.isPending}
        onClick={handleQueue}
      >
        {allQueued ? 'Dequeue' : 'Queue'}
      </Button>

      {selected.size >= 2 && selected.size <= 4 && onCompare && (
        <Button variant="secondary" size="sm" onClick={onCompare}>
          Compare ({selected.size})
        </Button>
      )}

      <CollectionPicker itemIds={[...selected]} />

      <Button variant="secondary" size="sm" onClick={handleCopyMd}>
        Copy MD
      </Button>

      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
