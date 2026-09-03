/**
 * Checks on the maths the planner is built from: the isometric projection, the
 * camera rotation, an item's local-to-world mapping, and the painter's
 * ordering. Run with `npm test`.
 *
 * These are the parts where a mistake is invisible in a screenshot until
 * something is subtly in the wrong place, so they are worth asserting.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { footprint, fromView, paintOrder, project, toView, unproject, viewBounds, type ViewBox } from '../src/lib/iso.ts'
import { localToWorld, subBoxes } from '../src/lib/geometry.ts'
import type { Catalog, CatalogItem, PlacedItem, Room } from '../src/lib/types.ts'

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

// --- Item shapes ------------------------------------------------------------

/**
 * A piece is drawn as a handful of sub-boxes, and hit-testing, collision and
 * the shopping list all work off the published measurements, so no part may
 * wander outside them. The archetype checks below pin down the dispatch, which
 * is a pile of regular expressions over 397 distinct product types and would
 * otherwise be easy to break by accident.
 */
const here = dirname(fileURLToPath(import.meta.url))
const products = (JSON.parse(readFileSync(resolve(here, '../public/catalog.json'), 'utf8')) as Catalog).items

const piece = (over: Partial<CatalogItem>): CatalogItem =>
  ({
    id: '00000000',
    system: 'X',
    systemLabel: 'X',
    name: 'X',
    type: 'Cabinet',
    finish: 'white',
    color: '#fff',
    width: 80,
    depth: 40,
    height: 100,
    measureText: '',
    price: null,
    currency: 'GBP',
    imageUrl: '',
    productUrl: '',
    category: 'shelving',
    face: 'plain',
    ...over,
  }) as CatalogItem

check(
  `every part of all ${products.length} products stays inside the published size`,
  products.every((item) =>
    subBoxes(item).every(
      (b) =>
        b.lx0 >= -1e-9 && b.lx1 <= item.width + 1e-9 &&
        b.ly0 >= -1e-9 && b.ly1 <= item.depth + 1e-9 &&
        b.lz0 >= -1e-9 && b.lz1 <= item.height + 1e-9,
    ),
  ),
)

check(
  'no part is inside out or flat',
  products.every((item) => subBoxes(item).every((b) => b.lx1 > b.lx0 && b.ly1 > b.ly0 && b.lz1 > b.lz0)),
)

check(
  // Two would paint the door lines twice, in two places.
  'at most one part of a piece carries the front detailing',
  products.every((item) => subBoxes(item).filter((b) => b.detailFront).length <= 1),
)

check(
  'every piece touches the floor somewhere',
  products.every((item) => subBoxes(item).some((b) => b.lz0 < 1e-9)),
)

check(
  'a chair is drawn with legs, a seat and a back',
  (() => {
    const parts = subBoxes(piece({ type: 'Chair', width: 46, depth: 51, height: 80, face: 'plain' }))
    const feet = parts.filter((b) => b.lz0 === 0)
    const seat = parts.find((b) => b.detailFront)
    return feet.length === 4 && !!seat && seat.lz0 > 20 && parts.length === 6
  })(),
)

check(
  'a stool has no back',
  subBoxes(piece({ type: 'Stool', width: 40, depth: 40, height: 63 })).length === 5,
)

check(
  // "Bench" reads as seating but in these systems it is nearly always a TV
  // bench, and putting a cabinet on chair legs looks worse than a plain box.
  'a TV bench is left as a cabinet',
  subBoxes(piece({ type: 'TV bench', width: 180, depth: 41, height: 47, face: 'drawers' })).length === 1,
)

check(
  'an open bookcase becomes a carcass with shelves behind a back panel',
  (() => {
    const parts = subBoxes(piece({ type: 'Bookcase', width: 80, depth: 28, height: 202, face: 'shelves' }))
    const backPanel = parts.find((b) => b.ly1 < 4 && b.lz1 > 100)
    // Two sides, a top, a bottom, a back and the shelves between them.
    return parts.length >= 9 && !!backPanel && parts.every((b) => !b.detailFront)
  })(),
)

check(
  'a piece sold on castors stands clear of the floor on them',
  (() => {
    const parts = subBoxes(piece({ type: 'Drawer unit on castors', width: 36, depth: 58, height: 76, face: 'drawers' }))
    const body = parts.find((b) => b.detailFront)
    const castors = parts.filter((b) => b.lz0 === 0)
    return !!body && body.lz0 > 3 && castors.length === 4 && castors.every((c) => c.lz1 <= body!.lz0 + 1e-9)
  })(),
)

check(
  'a shelf too small to have a carcass is left as one box',
  subBoxes(piece({ type: 'Shelf', width: 30, depth: 20, height: 5, face: 'shelves' })).length === 1,
)

check(
  'a wardrobe is still a single box',
  subBoxes(piece({ type: 'Wardrobe', width: 100, depth: 58, height: 201, face: 'double-door' })).length === 1,
)

// --- Shapes built from IKEA's own models --------------------------------------

/**
 * The shapes are optional: they are built by a separate pass over a thousand
 * downloads and a fork may never run it. When the file is there, every shape
 * in it has to obey what the archetypes obey, because the renderer, the picker
 * and the collision check make no distinction between them.
 */
const shapeFile = (() => {
  try {
    return JSON.parse(readFileSync(resolve(here, '../public/shapes.json'), 'utf8')) as {
      cell: number
      shapes: Record<string, number[][]>
    }
  } catch {
    return null
  }
})()

if (!shapeFile) {
  console.log('SKIP  no public/shapes.json; run `npm run shapes` to build one')
} else {
  const sized = new Map(products.map((p) => [p.id, p]))
  const built = Object.entries(shapeFile.shapes)

  const stale = built.filter(([id]) => !sized.has(id))

  check(
    // Not "every": the catalogue is re-scraped nightly and the shapes are
    // built by hand, so articles retire out from under them. A shape for an
    // article the catalogue no longer has is unreachable rather than wrong,
    // since shapes are looked up by walking the catalogue. What would matter
    // is the file drifting so far it has stopped describing the catalogue.
    `stored shapes still describe the catalogue (${built.length - stale.length} of ${built.length})`,
    built.length > 0 && stale.length < built.length * 0.1,
    `${stale.length} are for retired articles; run \`npm run shapes\` to clear them`,
  )

  check(
    'a stored shape stays inside the size IKEA published',
    built.filter(([id]) => sized.has(id)).every(([id, boxes]) => {
      const item = sized.get(id)!
      return boxes.every(
        ([lx0, ly0, lz0, lx1, ly1, lz1]) =>
          lx0 >= -1e-9 && lx1 <= item.width + 1e-9 &&
          ly0 >= -1e-9 && ly1 <= item.depth + 1e-9 &&
          lz0 >= -1e-9 && lz1 <= item.height + 1e-9,
      )
    }),
  )

  check(
    'no stored box is inside out or flat',
    built.every(([, boxes]) => boxes.every(([lx0, ly0, lz0, lx1, ly1, lz1]) => lx1 > lx0 && ly1 > ly0 && lz1 > lz0)),
  )

  check(
    'a stored shape is six numbers a box, and few enough boxes to draw',
    built.every(([, boxes]) => boxes.length > 0 && boxes.length <= 80 && boxes.every((b) => b.length === 6)),
  )

  check(
    // A shape that floats would look like a bug and hide a real one.
    'a stored shape reaches the floor',
    built.every(([, boxes]) => boxes.some(([, , lz0]) => lz0 < shapeFile.cell + 1e-9)),
  )

  check(
    // Every shape is scaled onto the size on the label, so its outermost boxes
    // land on that size by construction. One that stops short is a shape put
    // together wrongly -- a swap of depth for height leaves a 202 cm bookcase
    // 39 cm tall, and it passed every other check here while it did so.
    'a stored shape fills the size it was scaled onto',
    built.filter(([id]) => sized.has(id)).every(([id, boxes]) => {
      const item = sized.get(id)!
      const reach = (axis: number) => Math.max(...boxes.map((b) => b[axis]))
      const slack = shapeFile.cell + 1
      return (
        reach(3) >= item.width - slack && reach(4) >= item.depth - slack && reach(5) >= item.height - slack
      )
    }),
    JSON.stringify(
      built
        .filter(([id]) => sized.has(id))
        .filter(([id, boxes]) => Math.max(...boxes.map((b) => b[5])) < sized.get(id)!.height - shapeFile.cell - 1)
        .slice(0, 3)
        .map(([id]) => `${sized.get(id)!.name} ${sized.get(id)!.type}`),
    ),
  )

  check(
    'a stored shape is used in place of the archetype, and carries no painted detail',
    (() => {
      const [id, boxes] = built[0]
      const drawn = subBoxes(sized.get(id)!, boxes)
      return drawn.length === boxes.length && drawn.every((b) => !b.detailFront)
    })(),
  )

  check(
    'a product with no stored shape still gets its archetype',
    subBoxes(piece({ type: 'Chair', width: 46, depth: 51, height: 80 }), undefined).length === 6,
  )
}

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
