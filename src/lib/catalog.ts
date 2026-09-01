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
let groupOfItem = new Map<string, ProductGroup>()
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
  groupOfItem = new Map(groups.flatMap((g) => g.variants.map((v) => [v.id, g] as const)))
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

/**
 * The product an article belongs to, and with it the other colourways of the
 * same piece in the same size. Swapping between them is a change of finish
 * rather than a change of furniture, which is why the measurements are part of
 * the grouping key.
 */
export function groupOf(itemId: string): ProductGroup | undefined {
  return groupOfItem.get(itemId)
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

/** Adds or removes one size, since sizes are multi-select. */
export const toggleSize = (chosen: number[], value: number): number[] =>
  chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value]

/** Takes a whole bracket, or gives it back when all of it is already taken. */
export const toggleBand = (chosen: number[], band: number[]): number[] =>
  band.every((v) => chosen.includes(v))
    ? chosen.filter((v) => !band.includes(v))
    : [...chosen, ...band.filter((v) => !chosen.includes(v))]

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

/** A run of neighbouring sizes, offered as one choice when the exact list is too long. */
export interface SizeBand {
  /** The smallest and largest size actually present, not the round bracket they fall in. */
  lo: number
  hi: number
  count: number
  values: number[]
}

/**
 * Below this many sizes the exact list is short enough to read at a glance, so
 * it is shown as it is: BILLY's nine widths and PAX's four heights stay one
 * click away. Above it the list becomes a wall of numbers, and with no system
 * chosen there are 184 distinct widths.
 */
const BAND_FROM = 18
/** Enough brackets to see the shape of the range, few enough to scan in one row or two. */
const MAX_BANDS = 8
/** Bracket widths worth reading, smallest first. */
const BAND_STEPS = [5, 10, 20, 25, 50, 100, 200, 500]

function bandsAt(options: SizeOption[], step: number): SizeBand[] {
  const bands = new Map<number, SizeBand>()
  for (const o of options) {
    const bracket = Math.floor(o.value / step) * step
    let band = bands.get(bracket)
    if (!band) bands.set(bracket, (band = { lo: o.value, hi: o.value, count: 0, values: [] }))
    // A band is labelled by the sizes it holds rather than by its bracket, so
    // the widths 15 to 49 read "15-49" and not "0-49".
    band.hi = o.value
    band.count += o.count
    band.values.push(o.value)
  }
  return [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([, band]) => band)
}

/**
 * Groups a long list of sizes into a handful of brackets to pick from.
 *
 * The counts add up exactly, because a product has one width and so lands in
 * one bracket. Returns nothing when the list is already short, or when
 * bracketing it would not save the reader enough to be worth the extra step.
 */
export function sizeBands(options: SizeOption[]): SizeBand[] {
  if (options.length < BAND_FROM) return []
  for (const step of BAND_STEPS) {
    const bands = bandsAt(options, step)
    if (bands.length <= MAX_BANDS && bands.length * 2 <= options.length) return bands
  }
  return []
}

/** Replaces one dimension's selection outright. Passing none clears it. */
export function setSizes(filters: Filters, dimension: Dimension, values: number[]): Filters {
  return { ...filters, [dimension]: [...values].sort((a, b) => a - b) }
}

/**
 * A selection written the way you would say it: "80", "80-120", "up to 60".
 *
 * Runs are consecutive in what is *available*, not in whole centimetres, so
 * picking every PAX width reads "50-100" rather than listing 50, 75 and 100.
 */
export function summariseSizes(selected: number[], available: number[]): string {
  if (!selected.length) return ''
  const order = new Map(available.map((v, i) => [v, i]))
  const sorted = [...selected].sort((a, b) => a - b)

  const runs: number[][] = []
  for (const value of sorted) {
    const last = runs[runs.length - 1]
    const prev = last?.[last.length - 1]
    // A size that is no longer available (the other filters moved under it)
    // cannot continue a run, since it has no place in the order.
    const follows =
      last !== undefined && prev !== undefined && order.has(value) && order.has(prev) && order.get(value) === order.get(prev)! + 1
    if (follows) last.push(value)
    else runs.push([value])
  }

  const first = available[0]
  const last = available[available.length - 1]
  const text = runs.map((run) => {
    const [lo, hi] = [run[0], run[run.length - 1]]
    if (lo === hi) return `${lo}`
    if (lo === first && hi === last) return 'any'
    if (lo === first) return `up to ${hi}`
    if (hi === last) return `${lo} and over`
    return `${lo}–${hi}`
  })

  return text.length <= 2 ? text.join(', ') : `${text.slice(0, 2).join(', ')} +${text.length - 2} more`
}

/** "80" for a bracket holding one size, "100–148" for the rest. */
export const bandLabel = (band: SizeBand) => (band.lo === band.hi ? `${band.lo}` : `${band.lo}–${band.hi}`)

/** Is anything at all narrowing the catalogue down? */
export const hasAnyFilter = (f: Filters) =>
  f.query.trim() !== '' || f.category !== 'all' || f.system !== 'all' || hasSizeFilter(f)

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
