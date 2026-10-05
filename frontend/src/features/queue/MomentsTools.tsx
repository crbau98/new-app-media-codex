import { useRef } from 'react'
import { Download, Upload } from 'lucide-react'
import { useAppStore } from '@/store'
import { momentsActions } from './momentsStore'
import { MAX_IMPORT_BYTES } from './momentsModel'

/** Download text as a file the viewer keeps — nothing is uploaded anywhere. */
export function downloadTextFile(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

interface MomentsToolsProps {
  /** Disable Export when there is nothing to export. */
  count: number
  className?: string
  size?: 'sm' | 'md'
}

/** Export all moments to a JSON file, or import one (merged, duplicates skipped). */
export default function MomentsTools({ count, className, size = 'sm' }: MomentsToolsProps) {
  const addToast = useAppStore((state) => state.addToast)
  const inputRef = useRef<HTMLInputElement>(null)
  const button = size === 'md' ? 'btn-secondary' : 'btn-secondary min-h-9 px-3 text-xs'

  const onExport = () => {
    const stamp = new Date().toISOString().slice(0, 10)
    downloadTextFile(`media-codex-moments-${stamp}.json`, momentsActions.exportJson())
    addToast({ type: 'success', title: 'Moments exported', message: `${count} moment${count === 1 ? '' : 's'} saved to a JSON file on this device.` })
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) {
      addToast({ type: 'error', title: 'That file is too large', message: 'Choose a Media Codex moments export.' })
      return
    }
    try {
      const result = momentsActions.importJson(await file.text())
      if (!result.ok) {
        addToast({ type: 'error', title: 'Could not import moments', message: result.error })
        return
      }
      const parts = [`${result.added} added`]
      if (result.duplicates) parts.push(`${result.duplicates} already saved`)
      if (result.skipped) parts.push(`${result.skipped} skipped`)
      addToast({ type: result.added ? 'success' : 'info', title: result.added ? 'Moments imported' : 'Nothing new to import', message: parts.join(' · ') })
    } catch {
      addToast({ type: 'error', title: 'Could not read that file' })
    }
  }

  return (
    <div className={className}>
      <button type="button" onClick={onExport} disabled={count === 0} className={button}>
        <Download size={13} strokeWidth={1.75} aria-hidden="true" /> Export
      </button>
      <button type="button" onClick={() => inputRef.current?.click()} className={button}>
        <Upload size={13} strokeWidth={1.75} aria-hidden="true" /> Import
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import moments file"
        onChange={(event) => {
          void onFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </div>
  )
}
