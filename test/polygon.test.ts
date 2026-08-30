/**
 * Checks on floor-plan geometry: what counts as inside an irregular room, and
 * that an L-shaped plan survives a share link. A mistake here means furniture
 * silently allowed to sit inside a wall. Run with `npm test`.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  area,
  bounds,
  clockwise,
  contains,
  containsRect,
  isRectangle,
  lShape,
  nearestEdge,
  rectangle,
  segmentsCross,
  signedArea2,
  type Point,
} from '../src/lib/polygon.ts'
import type { Catalog, Layout } from '../src/lib/types.ts'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

const rect = rectangle(400, 300)
// An L: 400x300 with a 160x120 bite out of the near-right corner.
const ell = lShape(400, 300, 160, 120)

// --- Basics -----------------------------------------------------------------

check('a rectangle has the area it should', area(rect) === 400 * 300, String(area(rect)))
check('the L is smaller than its bounding box by the notch', area(ell) === 400 * 300 - 160 * 120, String(area(ell)))
check('a rectangle is recognised as one', isRectangle(rect))
check('an L is not mistaken for a rectangle', !isRectangle(ell))
check('both shapes are wound clockwise', signedArea2(rect) > 0 && signedArea2(ell) > 0)
check('rewinding a reversed polygon restores clockwise', signedArea2(clockwise([...rect].reverse())) > 0)
check('bounding box of the L is the full rectangle', (() => {
  const b = bounds(ell)
  return b.minX === 0 && b.minY === 0 && b.maxX === 400 && b.maxY === 300
})())

// --- Inside and outside -----------------------------------------------------

check('a point in the middle of the rectangle is inside', contains(rect, 200, 150))
check('a point beyond the rectangle is outside', !contains(rect, 500, 150))
check('a point in the L’s solid part is inside', contains(ell, 50, 250))
check('a point in the L’s notch is outside', !contains(ell, 380, 280), 'the notch must read as outside')
check('a point just inside the notch edge is still outside', !contains(ell, 250, 290))
check('a point just outside the notch edge is inside', contains(ell, 230, 290))

// --- Rectangles against the room --------------------------------------------

check('a wardrobe against the back wall fits', containsRect(ell, { x: 10, y: 10, width: 100, depth: 60 }))
check('a wardrobe hanging out of the room does not', !containsRect(ell, { x: 370, y: 10, width: 100, depth: 60 }))
check('a sofa sitting in the notch does not fit', !containsRect(ell, { x: 280, y: 220, width: 100, depth: 60 }))

check(
  'a rectangle spanning the notch is rejected even though its corners are inside',
  // Corners at x=200 and x=300, y=200 and y=290. The notch starts at x=240,
  // y=180, so the corners miss it but the shape crosses the wall.
  !containsRect(ell, { x: 150, y: 285, width: 200, depth: 10 }),
)

check(
  'a rectangle entirely outside the room is rejected',
  !containsRect(rect, { x: 500, y: 500, width: 50, depth: 50 }),
)

// --- Edges ------------------------------------------------------------------

check('segments that cross are detected', segmentsCross([0, 0], [10, 10], [0, 10], [10, 0]))
check('segments that miss are not', !segmentsCross([0, 0], [10, 10], [20, 20], [30, 30]))
check('segments merely touching at an end do not count as crossing', !segmentsCross([0, 0], [10, 0], [10, 0], [10, 10]))

check(
  'the nearest edge to a point is found, with the point on it',
  (() => {
    const hit = nearestEdge(rect, [200, -30] as Point)
    // Closest edge is the back wall from (0,0) to (400,0).
    return hit.index === 0 && hit.point[1] === 0 && Math.abs(hit.point[0] - 200) < 1e-9 && hit.distance === 30
  })(),
)

// --- An irregular room survives a share link --------------------------------

const here = dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(resolve(here, '../public/catalog.json'), 'utf8')) as Catalog
;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200, json: async () => catalog })
;(globalThis as unknown as { window: unknown }).window = { location: { href: 'https://example.test/' } }

const { loadCatalog } = await import('../src/lib/catalog.ts')
await loadCatalog('ignored')
const { decodeLayout, encodeLayout, sanitizeLayout } = await import('../src/lib/layout.ts')

const article = catalog.items[0].id
const plan: Layout = {
  version: 1,
  name: 'L-shaped',
  room: { width: 400, depth: 300, height: 250, wallColor: '#e8e4dc', floorColor: '#c8ac86', outline: ell },
  items: [{ uid: 'a', itemId: article, x: 20, y: 20, z: 0, rotation: 0 }],
  savedAt: '2026-01-01T00:00:00.000Z',
}

const back = decodeLayout(encodeLayout(plan))
check('an irregular floor plan survives a share link', !!back?.layout.room.outline)
check(
  'every corner comes back where it was',
  JSON.stringify(back?.layout.room.outline) === JSON.stringify(ell),
  JSON.stringify(back?.layout.room.outline),
)
check(
  'a share link with a floor plan is still short',
  encodeLayout(plan).length < 400,
  `${encodeLayout(plan).length} chars`,
)
check(
  'a rectangular room carries no outline, so its link stays minimal',
  (() => {
    const flat: Layout = { ...plan, room: { ...plan.room, outline: undefined } }
    return encodeLayout(flat).length < encodeLayout(plan).length && !decodeLayout(encodeLayout(flat))?.layout.room.outline
  })(),
)

// --- Rejecting bad outlines -------------------------------------------------

const withOutline = (outline: unknown) => sanitizeLayout({ ...plan, room: { ...plan.room, outline } })

check('an outline with two corners is dropped', withOutline([[0, 0], [10, 10]])?.layout.room.outline === undefined)
check('an outline with a non-numeric corner is dropped', withOutline([[0, 0], ['x', 1], [5, 5]])?.layout.room.outline === undefined)
check('an absurdly large coordinate is dropped', withOutline([[0, 0], [99999, 0], [0, 50]])?.layout.room.outline === undefined)
check('an outline with hundreds of corners is dropped',
  withOutline(Array.from({ length: 200 }, (_, i) => [i, i]))?.layout.room.outline === undefined)
check('a valid outline is kept', Array.isArray(withOutline(ell)?.layout.room.outline))
check(
  'the room box is recomputed from the outline rather than trusted',
  (() => {
    const loaded = sanitizeLayout({ ...plan, room: { ...plan.room, width: 999, depth: 999, outline: ell } })
    return loaded?.layout.room.width === 400 && loaded.layout.room.depth === 300
  })(),
)

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
