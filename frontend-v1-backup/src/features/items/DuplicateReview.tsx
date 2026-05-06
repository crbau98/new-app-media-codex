import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { DuplicateGroup, DuplicateItem } from '@/lib/api'
import { Button } from '@/components/Button'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/cn'
import { useAppStore } from '@/store'

function DuplicateCard({
  item,
  isKeeper,
  onKeep,
}: {
  item: DuplicateItem
  isKeeper: boolean
  onKeep: () => void
}) {
  return (
    <div
      className={cn(
        'flex-1 rounded-lg border p-3 text-xs transition-colors',
        isKeeper
          ? 'border-green-500/50 bg-green-500/5'
          : 'border-border bg-bg-surface',
      )}
    >
      <h4 className="font-medium text-text-primary line-clamp-2 mb-1.5 text-sm leading-snug">
        {item.title}
      </h4>
      <div className="space-y-0.5 text-text-muted mb-3">
        <p className="truncate">{item.url}</p>
        <p>
          <span className="inline-block px-1.5 py-0.5 rounded bg-bg-subtle text-text-secondary font-medium">
            {item.source_type}
          </span>
          {item.theme && (
            <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-bg-subtle text-text-secondary">
              {item.theme}
            </span>
          )}
        </p>
        <p>Score: {item.score?.toFixed(1) ?? '—'}</p>
      </div>
      <Button
        size="sm"
        variant={isKeeper ? 'primary' : 'secondary'}
        onClick={onKeep}
      >
        {isKeeper ? 'Keeping' : 'Keep this one'}
      </Button>
    </div>
  )
}

function GroupCard({
  group,
  onMerge,
  onDismiss,
  merging,
}: {
  group: DuplicateGroup
  onMerge: (keepId: number) => void
  onDismiss: () => void
  merging: boolean
}) {
  const [keepId, setKeepId] = useState<number | null>(null)

  const handleKeep = (id: number) => {
    setKeepId(id)
    onMerge(id)
  }

  return (
    <div className="rounded-xl border border-border bg-bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
          {group.reason === 'same_url' ? 'Same URL' : 'Similar Title'}
        </span>
        <button
          onClick={onDismiss}
          className="text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          Dismiss
        </button>
      </div>
      <div className="flex gap-3">
        {group.items.map((item) => (
          <DuplicateCard
            key={item.id}
            item={item}
            isKeeper={keepId === item.id}
            onKeep={() => handleKeep(item.id)}
          />
        ))}
      </div>
      {merging && (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Spinner size="sm" /> Merging...
        </div>
      )}
    </div>
  )
}

export function DuplicateReview({ onClose }: { onClose: () => void }) {
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [mergingIdx, setMergingIdx] = useState<number | null>(null)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['duplicates'],
    queryFn: () => api.duplicates(),
  })

  const groups = (data?.groups ?? []).filter((_, i) => !dismissed.has(i))

  const handleMerge = async (groupIdx: number, keepId: number, group: DuplicateGroup) => {
    const removeIds = group.items.map((i) => i.id).filter((id) => id !== keepId)
    setMergingIdx(groupIdx)
    try {
      const result = await api.mergeItems(keepId, removeIds)
      addToast(`Merged ${result.merged} duplicate${result.merged !== 1 ? 's' : ''}`)
      setDismissed((s) => new Set(s).add(groupIdx))
      qc.invalidateQueries({ queryKey: ['items'] })
      refetch()
    } catch {
      addToast('Merge failed', 'error')
    } finally {
      setMergingIdx(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl max-h-[75vh] overflow-y-auto rounded-2xl border border-border bg-bg-base shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border bg-bg-base/95 backdrop-blur-sm rounded-t-2xl">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-text-primary">
              Duplicate Review
            </h2>
            {!isLoading && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
                {groups.length} group{groups.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-subtle transition-colors"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="text-4xl mb-3 opacity-30">&#10003;</div>
              <p className="text-sm text-text-muted">
                No duplicate items found.
              </p>
            </div>
          ) : (
            groups.map((group, idx) => (
              <GroupCard
                key={`${group.reason}-${group.items.map((i) => i.id).join('-')}`}
                group={group}
                onMerge={(keepId) => handleMerge(idx, keepId, group)}
                onDismiss={() => setDismissed((s) => new Set(s).add(idx))}
                merging={mergingIdx === idx}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
