/**
 * Checks on the scraped Dunelm catalogue itself, rather than on the parser.
 *
 * These are the assertions that would have caught the bed bug from the outside:
 * a parser that reads the wrong axis produces a catalogue full of wardrobes
 * lying on their backs, and nothing else in the build notices. They also guard
 * the thing that makes a second retailer dangerous, which is that a share link
 * carries an id and not the shop it came from.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeLayout, encodeLayout } from '../src/lib/layout.ts'
import type { Catalog, Layout } from '../src/lib/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string) =>
  JSON.parse(readFileSync(resolve(here, `../public/${name}`), 'utf8')) as Catalog

const dunelm = read('catalog-dunelm.json')
const ikea = read('catalog.json')

// Serve each file by name, so `loadCatalog` really merges two shops here rather
// than being handed the same one twice. `sanitizeLayout` drops any article it
// cannot find, so the share round trip below is only meaningful once the merged
// catalogue is loaded.
const FILES: Record<string, unknown> = { 'catalog.json': ikea, 'catalog-dunelm.json': dunelm }
;(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const name = Object.keys(FILES).find((f) => url.endsWith(f))
  if (!name) return { ok: false, status: 404 }
  return { ok: true, status: 200, json: async () => FILES[name] }
}

const { loadCatalog, retailers } = await import('../src/lib/catalog.ts')
const merged = await loadCatalog('catalog.json')

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

const items = dunelm.items
const show = (list: unknown[], n = 3) => JSON.stringify(list.slice(0, n))

check(`catalogue has products (${items.length})`, items.length > 200, `${items.length}`)

// --- The merged catalogue ---------------------------------------------------

check(
  `both shops load together (${merged.items.length} products)`,
  merged.items.length === ikea.items.length + items.length,
  `${merged.items.length} vs ${ikea.items.length} + ${items.length}`,
)
check('both shops are offered', retailers().join() === 'IKEA,Dunelm', retailers().join())
check(
  'every Dunelm product is labelled Dunelm',
  merged.items.filter((i) => i.retailer === 'Dunelm').length === items.length,
  '',
)
check(
  'IKEA products are labelled even though the file predates retailers',
  merged.items.filter((i) => i.retailer === 'IKEA').length === ikea.items.length,
  '',
)

// --- Identity ---------------------------------------------------------------

const ids = new Set(items.map((i) => i.id))
check('every id is unique', ids.size === items.length, `${ids.size} of ${items.length}`)

// Share links pack an id through Number() and pad it back to eight digits, so
// anything non-numeric or with a meaningful leading zero cannot survive a link.
const unpackable = items.filter((i) => String(Number(i.id)).padStart(8, '0') !== i.id)
check('every id survives the share encoding', unpackable.length === 0, show(unpackable.map((i) => i.id)))

// The one that matters. Nothing in an id says which shop it came from, so a
// collision would silently resolve a shared plan to somebody else's product.
const ikeaIds = new Set(ikea.items.map((i) => i.id))
const clashes = items.filter((i) => ikeaIds.has(i.id))
check('no id collides with an IKEA article number', clashes.length === 0, show(clashes.map((i) => i.id)))

// A link is the only place an id travels on its own, so the check above is only
// worth as much as this one: the whole catalogue through a real share link.
const room = { width: 400, depth: 300, height: 240, wallColor: '#eee', floorColor: '#ddd' }
const sample = items.filter((_, n) => n % 97 === 0)
const layout: Layout = {
  version: 1,
  name: 'every-97th',
  room,
  items: sample.map((i, n) => ({ uid: `u${n}`, itemId: i.id, x: n, y: 0, z: 0, rotation: 0 as const })),
  savedAt: new Date().toISOString(),
}
const roundTripped = decodeLayout(encodeLayout(layout))
check(
  `ids survive a real share link (${sample.length} sampled)`,
  roundTripped !== null &&
    roundTripped.layout.items.map((i) => i.itemId).join() === sample.map((i) => i.id).join(),
  roundTripped ? show(roundTripped.layout.items.map((i) => i.itemId)) : 'decoded to nothing',
)

// --- Sizes ------------------------------------------------------------------

const unsized = items.filter(
  (i) => ![i.width, i.depth, i.height].every((v) => Number.isFinite(v) && v >= 5 && v <= 400),
)
check('every product has three sane dimensions', unsized.length === 0, show(unsized.map((i) => i.name)))

// An axis swap is the failure this catalogue is most prone to, and it is
// invisible in aggregate. A wardrobe standing up is taller than it is deep.
const flatWardrobes = items.filter((i) => i.category === 'wardrobe' && i.height <= i.depth)
check('no wardrobe is lying on its back', flatWardrobes.length === 0, show(flatWardrobes.map((i) => `${i.name} ${i.width}x${i.depth}x${i.height}`)))

// A bed's depth runs head to foot and no mattress is shorter than 150 cm, so
// this fails loudly the moment a length is read as something other than depth.
const beds = items.filter((i) => /\bbed\b|bunk|divan/i.test(i.type) && !/sofa/i.test(i.type))
const shallowBeds = beds.filter((i) => i.depth < 150)
check(`beds are as deep as a mattress is long (${beds.length} beds)`, shallowBeds.length === 0, show(shallowBeds.map((i) => `${i.name} ${i.width}x${i.depth}x${i.height}`)))

// --- Shape of the file ------------------------------------------------------

const counted = new Map<string, number>()
for (const i of items) counted.set(i.system, (counted.get(i.system) ?? 0) + 1)
const miscounted = dunelm.systems.filter((s) => counted.get(s.id) !== s.count)
check('every system summary counts its own items', miscounted.length === 0, show(miscounted.map((s) => s.id)))

const orphans = items.filter((i) => !dunelm.systems.some((s) => s.id === i.system))
check('every item belongs to a listed system', orphans.length === 0, show(orphans.map((i) => i.system)))

check('every product links to Dunelm', items.every((i) => i.productUrl.startsWith('https://www.dunelm.com/product/')), '')
check('prices are a number or absent', items.every((i) => i.price === null || Number.isFinite(i.price)), '')

console.log(failures === 0 ? '\nAll Dunelm catalogue checks passed.' : `\n${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
