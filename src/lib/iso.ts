/**
 * Isometric projection maths.
 *
 * World space is the room: `x` runs left-to-right along the back wall, `y` runs
 * from the back wall towards the viewer, `z` is height. Everything is in
 * centimetres, matching IKEA's own measurements.
 *
 * View space is the world after the camera's quarter-turn rotation. Screen
 * space is the view projected isometrically, before pan and zoom.
 */
import type { CameraRotation, PlacedItem, Room } from './types'

export type { CameraRotation }

/** True isometric: 30 degrees above the horizon. */
export const ISO_X = Math.cos(Math.PI / 6) // 0.8660
export const ISO_Y = Math.sin(Math.PI / 6) // 0.5

export interface Point {
  sx: number
  sy: number
}

/** Projects a view-space point to screen space at `scale` pixels per centimetre. */
export function project(vx: number, vy: number, z: number, scale: number): Point {
  return {
    sx: (vx - vy) * ISO_X * scale,
    sy: (vx + vy) * ISO_Y * scale - z * scale,
  }
}

/**
 * Inverse of `project` for a known height. Used to turn a mouse position into
 * floor coordinates while dragging an item that sits at elevation `z`.
 */
export function unproject(sx: number, sy: number, z: number, scale: number): { vx: number; vy: number } {
  const diff = sx / (ISO_X * scale) // vx - vy
  const sum = (sy + z * scale) / (ISO_Y * scale) // vx + vy
  return { vx: (sum + diff) / 2, vy: (sum - diff) / 2 }
}

/** The room's footprint as the camera sees it; odd rotations swap width and depth. */
export function viewExtent(room: Room, rot: CameraRotation): { width: number; depth: number } {
  return rot % 2 === 0 ? { width: room.width, depth: room.depth } : { width: room.depth, depth: room.width }
}

/** Rotates a world-space floor point into view space. */
export function toView(x: number, y: number, room: Room, rot: CameraRotation): { vx: number; vy: number } {
  switch (rot) {
    case 0:
      return { vx: x, vy: y }
    case 1:
      return { vx: room.depth - y, vy: x }
    case 2:
      return { vx: room.width - x, vy: room.depth - y }
    case 3:
      return { vx: y, vy: room.width - x }
  }
}

/** Rotates a view-space floor point back into world space. */
export function fromView(vx: number, vy: number, room: Room, rot: CameraRotation): { x: number; y: number } {
  switch (rot) {
    case 0:
      return { x: vx, y: vy }
    case 1:
      return { x: vy, y: room.depth - vx }
    case 2:
      return { x: room.width - vx, y: room.depth - vy }
    case 3:
      return { x: room.width - vy, y: vx }
  }
}

export interface Footprint {
  x: number
  y: number
  width: number
  depth: number
}

/** The floor rectangle an item occupies in world space, accounting for its own rotation. */
export function footprint(item: PlacedItem, width: number, depth: number): Footprint {
  const swapped = item.rotation === 90 || item.rotation === 270
  return {
    x: item.x,
    y: item.y,
    width: swapped ? depth : width,
    depth: swapped ? width : depth,
  }
}

/** The same rectangle expressed in view space, as min/max bounds. */
export function viewBounds(
  fp: Footprint,
  room: Room,
  rot: CameraRotation,
): { vx0: number; vy0: number; vx1: number; vy1: number } {
  const a = toView(fp.x, fp.y, room, rot)
  const b = toView(fp.x + fp.width, fp.y + fp.depth, room, rot)
  return {
    vx0: Math.min(a.vx, b.vx),
    vy0: Math.min(a.vy, b.vy),
    vx1: Math.max(a.vx, b.vx),
    vy1: Math.max(a.vy, b.vy),
  }
}

/**
 * Which of the two visible box faces shows the item's front.
 *
 * At rotation 0 an item faces +y. The camera sits on the +x/+y side, so the
 * face at max y is drawn on screen-left and the face at max x on screen-right;
 * the other two are hidden.
 */
export type FrontSide = 'left' | 'right' | 'hidden'

export function frontSide(itemRotation: PlacedItem['rotation'], rot: CameraRotation): FrontSide {
  const facing = ((itemRotation / 90 - rot) % 4 + 4) % 4
  if (facing === 0) return 'left'
  if (facing === 1) return 'right'
  return 'hidden'
}

/** A box in view space, as the painter's algorithm needs to see it. */
export interface ViewBox {
  vx0: number
  vy0: number
  vx1: number
  vy1: number
  z0: number
  z1: number
}

/** Rough front-to-back distance, used to break ties and cycles. */
export function depthKey(b: { vx0: number; vy0: number; z0: number }): number {
  return b.vx0 + b.vy0 + b.z0 * 0.001
}

const EPS = 0.001

/**
 * Is `a` definitely further from the camera than `b`?
 *
 * The camera sits on the +x/+y side looking down, so `a` is behind whenever
 * the two are separated along any axis with `a` on the far side. If no axis
 * separates them the boxes interpenetrate and neither is strictly behind.
 */
function isBehind(a: ViewBox, b: ViewBox): boolean {
  return a.vx1 <= b.vx0 + EPS || a.vy1 <= b.vy0 + EPS || a.z1 <= b.z0 + EPS
}

/**
 * Orders boxes back to front.
 *
 * Sorting on a single distance number gets big abutting furniture wrong: a
 * long sofa can be nearer than a wardrobe at one end and further at the other,
 * and no single key expresses that. So this builds a graph of "must be drawn
 * before" edges and topologically sorts it, preferring the most distant box
 * whenever several are ready. Interpenetrating boxes can form a cycle; those
 * fall back to the distance key, which is no worse than sorting alone.
 */
export function paintOrder<T>(items: T[], boxOf: (item: T) => ViewBox): T[] {
  const n = items.length
  if (n < 2) return items.slice()

  const boxes = items.map(boxOf)
  const after: number[][] = Array.from({ length: n }, () => [])
  const indegree = new Array<number>(n).fill(0)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const iBehind = isBehind(boxes[i], boxes[j])
      const jBehind = isBehind(boxes[j], boxes[i])
      // A separating axis puts exactly one of them behind; if both or neither
      // look behind, there is nothing to order.
      if (iBehind === jBehind) continue
      if (iBehind) {
        after[i].push(j)
        indegree[j]++
      } else {
        after[j].push(i)
        indegree[i]++
      }
    }
  }

  const byDistance = (a: number, b: number) => depthKey(boxes[a]) - depthKey(boxes[b])
  const ready = boxes.map((_, i) => i).filter((i) => indegree[i] === 0)
  const order: number[] = []
  const drawn = new Uint8Array(n)

  while (ready.length) {
    ready.sort(byDistance)
    const i = ready.shift()!
    order.push(i)
    drawn[i] = 1
    for (const j of after[i]) if (--indegree[j] === 0) ready.push(j)
  }

  // Whatever is left sits in a cycle. Distance order is the best guess.
  if (order.length < n) {
    const leftover = boxes.map((_, i) => i).filter((i) => !drawn[i])
    leftover.sort(byDistance)
    order.push(...leftover)
  }

  return order.map((i) => items[i])
}

/** Do two floor rectangles overlap? Used to warn about items placed inside each other. */
export function overlaps(a: Footprint, b: Footprint): boolean {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.depth && a.y + a.depth > b.y
  )
}
