import { useEffect } from 'react'

const SHORTCUTS = [
  { key: '⌘K', description: 'Open command palette' },
  { key: 'j / k', description: 'Next / previous item (Items view)' },
  { key: 'Escape', description: 'Close drawer or deselect' },
  { key: '?', description: 'Show keyboard shortcuts' },
]

export function ShortcutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-surface border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-text-primary">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <table className="w-full">
          <tbody className="divide-y divide-border">
            {SHORTCUTS.map((s) => (
              <tr key={s.key}>
                <td className="py-2.5 pr-4 w-28">
                  <kbd className="font-mono text-xs bg-bg-subtle border border-border rounded px-2 py-1 text-text-secondary whitespace-nowrap">
                    {s.key}
                  </kbd>
                </td>
                <td className="py-2.5 text-sm text-text-secondary">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
