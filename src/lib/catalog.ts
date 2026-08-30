import type { Catalog, CatalogItem, SystemCategory } from './types'

/**
 * The scraped IKEA catalogue.
 *
 * It is fetched as a static JSON asset rather than imported, so the browser
 * parses it natively and caches it separately from the app code. `loadCatalog`
 * is awaited in `main.tsx` before anything renders, which is what lets the rest
 * of the app read it synchronously.
 */
let data: Catalog | null = null
let byId = new Map<string, CatalogItem>()
let groups: ProductGroup[] = []
let bounds: SizeBounds = { width: [0, 0], depth: [0, 0], height: [0, 0] }

/**
 * One product, with its colourways collected together.
 *
 * IKEA lists every finish as its own article, so a single BILLY bookcase shows
 * up eight times and the POÄNG armchair thirty-three. Anything sharing a name,
 * a type and all three measurements is the same piece of furniture in a
 * different colour, so it is presented as one product you pick a finish for.
 * Different sizes stay separate, because those are different things to buy.
 */
export interface ProductGroup {
  key: string
  system: string
  systemLabel: string
  name: string
  type: string
  width: number
  depth: number
  height: number
  category: SystemCategory
  /** Colourways, cheapest first. Always at least one. */
  variants: CatalogItem[]
  minPrice: number | null
  maxPrice: number | null
  /** Lowercased text used for searching, one entry per variant. */
  haystacks: string[]
}

export interface SizeBounds {
  width: [number, number]
  depth: [number, number]
  height: [number, number]
}

const groupKey = (i: CatalogItem) => `${i.system}|${i.name}|${i.type}|${i.width}x${i.depth}x${i.height}`

function buildGroups(items: CatalogItem[]): ProductGroup[] {
  const map = new Map<string, CatalogItem[]>()
  for (const item of items) {
    const key = groupKey(item)
    const bucket = map.get(key)
    if (bucket) bucket.push(item)
    else map.set(key, [item])
  }

  return [...map.entries()].map(([key, variants]) => {
    // Cheapest first, so the default pick is the cheapest colourway and the
    // price range reads low-to-high.
    variants.sort(
      (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.finish.localeCompare(b.finish),
    )
    const head = variants[0]
    const prices = variants.map((v) => v.price).filter((p): p is number => p !== null)
    const shared = `${head.system} ${head.systemLabel} ${head.name} ${head.type} ` +
      `${head.width}x${head.depth}x${head.height} ${head.width} ${head.depth} ${head.height}`

    return {
      key,
      system: head.system,
      systemLabel: head.systemLabel,
      name: head.name,
      type: head.type,
      width: head.width,
      depth: head.depth,
      height: head.height,
      category: head.category,
      variants,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      haystacks: variants.map((v) => `${shared} ${v.finish}`.toLowerCase()),
    }
  })
}

function measureBounds(items: CatalogItem[]): SizeBounds {
  const span = (pick: (i: CatalogItem) => number): [number, number] => {
    let lo = Infinity
    let hi = -Infinity
    for (const i of items) {
      const v = pick(i)
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return [Math.floor(lo), Math.ceil(hi)]
  }
  return { width: span((i) => i.width), depth: span((i) => i.depth), height: span((i) => i.height) }
}

export async function loadCatalog(url = `${import.meta.env.BASE_URL}catalog.json`): Promise<Catalog> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load the product catalogue (HTTP ${res.status}). Run "npm run scrape".`)
  const loaded = (await res.json()) as Catalog
  if (!Array.isArray(loaded.items) || !loaded.items.length) {
    throw new Error('The product catalogue is empty. Run "npm run scrape".')
  }
  data = loaded
  byId = new Map(loaded.items.map((i) => [i.id, i]))
  groups = buildGroups(loaded.items)
  bounds = measureBounds(loaded.items)
  return loaded
}

export function getCatalog(): Catalog {
  if (!data) throw new Error('The catalogue was read before it finished loading')
  return data
}

export function getItem(id: string): CatalogItem | undefined {
  return byId.get(id)
}

export function sizeBounds(): SizeBounds {
  return bounds
}

export const CATEGORY_LABELS: Record<SystemCategory, string> = {
  wardrobe: 'Wardrobes',
  shelving: 'Shelving',
  kitchen: 'Kitchen',
  living: 'Living room',
  bedroom: 'Bedroom',
  office: 'Desks & office',
  seating: 'Seating',
  table: 'Tables',
  utility: 'Utility',
  kids: 'Kids',
}

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as SystemCategory[]

/** Categories present in the scraped data, in the order above. */
export function categories(): SystemCategory[] {
  const systems = getCatalog().systems
  return CATEGORY_ORDER.filter((c) => systems.some((s) => s.category === c))
}

export interface Filters {
  query: string
  category: SystemCategory | 'all'
  system: string | 'all'
  /** Selected widths in whole cm. Empty means any. */
  widths: number[]
  depths: number[]
  heights: number[]
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  category: 'all',
  system: 'all',
  widths: [],
  depths: [],
  heights: [],
}

/** The three dimensions you can filter on. */
export const DIMENSIONS = ['widths', 'depths', 'heights'] as const
export type Dimension = (typeof DIMENSIONS)[number]

export const DIMENSION_LABELS: Record<Dimension, string> = {
  widths: 'Width',
  depths: 'Depth',
  heights: 'Height',
}

const MEASURE: Record<Dimension, (g: ProductGroup) => number> = {
  widths: (g) => g.width,
  depths: (g) => g.depth,
  heights: (g) => g.height,
}

/**
 * Sizes are faceted on whole centimetres. IKEA publishes a KALLAX at 146,
 * 146.5, 146.6 and 147 cm depending on the variant, which are the same shelf
 * as far as planning a room goes; rounding folds those into one choice while
 * leaving meaningful values like PAX's 50 / 75 / 100 untouched.
 */
export const sizeOf = (group: ProductGroup, dimension: Dimension) => Math.round(MEASURE[dimension](group))

export const hasSizeFilter = (f: Filters) => DIMENSIONS.some((d) => f[d].length > 0)

/** Toggles one value in a dimension, since sizes are multi-select. */
export function toggleSize(filters: Filters, dimension: Dimension, value: number): Filters {
  const current = filters[dimension]
  return {
    ...filters,
    [dimension]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value].sort((a, b) => a - b),
  }
}

export function clearSizes(filters: Filters): Filters {
  return { ...filters, widths: [], depths: [], heights: [] }
}

/** Does a product pass every filter except, optionally, one dimension? */
function matches(group: ProductGroup, filters: Filters, terms: string[], ignore?: Dimension): number | null {
  if (filters.category !== 'all' && group.category !== filters.category) return null
  if (filters.system !== 'all' && group.system !== filters.system) return null

  for (const dimension of DIMENSIONS) {
    if (dimension === ignore) continue
    const wanted = filters[dimension]
    if (wanted.length && !wanted.includes(sizeOf(group, dimension))) return null
  }

  if (!terms.length) return 0
  const variant = group.haystacks.findIndex((h) => terms.every((t) => h.includes(t)))
  return variant === -1 ? null : variant
}

const termsOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** A product that matched, plus which colourway the query pointed at. */
export interface GroupMatch {
  group: ProductGroup
  /** Index into `group.variants`, so searching "billy oak" preselects the oak one. */
  variant: number
}

/**
 * Filters the catalogue down to products. Terms match the system, name, type,
 * finish and measurements, so "pax door", "corner" and "billy 80" all do
 * something sensible, and "billy oak" lands on the oak colourway.
 */
export function filterGroups(filters: Filters, limit = 200): { matches: GroupMatch[]; total: number } {
  const terms = termsOf(filters.query)
  const found: GroupMatch[] = []

  for (const group of groups) {
    const variant = matches(group, filters, terms)
    if (variant !== null) found.push({ group, variant })
  }
  return { matches: found.slice(0, limit), total: found.length }
}

export interface SizeOption {
  value: number
  /** How many products would remain if this size were picked. */
  count: number
}

/**
 * The sizes worth offering, given everything else that is selected.
 *
 * A dimension's own selection is excluded from its own facet, so choosing
 * "80 wide" leaves the other widths visible to switch to rather than
 * collapsing the list to the one thing already picked.
 */
export function sizeFacets(filters: Filters): Record<Dimension, SizeOption[]> {
  const terms = termsOf(filters.query)
  const tallies: Record<Dimension, Map<number, number>> = {
    widths: new Map(),
    depths: new Map(),
    heights: new Map(),
  }

  for (const dimension of DIMENSIONS) {
    const tally = tallies[dimension]
    for (const group of groups) {
      if (matches(group, filters, terms, dimension) === null) continue
      const value = sizeOf(group, dimension)
      tally.set(value, (tally.get(value) ?? 0) + 1)
    }
  }

  return {
    widths: toOptions(tallies.widths),
    depths: toOptions(tallies.depths),
    heights: toOptions(tallies.heights),
  }
}

const toOptions = (tally: Map<number, number>): SizeOption[] =>
  [...tally.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value - b.value)

export function formatPrice(price: number | null, currency: string): string {
  if (price === null) return '—'
  const symbol = { GBP: '£', EUR: '€', USD: '$', SEK: 'kr ' }[currency] ?? ''
  return `${symbol}${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/** "£70" for a single price, "£70–80" when the colourways differ. */
export function formatPriceRange(group: ProductGroup, currency: string): string {
  if (group.minPrice === null) return '—'
  const low = formatPrice(group.minPrice, currency)
  return group.maxPrice === group.minPrice ? low : `${low}–${group.maxPrice}`
}
