import { lazy, Suspense, useState } from 'react'
import { useAppStore } from '@/store'

// The AI command bar (NL parser, BM25 search, taste engine, previews) lives in a
// separate lazy chunk that is only fetched the first time the palette opens.
const CommandBar = lazy(() => import('@/features/ai/CommandBar'))

/**
 * Cmd/Ctrl-K entry point. Kept as a thin shell so the existing lazy import in
 * App.tsx and the `commandPaletteOpen` store flag keep working unchanged.
 */
export default function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  // Stay mounted after the first open so the exit animation can play and reopening is instant.
  const [everOpened, setEverOpened] = useState(open)
  if (open && !everOpened) setEverOpened(true)

  if (!open && !everOpened) return null
  return (
    <Suspense fallback={null}>
      <CommandBar open={open} onClose={() => setOpen(false)} />
    </Suspense>
  )
}
