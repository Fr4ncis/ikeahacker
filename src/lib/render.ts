/**
 * Draws the room and everything in it onto a 2D canvas.
 *
 * The same routine runs in two modes. `display` paints the scene the user
 * sees; `pick` paints each item as a flat unique colour into an offscreen
 * canvas so a click can be resolved to an item by reading one pixel. Sharing
 * the geometry between the two keeps hit-testing exactly in step with what is
 * on screen.
 */
import { FACE_LIGHT, mix, readableOn, shade } from './color'
import { subBoxes, localToWorld, type SubBox } from './geometry'
import {
  footprint,
  frontSide,
  paintOrder,
  project,
  toView,
  viewBounds,
  viewExtent,
  type CameraRotation,
  type FrontSide,
} from './iso'
import type { Camera, CatalogItem, PlacedItem, Room } from './types'

export interface Scene {
  room: Room
  items: PlacedItem[]
  /** Resolves a placed item to its catalog entry. */
  lookup: (itemId: string) => CatalogItem | undefined
  camera: Camera
  selectedUid: string | null
  hoverUid: string | null
  /** Items that overlap something else, drawn with a warning tint. */
  collisions: Set<string>
  showGrid: boolean
  showLabels: boolean
}

export interface Viewport {
  width: number
  height: number
}

export interface Transform {
  scale: number
  originX: number
  originY: number
  /** View-space point to canvas pixel. */
  toScreen: (vx: number, vy: number, z: number) => { x: number; y: number }
}

const GRID_STEP = 50
const ACCENT = '#1a7f6b'
const WARNING = '#c8553d'

/**
 * Fits the room's isometric bounding box to the viewport, then applies pan.
 * Keeping this separate means the canvas and the pointer maths agree.
 */
export function makeTransform(room: Room, camera: Camera, viewport: Viewport): Transform {
  const { width: W, depth: D } = viewExtent(room, camera.rotation)
  const scale = camera.zoom

  // Extremes of the room's eight corners in unscaled screen space.
  const minSx = project(0, D, 0, 1).sx
  const maxSx = project(W, 0, 0, 1).sx
  const minSy = project(0, 0, room.height, 1).sy
  const maxSy = project(W, D, 0, 1).sy

  const originX = viewport.width / 2 - ((minSx + maxSx) / 2) * scale + camera.panX
  const originY = viewport.height / 2 - ((minSy + maxSy) / 2) * scale + camera.panY

  return {
    scale,
    originX,
    originY,
    toScreen(vx, vy, z) {
      const p = project(vx, vy, z, scale)
      return { x: originX + p.sx, y: originY + p.sy }
    },
  }
}

/** How wide and tall the room's isometric silhouette is, at unit scale. */
export function sceneShape(room: Room, rotation: CameraRotation): { spanX: number; spanY: number; aspect: number } {
  const { width: W, depth: D } = viewExtent(room, rotation)
  const spanX = project(W, 0, 0, 1).sx - project(0, D, 0, 1).sx
  const spanY = project(W, D, 0, 1).sy - project(0, 0, room.height, 1).sy
  return { spanX, spanY, aspect: spanY > 0 ? spanX / spanY : 1 }
}

/**
 * The zoom at which the whole room just fits the viewport, with a little air
 * around it. Used by the Fit button and by PNG export.
 */
export function fitZoom(room: Room, rotation: CameraRotation, viewport: Viewport, padding = 0.88): number {
  const { spanX, spanY } = sceneShape(room, rotation)
  if (spanX <= 0 || spanY <= 0) return 1
  return Math.min(viewport.width / spanX, viewport.height / spanY) * padding
}

type Quad = [number, number][]

function fillQuad(ctx: CanvasRenderingContext2D, quad: Quad, fill: string, stroke?: string) {
  ctx.beginPath()
  ctx.moveTo(quad[0][0], quad[0][1])
  for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i][0], quad[i][1])
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
}

/** Point inside a quad given normalised coordinates, corners ordered bl, br, tr, tl. */
function bilinear(quad: Quad, u: number, v: number): [number, number] {
  const [bl, br, tr, tl] = quad
  const bx = bl[0] + (br[0] - bl[0]) * u
  const by = bl[1] + (br[1] - bl[1]) * u
  const tx = tl[0] + (tr[0] - tl[0]) * u
  const ty = tl[1] + (tr[1] - tl[1]) * u
  return [bx + (tx - bx) * v, by + (ty - by) * v]
}

function line(ctx: CanvasRenderingContext2D, quad: Quad, u0: number, v0: number, u1: number, v1: number) {
  const a = bilinear(quad, u0, v0)
  const b = bilinear(quad, u1, v1)
  ctx.beginPath()
  ctx.moveTo(a[0], a[1])
  ctx.lineTo(b[0], b[1])
  ctx.stroke()
}

/**
 * Draws doors, drawer fronts or shelf lines onto the face carrying the item's
 * front. Coordinates are normalised across the face, so this works whichever
 * of the two visible sides the front happens to land on.
 */
function drawFrontDetail(ctx: CanvasRenderingContext2D, quad: Quad, item: CatalogItem, scale: number) {
  if (scale < 0.6) return
  const ink = 'rgba(0,0,0,0.30)'
  const inset = 0.06
  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(0.75, scale * 0.6)

  switch (item.face) {
    case 'door': {
      line(ctx, quad, 0.5, inset, 0.5, 1 - inset)
      const [hx, hy] = bilinear(quad, 0.44, 0.5)
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.arc(hx, hy, Math.max(1, scale * 1.4), 0, Math.PI * 2)
      ctx.fill()
      break
    }

    case 'double-door': {
      line(ctx, quad, 0.5, 0, 0.5, 1)
      ctx.fillStyle = ink
      for (const u of [0.44, 0.56]) {
        const [x, y] = bilinear(quad, u, 0.5)
        ctx.beginPath()
        ctx.arc(x, y, Math.max(1, scale * 1.3), 0, Math.PI * 2)
        ctx.fill()
      }
      break
    }

    case 'drawers': {
      // One drawer roughly every 25 cm of height, between two and six.
      const count = Math.max(2, Math.min(6, Math.round(item.height / 25)))
      for (let i = 1; i < count; i++) line(ctx, quad, 0, i / count, 1, i / count)
      ctx.fillStyle = ink
      for (let i = 0; i < count; i++) {
        const [x, y] = bilinear(quad, 0.5, (i + 0.5) / count)
        ctx.fillRect(x - Math.max(3, scale * 5), y - Math.max(0.5, scale * 0.5), Math.max(6, scale * 10), Math.max(1, scale))
      }
      break
    }

    case 'shelves': {
      // Recess the opening, then draw the shelf lines inside it.
      const opening: Quad = [
        bilinear(quad, 0.04, 0.03),
        bilinear(quad, 0.96, 0.03),
        bilinear(quad, 0.96, 0.97),
        bilinear(quad, 0.04, 0.97),
      ]
      fillQuad(ctx, opening, 'rgba(0,0,0,0.18)')
      const count = Math.max(1, Math.min(7, Math.round(item.height / 35)))
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      for (let i = 1; i < count; i++) line(ctx, opening, 0, i / count, 1, i / count)
      break
    }

    case 'soft':
      line(ctx, quad, 0, 0.55, 1, 0.55)
      break

    default:
      break
  }
  ctx.restore()
}

interface DrawableBox {
  vx0: number
  vy0: number
  vx1: number
  vy1: number
  z0: number
  z1: number
  tint: number
  detailFront: boolean
}

/** Converts one sub-box of an item into view-space bounds. */
function toDrawable(
  sub: SubBox,
  placed: PlacedItem,
  cat: CatalogItem,
  room: Room,
  rot: CameraRotation,
): DrawableBox {
  const a = localToWorld(sub.lx0, sub.ly0, placed.rotation, cat.width, cat.depth)
  const b = localToWorld(sub.lx1, sub.ly1, placed.rotation, cat.width, cat.depth)

  const wa = toView(placed.x + Math.min(a.dx, b.dx), placed.y + Math.min(a.dy, b.dy), room, rot)
  const wb = toView(placed.x + Math.max(a.dx, b.dx), placed.y + Math.max(a.dy, b.dy), room, rot)

  return {
    vx0: Math.min(wa.vx, wb.vx),
    vy0: Math.min(wa.vy, wb.vy),
    vx1: Math.max(wa.vx, wb.vx),
    vy1: Math.max(wa.vy, wb.vy),
    z0: placed.z + sub.lz0,
    z1: placed.z + sub.lz1,
    tint: sub.tint ?? 1,
    detailFront: sub.detailFront ?? false,
  }
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  box: DrawableBox,
  baseColor: string,
  front: FrontSide,
  cat: CatalogItem | null,
  outline: string | null,
  flat: boolean,
) {
  const { vx0, vy0, vx1, vy1, z0, z1 } = box
  const p = (vx: number, vy: number, z: number): [number, number] => {
    const s = t.toScreen(vx, vy, z)
    return [s.x, s.y]
  }

  // The camera sits on the +x/+y side, so the faces at max y (screen left) and
  // max x (screen right) are the visible ones.
  const top: Quad = [p(vx0, vy0, z1), p(vx1, vy0, z1), p(vx1, vy1, z1), p(vx0, vy1, z1)]
  const left: Quad = [p(vx0, vy1, z0), p(vx1, vy1, z0), p(vx1, vy1, z1), p(vx0, vy1, z1)]
  const right: Quad = [p(vx1, vy0, z0), p(vx1, vy1, z0), p(vx1, vy1, z1), p(vx1, vy0, z1)]

  if (flat) {
    // Pick pass: one solid silhouette, no shading and no seams between faces.
    for (const q of [top, left, right]) fillQuad(ctx, q, baseColor)
    return
  }

  const edge = shade(baseColor, 0.55)
  ctx.lineWidth = 0.6
  ctx.lineJoin = 'round'
  fillQuad(ctx, top, shade(baseColor, FACE_LIGHT.top * box.tint), edge)
  fillQuad(ctx, left, shade(baseColor, FACE_LIGHT.left * box.tint), edge)
  fillQuad(ctx, right, shade(baseColor, FACE_LIGHT.right * box.tint), edge)

  if (cat && box.detailFront) {
    if (front === 'left') drawFrontDetail(ctx, left, cat, t.scale)
    else if (front === 'right') drawFrontDetail(ctx, right, cat, t.scale)
  }

  if (outline) {
    ctx.save()
    ctx.strokeStyle = outline
    ctx.lineWidth = 2
    for (const q of [top, left, right]) {
      ctx.beginPath()
      ctx.moveTo(q[0][0], q[0][1])
      for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1])
      ctx.closePath()
      ctx.stroke()
    }
    ctx.restore()
  }
}

function drawRoom(ctx: CanvasRenderingContext2D, t: Transform, scene: Scene) {
  const { room, camera } = scene
  const { width: W, depth: D } = viewExtent(room, camera.rotation)
  const H = room.height
  const p = (vx: number, vy: number, z: number): [number, number] => {
    const s = t.toScreen(vx, vy, z)
    return [s.x, s.y]
  }

  // Floor.
  fillQuad(ctx, [p(0, 0, 0), p(W, 0, 0), p(W, D, 0), p(0, D, 0)], scene.room.floorColor)

  if (scene.showGrid && t.scale > 0.3) {
    ctx.save()
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'
    ctx.lineWidth = 1
    for (let x = 0; x <= W; x += GRID_STEP) {
      const a = p(Math.min(x, W), 0, 0)
      const b = p(Math.min(x, W), D, 0)
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
    for (let y = 0; y <= D; y += GRID_STEP) {
      const a = p(0, Math.min(y, D), 0)
      const b = p(W, Math.min(y, D), 0)
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
    ctx.restore()
  }

  // The two walls facing the camera, at vx = 0 (screen left) and vy = 0 (right).
  fillQuad(
    ctx,
    [p(0, 0, 0), p(0, D, 0), p(0, D, H), p(0, 0, H)],
    mix(room.wallColor, '#000000', 0.1),
    'rgba(0,0,0,0.12)',
  )
  fillQuad(
    ctx,
    [p(0, 0, 0), p(W, 0, 0), p(W, 0, H), p(0, 0, H)],
    mix(room.wallColor, '#000000', 0.02),
    'rgba(0,0,0,0.12)',
  )
}

/** Soft contact shadow so items do not look like they float. */
function drawShadow(ctx: CanvasRenderingContext2D, t: Transform, b: { vx0: number; vy0: number; vx1: number; vy1: number }) {
  const p = (vx: number, vy: number): [number, number] => {
    const s = t.toScreen(vx, vy, 0)
    return [s.x, s.y]
  }
  ctx.save()
  ctx.globalAlpha = 0.18
  fillQuad(ctx, [p(b.vx0, b.vy0), p(b.vx1, b.vy0), p(b.vx1, b.vy1), p(b.vx0, b.vy1)], '#000000')
  ctx.restore()
}

/** Encodes an index as a colour the pick pass can read back exactly. */
export function indexToPickColor(index: number): string {
  const n = index + 1
  return `rgb(${n & 255},${(n >> 8) & 255},${(n >> 16) & 255})`
}

export function pickColorToIndex(r: number, g: number, b: number): number {
  return (r | (g << 8) | (b << 16)) - 1
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  viewport: Viewport,
  mode: 'display' | 'pick' = 'display',
): Transform {
  const t = makeTransform(scene.room, scene.camera, viewport)

  ctx.save()
  if (mode === 'pick') {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, viewport.width, viewport.height)
    ctx.imageSmoothingEnabled = false
  } else {
    ctx.clearRect(0, 0, viewport.width, viewport.height)
    drawRoom(ctx, t, scene)
  }

  // Resolve every placed item, then order it back to front.
  const resolved = scene.items
    .map((placed, index) => {
      const cat = scene.lookup(placed.itemId)
      if (!cat) return null
      const fp = footprint(placed, cat.width, cat.depth)
      const bounds = viewBounds(fp, scene.room, scene.camera.rotation)
      return { placed, cat, bounds, index }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  const entries = paintOrder(resolved, (e) => ({
    ...e.bounds,
    z0: e.placed.z,
    z1: e.placed.z + e.cat.height,
  }))

  for (const { placed, cat, bounds, index } of entries) {
    const front = frontSide(placed.rotation, scene.camera.rotation)
    const selected = placed.uid === scene.selectedUid
    const hovered = placed.uid === scene.hoverUid

    const clashing = scene.collisions.has(placed.uid)
    let color = placed.color ?? cat.color
    if (mode === 'display') {
      // Flag a clash with a tint light enough to leave the finish readable;
      // the outline below is what actually draws the eye.
      if (clashing) color = mix(color, WARNING, 0.15)
      else if (hovered && !selected) color = mix(color, '#ffffff', 0.12)
    }

    if (mode === 'display' && placed.z === 0) drawShadow(ctx, t, bounds)

    // Sub-boxes need their own back-to-front pass, e.g. a sofa's back before its seat.
    const boxes = paintOrder(
      subBoxes(cat).map((sub) => toDrawable(sub, placed, cat, scene.room, scene.camera.rotation)),
      (b) => b,
    )

    for (const box of boxes) {
      drawBox(
        ctx,
        t,
        box,
        mode === 'pick' ? indexToPickColor(index) : color,
        front,
        mode === 'pick' ? null : cat,
        mode === 'display' ? (selected ? ACCENT : clashing ? WARNING : null) : null,
        mode === 'pick',
      )
    }

    if (mode === 'display' && scene.showLabels && t.scale > 0.9) {
      const centre = t.toScreen((bounds.vx0 + bounds.vx1) / 2, (bounds.vy0 + bounds.vy1) / 2, placed.z + cat.height)
      const wide = (bounds.vx1 - bounds.vx0) * t.scale
      if (wide > 34) {
        ctx.save()
        // Grows with the zoom so a large PNG export gets legible labels.
        ctx.font = `600 ${Math.max(9, t.scale * 7)}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = readableOn(color)
        ctx.globalAlpha = 0.85
        ctx.fillText(cat.systemLabel, centre.x, centre.y)
        ctx.restore()
      }
    }
  }

  ctx.restore()
  return t
}
