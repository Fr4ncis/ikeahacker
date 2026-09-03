/**
 * Builds public/shapes.json: the products IKEA publishes a model for, reduced
 * to the boxes the planner draws.
 *
 *   npm run shapes                  # every product without a shape yet
 *   SHAPES_LIMIT=50 npm run shapes  # a taste of it
 *   SHAPES_CELL=8 npm run shapes    # coarser cubes, fewer boxes
 *
 * One model per product rather than per article: colourways of the same piece
 * in the same size are the same shape, which turns 3,800 downloads into about
 * 1,600. Products already in the file are left alone, so a run can be stopped
 * and picked up again, and adding the rest later costs only what is missing.
 *
 * A model is kept only if it measures what the product says it does. IKEA
 * sometimes publishes the model of a whole combination against one of its
 * parts, and a wardrobe drawn at the size of the run of wardrobes it belongs
 * to would be worse than the plain box it would otherwise get.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapLimit } from './pip.ts'
import { fetchModel } from './model.ts'
import {
  boundsOf,
  expand,
  fillEnclosed,
  fitsPublishedSize,
  merge,
  pack,
  toLocal,
  voxelise,
  type Bounds,
  type ShapeBox,
} from './voxel.ts'
import type { Catalog, CatalogItem } from '../src/lib/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const CATALOG = resolve(here, '../public/catalog.json')
const SHAPES = resolve(here, '../public/shapes.json')
const CELL_CACHE = resolve(here, '.cache/cells')

const LIMIT = Number(process.env.SHAPES_LIMIT ?? 5000)
const CONCURRENCY = Number(process.env.SHAPES_CONCURRENCY ?? 4)
const CELL = Number(process.env.SHAPES_CELL ?? 6)

/** More than this many boxes and the piece costs more to draw than it is worth. */
const MAX_BOXES = 80
/** Fewer cells than this means the model was empty or unreadably thin. */
const MIN_CELLS = 8

export interface ShapeFile {
  version: 1
  /** The cube size the models were sampled at, in centimetres. */
  cell: number
  builtAt: string
  /** Article number to boxes, each box six numbers: lx0, ly0, lz0, lx1, ly1, lz1. */
  shapes: Record<string, number[][]>
}

/** The same grouping the app uses: one shape per product, not per colourway. */
const groupKey = (i: CatalogItem) => `${i.system}|${i.name}|${i.type}|${i.width}x${i.depth}x${i.height}`

interface Grid {
  bounds: Bounds
  cells: number
  boxes: ShapeBox[]
}

/**
 * The merged cubes for a product, downloading and sampling the model if this
 * is the first time at this cube size.
 *
 * The cache stops at the merge rather than at the finished shape, which is the
 * same line pip.ts draws: everything expensive is behind it, and everything
 * still being argued about -- how a model is squared up with the size on the
 * label -- is in front, so that can change without fetching a gigabyte again.
 */
async function cellsFor(item: CatalogItem): Promise<Grid | 'none' | null> {
  const file = resolve(CELL_CACHE, `${item.id}-${CELL}.json`)
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as Grid | { none: true }
    return 'none' in cached ? 'none' : cached
  } catch {
    // Not fetched yet.
  }

  let tris
  try {
    tris = await fetchModel(item.id, item.productUrl)
  } catch {
    return null
  }
  await mkdir(CELL_CACHE, { recursive: true })
  if (!tris) {
    await writeFile(file, JSON.stringify({ none: true }))
    return 'none'
  }

  const bounds = boundsOf(tris)
  const cells = voxelise(tris, CELL, bounds)
  const grid: Grid = { bounds, cells: cells.size, boxes: merge(cells) }
  await writeFile(file, JSON.stringify(grid))
  return grid
}

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG, 'utf8')) as Catalog
  const existing: ShapeFile = await readFile(SHAPES, 'utf8')
    .then((raw) => JSON.parse(raw) as ShapeFile)
    .catch(() => ({ version: 1, cell: CELL, builtAt: '', shapes: {} }))

  // A change of cube size invalidates every shape in the file.
  const shapes = existing.cell === CELL ? existing.shapes : {}
  if (existing.cell !== CELL && Object.keys(existing.shapes).length) {
    console.log(`cell size changed ${existing.cell} -> ${CELL} cm, rebuilding every shape`)
  }

  const groups = new Map<string, CatalogItem>()
  for (const item of catalog.items) if (!groups.has(groupKey(item))) groups.set(groupKey(item), item)

  const done = new Set(Object.keys(shapes))
  const pending = [...groups.values()].filter((i) => !done.has(i.id))
  const budget = pending.slice(0, LIMIT)
  console.log(
    `${groups.size} products, ${done.size} already shaped, ${pending.length} to go; fetching ${budget.length} at ${CELL} cm`,
  )

  let modelled = 0
  let noModel = 0
  let rejected = 0

  await mapLimit(budget, CONCURRENCY, async (item, index) => {
    if (index % 25 === 0 && index) console.log(`  ${index}/${budget.length}…`)
    const grid = await cellsFor(item)
    if (grid === 'none') {
      noModel++
      return
    }
    if (!grid || !fitsPublishedSize(grid.bounds, item) || grid.cells < MIN_CELLS) {
      rejected++
      return
    }

    // Filled and re-merged here rather than in the cache, so what counts as
    // the inside of a cabinet can change without fetching the models again.
    const solid = merge(fillEnclosed(expand(grid.boxes)))
    const boxes = toLocal(solid, CELL, grid.bounds, item)
    if (boxes.length > MAX_BOXES) {
      rejected++
      return
    }

    shapes[item.id] = boxes.map(pack)
    modelled++
  })

  // A shape for an article the catalogue no longer sells is dead weight: the
  // app looks shapes up by walking the catalogue, so it can never be read
  // again. The nightly re-scrape retires articles, so this drifts on its own.
  const live = new Set(catalog.items.map((i) => i.id))
  let dropped = 0
  for (const id of Object.keys(shapes)) {
    if (!live.has(id)) {
      delete shapes[id]
      dropped++
    }
  }
  if (dropped) console.log(`dropped ${dropped} shape${dropped === 1 ? '' : 's'} for articles no longer in the catalogue`)

  const file: ShapeFile = { version: 1, cell: CELL, builtAt: new Date().toISOString(), shapes }
  await writeFile(SHAPES, JSON.stringify(file))
  const counts = Object.values(shapes).map((b) => b.length)
  const average = counts.length ? (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1) : '0'

  console.log(
    `\n${modelled} shaped, ${noModel} publish no readable model, ${rejected} rejected as not matching the product`,
  )
  console.log(
    `${Object.keys(shapes).length} of ${groups.size} products now have a shape, ${average} boxes each on average`,
  )
  console.log(`wrote ${SHAPES} (${((await readFile(SHAPES)).length / 1024).toFixed(0)} KB)`)
}

await main()
