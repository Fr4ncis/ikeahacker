/**
 * Turns a catalog item into the boxes we actually draw.
 *
 * A wardrobe is one box, but a desk drawn as a solid block looks wrong, so
 * tables get a slab and four legs and sofas get a seat plus a back. Sub-boxes
 * are expressed in the item's own local frame: `lx` runs across its width,
 * `ly` from its back (0) to its front (depth), `lz` upwards.
 */
import type { CatalogItem, PlacedItem } from './types'

export interface SubBox {
  lx0: number
  lx1: number
  ly0: number
  ly1: number
  lz0: number
  lz1: number
  /** Brightness multiplier applied on top of the face shading. */
  tint?: number
  /** Only the box carrying the item's front gets door and drawer detailing. */
  detailFront?: boolean
}

const LEG = 6
const SLAB = 4
const SEAT_HEIGHT = 42
const BACK_DEPTH = 22
const ARM_WIDTH = 18

/** Legs are only worth drawing when the piece is tall enough to have them. */
function tableParts(w: number, d: number, h: number): SubBox[] {
  if (h < 25) return [{ lx0: 0, lx1: w, ly0: 0, ly1: d, lz0: 0, lz1: h }]
  const top = Math.max(h - SLAB, 0)
  const legW = Math.min(LEG, w / 4)
  const legD = Math.min(LEG, d / 4)
  return [
    { lx0: 0, lx1: w, ly0: 0, ly1: d, lz0: top, lz1: h, detailFront: true },
    { lx0: 0, lx1: legW, ly0: 0, ly1: legD, lz0: 0, lz1: top, tint: 0.9 },
    { lx0: w - legW, lx1: w, ly0: 0, ly1: legD, lz0: 0, lz1: top, tint: 0.9 },
    { lx0: 0, lx1: legW, ly0: d - legD, ly1: d, lz0: 0, lz1: top, tint: 0.9 },
    { lx0: w - legW, lx1: w, ly0: d - legD, ly1: d, lz0: 0, lz1: top, tint: 0.9 },
  ]
}

/** A seat slab, a back and two arms reads as a sofa from any angle. */
function sofaParts(w: number, d: number, h: number): SubBox[] {
  const seat = Math.min(SEAT_HEIGHT, h * 0.6)
  const back = Math.min(BACK_DEPTH, d * 0.35)
  const arm = Math.min(ARM_WIDTH, w * 0.2)
  return [
    // Back rest, along the item's rear edge.
    { lx0: 0, lx1: w, ly0: 0, ly1: back, lz0: 0, lz1: h, tint: 0.97 },
    // Seat.
    { lx0: 0, lx1: w, ly0: back, ly1: d, lz0: 0, lz1: seat, tint: 1.05, detailFront: true },
    // Arms.
    { lx0: 0, lx1: arm, ly0: back, ly1: d, lz0: 0, lz1: Math.min(h * 0.75, seat + 22), tint: 0.99 },
    { lx0: w - arm, lx1: w, ly0: back, ly1: d, lz0: 0, lz1: Math.min(h * 0.75, seat + 22), tint: 0.99 },
  ]
}

/** A bed is a low frame with a headboard at the back. */
function bedParts(w: number, d: number, h: number): SubBox[] {
  const head = Math.min(10, d * 0.08)
  const mattressTop = Math.max(h * 0.75, 25)
  return [
    { lx0: 0, lx1: w, ly0: 0, ly1: head, lz0: 0, lz1: h, tint: 0.95 },
    { lx0: 0, lx1: w, ly0: head, ly1: d, lz0: 0, lz1: mattressTop, tint: 1.06, detailFront: true },
  ]
}

export function subBoxes(item: CatalogItem): SubBox[] {
  const { width: w, depth: d, height: h, type, face } = item
  const t = type.toLowerCase()

  if (face === 'surface') return tableParts(w, d, h)
  if (/\bbed\b|bedstead|divan|mattress/.test(t)) return bedParts(w, d, h)
  if (/sofa|armchair|chaise|corner section|footstool|pouffe/.test(t) && w >= 60) return sofaParts(w, d, h)

  return [{ lx0: 0, lx1: w, ly0: 0, ly1: d, lz0: 0, lz1: h, detailFront: true }]
}

/**
 * Maps a point in an item's local frame to a world offset from the item's
 * origin corner, for the item's rotation. Rotation 0 has the front facing +y;
 * each 90 degrees turns the front a quarter turn towards +x.
 */
export function localToWorld(
  lx: number,
  ly: number,
  rotation: PlacedItem['rotation'],
  width: number,
  depth: number,
): { dx: number; dy: number } {
  switch (rotation) {
    case 0:
      return { dx: lx, dy: ly }
    case 90:
      return { dx: ly, dy: width - lx }
    case 180:
      return { dx: width - lx, dy: depth - ly }
    case 270:
      return { dx: depth - ly, dy: lx }
  }
}
