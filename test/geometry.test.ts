/**
 * Checks on the maths the planner is built from: the isometric projection, the
 * camera rotation, an item's local-to-world mapping, and the painter's
 * ordering. Run with `npm test`.
 *
 * These are the parts where a mistake is invisible in a screenshot until
 * something is subtly in the wrong place, so they are worth asserting.
 */
import { footprint, fromView, paintOrder, project, toView, unproject, viewBounds, type ViewBox } from '../src/lib/iso.ts'
import { localToWorld } from '../src/lib/geometry.ts'
import type { PlacedItem, Room } from '../src/lib/types.ts'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

const room: Room = { width: 420, depth: 340, height: 250, wallColor: '#fff', floorColor: '#fff' }

// --- Projection -------------------------------------------------------------

check(
  'the room origin projects to the screen origin',
  close(project(0, 0, 0, 2).sx, 0) && close(project(0, 0, 0, 2).sy, 0),
)

check(
  'height moves a point straight up the screen',
  (() => {
    const a = project(50, 70, 0, 2)
    const b = project(50, 70, 30, 2)
    return close(a.sx, b.sx) && close(b.sy, a.sy - 60)
  })(),
)

check(
  'unproject inverts project at any height',
  [
    [0, 0, 0],
    [120, 45, 0],
    [17.5, 303, 88],
    [420, 340, 250],
  ].every(([vx, vy, z]) => {
    const s = project(vx, vy, z, 1.7)
    const back = unproject(s.sx, s.sy, z, 1.7)
    return close(back.vx, vx, 1e-9) && close(back.vy, vy, 1e-9)
  }),
)

// --- Camera rotation --------------------------------------------------------

check(
  'fromView inverts toView for every quarter turn',
  ([0, 1, 2, 3] as const).every((rot) =>
    [
      [0, 0],
      [420, 340],
      [137, 12],
      [55.5, 299.25],
    ].every(([x, y]) => {
      const v = toView(x, y, room, rot)
      const back = fromView(v.vx, v.vy, room, rot)
      return close(back.x, x, 1e-9) && close(back.y, y, 1e-9)
    }),
  ),
)

check(
  'rotating the camera keeps every point inside the room',
  ([0, 1, 2, 3] as const).every((rot) => {
    const limit = rot % 2 === 0 ? [room.width, room.depth] : [room.depth, room.width]
    return [
      [0, 0],
      [420, 340],
      [210, 170],
    ].every(([x, y]) => {
      const v = toView(x, y, room, rot)
      return v.vx >= -1e-9 && v.vx <= limit[0] + 1e-9 && v.vy >= -1e-9 && v.vy <= limit[1] + 1e-9
    })
  }),
)

// --- Item rotation ----------------------------------------------------------

const placed = (rotation: PlacedItem['rotation']): PlacedItem => ({
  uid: 'u',
  itemId: 'i',
  x: 100,
  y: 50,
  z: 0,
  rotation,
})

check(
  'a rotated item stays inside its own footprint',
  ([0, 90, 180, 270] as const).every((rotation) => {
    const W = 120
    const D = 40
    const fp = footprint(placed(rotation), W, D)
    // Sample the item's local corners and check each lands in the footprint.
    return [
      [0, 0],
      [W, 0],
      [0, D],
      [W, D],
    ].every(([lx, ly]) => {
      const { dx, dy } = localToWorld(lx, ly, rotation, W, D)
      return dx >= -1e-9 && dx <= fp.width + 1e-9 && dy >= -1e-9 && dy <= fp.depth + 1e-9
    })
  }),
)

check(
  'rotation turns the front a quarter turn at a time',
  (() => {
    const W = 120
    const D = 40
    // The centre of an item's front edge is at local (W/2, D).
    const fronts = ([0, 90, 180, 270] as const).map((rotation) => {
      const centre = localToWorld(W / 2, D / 2, rotation, W, D)
      const front = localToWorld(W / 2, D, rotation, W, D)
      return { dx: front.dx - centre.dx, dy: front.dy - centre.dy }
    })
    // +y, then +x, then -y, then -x.
    return (
      fronts[0].dy > 0 && close(fronts[0].dx, 0) &&
      fronts[1].dx > 0 && close(fronts[1].dy, 0) &&
      fronts[2].dy < 0 && close(fronts[2].dx, 0) &&
      fronts[3].dx < 0 && close(fronts[3].dy, 0)
    )
  })(),
)

check(
  'a rotated footprint swaps width and depth',
  (() => {
    const a = footprint(placed(0), 120, 40)
    const b = footprint(placed(90), 120, 40)
    return a.width === 120 && a.depth === 40 && b.width === 40 && b.depth === 120
  })(),
)

check(
  'view bounds of a footprint stay inside the rotated room',
  ([0, 1, 2, 3] as const).every((rot) => {
    const b = viewBounds(footprint(placed(0), 120, 40), room, rot)
    const limit = rot % 2 === 0 ? [room.width, room.depth] : [room.depth, room.width]
    return b.vx0 >= -1e-9 && b.vx1 <= limit[0] + 1e-9 && b.vy0 >= -1e-9 && b.vy1 <= limit[1] + 1e-9
  }),
)

// --- Painter's ordering -----------------------------------------------------

const box = (name: string, vx0: number, vy0: number, vx1: number, vy1: number, z0 = 0, z1 = 100) =>
  ({ name, vx0, vy0, vx1, vy1, z0, z1 })
const order = (items: ReturnType<typeof box>[]) => paintOrder(items, (i) => i as ViewBox).map((i) => i.name)
const before = (list: string[], a: string, b: string) => list.indexOf(a) < list.indexOf(b)

check(
  'a box nearer the back wall is drawn first',
  before(order([box('front', 0, 200, 100, 300), box('back', 0, 0, 100, 100)]), 'back', 'front'),
)

check(
  // Distance-key sorting gets this wrong: the sofa's near corner is at 0 and
  // the wardrobe's at 250, so a single key would draw the wardrobe in front.
  'a long sofa is drawn before a wardrobe past its far end',
  before(order([box('sofa', 0, 0, 230, 95), box('wardrobe', 250, 0, 350, 60, 0, 200)]), 'sofa', 'wardrobe'),
)

check(
  'a stacked unit is drawn after the one it sits on',
  before(order([box('upper', 0, 0, 70, 35, 70, 140), box('lower', 0, 0, 70, 35, 0, 70)]), 'lower', 'upper'),
)

check(
  'ordering is transitive along a chain',
  (() => {
    const o = order([box('c', 200, 0, 300, 50), box('a', 0, 0, 50, 50), box('b', 100, 0, 150, 50)])
    return before(o, 'a', 'b') && before(o, 'b', 'c')
  })(),
)

check(
  'interpenetrating boxes still each appear exactly once',
  (() => {
    const o = order([box('x', 0, 0, 100, 200), box('y', 50, 50, 150, 150), box('z', 20, 120, 220, 180)])
    return o.length === 3 && new Set(o).size === 3
  })(),
)

check(
  'ordering does not depend on the order items were added',
  (() => {
    const items = [
      box('sofa', 0, 0, 230, 95),
      box('table', 60, 130, 180, 180, 0, 50),
      box('shelf', 260, 0, 340, 28, 0, 202),
      box('lamp', 300, 250, 340, 290, 0, 150),
    ]
    return order(items).join() === order([items[3], items[1], items[0], items[2]]).join()
  })(),
)

check(
  'a 60-box room has no pair drawn against a separating axis',
  (() => {
    const items: ReturnType<typeof box>[] = []
    let seed = 42
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n)
    for (let i = 0; i < 60; i++) {
      const x = rnd(380)
      const y = rnd(300)
      const z = rnd(2) * 80
      items.push(box(`b${i}`, x, y, x + 20 + rnd(60), y + 20 + rnd(40), z, z + 40 + rnd(120)))
    }
    const pos = new Map(order(items).map((n, i) => [n, i]))
    for (const a of items) {
      for (const b of items) {
        if (a === b) continue
        const aBehind = a.vx1 <= b.vx0 || a.vy1 <= b.vy0 || a.z1 <= b.z0
        const bBehind = b.vx1 <= a.vx0 || b.vy1 <= a.vy0 || b.z1 <= a.z0
        if (aBehind && !bBehind && pos.get(a.name)! > pos.get(b.name)!) return false
      }
    }
    return true
  })(),
)

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
