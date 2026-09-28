import { useMemo, useState } from 'react'
import { FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { useCollections } from '@/hooks/useCollections'
import MediaCard from '@/components/MediaCard'
import Rail from '@/components/discovery/Rail'
import SectionHeader from '@/components/discovery/SectionHeader'
import { cn } from '@/lib/utils'
import '@/styles/discovery.css'

interface CollectionsRailProps {
  items: MediaItem[]
  onSelect: (item: MediaItem) => void
}

/**
 * Private on-device collections. Member ids resolve against the current live
 * feed; items that rotated out of the feed stay stored and are counted, never
 * re-fetched. All data lives in localStorage.
 */
export default function CollectionsRail({ items, onSelect }: CollectionsRailProps) {
  const { collections, create, rename, remove, removeItem } = useCollections()
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const open = collections.find((entry) => entry.id === openId) ?? null

  const resetOpenState = () => {
    setRenaming(false)
    setConfirmingDelete(false)
  }

  const submitCreate = () => {
    const name = draftName.trim()
    if (!name) return
    const collection = create(name)
    setDraftName('')
    setOpenId(collection.id)
    resetOpenState()
  }

  return (
    <section aria-label="Your collections">
      <SectionHeader
        title="Collections"
        eyebrow="On-device"
        icon={<FolderPlus size={12} strokeWidth={1.75} aria-hidden="true" />}
        note={collections.length === 0 ? 'Group favourites into private shelves. Nothing leaves this device.' : undefined}
      >
        <div className="d-field" style={{ flexBasis: 200 }}>
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitCreate()
            }}
            placeholder="New collection name"
            aria-label="New collection name"
            className="d-input"
            style={{ paddingLeft: 16, paddingRight: 16 }}
          />
        </div>
        <button onClick={submitCreate} disabled={!draftName.trim()} className="btn-secondary" aria-label="Create collection">
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Create
        </button>
      </SectionHeader>

      {collections.length > 0 && (
        <div className="d-chips">
          {collections.map((collection) => (
            <button
              key={collection.id}
              onClick={() => {
                setOpenId(openId === collection.id ? null : collection.id)
                resetOpenState()
              }}
              className={cn('chip', openId === collection.id && 'chip-active')}
              aria-pressed={openId === collection.id}
            >
              {collection.name}
              <span className="font-mono text-[10px] opacity-60">{collection.itemIds.length}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="d-panel mt-4">
          <div className="flex flex-wrap items-center gap-2">
            {renaming ? (
              <>
                <input
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && renameDraft.trim()) {
                      rename(open.id, renameDraft)
                      setRenaming(false)
                    }
                    if (event.key === 'Escape') setRenaming(false)
                  }}
                  aria-label="Rename collection"
                  autoFocus
                  className="d-input"
                  style={{ width: 220, paddingLeft: 16 }}
                />
                <button
                  onClick={() => {
                    if (renameDraft.trim()) rename(open.id, renameDraft)
                    setRenaming(false)
                  }}
                  className="btn-secondary"
                >
                  Save name
                </button>
              </>
            ) : (
              <>
                <p className="text-[15px] font-semibold tracking-tight text-ink">{open.name}</p>
                <button
                  onClick={() => {
                    setRenaming(true)
                    setRenameDraft(open.name)
                  }}
                  className="grid h-11 w-11 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                  aria-label={`Rename ${open.name}`}
                >
                  <Pencil size={14} strokeWidth={1.75} />
                </button>
              </>
            )}
            <button
              onClick={() => {
                if (!confirmingDelete) {
                  setConfirmingDelete(true)
                  return
                }
                remove(open.id)
                setOpenId(null)
                resetOpenState()
              }}
              onBlur={() => setConfirmingDelete(false)}
              className={cn('ml-auto', confirmingDelete ? 'btn-heat' : 'btn-secondary')}
            >
              <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
              {confirmingDelete ? 'Confirm delete' : 'Delete'}
            </button>
          </div>

          {open.itemIds.length === 0 ? (
            <p className="mt-4 text-[13px] text-ink-3">
              Nothing saved here yet. Open any item and use Collect to add it.
            </p>
          ) : (
            <>
              <div className="mt-4">
                <Rail ariaLabel={`${open.name} items`}>
                  {open.itemIds.map((itemId) => {
                    const item = byId.get(itemId)
                    if (!item) return null
                    return (
                      <div key={itemId} className="d-rail-item group relative" data-variant="poster" style={{ width: 'clamp(128px, 34vw, 160px)' }}>
                        <MediaCard item={item} aspectRatio="3 / 4" onSelect={() => onSelect(item)} />
                        <button
                          onClick={() => removeItem(open.id, itemId)}
                          className="d-remove"
                          aria-label={`Remove ${item.title} from ${open.name}`}
                        >
                          <X size={14} strokeWidth={2} />
                        </button>
                      </div>
                    )
                  })}
                </Rail>
              </div>
              {open.itemIds.some((itemId) => !byId.has(itemId)) && (
                <p className="mt-3 font-mono text-[10px] text-ink-3">
                  {open.itemIds.filter((itemId) => !byId.has(itemId)).length} saved item(s) are not in the current feed — they stay stored on this device.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
