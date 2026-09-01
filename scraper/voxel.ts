/**
 * Turns a product's 3D model into the handful of boxes the planner draws.
 *
 * IKEA publishes a glTF model for a lot of its articles. Those are tens of
 * thousands of triangles, which is neither what the renderer draws nor what
 * the look of the thing calls for: it paints axis-aligned boxes in an
 * isometric projection. So the mesh is sampled into a grid of cubes and the
 * cubes are merged back into as few boxes as will cover them. A BILLY
 * bookcase comes out as about fifteen, and they are the right fifteen -- the
 * sides, the back and each shelf, in the real places, rather than a rule
 * somebody wrote about what bookcases look like.
 *
 * Only the surface is filled. A solid fill would close up an open bookcase,
 * and the shell is what reads as furniture from the outside anyway.
 */

/** A triangle, in the model's own coordinates (metres, Y up). */
export type Triangle = [number, number, number][]

/** A box in the item's local frame, in centimetres: lx, ly (back to front), lz. */
export interface ShapeBox {
  lx0: number
  ly0: number
  lz0: number
  lx1: number
  ly1: number
  lz1: number
}

export interface Bounds {
  min: [number, number, number]
  max: [number, number, number]
}

export function boundsOf(tris: Triangle[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const t of tris) {
    for (const v of t) {
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i]
        if (v[i] > max[i]) max[i] = v[i]
      }
    }
  }
  return { min, max }
}

/**
 * Marks every cell the surface passes through.
 *
 * Triangles are sampled rather than tested for overlap: a point every 40% of a
 * cell across the triangle cannot step over a cell, and it is a tenth of the
 * code of a separating-axis test. Sampling is per triangle edge length, so a
 * large flat panel costs what its area costs and a tiny one costs almost
 * nothing.
 */
export function voxelise(tris: Triangle[], cellCm: number, bounds = boundsOf(tris)): Set<string> {
  const cells = new Set<string>()
  const cell = cellCm / 100
  const { min } = bounds

  for (const [a, b, c] of tris) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const longest = Math.max(Math.hypot(...(ab as [number, number, number])), Math.hypot(...(ac as [number, number, number])))
    const steps = Math.max(2, Math.ceil(longest / (cell * 0.4)))

    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps
        const v = j / steps
        const x = Math.floor((a[0] + ab[0] * u + ac[0] * v - min[0]) / cell)
        const y = Math.floor((a[1] + ab[1] * u + ac[1] * v - min[1]) / cell)
        const z = Math.floor((a[2] + ab[2] * u + ac[2] * v - min[2]) / cell)
        cells.add(`${x},${y},${z}`)
      }
    }
  }
  return cells
}

/**
 * Merges filled cells into as few boxes as possible.
 *
 * Greedily: take the lowest cell left, run as far as it goes in x, then widen
 * that run in y for as long as every cell is present, then again in z. It is
 * not the smallest possible set of boxes, which is NP-hard, but it turns a few
 * hundred cells into a couple of dozen boxes, and the ones it finds are the
 * slabs and panels the furniture is actually made of.
 */
export function merge(cells: Set<string>): ShapeBox[] {
  const left = new Set(cells)
  const parse = (key: string) => key.split(',').map(Number) as [number, number, number]
  const has = (x: number, y: number, z: number) => left.has(`${x},${y},${z}`)

  const order = [...cells].sort((p, q) => {
    const a = parse(p)
    const b = parse(q)
    return a[2] - b[2] || a[1] - b[1] || a[0] - b[0]
  })

  const boxes: ShapeBox[] = []
  for (const key of order) {
    if (!left.has(key)) continue
    const [x, y, z] = parse(key)

    let w = 1
    while (has(x + w, y, z)) w++

    let d = 1
    grow: for (;;) {
      for (let i = 0; i < w; i++) if (!has(x + i, y + d, z)) break grow
      d++
    }

    let h = 1
    rise: for (;;) {
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (!has(x + i, y + j, z + h)) break rise
      h++
    }

    for (let i = 0; i < w; i++)
      for (let j = 0; j < d; j++) for (let k = 0; k < h; k++) left.delete(`${x + i},${y + j},${z + k}`)

    boxes.push({ lx0: x, ly0: y, lz0: z, lx1: x + w, ly1: y + d, lz1: z + h })
  }
  return boxes
}

/** The cells a set of merged boxes covers. Exactly inverts `merge`. */
export function expand(boxes: ShapeBox[]): Set<string> {
  const cells = new Set<string>()
  for (const b of boxes)
    for (let x = b.lx0; x < b.lx1; x++)
      for (let y = b.ly0; y < b.ly1; y++) for (let z = b.lz0; z < b.lz1; z++) cells.add(`${x},${y},${z}`)
  return cells
}

/**
 * Fills the space a shell encloses.
 *
 * Sampling the surface leaves a cabinet hollow, and the camera looks down into
 * anything hollow through its own top: a chest of drawers came out as a cage.
 * So the empty space is flooded from outside the model, and whatever the flood
 * cannot reach was inside something and is filled in.
 *
 * A bookcase stays open, which is the point of doing it this way round rather
 * than filling between the outermost cells on each axis. Its front is open to
 * the outside, so the flood walks straight in, and the shelves stay shelves.
 */
export function fillEnclosed(cells: Set<string>): Set<string> {
  let lo = [Infinity, Infinity, Infinity]
  let hi = [-Infinity, -Infinity, -Infinity]
  for (const key of cells) {
    const p = key.split(',').map(Number)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i])
      hi[i] = Math.max(hi[i], p[i])
    }
  }
  if (!Number.isFinite(lo[0])) return cells

  // Air all round except underneath. Furniture models routinely leave out the
  // face nobody sees, and a flood let in from below comes up inside the
  // carcass: a chest of drawers came out as a cage. The floor it stands on is
  // as good a sixth wall as the model has.
  //
  // Only the floor. Sealing the back as well was tried and is not worth it: it
  // gains a box or two on a cabinet and risks filling in shelving that is open
  // at the back. An open bookcase is unaffected either way, since its front is
  // open and the flood walks straight in there.
  lo = [lo[0] - 1, lo[1], lo[2] - 1]
  hi = hi.map((v) => v + 1)
  const key = (p: number[]) => `${p[0]},${p[1]},${p[2]}`
  const outside = new Set<string>()
  // The far top corner, out in the air added above and in front.
  const start = [lo[0], hi[1], hi[2]]
  const queue: number[][] = [start]
  outside.add(key(start))

  while (queue.length) {
    const p = queue.pop()!
    for (const [dx, dy, dz] of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      const n = [p[0] + dx, p[1] + dy, p[2] + dz]
      if (n.some((v, i) => v < lo[i] || v > hi[i])) continue
      const k = key(n)
      if (outside.has(k) || cells.has(k)) continue
      outside.add(k)
      queue.push(n)
    }
  }

  const filled = new Set(cells)
  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) {
        const k = `${x},${y},${z}`
        if (!filled.has(k) && !outside.has(k)) filled.add(k)
      }
  return filled
}

/**
 * Puts the boxes in the planner's frame, at the size IKEA publishes.
 *
 * glTF is Y-up with +Z towards the viewer; the planner has `lx` across the
 * width, `ly` from the back to the front and `lz` upwards, so the model's Y
 * and Z swap. Each axis is then scaled to the published measurement rather
 * than trusted: a BILLY model measures 205 cm against a published 202, and a
 * part sticking out past the size on the label would break hit-testing and the
 * collision check, which both work off that size.
 */
export function toLocal(
  boxes: ShapeBox[],
  cellCm: number,
  bounds: Bounds,
  size: { width: number; depth: number; height: number },
): ShapeBox[] {
  const span = [
    (bounds.max[0] - bounds.min[0]) * 100,
    (bounds.max[1] - bounds.min[1]) * 100,
    (bounds.max[2] - bounds.min[2]) * 100,
  ]
  const scale = [
    span[0] > 0 ? size.width / span[0] : 0,
    span[1] > 0 ? size.height / span[1] : 0,
    span[2] > 0 ? size.depth / span[2] : 0,
  ]
  // The grid runs a fraction past the model, since a cell that a surface only
  // clips still counts, so both ends are held inside the published size --
  // clamping one end alone turns a box that lies entirely in that overhang
  // inside out. Anything left with no thickness is a sliver of rounding and
  // is dropped rather than drawn.
  const at = (v: number, axis: number, limit: number) =>
    Math.round(Math.min(limit, Math.max(0, v * cellCm * scale[axis])) * 10) / 10

  // The swap happens here: a merged box counts cells in the model's own order,
  // x then up then depth, and the planner wants x then depth then up.
  return boxes
    .map((b) => ({
      lx0: at(b.lx0, 0, size.width),
      lx1: at(b.lx1, 0, size.width),
      ly0: at(b.lz0, 2, size.depth),
      ly1: at(b.lz1, 2, size.depth),
      lz0: at(b.ly0, 1, size.height),
      lz1: at(b.ly1, 1, size.height),
    }))
    .filter((b) => b.lx1 > b.lx0 && b.ly1 > b.ly0 && b.lz1 > b.lz0)
}

/** The published size a model has to be close to before it is believed. */
const TOLERANCE = 0.2

/**
 * Is this model plausibly of this product?
 *
 * The article number in the URL comes from the product's own page, so a
 * mismatch means IKEA published a model of something else -- a whole
 * combination, or the frame without its doors. Rather than guess, such a model
 * is dropped and the product keeps the shape its type implies.
 */
export function fitsPublishedSize(
  bounds: Bounds,
  size: { width: number; depth: number; height: number },
): boolean {
  const span = [
    (bounds.max[0] - bounds.min[0]) * 100,
    (bounds.max[1] - bounds.min[1]) * 100,
    (bounds.max[2] - bounds.min[2]) * 100,
  ]
  const want = [size.width, size.height, size.depth]
  return span.every((s, i) => want[i] > 0 && Math.abs(s - want[i]) / want[i] <= TOLERANCE)
}

/** Boxes as they are stored: six numbers, which is a third of the JSON of named fields. */
export const pack = (b: ShapeBox): number[] => [b.lx0, b.ly0, b.lz0, b.lx1, b.ly1, b.lz1]
