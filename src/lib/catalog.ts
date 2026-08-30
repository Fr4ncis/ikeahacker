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

export async function loadCatalog(url = `${import.meta.env.BASE_URL}catalog.json`): Promise<Catalog> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load the product catalogue (HTTP ${res.status}). Run "npm run scrape".`)
  const loaded = (await res.json()) as Catalog
  if (!Array.isArray(loaded.items) || !loaded.items.length) {
    throw new Error('The product catalogue is empty. Run "npm run scrape".')
  }
  data = loaded
  byId = new Map(loaded.items.map((i) => [i.id, i]))
  return loaded
}

export function getCatalog(): Catalog {
  if (!data) throw new Error('The catalogue was read before it finished loading')
  return data
}

export function getItem(id: string): CatalogItem | undefined {
  return byId.get(id)
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
  /** Only show items that fit within this width, in cm. 0 means no limit. */
  maxWidth: number
}

/**
 * Filters the catalogue. Terms match the system, name, type, finish and the
 * measurements, so "pax door", "corner" and "billy 80" all do something
 * sensible.
 */
export function filterItems(filters: Filters, limit = 300): { items: CatalogItem[]; total: number } {
  const terms = filters.query.toLowerCase().split(/\s+/).filter(Boolean)

  const matched = getCatalog().items.filter((item) => {
    if (filters.category !== 'all' && item.category !== filters.category) return false
    if (filters.system !== 'all' && item.system !== filters.system) return false
    if (filters.maxWidth > 0 && item.width > filters.maxWidth) return false
    if (!terms.length) return true
    const haystack = (
      `${item.system} ${item.systemLabel} ${item.name} ${item.type} ${item.finish} ` +
      `${item.width}x${item.depth}x${item.height} ${item.width} ${item.depth} ${item.height}`
    ).toLowerCase()
    return terms.every((t) => haystack.includes(t))
  })

  return { items: matched.slice(0, limit), total: matched.length }
}

export function formatPrice(price: number | null, currency: string): string {
  if (price === null) return '—'
  const symbol = { GBP: '£', EUR: '€', USD: '$', SEK: 'kr ' }[currency] ?? ''
  return `${symbol}${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
