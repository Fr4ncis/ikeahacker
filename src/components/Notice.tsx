import { useEffect } from 'react'
import type { LoadNotice } from '../App'

/** A transient message about something that just happened, e.g. a copied link. */
export function Notice({ notice, onDismiss }: { notice: LoadNotice | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!notice) return
    // Warnings stay long enough to actually be read.
    const timer = setTimeout(onDismiss, notice.tone === 'warning' ? 9000 : 3500)
    return () => clearTimeout(timer)
  }, [notice, onDismiss])

  if (!notice) return null
  return (
    <div className={`notice notice--${notice.tone}`} role="status">
      <span>{notice.text}</span>
      <button onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
