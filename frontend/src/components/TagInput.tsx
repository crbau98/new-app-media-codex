import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

const PRESET_COLORS = [
  '#6b7280', // gray
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
]

interface TagInputProps {
  itemId: number
}

export function TagInput({ itemId }: TagInputProps) {
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0])
  const [showColorPicker, setShowColorPicker] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch tags for this item
  const { data: itemTags = [] } = useQuery({
    queryKey: ['item-tags', itemId],
    queryFn: () => api.itemTags(itemId),
    staleTime: 30_000,
  })

  // Fetch all tags for autocomplete
  const { data: allTags = [] } = useQuery({
    queryKey: ['all-tags'],
    queryFn: () => api.tags(),
    staleTime: 60_000,
  })

  // Filter suggestions: not already on this item, matches input
  const suggestions = allTags
    .filter((t) => !itemTags.some((it) => it.id === t.id))
    .filter((t) => !input || t.name.toLowerCase().includes(input.toLowerCase()))
    .slice(0, 8)

  const exactMatch = allTags.find((t) => t.name.toLowerCase() === input.trim().toLowerCase())
  const showCreateOption = input.trim() && !exactMatch

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function addTag(tag: { tag_id?: number; tag_name?: string; color?: string }) {
    await api.addItemTag(itemId, tag)
    qc.invalidateQueries({ queryKey: ['item-tags', itemId] })
    qc.invalidateQueries({ queryKey: ['all-tags'] })
    setInput('')
    setShowSuggestions(false)
    setShowColorPicker(false)
  }

  async function removeTag(tagId: number) {
    await api.removeItemTag(itemId, tagId)
    qc.invalidateQueries({ queryKey: ['item-tags', itemId] })
    qc.invalidateQueries({ queryKey: ['all-tags'] })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault()
      if (exactMatch) {
        addTag({ tag_id: exactMatch.id })
      } else {
        addTag({ tag_name: input.trim(), color: selectedColor })
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setShowColorPicker(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={containerRef} className="space-y-1.5">
      {/* Current tags as pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {itemTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors"
            style={{
              backgroundColor: `${tag.color}15`,
              borderColor: `${tag.color}40`,
              color: tag.color,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
            <button
              onClick={() => removeTag(tag.id)}
              className="ml-0.5 hover:opacity-70 transition-opacity"
              aria-label={`Remove tag ${tag.name}`}
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}

        {/* Inline input */}
        <div className="relative">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={handleKeyDown}
            placeholder="+ tag"
            className="w-20 focus:w-36 transition-all bg-transparent text-[11px] text-text-secondary placeholder:text-text-muted outline-none border-b border-transparent focus:border-accent/40 py-0.5 px-1"
          />

          {/* Suggestions dropdown */}
          {showSuggestions && (suggestions.length > 0 || showCreateOption) && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] max-h-48 overflow-y-auto rounded-lg border border-border bg-bg-surface shadow-lg py-1">
              {suggestions.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => addTag({ tag_id: tag.id })}
                  className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-subtle transition-colors flex items-center gap-2"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                  {tag.usage_count != null && tag.usage_count > 0 && (
                    <span className="ml-auto text-[10px] text-text-muted">{tag.usage_count}</span>
                  )}
                </button>
              ))}
              {showCreateOption && (
                <>
                  {suggestions.length > 0 && <div className="border-t border-border my-1" />}
                  <button
                    onClick={() => setShowColorPicker((v) => !v)}
                    className="w-full text-left px-3 py-1.5 text-xs text-accent hover:bg-accent/10 transition-colors flex items-center gap-2"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: selectedColor }}
                    />
                    Create "{input.trim()}"
                  </button>
                  {showColorPicker && (
                    <div className="px-3 py-2 flex flex-wrap gap-1.5">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => {
                            setSelectedColor(c)
                            addTag({ tag_name: input.trim(), color: c })
                          }}
                          className={cn(
                            'w-5 h-5 rounded-full border-2 transition-transform hover:scale-110',
                            selectedColor === c ? 'border-text-primary scale-110' : 'border-transparent'
                          )}
                          style={{ backgroundColor: c }}
                          aria-label={`Color ${c}`}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
