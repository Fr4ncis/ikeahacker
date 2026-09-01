/**
 * Turns a catalog item into the boxes we actually draw.
 *
 * A wardrobe is one box, but a desk drawn as a solid block looks wrong, so
 * tables get a slab and four legs, chairs get a seat and a back, and an open
 * bookcase gets real sides and shelves with a panel behind them. Sub-boxes are
 * expressed in the item's own local frame: `lx` runs across its width, `ly`
 * from its back (0) to its front (depth), `lz` upwards.
 *
 * Everything here is driven by what IKEA publishes -- the product type and the
 * three measurements -- so a piece sold on legs is drawn on legs. Every
 * archetype falls back to the plain box when the numbers are too small for its
 * parts to make sense, which is what keeps an armrest or a pull-out tray from
 * being drawn as furniture.
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
/** Thickness of a carcass panel: IKEA's boards are 15 to 20 mm, rounded up to read at this scale. */
const PANEL = 3
const SEAT_HEIGHT = 42
const BACK_DEPTH = 22
const ARM_WIDTH = 18

const box = (w: number, d: number, h: number): SubBox => ({
  lx0: 0,
  lx1: w,
  ly0: 0,
  ly1: d,
  lz0: 0,
  lz1: h,
  detailFront: true,
})

/** Posts at the four corners, from the floor up to `top`. */
function legs(w: number, d: number, top: number, thickness = LEG): SubBox[] {
  const lw = Math.min(thickness, w / 4)
  const ld = Math.min(thickness, d / 4)
  return [
    { lx0: 0, lx1: lw, ly0: 0, ly1: ld, lz0: 0, lz1: top, tint: 0.9 },
    { lx0: w - lw, lx1: w, ly0: 0, ly1: ld, lz0: 0, lz1: top, tint: 0.9 },
    { lx0: 0, lx1: lw, ly0: d - ld, ly1: d, lz0: 0, lz1: top, tint: 0.9 },
    { lx0: w - lw, lx1: w, ly0: d - ld, ly1: d, lz0: 0, lz1: top, tint: 0.9 },
  ]
}

/** Legs are only worth drawing when the piece is tall enough to have them. */
function tableParts(w: number, d: number, h: number): SubBox[] {
  if (h < 25) return [box(w, d, h)]
  const top = Math.max(h - SLAB, 0)
  return [{ lx0: 0, lx1: w, ly0: 0, ly1: d, lz0: top, lz1: h, detailFront: true }, ...legs(w, d, top)]
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

/**
 * A dining chair or a stool: four legs, a seat, and a back panel for the ones
 * that have one. Drawn as a solid block a chair looks like a bedside table.
 */
function chairParts(w: number, d: number, h: number, back: boolean): SubBox[] {
  const seatTop = back ? Math.min(Math.max(h * 0.5, 40), h - 20) : h
  if (seatTop <= SLAB + 4) return [box(w, d, h)]

  const parts = legs(w, d, seatTop - SLAB, 5)
  parts.push({ lx0: 0, lx1: w, ly0: 0, ly1: d, lz0: seatTop - SLAB, lz1: seatTop, tint: 1.05, detailFront: true })
  if (back) {
    const thick = Math.max(2, Math.min(PANEL + 1, d / 6))
    // Set in from the sides, so the back reads as a rest rather than a wall.
    const cheek = Math.min(w * 0.08, 4)
    parts.push({ lx0: cheek, lx1: w - cheek, ly0: 0, ly1: thick, lz0: seatTop, lz1: h, tint: 0.95 })
  }
  return parts
}

/** A bed is a frame with a mattress set into it and a headboard at the back. */
function bedParts(w: number, d: number, h: number): SubBox[] {
  const head = Math.min(10, d * 0.08)
  // Clamped to the piece: "bed" also catches an under-bed storage box 24 cm
  // tall, and a mattress standing proud of the item it belongs to would break
  // both hit-testing and the collision check.
  const frame = Math.min(Math.max(h * 0.45, 18), h)
  const mattressTop = Math.min(Math.max(h * 0.75, 25), h)
  if (mattressTop <= frame + 2) return [box(w, d, h)]

  const inset = Math.min(4, w * 0.03)
  return [
    { lx0: 0, lx1: w, ly0: 0, ly1: head, lz0: 0, lz1: h, tint: 0.95 },
    { lx0: 0, lx1: w, ly0: head, ly1: d, lz0: 0, lz1: frame, tint: 0.92 },
    // The mattress, set in on three sides so the frame shows around it.
    {
      lx0: inset,
      lx1: w - inset,
      ly0: head,
      ly1: d - inset,
      lz0: frame,
      lz1: mattressTop,
      tint: 1.1,
      detailFront: true,
    },
  ]
}

/**
 * An open carcass: two sides, a top and a bottom, a panel across the back and
 * the shelves themselves. What you see through the front is the back panel,
 * which is why it is there -- without it a bookcase would be a hole.
 */
function shelfParts(w: number, d: number, h: number): SubBox[] {
  if (w < 25 || d < 12 || h < 30) return [box(w, d, h)]

  const t = Math.max(2, Math.min(PANEL, w / 8, d / 6, h / 10))
  const back = Math.max(1.5, Math.min(2.5, d / 8))
  const parts: SubBox[] = [
    { lx0: 0, lx1: t, ly0: 0, ly1: d, lz0: 0, lz1: h },
    { lx0: w - t, lx1: w, ly0: 0, ly1: d, lz0: 0, lz1: h },
    { lx0: t, lx1: w - t, ly0: 0, ly1: d, lz0: h - t, lz1: h },
    { lx0: t, lx1: w - t, ly0: 0, ly1: d, lz0: 0, lz1: t },
    // Darker, because it sits in the shade of the carcass around it.
    { lx0: t, lx1: w - t, ly0: 0, ly1: back, lz0: t, lz1: h - t, tint: 0.78 },
  ]

  // Roughly a shelf every 35 cm, the same spacing the flat front detail used.
  const bays = Math.max(1, Math.min(7, Math.round(h / 35)))
  const inner = h - 2 * t
  for (let i = 1; i < bays; i++) {
    const z = t + (inner * i) / bays
    parts.push({
      lx0: t,
      lx1: w - t,
      ly0: back,
      ly1: d,
      lz0: z - t / 2,
      lz1: z + t / 2,
      tint: 0.97,
    })
  }
  return parts
}

/** A carcass standing clear of the floor on an underframe or feet. */
function raisedParts(w: number, d: number, h: number, clearance: number, open: boolean): SubBox[] {
  const lift = Math.min(clearance, h * 0.3)
  if (lift < 3) return open ? shelfParts(w, d, h) : [box(w, d, h)]

  const body = open ? shelfParts(w, d, h - lift) : [box(w, d, h - lift)]
  return [...body.map((b) => ({ ...b, lz0: b.lz0 + lift, lz1: b.lz1 + lift })), ...legs(w, d, lift, 5)]
}

/** Sold on an underframe, on legs, on feet or on castors, and drawn that way. */
const RAISED = /underframe|with legs|w legs|with feet|w feet|castors|trestle/
const UPHOLSTERED = /sofa|armchair|chaise|corner section|footstool|pouffe|ottoman|rocking-chair|day-?bed/
// Not "bench": in these systems that is nearly always a TV bench, which is a
// cabinet, and drawing one on chair legs would be worse than a plain box.
const SEATING = /\bchair\b|\bstool\b|highchair/
const BACKLESS = /stool|footstool|pouffe/
const BED = /\bbed\b|bedstead|divan|mattress|bunk/

/**
 * The boxes to draw a product as.
 *
 * `stored` is the shape built from IKEA's own model, when there is one: real
 * geometry beats a rule about what bookcases look like, so it wins outright.
 * It carries no front detailing, because the detail is in the shape by then --
 * the shelves are shelves rather than lines painted on a slab.
 */
export function subBoxes(item: CatalogItem, stored?: number[][]): SubBox[] {
  if (stored?.length) {
    return stored.map(([lx0, ly0, lz0, lx1, ly1, lz1]) => ({ lx0, ly0, lz0, lx1, ly1, lz1 }))
  }

  const { width: w, depth: d, height: h, type, face } = item
  const t = type.toLowerCase()

  if (face === 'surface') return tableParts(w, d, h)
  if (BED.test(t)) return bedParts(w, d, h)
  if (UPHOLSTERED.test(t) && w >= 60) return sofaParts(w, d, h)
  // An armchair too narrow for arms is still a chair with a back, not a block.
  if (UPHOLSTERED.test(t) || SEATING.test(t)) {
    if (h >= 35 && h <= 140 && w <= 110) return chairParts(w, d, h, !BACKLESS.test(t) && h >= 60)
  }

  const open = face === 'shelves'
  if (RAISED.test(t)) return raisedParts(w, d, h, 14, open)
  if (open) return shelfParts(w, d, h)

  return [box(w, d, h)]
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
