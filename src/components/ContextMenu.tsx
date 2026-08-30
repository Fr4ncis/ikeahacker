import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CatalogItem } from '../lib/types'

export interface MenuAction {
  label: string
  onSelect: () => void
  danger?: boolean
}

export interface MenuTarget {
  item: CatalogItem
  x: number
  y: number
  actions: MenuAction[]
}

/**
 * Right-click menu for a product, in the catalogue or in the room.
 *
 * The browser's own menu is suppressed only where we have something better to
 * offer, and the first entry is always the link to ikea.com, which is what the
 * menu exists for.
 */
export function ContextMenu({ target, onClose }: { target: MenuTarget | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Place it after measuring, so a menu opened near an edge stays on screen.
  useLayoutEffect(() => {
    if (!target || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(target.x, window.innerWidth - width - 8),
      y: Math.min(target.y, window.innerHeight - height - 8),
    })
  }, [target])

  useEffect(() => {
    if (!target) return
    const dismiss = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Capture, so a click anywhere closes the menu before it does anything else.
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('wheel', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('wheel', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [target, onClose])

  if (!target) return null

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="context-head">
        <strong>{target.item.name}</strong>
        <span>{target.item.type}</span>
      </div>
      {target.actions.map((action) => (
        <button
          key={action.label}
          role="menuitem"
          className={action.danger ? 'danger' : undefined}
          onClick={() => {
            action.onSelect()
            onClose()
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
