/** Exporting a plan: a PNG of the room, and the shopping list as CSV. */
import { getCatalog, getItem } from './catalog'
import { fitZoom, sceneShape, renderScene, type Scene } from './render'
import type { PlacedItem } from './types'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  // The anchor has to be in the document for the click to count, and the URL
  // has to outlive the click or the browser cancels the download.
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * Renders the scene to an offscreen canvas and saves it as a PNG.
 *
 * The canvas is sized to the room's own isometric proportions rather than a
 * fixed frame, so a square room does not export with a band of empty space
 * down each side. Nothing external is drawn into the canvas, so it stays
 * untainted and `toBlob` works.
 */
export function exportPng(scene: Scene, longEdge = 2200) {
  const { room, camera } = scene
  // Fit against a unit viewport to learn the scene's aspect, then size to it.
  const shape = sceneShape(room, camera.rotation)
  const width = Math.round(shape.aspect >= 1 ? longEdge : longEdge * shape.aspect)
  const height = Math.round(shape.aspect >= 1 ? longEdge / shape.aspect : longEdge)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.fillStyle = '#f4f2ee'
  ctx.fillRect(0, 0, width, height)

  // Re-fit the room to the export size rather than reusing the screen pan.
  const fitted: Scene = {
    ...scene,
    camera: {
      ...camera,
      zoom: fitZoom(room, camera.rotation, { width, height }, 0.94),
      panX: 0,
      panY: 0,
    },
    selectedUid: null,
    hoverUid: null,
    collisions: new Set(),
  }
  renderScene(ctx, fitted, { width, height }, 'display')

  canvas.toBlob((blob) => {
    if (blob) download(blob, `ikea-room-${new Date().toISOString().slice(0, 10)}.png`)
  }, 'image/png')
}

const csvCell = (value: string | number | null) => {
  const s = value === null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportCsv(items: PlacedItem[]) {
  const counted = new Map<string, number>()
  for (const it of items) counted.set(it.itemId, (counted.get(it.itemId) ?? 0) + 1)

  const header = ['Qty', 'Article', 'System', 'Name', 'Type', 'Finish', 'W cm', 'D cm', 'H cm', 'Unit price', 'Line total', 'URL']
  const rows = [...counted.entries()].flatMap(([id, qty]) => {
    const c = getItem(id)
    if (!c) return []
    return [
      [qty, c.id, c.system, c.name, c.type, c.finish, c.width, c.depth, c.height, c.price, c.price === null ? null : c.price * qty, c.productUrl],
    ]
  })

  const total = rows.reduce((sum, r) => sum + (typeof r[10] === 'number' ? r[10] : 0), 0)
  rows.push(['', '', '', '', '', '', '', '', '', 'Total', total, ''])

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `ikea-shopping-list-${getCatalog().market.replace('/', '-')}.csv`)
}

export function exportJson(layout: unknown, name: string) {
  download(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }), `${name}.json`)
}
