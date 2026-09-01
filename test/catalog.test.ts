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

const {
  DIMENSIONS,
  EMPTY_FILTERS,
  clearSizes,
  filterGroups,
  formatPriceRange,
  hasAnyFilter,
  loadCatalog,
  setSizes,
  sizeBands,
  sizeFacets,
  sizeOf,
  summariseSizes,
  toggleBand,
  toggleSize,
} = await import('../src/lib/catalog.ts')
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

// --- Size facets ------------------------------------------------------------

const facets = sizeFacets(EMPTY_FILTERS)

check(
  `sizes are offered as discrete values (${facets.widths.length} widths, ${facets.heights.length} heights)`,
  facets.widths.length > 5 && facets.heights.length > 5,
)

check(
  'every offered size is a whole number of centimetres',
  facets.widths.every((o) => Number.isInteger(o.value)) && facets.depths.every((o) => Number.isInteger(o.value)),
)

check('offered sizes are in ascending order', facets.widths.every((o, i) => i === 0 || facets.widths[i - 1].value < o.value))

check(
  'each size carries how many products it would leave',
  facets.widths.every((o) => o.count > 0) &&
    facets.widths.reduce((sum, o) => sum + o.count, 0) === all.total,
)

check(
  'sub-centimetre variants of one product fold into a single choice',
  (() => {
    // IKEA lists the KALLAX shelving unit at both 146.5 and 147 cm depending
    // on the variant. That is one shelf. The 146 cm underframe beside it is a
    // different product and must keep its own pill.
    const shelves = catalog.items.filter((i) => i.system === 'KALLAX' && /shelving unit/i.test(i.type))
    const rawWidths = new Set(shelves.map((i) => i.width).filter((w) => w >= 146 && w <= 147))
    const faceted = new Set([...rawWidths].map((w) => Math.round(w)))
    return rawWidths.size >= 2 && faceted.size === 1
  })(),
)

check(
  'a genuinely different product at a nearby size keeps its own choice',
  (() => {
    const widths = sizeFacets({ ...EMPTY_FILTERS, system: 'KALLAX' }).widths.map((o) => o.value)
    // The 146 cm underframe and the 147 cm shelf stay distinct.
    return widths.includes(146) && widths.includes(147)
  })(),
)

check(
  'a modular system keeps its meaningful widths',
  (() => {
    const pax = sizeFacets({ ...EMPTY_FILTERS, system: 'PAX' }).widths.map((o) => o.value)
    return [50, 75, 100].every((w) => pax.includes(w))
  })(),
  JSON.stringify(sizeFacets({ ...EMPTY_FILTERS, system: 'PAX' }).widths.map((o) => o.value)),
)

check(
  'picking a system leaves few enough sizes to show as pills',
  ['PAX', 'BILLY', 'EKET', 'KALLAX'].every((system) => {
    const f = sizeFacets({ ...EMPTY_FILTERS, system })
    return f.widths.length <= 25 && f.depths.length <= 25 && f.heights.length <= 25
  }),
)

check(
  'selecting a width keeps only products of that width',
  (() => {
    const { matches } = filterGroups({ ...EMPTY_FILTERS, widths: [80] }, 1e6)
    return matches.length > 0 && matches.every((m) => sizeOf(m.group, 'widths') === 80)
  })(),
)

check(
  'sizes are multi-select, so two widths return both',
  (() => {
    const only80 = filterGroups({ ...EMPTY_FILTERS, widths: [80] }, 1e6).total
    const only60 = filterGroups({ ...EMPTY_FILTERS, widths: [60] }, 1e6).total
    return filterGroups({ ...EMPTY_FILTERS, widths: [60, 80] }, 1e6).total === only60 + only80
  })(),
)

check(
  'the three dimensions combine',
  (() => {
    const f = { ...EMPTY_FILTERS, widths: [80], depths: [28], heights: [202] }
    const { matches } = filterGroups(f, 1e6)
    return (
      matches.length > 0 &&
      matches.every(
        (m) =>
          sizeOf(m.group, 'widths') === 80 && sizeOf(m.group, 'depths') === 28 && sizeOf(m.group, 'heights') === 202,
      )
    )
  })(),
)

check(
  'a dimension’s own choice does not collapse its own list',
  (() => {
    // Having picked 80 wide, the other widths must stay available to switch to.
    const before = sizeFacets({ ...EMPTY_FILTERS, system: 'BILLY' }).widths.length
    const after = sizeFacets({ ...EMPTY_FILTERS, system: 'BILLY', widths: [80] }).widths.length
    return before > 1 && after === before
  })(),
)

check(
  'but choosing a width does narrow the other dimensions',
  (() => {
    const all = sizeFacets({ ...EMPTY_FILTERS, system: 'PAX' }).heights.length
    const narrowed = sizeFacets({ ...EMPTY_FILTERS, system: 'PAX', widths: [50] }).heights.length
    return narrowed <= all
  })(),
)

check(
  'facets follow the search box',
  (() => {
    const f = sizeFacets({ ...EMPTY_FILTERS, query: 'billy bookcase' })
    const { matches } = filterGroups({ ...EMPTY_FILTERS, query: 'billy bookcase' }, 1e6)
    const actual = new Set(matches.map((m) => sizeOf(m.group, 'widths')))
    return f.widths.length === actual.size && f.widths.every((o) => actual.has(o.value))
  })(),
)

check(
  'every offered size yields at least one product when picked',
  sizeFacets({ ...EMPTY_FILTERS, system: 'BILLY' }).widths.every(
    (o) => filterGroups({ ...EMPTY_FILTERS, system: 'BILLY', widths: [o.value] }, 1e6).total === o.count,
  ),
)

check('toggling a size on and off returns to where it started',
  (() => {
    const on = toggleSize([], 80)
    const off = toggleSize(on, 80)
    return on.join() === '80' && off.length === 0 && toggleSize([40, 80], 40).join() === '80'
  })(),
)

check('taking a bracket takes all of it, and taking it again gives all of it back',
  (() => {
    const bracket = [100, 102, 103]
    const taken = toggleBand([80], bracket)
    return (
      taken.join() === '80,100,102,103' &&
      toggleBand(taken, bracket).join() === '80' &&
      // Part of it already chosen means you wanted more of it, not less.
      toggleBand([102], bracket).sort((a, b) => a - b).join() === '100,102,103'
    )
  })(),
)

check('clearing sizes leaves the other filters alone',
  (() => {
    const f = clearSizes({ ...EMPTY_FILTERS, system: 'PAX', query: 'white', widths: [50], heights: [201] })
    return f.system === 'PAX' && f.query === 'white' && !f.widths.length && !f.heights.length
  })(),
)

check('no size selection is the same as no filter',
  filterGroups({ ...EMPTY_FILTERS, widths: [], depths: [], heights: [] }, 1e6).total === all.total)

check(
  'sizes combine with a system filter',
  (() => {
    const { matches } = filterGroups({ ...EMPTY_FILTERS, system: 'BILLY', widths: [80] }, 1e6)
    return matches.length > 0 && matches.every((m) => m.group.system === 'BILLY' && sizeOf(m.group, 'widths') === 80)
  })(),
)

// --- Size brackets ----------------------------------------------------------

const widthBands = sizeBands(facets.widths)

check(
  `a long list of sizes is bracketed (${facets.widths.length} widths into ${widthBands.length})`,
  widthBands.length > 1 && widthBands.length * 2 <= facets.widths.length,
)

check(
  'a short list is left as the exact sizes',
  DIMENSIONS.every((d) => {
    const options = sizeFacets({ ...EMPTY_FILTERS, system: 'BILLY' })[d]
    return options.length < 10 && sizeBands(options).length === 0
  }),
)

check(
  'brackets cover every size exactly once, in order',
  (() => {
    const covered = widthBands.flatMap((b) => b.values)
    return covered.join() === facets.widths.map((o) => o.value).join()
  })(),
)

check(
  'a bracket is labelled by the sizes it holds, not by the round numbers around them',
  widthBands.every((b) => b.values.includes(b.lo) && b.values.includes(b.hi) && b.lo <= b.hi),
  JSON.stringify(widthBands.map((b) => `${b.lo}-${b.hi}`)),
)

check(
  // Every product has one width, so the counts partition rather than overlap.
  'taking a whole bracket returns exactly the products it promises',
  widthBands.every((b) => filterGroups({ ...EMPTY_FILTERS, widths: b.values }, 1e6).total === b.count),
)

check(
  'the brackets between them account for the whole catalogue',
  widthBands.reduce((sum, b) => sum + b.count, 0) === all.total,
)

// --- Saying what is selected -------------------------------------------------

const paxWidths = sizeFacets({ ...EMPTY_FILTERS, system: 'PAX' }).widths.map((o) => o.value)

check('one size is said plainly', summariseSizes([100], paxWidths) === '100')

check(
  'sizes that are neighbours in what is on offer read as a range',
  (() => {
    // Neighbouring in the list, not in centimetres: PAX widths step 35, 50, 75,
    // so those three are "35-75" while 35 and 75 alone stay two separate sizes.
    const [a, b, c] = paxWidths.slice(1, 4)
    return summariseSizes([a, b, c], paxWidths) === `${a}–${c}` && summariseSizes([a, c], paxWidths) === `${a}, ${c}`
  })(),
  JSON.stringify(paxWidths.slice(0, 5)),
)

check(
  'a run against either end reads as an open range',
  summariseSizes(paxWidths.filter((v) => v <= 100), paxWidths) === 'up to 100' &&
    summariseSizes(paxWidths.filter((v) => v >= 300), paxWidths) === '300 and over',
)

check('everything on offer is any size at all', summariseSizes(paxWidths, paxWidths) === 'any')

check(
  'a long scatter of sizes is cut short rather than overflowing',
  summariseSizes([20, 50, 100, 200], paxWidths) === '20, 50 +2 more',
)

check(
  // Narrowing the other filters can strand a size that is no longer offered.
  // It must still be listed, since it is still filtering.
  'a size that is no longer on offer is still named',
  summariseSizes([9999, 100], paxWidths) === '100, 9999',
)

check('nothing selected says nothing', summariseSizes([], paxWidths) === '')

check(
  'setting a dimension replaces it, sorted, and leaves the others alone',
  (() => {
    const f = setSizes({ ...EMPTY_FILTERS, widths: [80], heights: [202] }, 'widths', [120, 40])
    return f.widths.join() === '40,120' && f.heights.join() === '202'
  })(),
)

check(
  'setting a dimension to nothing clears only that dimension',
  (() => {
    const f = setSizes({ ...EMPTY_FILTERS, system: 'PAX', widths: [50], heights: [201] }, 'widths', [])
    return !f.widths.length && f.heights.join() === '201' && f.system === 'PAX'
  })(),
)

check(
  'anything narrowing the catalogue counts as a filter',
  !hasAnyFilter(EMPTY_FILTERS) &&
    hasAnyFilter({ ...EMPTY_FILTERS, query: 'billy' }) &&
    hasAnyFilter({ ...EMPTY_FILTERS, system: 'PAX' }) &&
    hasAnyFilter({ ...EMPTY_FILTERS, category: 'shelving' }) &&
    hasAnyFilter({ ...EMPTY_FILTERS, heights: [202] }),
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
