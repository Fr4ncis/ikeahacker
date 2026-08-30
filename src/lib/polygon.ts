/**
 * Floor-plan geometry.
 *
 * A room's floor is a closed polygon in centimetres, wound clockwise in plan
 * view (x right, y away from the viewer). A plain rectangle is just a
 * four-point polygon, so there is one code path rather than two.
 */

export type Point = [x: number, y: number]

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function bounds(poly: Point[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of poly) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Twice the signed area. Positive means clockwise in a y-down plan view. */
export function signedArea2(poly: Point[]): number {
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]
    const [x1, y1] = poly[(i + 1) % poly.length]
    sum += x0 * y1 - x1 * y0
  }
  return sum
}

export const area = (poly: Point[]) => Math.abs(signedArea2(poly)) / 2

/** Returns the polygon wound clockwise, so edge normals can be trusted. */
export function clockwise(poly: Point[]): Point[] {
  return signedArea2(poly) < 0 ? [...poly].reverse() : poly
}

export function centroid(poly: Point[]): Point {
  let x = 0
  let y = 0
  for (const p of poly) {
    x += p[0]
    y += p[1]
  }
  return [x / poly.length, y / poly.length]
}

/** Ray casting. Points exactly on an edge may fall either way, which is fine here. */
export function contains(poly: Point[], px: number, py: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

/** Proper segment intersection; touching endpoints do not count. */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orient(a[0], a[1], b[0], b[1], c[0], c[1])
  const d2 = orient(a[0], a[1], b[0], b[1], d[0], d[1])
  const d3 = orient(c[0], c[1], d[0], d[1], a[0], a[1])
  const d4 = orient(c[0], c[1], d[0], d[1], b[0], b[1])
  return d1 * d2 < 0 && d3 * d4 < 0
}

export interface Rect {
  x: number
  y: number
  width: number
  depth: number
}

const corners = (r: Rect): Point[] => [
  [r.x, r.y],
  [r.x + r.width, r.y],
  [r.x + r.width, r.y + r.depth],
  [r.x, r.y + r.depth],
]

/**
 * Does an axis-aligned rectangle lie wholly inside the room?
 *
 * Both tests are needed: every corner inside still allows a wall to cut across
 * the middle of a concave room, and no crossing edge still allows a rectangle
 * that sits entirely outside.
 */
export function containsRect(poly: Point[], r: Rect): boolean {
  const pts = corners(r)
  if (!pts.every(([x, y]) => contains(poly, x, y))) return false

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    for (let j = 0; j < 4; j++) {
      if (segmentsCross(a, b, pts[j], pts[(j + 1) % 4])) return false
    }
  }
  return true
}

/** Distance from a point to a segment, and the closest point on it. */
export function closestOnSegment(p: Point, a: Point, b: Point): { point: Point; distance: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
  const point: Point = [a[0] + t * dx, a[1] + t * dy]
  return { point, distance: Math.hypot(p[0] - point[0], p[1] - point[1]) }
}

/** Index of the edge nearest a point, with the closest point on it. */
export function nearestEdge(poly: Point[], p: Point): { index: number; point: Point; distance: number } {
  let best = { index: 0, point: poly[0], distance: Infinity }
  for (let i = 0; i < poly.length; i++) {
    const hit = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length])
    if (hit.distance < best.distance) best = { index: i, ...hit }
  }
  return best
}

// --- Shapes -----------------------------------------------------------------

export function rectangle(width: number, depth: number): Point[] {
  return [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ]
}

/**
 * An L, with the missing corner cut out of the near-right of the room. `notchW`
 * and `notchD` are how far the cut reaches in from that corner.
 */
export function lShape(width: number, depth: number, notchW: number, notchD: number): Point[] {
  const w = Math.min(notchW, width - 50)
  const d = Math.min(notchD, depth - 50)
  return [
    [0, 0],
    [width, 0],
    [width, depth - d],
    [width - w, depth - d],
    [width - w, depth],
    [0, depth],
  ]
}

/** True when the outline is just its own bounding box, i.e. a plain rectangle. */
export function isRectangle(poly: Point[]): boolean {
  if (poly.length !== 4) return false
  const b = bounds(poly)
  return poly.every(([x, y]) => (x === b.minX || x === b.maxX) && (y === b.minY || y === b.maxY))
}
