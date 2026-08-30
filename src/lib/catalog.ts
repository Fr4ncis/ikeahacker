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

/** An inclusive cm range. A bound of null means "no limit". */
export type Range = [min: number | null, max: number | null]

export interface Filters {
  query: string
  category: SystemCategory | 'all'
  system: string | 'all'
  width: Range
  depth: Range
  height: Range
}

export const NO_RANGE: Range = [null, null]

export const EMPTY_FILTERS: Filters = {
  query: '',
  category: 'all',
  system: 'all',
  width: NO_RANGE,
  depth: NO_RANGE,
  height: NO_RANGE,
}

export const isRangeSet = (r: Range) => r[0] !== null || r[1] !== null

export const hasSizeFilter = (f: Filters) => isRangeSet(f.width) || isRangeSet(f.depth) || isRangeSet(f.height)

const inRange = (value: number, [min, max]: Range) =>
  (min === null || value >= min) && (max === null || value <= max)

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
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches: GroupMatch[] = []

  for (const group of groups) {
    if (filters.category !== 'all' && group.category !== filters.category) continue
    if (filters.system !== 'all' && group.system !== filters.system) continue
    if (!inRange(group.width, filters.width)) continue
    if (!inRange(group.depth, filters.depth)) continue
    if (!inRange(group.height, filters.height)) continue

    if (!terms.length) {
      matches.push({ group, variant: 0 })
      continue
    }
    const variant = group.haystacks.findIndex((h) => terms.every((t) => h.includes(t)))
    if (variant !== -1) matches.push({ group, variant })
  }

  return { matches: matches.slice(0, limit), total: matches.length }
}

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
