import { useMemo, useState } from 'react'
import { FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { MediaItem } from '@/lib/types'
import { useCollections } from '@/hooks/useCollections'
import MediaImage from '@/components/MediaImage'
import { cn } from '@/lib/utils'

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
    <section aria-label="Your collections" className="content-auto">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="eyebrow flex items-center gap-1.5">
          <FolderPlus size={12} strokeWidth={1.75} aria-hidden="true" /> Collections · on-device
        </h2>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitCreate()
            }}
            placeholder="New collection name"
            aria-label="New collection name"
            className="h-9 w-40 rounded-md border border-line bg-transparent px-2.5 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-line-strong"
          />
          <button onClick={submitCreate} disabled={!draftName.trim()} className="btn-secondary min-h-9 px-3 text-xs" aria-label="Create collection">
            <Plus size={13} strokeWidth={1.75} aria-hidden="true" /> Create
          </button>
        </div>
      </div>

      {collections.length > 0 && (
        <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
          {collections.map((collection) => (
            <button
              key={collection.id}
              onClick={() => {
                setOpenId(openId === collection.id ? null : collection.id)
                resetOpenState()
              }}
              className={cn('chip shrink-0', openId === collection.id && 'chip-active')}
              aria-pressed={openId === collection.id}
            >
              {collection.name}
              <span className="font-mono text-[9px] text-ink-3">{collection.itemIds.length}</span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-2 rounded-md border border-line p-3">
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
                  className="h-9 w-48 rounded-md border border-line bg-transparent px-2.5 text-[12px] text-ink outline-none focus:border-line-strong"
                />
                <button
                  onClick={() => {
                    if (renameDraft.trim()) rename(open.id, renameDraft)
                    setRenaming(false)
                  }}
                  className="btn-secondary min-h-9 px-3 text-xs"
                >
                  Save name
                </button>
              </>
            ) : (
              <>
                <p className="text-[13px] font-medium text-ink">{open.name}</p>
                <button
                  onClick={() => {
                    setRenaming(true)
                    setRenameDraft(open.name)
                  }}
                  className="grid h-8 w-8 place-items-center rounded text-ink-3 hover:text-ink"
                  aria-label={`Rename ${open.name}`}
                >
                  <Pencil size={13} strokeWidth={1.75} />
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
              className={cn('ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 font-mono text-[10px] uppercase tracking-[0.08em]', confirmingDelete ? 'bg-heat text-canvas' : 'text-ink-3 hover:text-ink')}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              {confirmingDelete ? 'Confirm delete' : 'Delete'}
            </button>
          </div>

          {open.itemIds.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-3">
              Nothing saved here yet. Open any item and use Collect to add it.
            </p>
          ) : (
            <>
              <div className="hide-scrollbar -mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-1">
                {open.itemIds.map((itemId) => {
                  const item = byId.get(itemId)
                  if (!item) return null
                  return (
                    <span key={itemId} className="group relative w-28 shrink-0">
                      <button onClick={() => onSelect(item)} className="block w-full text-left tap-highlight-none" aria-label={`Open ${item.title}`}>
                        <span className="relative block aspect-[2/3] overflow-hidden rounded-md bg-sunken">
                          <MediaImage
                            sources={item.isVideo ? [item.thumbnail] : [item.thumbnail, item.mediaUrl]}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                            skeletonClassName="absolute inset-0"
                          />
                        </span>
                        <span className="mt-1 block truncate text-[11px] font-medium text-ink">{item.title}</span>
                      </button>
                      <button
                        onClick={() => removeItem(open.id, itemId)}
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-canvas/85 text-ink opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label={`Remove ${item.title} from ${open.name}`}
                      >
                        <X size={12} strokeWidth={1.75} />
                      </button>
                    </span>
                  )
                })}
              </div>
              {open.itemIds.some((itemId) => !byId.has(itemId)) && (
                <p className="mt-2 font-mono text-[10px] text-ink-3">
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
