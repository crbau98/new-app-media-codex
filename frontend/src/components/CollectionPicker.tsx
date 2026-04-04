import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Collection } from '@/lib/api'
import { useAppStore } from '@/store'

const PRESET_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
]

interface CollectionPickerProps {
  itemIds: number[]
  onDone?: () => void
}

export function CollectionPicker({ itemIds, onDone }: CollectionPickerProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const addToast = useAppStore((s) => s.addToast)
  const qc = useQueryClient()
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.collections(),
    enabled: open,
  })

  const addMutation = useMutation({
    mutationFn: ({ collectionId, ids }: { collectionId: number; ids: number[] }) =>
      api.addToCollection(collectionId, ids),
    onSuccess: (_data, { collectionId }) => {
      const coll = collections.find((c) => c.id === collectionId)
      addToast(`Added ${itemIds.length} item${itemIds.length > 1 ? 's' : ''} to ${coll?.name ?? 'collection'}`)
      qc.invalidateQueries({ queryKey: ['collections'] })
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; color: string }) => api.createCollection(data),
    onSuccess: (newColl) => {
      qc.invalidateQueries({ queryKey: ['collections'] })
      // Immediately add items to the new collection
      addMutation.mutate({ collectionId: newColl.id, ids: itemIds })
      setCreating(false)
      setNewName('')
      setNewColor(PRESET_COLORS[0])
      setOpen(false)
      onDone?.()
    },
  })

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Auto-focus new collection input
  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  function handleAddToExisting(collection: Collection) {
    addMutation.mutate({ collectionId: collection.id, ids: itemIds })
    setOpen(false)
    onDone?.()
  }

  function handleCreate() {
    const name = newName.trim()
    if (!name) return
    createMutation.mutate({ name, color: newColor })
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-bg-subtle border border-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
        Collection
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-xl border border-border bg-bg-surface shadow-xl overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-text-primary">
              Add {itemIds.length} item{itemIds.length > 1 ? 's' : ''} to collection
            </p>
          </div>

          {/* Collection list */}
          <div className="max-h-48 overflow-y-auto">
            {collections.length === 0 && !creating && (
              <p className="px-3 py-4 text-xs text-text-muted text-center">No collections yet</p>
            )}
            {collections.map((c) => (
              <button
                key={c.id}
                onClick={() => handleAddToExisting(c)}
                disabled={addMutation.isPending}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-bg-elevated transition-colors disabled:opacity-50"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-xs text-text-primary truncate flex-1">{c.icon} {c.name}</span>
                <span className="text-[10px] text-text-muted font-mono">{c.item_count}</span>
              </button>
            ))}
          </div>

          {/* Create new */}
          <div className="border-t border-border">
            {creating ? (
              <div className="p-3 space-y-2">
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Collection name..."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-bg-subtle text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate()
                    if (e.key === 'Escape') { setCreating(false); setNewName('') }
                  }}
                />
                {/* Color picker */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider mr-1">Color</span>
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewColor(color)}
                      className="w-5 h-5 rounded-full border-2 transition-all"
                      style={{
                        backgroundColor: color,
                        borderColor: newColor === color ? 'white' : 'transparent',
                        transform: newColor === color ? 'scale(1.15)' : 'scale(1)',
                      }}
                      aria-label={`Select color ${color}`}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim() || createMutation.isPending}
                    className="px-3 py-1 rounded-lg bg-accent text-white text-[11px] font-medium hover:bg-accent/80 transition-colors disabled:opacity-40"
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create & Add'}
                  </button>
                  <button
                    onClick={() => { setCreating(false); setNewName('') }}
                    className="px-2 py-1 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-accent hover:bg-accent/5 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                New collection
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
