import { memo } from "react"

export const NotificationCenter = memo(function NotificationCenter({ onClose }: { onClose?: () => void }) {
  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-text-primary">Notifications</h3>
      <p className="text-xs text-text-muted mt-1">No new notifications</p>
      {onClose && (
        <button onClick={onClose} className="mt-2 text-xs text-accent">Close</button>
      )}
    </div>
  )
})
