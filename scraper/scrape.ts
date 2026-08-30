/**
 * Scrapes IKEA product data for each system in `systems.ts` and writes
 * `public/catalog.json`.
 *
 * Two sources, cheapest first:
 *   1. The JSON endpoint the ikea.com search page calls. One request per system
 *      returns the whole result set, including a `WxDxH cm` string for most
 *      flat-pack storage.
 *   2. The product page, for items the search API leaves without usable
 *      dimensions (sofas, desks, dining tables). Pages are ~1 MB, so these are
 *      capped, run concurrently and cached on disk under scraper/.cache.
 *
 *   npm run scrape                 # fetch and write the catalog
 *   npm run scrape:dry             # fetch and report, write nothing
 *   PIP_LIMIT=0 npm run scrape     # skip the product-page pass
 *   IKEA_MARKET=de IKEA_LANG=de npm run scrape
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYSTEMS } from './systems.ts'
import { colorForFinish, humanizeFinish } from './finish.ts'
import { fetchMeasures, mapLimit, type Measures } from './pip.ts'
import type { Catalog, CatalogItem, FaceStyle, SystemDef, SystemSummary } from '../src/lib/types.ts'

const MARKET = process.env.IKEA_MARKET ?? 'gb'
const LANG = process.env.IKEA_LANG ?? 'en'
const DRY_RUN = process.argv.includes('--dry-run')
/** Max product pages to fetch in the enrichment pass. */
const PIP_LIMIT = Number(process.env.PIP_LIMIT ?? 3000)
const PIP_CONCURRENCY = Number(process.env.PIP_CONCURRENCY ?? 5)
const PAGE_SIZE = 500
const DELAY_MS = 400

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/catalog.json')

interface RawProduct {
  id?: string
  itemNoGlobal?: string
  name?: string
  typeName?: string
  itemMeasureReferenceText?: string
  mainImageUrl?: string
  pipUrl?: string
  salesPrice?: { numeral?: number; currencyCode?: string }
  gprDescription?: { variants?: RawProduct[] }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchSystem(system: SystemDef): Promise<RawProduct[]> {
  const url =
    `https://sik.search.blue.cdtapps.com/${MARKET}/${LANG}/search-result-page` +
    `?q=${encodeURIComponent(system.query)}&size=${PAGE_SIZE}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': `${LANG}-${MARKET.toUpperCase()},${LANG};q=0.9`,
      Referer: `https://www.ikea.com/${MARKET}/${LANG}/search/`,
      Origin: 'https://www.ikea.com',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

  const body = (await res.json()) as {
    searchResultPage?: { products?: { main?: { items?: { product?: RawProduct }[] } } }
  }
  const items = body.searchResultPage?.products?.main?.items ?? []

  // Variants carry their own size and colour, so a single search hit can yield
  // a dozen placeable products. Flatten them in alongside the parent.
  const out: RawProduct[] = []
  for (const entry of items) {
    const p = entry.product
    if (!p) continue
    out.push(p)
    for (const v of p.gprDescription?.variants ?? []) out.push(v)
  }
  return out
}

/**
 * IKEA transliterates Swedish characters in its URLs, and not the way NFD
 * would: POÄNG becomes `poaeng`, SÖDERHAMN becomes `soederhamn`, BESTÅ becomes
 * `besta`.
 */
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/å/g, 'a')
    // Apostrophes vanish rather than splitting a word: "children's" -> "childrens".
    .replace(/['\u2019]/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Does this product belong to the system we searched for? */
function belongsTo(product: RawProduct, system: SystemDef): boolean {
  const name = (product.name ?? '').toUpperCase()
  if (!name) return false
  const candidates = [system.id, ...(system.aliases ?? [])].map((s) => s.toUpperCase())
  // Names are either "PAX" or a combination like "PAX / BERGSBO".
  return name
    .split('/')
    .map((s) => s.trim())
    .some((part) => candidates.includes(part))
}

/**
 * IKEA product URLs look like
 * `/p/pax-wardrobe-frame-white-stained-oak-effect-99429426/`, i.e.
 * `{name}-{type}-{finish}-{article}`. Stripping the slugified name and type
 * leaves the finish. If the slug does not start the way we expect (an
 * unhandled transliteration, say), fall back to dropping as many leading
 * tokens as the name and type have words, which gets the same answer without
 * relying on the spelling.
 */
function parseFinish(product: RawProduct): string {
  const m = (product.pipUrl ?? '').match(/\/p\/([^/?#]+)/)
  if (!m) return ''
  let slug = m[1].replace(/-s?\d{6,}$/, '') // trailing article number

  const prefixes = [slugify(product.name ?? ''), slugify(product.typeName ?? '')].filter(Boolean)
  let matchedAll = true
  for (const prefix of prefixes) {
    if (slug.startsWith(prefix)) slug = slug.slice(prefix.length).replace(/^-/, '')
    else matchedAll = false
  }
  if (matchedAll) return slug

  const tokens = prefixes.join('-').split('-').filter(Boolean).length
  return m[1]
    .replace(/-s?\d{6,}$/, '')
    .split('-')
    .slice(tokens)
    .join('-')
}

interface Dims {
  width: number
  depth: number
  height: number
}

const sane = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 5 && v <= 400

/**
 * Parses IKEA's reference measurement, e.g. "100x58x201 cm" (width x depth x
 * height). Extendable furniture is written "140/196x85 cm"; we take the
 * retracted size so the piece fits where the planner says it fits.
 */
function parseMeasureText(text: string | undefined): Dims | null {
  if (!text) return null
  const retracted = text.replace(/(\d+(?:[.,]\d+)?)\s*\/\s*\d+(?:[.,]\d+)?/g, '$1')
  const nums = retracted.match(/\d+(?:[.,]\d+)?/g)
  if (!nums || nums.length < 3) return null
  const [width, depth, height] = nums.map((v) => parseFloat(v.replace(',', '.')))
  if (!sane(width) || !sane(depth) || !sane(height)) return null
  return { width, depth, height }
}

/**
 * Turns a product page's measurement table into a box.
 *
 * IKEA does not always publish a depth. Tables and sofas get a `length`, which
 * is their long horizontal axis and therefore the width; beds get a `length`
 * that runs head to foot, i.e. away from the wall, which is the depth. Round
 * tables give only a diameter.
 */
function dimsFromMeasures(m: Measures, type: string): Dims | null {
  const isBed = /\bbed\b|bedstead|divan|mattress/.test(type.toLowerCase())

  let width = m.width
  let depth = m.depth
  const height = m.height ?? m['max height'] ?? m['min height']

  if (m.diameter !== undefined) {
    width ??= m.diameter
    depth ??= m.diameter
  }

  if (m.length !== undefined) {
    if (isBed) {
      depth ??= m.length
    } else if (depth === undefined && width !== undefined) {
      // Length is the long side; keep the piece wider than it is deep.
      depth = Math.min(width, m.length)
      width = Math.max(width, m.length)
    } else {
      width ??= m.length
    }
  }

  if (!sane(width) || !sane(depth) || !sane(height)) return null
  return { width, depth, height }
}

/** Picks the front-face detailing used when rendering the box. */
function faceStyle(type: string, width: number): FaceStyle {
  const t = type.toLowerCase()
  if (/sofa|armchair|chair|stool|pouffe|bed|mattress|cushion|cover/.test(t)) return 'soft'
  if (/desk|table|worktop|table top/.test(t)) return 'surface'
  if (/drawer|chest/.test(t)) return 'drawers'
  if (/bookcase|shelving|shelf|open|frame|rail|post/.test(t)) return 'shelves'
  if (/door|wardrobe|cabinet|cupboard/.test(t)) return width >= 80 ? 'double-door' : 'door'
  return 'plain'
}

function buildItem(product: RawProduct, system: SystemDef, dims: Dims): CatalogItem {
  const finishSlug = parseFinish(product)
  return {
    id: (product.itemNoGlobal ?? product.id)!,
    system: system.id,
    systemLabel: system.label ?? system.id,
    name: product.name!,
    type: product.typeName!,
    finish: humanizeFinish(finishSlug) || 'unspecified',
    color: colorForFinish(finishSlug),
    width: dims.width,
    depth: dims.depth,
    height: dims.height,
    measureText:
      product.itemMeasureReferenceText ||
      `${dims.width}x${dims.depth}x${dims.height} cm`,
    price: product.salesPrice?.numeral ?? null,
    currency: product.salesPrice?.currencyCode ?? '',
    imageUrl: product.mainImageUrl ?? '',
    productUrl: product.pipUrl ?? '',
    category: system.category,
    face: faceStyle(product.typeName!, dims.width),
  }
}

interface Pending {
  product: RawProduct
  system: SystemDef
}

async function main() {
  console.log(`Scraping ${SYSTEMS.length} IKEA systems from ${MARKET}/${LANG}\n`)

  const byId = new Map<string, CatalogItem>()
  const claimed = new Set<string>()
  const pending: Pending[] = []
  const perSystem = new Map<string, number>()
  const failures: string[] = []

  // --- Pass 1: search API ---
  for (const system of SYSTEMS) {
    process.stdout.write(`  ${system.id.padEnd(12)} `)
    let kept = 0
    let queued = 0
    try {
      const matched = (await fetchSystem(system)).filter((p) => belongsTo(p, system))
      for (const product of matched) {
        const id = product.itemNoGlobal ?? product.id
        if (!id || !product.name || !product.typeName) continue
        // First system to claim an article wins, so shared fronts land once.
        if (claimed.has(id)) continue
        claimed.add(id)

        const dims = parseMeasureText(product.itemMeasureReferenceText)
        if (dims) {
          byId.set(id, buildItem(product, system, dims))
          kept++
        } else if (product.pipUrl) {
          pending.push({ product, system })
          queued++
        }
      }
      console.log(
        `${String(matched.length).padStart(4)} in system -> ${String(kept).padStart(4)} sized, ${queued} need product page`,
      )
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`)
      failures.push(system.id)
    }
    perSystem.set(system.id, kept)
    await sleep(DELAY_MS)
  }

  // --- Pass 2: product pages, round-robin so every system gets covered ---
  const budget = Math.min(PIP_LIMIT, pending.length)
  if (budget > 0) {
    const queues = new Map<string, Pending[]>()
    for (const p of pending) {
      const q = queues.get(p.system.id) ?? []
      q.push(p)
      queues.set(p.system.id, q)
    }
    const ordered: Pending[] = []
    while (ordered.length < budget) {
      let drained = true
      for (const q of queues.values()) {
        if (ordered.length >= budget) break
        const next = q.shift()
        if (next) {
          ordered.push(next)
          drained = false
        }
      }
      if (drained) break
    }

    console.log(`\nFetching ${ordered.length} product pages (of ${pending.length} unsized)...`)
    let enriched = 0
    let done = 0
    await mapLimit(ordered, PIP_CONCURRENCY, async ({ product, system }) => {
      const id = (product.itemNoGlobal ?? product.id)!
      const dims = dimsFromMeasures(await fetchMeasures(id, product.pipUrl!), product.typeName!)
      if (dims) {
        byId.set(id, buildItem(product, system, dims))
        perSystem.set(system.id, (perSystem.get(system.id) ?? 0) + 1)
        enriched++
      }
      if (++done % 100 === 0) process.stdout.write(`  ...${done}/${ordered.length}\n`)
    })
    console.log(`  ${enriched} of ${ordered.length} product pages yielded full dimensions.`)
  }

  // --- Write ---
  const items = [...byId.values()].sort(
    (a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name) || a.width - b.width,
  )
  const currency = items.find((i) => i.currency)?.currency ?? ''

  const catalog: Catalog = {
    scrapedAt: new Date().toISOString(),
    market: `${MARKET}/${LANG}`,
    currency,
    systems: SYSTEMS.map<SystemSummary>((s) => ({
      id: s.id,
      label: s.label ?? s.id,
      category: s.category,
      blurb: s.blurb,
      count: perSystem.get(s.id) ?? 0,
      wallMountable: s.wallMountable ?? false,
    })).filter((s) => s.count > 0),
    items,
  }

  console.log(`\n${items.length} placeable products across ${catalog.systems.length} systems.`)
  for (const s of catalog.systems) console.log(`  ${s.id.padEnd(12)} ${s.count}`)
  if (failures.length) console.log(`Failed systems: ${failures.join(', ')}`)

  if (DRY_RUN) {
    console.log('Dry run: nothing written.')
    return
  }
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(catalog))
  console.log(`Wrote ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
