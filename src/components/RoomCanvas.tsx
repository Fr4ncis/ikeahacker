import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getItem } from '../lib/catalog'
import { footprint, fromView, ISO_X, ISO_Y, overlaps, project, unproject, viewExtent } from '../lib/iso'
import { fitZoom, makeTransform, pickColorToIndex, renderScene, type Scene } from '../lib/render'
import { SNAP_CM, usePlanner } from '../state/store'
import type { CatalogItem, PlacedItem } from '../lib/types'

const MIN_ZOOM = 0.4
const MAX_ZOOM = 6

/** Items whose footprints and heights both overlap something else. */
function findCollisions(items: PlacedItem[]): Set<string> {
  const boxes = items
    .map((it) => {
      const cat = getItem(it.itemId)
      if (!cat) return null
      return { it, fp: footprint(it, cat.width, cat.depth), z0: it.z, z1: it.z + cat.height }
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)

  const hits = new Set<string>()
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      // A shallow touch is fine; only a real intersection counts.
      if (overlaps(a.fp, b.fp) && a.z0 < b.z1 - 0.5 && b.z0 < a.z1 - 0.5) {
        hits.add(a.it.uid)
        hits.add(b.it.uid)
      }
    }
  }
  return hits
}

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'item'; uid: string; offsetX: number; offsetY: number }

export function RoomCanvas({
  onContext,
}: {
  onContext: (item: CatalogItem, uid: string, x: number, y: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pickRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>({ kind: 'none' })
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [hoverUid, setHoverUid] = useState<string | null>(null)

  const room = usePlanner((s) => s.room)
  const items = usePlanner((s) => s.items)
  const camera = usePlanner((s) => s.camera)
  const selectedUid = usePlanner((s) => s.selectedUid)
  const showGrid = usePlanner((s) => s.showGrid)
  const showLabels = usePlanner((s) => s.showLabels)

  const collisions = useMemo(() => findCollisions(items), [items])

  const scene: Scene = useMemo(
    () => ({ room, items, lookup: getItem, camera, selectedUid, hoverUid, collisions, showGrid, showLabels }),
    [room, items, camera, selectedUid, hoverUid, collisions, showGrid, showLabels],
  )

  // --- Sizing ---------------------------------------------------------------
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // Measure once synchronously: the ResizeObserver only fires after a frame,
    // and the initial fit-to-room would otherwise be computed against the
    // placeholder size and come out too small.
    const rect = el.getBoundingClientRect()
    setSize({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) })

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The toolbar cannot know the viewport size, so it requests a fit by setting
  // the zoom to 0 and this resolves it. The element is measured here rather
  // than read from `size`, because on the first commit this effect still closes
  // over the pre-measurement value and would fit the room to a phantom canvas.
  useEffect(() => {
    if (camera.zoom > 0) return
    const rect = wrapRef.current?.getBoundingClientRect()
    const viewport = rect && rect.width > 1 ? { width: rect.width, height: rect.height } : size
    usePlanner.getState().setCamera({ zoom: fitZoom(room, camera.rotation, viewport), panX: 0, panY: 0 })
  }, [camera.zoom, camera.rotation, room, size])

  // --- Painting -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    // Zoom 0 is the pending "fit the room" request handled above; there is
    // nothing sensible to draw until it resolves.
    if (!canvas || camera.zoom <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderScene(ctx, scene, size, 'display')

    // Keep the pick buffer in step. It is drawn at CSS pixel scale, which is
    // plenty for hit-testing and cheaper than matching the device ratio.
    let pick = pickRef.current
    if (!pick) {
      pick = document.createElement('canvas')
      pickRef.current = pick
    }
    pick.width = size.width
    pick.height = size.height
    const pctx = pick.getContext('2d', { willReadFrequently: true })
    if (pctx) {
      pctx.setTransform(1, 0, 0, 1, 0, 0)
      renderScene(pctx, scene, size, 'pick')
    }
  }, [scene, size, camera.zoom])

  // --- Pointer helpers ------------------------------------------------------
  const localPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }, [])

  const pickAt = useCallback(
    (px: number, py: number): string | null => {
      const pick = pickRef.current
      if (!pick) return null
      const ctx = pick.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      const x = Math.round(px)
      const y = Math.round(py)
      if (x < 0 || y < 0 || x >= pick.width || y >= pick.height) return null
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data
      const index = pickColorToIndex(r, g, b)
      return index >= 0 && index < items.length ? items[index].uid : null
    },
    [items],
  )

  /** Screen pixel to world floor coordinate, on the horizontal plane at height z. */
  const toFloor = useCallback(
    (px: number, py: number, z: number) => {
      const t = makeTransform(room, camera, size)
      const { vx, vy } = unproject(px - t.originX, py - t.originY, z, t.scale)
      return fromView(vx, vy, room, camera.rotation)
    },
    [room, camera, size],
  )

  // --- Interaction ----------------------------------------------------------
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { px, py } = localPoint(e)
      canvasRef.current?.setPointerCapture(e.pointerId)

      const uid = e.button === 1 ? null : pickAt(px, py)
      if (!uid) {
        usePlanner.getState().select(null)
        dragRef.current = { kind: 'pan', lastX: e.clientX, lastY: e.clientY }
        return
      }

      const placed = items.find((i) => i.uid === uid)!
      const floor = toFloor(px, py, placed.z)
      usePlanner.getState().select(uid)
      dragRef.current = { kind: 'item', uid, offsetX: floor.x - placed.x, offsetY: floor.y - placed.y }
    },
    [items, localPoint, pickAt, toFloor],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      const { px, py } = localPoint(e)

      if (drag.kind === 'none') {
        setHoverUid(pickAt(px, py))
        return
      }

      if (drag.kind === 'pan') {
        const dx = e.clientX - drag.lastX
        const dy = e.clientY - drag.lastY
        drag.lastX = e.clientX
        drag.lastY = e.clientY
        const cam = usePlanner.getState().camera
        usePlanner.getState().setCamera({ panX: cam.panX + dx, panY: cam.panY + dy })
        return
      }

      const placed = usePlanner.getState().items.find((i) => i.uid === drag.uid)
      if (!placed) return
      const floor = toFloor(px, py, placed.z)
      // Alt disables snapping for the odd centimetre.
      const snap = e.altKey ? 1 : SNAP_CM
      const x = Math.round((floor.x - drag.offsetX) / snap) * snap
      const y = Math.round((floor.y - drag.offsetY) / snap) * snap
      if (x !== placed.x || y !== placed.y) usePlanner.getState().moveItem(drag.uid, x, y)
    },
    [localPoint, pickAt, toFloor],
  )

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { px, py } = localPoint(e)
      const uid = pickAt(px, py)
      const placed = uid ? items.find((i) => i.uid === uid) : undefined
      const cat = placed && getItem(placed.itemId)
      // Over bare floor there is nothing to offer, so leave the browser's own
      // menu alone rather than replacing it with an empty one.
      if (!placed || !cat) return
      e.preventDefault()
      usePlanner.getState().select(placed.uid)
      onContext(cat, placed.uid, e.clientX, e.clientY)
    },
    [items, localPoint, pickAt, onContext],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.releasePointerCapture(e.pointerId)
    dragRef.current = { kind: 'none' }
  }, [])

  /** Zooms about the cursor, so the point under the mouse stays put. */
  const onWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      const { px, py } = localPoint(e)
      const cam = usePlanner.getState().camera
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * Math.exp(-e.deltaY * 0.0015)))
      if (next === cam.zoom) return

      const t = makeTransform(room, cam, size)
      const anchor = unproject(px - t.originX, py - t.originY, 0, cam.zoom)

      // Recompute the centring term at the new scale, then solve for the pan
      // that keeps `anchor` under the cursor.
      const { width: W, depth: D } = viewExtent(room, cam.rotation)
      const midSx = (project(0, D, 0, 1).sx + project(W, 0, 0, 1).sx) / 2
      const midSy = (project(0, 0, room.height, 1).sy + project(W, D, 0, 1).sy) / 2
      const baseX = size.width / 2 - midSx * next
      const baseY = size.height / 2 - midSy * next

      const panX = px - (anchor.vx - anchor.vy) * ISO_X * next - baseX
      const panY = py - (anchor.vx + anchor.vy) * ISO_Y * next - baseY
      usePlanner.getState().setCamera({ zoom: next, panX, panY })
    },
    [localPoint, room, size],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [onWheel])

  // --- Keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      const store = usePlanner.getState()
      const uid = store.selectedUid
      const nudge = e.shiftKey ? 25 : SNAP_CM

      switch (e.key) {
        case 'Escape':
          store.select(null)
          return
        case '[':
          store.rotateCamera(-1)
          e.preventDefault()
          return
        case ']':
          store.rotateCamera(1)
          e.preventDefault()
          return
      }
      if (!uid) return
      const placed = store.items.find((i) => i.uid === uid)
      if (!placed) return

      switch (e.key) {
        case 'Backspace':
        case 'Delete':
          store.removeItem(uid)
          break
        case 'r':
        case 'R':
          store.rotateItem(uid, e.shiftKey ? -90 : 90)
          break
        case 'd':
        case 'D':
          store.duplicateItem(uid)
          break
        case 'ArrowLeft':
          store.moveItem(uid, placed.x - nudge, placed.y)
          break
        case 'ArrowRight':
          store.moveItem(uid, placed.x + nudge, placed.y)
          break
        case 'ArrowUp':
          if (e.metaKey || e.ctrlKey) store.updateItem(uid, { z: placed.z + nudge })
          else store.moveItem(uid, placed.x, placed.y - nudge)
          break
        case 'ArrowDown':
          if (e.metaKey || e.ctrlKey) store.updateItem(uid, { z: Math.max(0, placed.z - nudge) })
          else store.moveItem(uid, placed.x, placed.y + nudge)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cursor = hoverUid ? 'grab' : 'default'

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHoverUid(null)}
        onContextMenu={onContextMenu}
      />
      {items.length === 0 && (
        <div className="canvas-empty">
          <strong>Empty room.</strong>
          <span>Pick something from the catalogue on the left to drop it in.</span>
        </div>
      )}
      {collisions.size > 0 && (
        <div className="canvas-warning">{collisions.size} items are overlapping</div>
      )}
    </div>
  )
}
