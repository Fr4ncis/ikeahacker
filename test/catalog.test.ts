/**
 * Checks on how the catalogue is grouped and filtered: colourways of one
 * product must collapse together, different sizes must not, and the size
 * ranges must mean what they say. Run with `npm test`.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Catalog } from '../src/lib/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(resolve(here, '../public/catalog.json'), 'utf8')) as Catalog
;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({ ok: true, status: 200, json: async () => catalog })

const { EMPTY_FILTERS, filterGroups, formatPriceRange, loadCatalog, sizeBounds } = await import('../src/lib/catalog.ts')
await loadCatalog('ignored')

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

const all = filterGroups(EMPTY_FILTERS, 1e6)

// --- Grouping ---------------------------------------------------------------

check(
  `grouping collapses ${catalog.items.length} articles into ${all.total} products`,
  all.total > 0 && all.total < catalog.items.length,
  `${all.total} vs ${catalog.items.length}`,
)

check(
  'every article ends up in exactly one product',
  (() => {
    const seen = new Set<string>()
    for (const { group } of all.matches) for (const v of group.variants) seen.add(v.id)
    return seen.size === catalog.items.length
  })(),
)

check(
  'a product’s colourways all share its exact measurements',
  all.matches.every(({ group }) =>
    group.variants.every((v) => v.width === group.width && v.depth === group.depth && v.height === group.height),
  ),
)

check(
  'a product’s colourways all share its name and type',
  all.matches.every(({ group }) => group.variants.every((v) => v.name === group.name && v.type === group.type)),
)

check(
  'colourways are listed cheapest first',
  all.matches.every(({ group }) =>
    group.variants.every((v, i) => i === 0 || (group.variants[i - 1].price ?? Infinity) <= (v.price ?? Infinity)),
  ),
)

check(
  'the same product in a different size stays a separate product',
  (() => {
    const billy = all.matches.filter((m) => m.group.name === 'BILLY' && m.group.type === 'Bookcase')
    const sizes = new Set(billy.map((m) => `${m.group.width}x${m.group.depth}x${m.group.height}`))
    // More than one BILLY bookcase size exists, and each is its own product.
    return sizes.size > 1 && sizes.size === billy.length
  })(),
)

check(
  'a product with many colourways really does collapse',
  (() => {
    const poang = all.matches.find((m) => m.group.name === 'POÄNG' && m.group.type === 'Armchair')
    return !!poang && poang.group.variants.length > 10
  })(),
  String(all.matches.find((m) => m.group.name === 'POÄNG' && m.group.type === 'Armchair')?.group.variants.length),
)

check(
  'a price range is shown only when the colourways actually differ in price',
  (() => {
    const varying = all.matches.find(({ group }) => group.minPrice !== null && group.maxPrice !== group.minPrice)
    const flat = all.matches.find(({ group }) => group.minPrice !== null && group.maxPrice === group.minPrice)
    return (
      !!varying && !!flat &&
      formatPriceRange(varying.group, 'GBP').includes('–') &&
      !formatPriceRange(flat.group, 'GBP').includes('–')
    )
  })(),
)

// --- Search points at the right colourway -----------------------------------

check(
  'searching a finish preselects that colourway',
  (() => {
    const { matches } = filterGroups({ ...EMPTY_FILTERS, query: 'billy bookcase oak effect' })
    const m = matches.find((x) => x.group.name === 'BILLY' && x.group.variants.length > 1)
    return !!m && m.group.variants[m.variant].finish.includes('oak')
  })(),
)

check(
  'a search with no finish term lands on the cheapest colourway',
  (() => {
    const { matches } = filterGroups({ ...EMPTY_FILTERS, query: 'billy bookcase' })
    return matches.length > 0 && matches.every((m) => m.variant === 0)
  })(),
)

check(
  'searching by measurement still works',
  filterGroups({ ...EMPTY_FILTERS, query: 'billy 80 202' }).total > 0,
)

// --- Size ranges ------------------------------------------------------------

const bounds = sizeBounds()
check(
  `size bounds span the catalogue (w ${bounds.width[0]}-${bounds.width[1]} cm)`,
  bounds.width[0] > 0 && bounds.width[1] >= bounds.width[0] && bounds.height[1] > 0,
)

check(
  'a maximum width excludes everything wider',
  (() => {
    const { matches } = filterGroups({ ...EMPTY_FILTERS, width: [null, 60] }, 1e6)
    return matches.length > 0 && matches.every((m) => m.group.width <= 60)
  })(),
)

check(
  'a minimum height excludes everything shorter',
  (() => {
    const { matches } = filterGroups({ ...EMPTY_FILTERS, height: [180, null] }, 1e6)
    return matches.length > 0 && matches.every((m) => m.group.height >= 180)
  })(),
)

check(
  'the three ranges combine',
  (() => {
    const { matches } = filterGroups(
      { ...EMPTY_FILTERS, width: [40, 100], depth: [null, 40], height: [150, 220] },
      1e6,
    )
    return (
      matches.length > 0 &&
      matches.every(
        (m) =>
          m.group.width >= 40 && m.group.width <= 100 && m.group.depth <= 40 &&
          m.group.height >= 150 && m.group.height <= 220,
      )
    )
  })(),
)

check(
  'an impossible range returns nothing rather than everything',
  filterGroups({ ...EMPTY_FILTERS, width: [900, 950] }, 1e6).total === 0,
)

check(
  'an open range is the same as no filter',
  filterGroups({ ...EMPTY_FILTERS, width: [null, null] }, 1e6).total === all.total,
)

check(
  'ranges combine with a system filter',
  (() => {
    const { matches } = filterGroups({ ...EMPTY_FILTERS, system: 'BILLY', height: [null, 110] }, 1e6)
    return matches.length > 0 && matches.every((m) => m.group.system === 'BILLY' && m.group.height <= 110)
  })(),
)

// --- Right-click needs a usable link -----------------------------------------

check(
  'every colourway carries its own ikea.com URL and article number',
  all.matches.every(({ group }) =>
    group.variants.every((v) => /^https:\/\/www\.ikea\.com\//.test(v.productUrl) && /^\d{8}$/.test(v.id)),
  ),
)

check(
  'colourways within a product have distinct articles',
  all.matches.every(({ group }) => new Set(group.variants.map((v) => v.id)).size === group.variants.length),
)

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
